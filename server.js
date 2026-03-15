require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const Stripe    = require('stripe');
const nodemailer= require('nodemailer');
const Anthropic = require('@anthropic-ai/sdk');
const { Pool }  = require('pg');
const crypto    = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

/* ── CORS ── */
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (origin.includes('github.io') || origin.includes('aurarometours.com') || origin.includes('localhost') || origin.includes('127.0.0.1')) return cb(null, true);
    cb(new Error('CORS blocked: ' + origin));
  }
}));

/* ── DATABASE ── */
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      tour TEXT NOT NULL,
      people TEXT,
      date TEXT,
      time TEXT,
      notes TEXT,
      payment_method TEXT,
      stripe_payment_id TEXT,
      status TEXT DEFAULT 'pending',
      amount NUMERIC,
      notes_admin TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location TEXT,
      tour_name TEXT,
      stars INTEGER NOT NULL,
      text TEXT NOT NULL,
      approved BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS blocked_dates (
      date TEXT PRIMARY KEY,
      reason TEXT DEFAULT 'Indisponibile',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE SEQUENCE IF NOT EXISTS booking_counter START 1001;
  `);
  console.log('✅ Database inizializzato');
}

/* ── SERVICES ── */
let stripe, anthropic, transporter;
try { stripe = new Stripe(process.env.STRIPE_SECRET_KEY); } catch(e) { console.error('[STRIPE]', e.message); }
try { anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }); } catch(e) { console.error('[ANTHROPIC]', e.message); }
try { transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } }); } catch(e) { console.error('[EMAIL]', e.message); }

/* ── AUTH ── */
function adminAuth(req, res, next) {
  if (req.headers['x-admin-token'] !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorizzato' });
  next();
}

/* ── SYSTEM PROMPT ── */
const SYSTEM_PROMPT = `Sei l'assistente virtuale di Aura Rome Tours, azienda che offre tour privati esclusivi in golf cart Alba nel centro storico di Roma.
TOUR E PREZZI:
- La Grande Bellezza: 3h, da €250 p.p. — Colosseo, Fori Imperiali, Piazza Venezia, Bocca della Verità
- Roma by Night: 2.5h, da €310 p.p. — Fontana di Trevi illuminata, Piazza Navona, Pantheon, aperitivo incluso
- Full Roma Experience: 3h+, da €400 p.p. — il meglio + foto professionali (la più richiesta)
- Shooting Tour: da €500 — tour + fotografo professionale
- Gruppi 7+: prezzo su richiesta
PRENOTAZIONE: form sul sito, WhatsApp +39 320 689 1014, Calendly, email info@aurarometours.com
POLITICHE: Tour privato, partenza dall'hotel, cancellazione gratuita 24h, max 6 persone per cart, ideale per bambini/anziani/disabili.
CONTATTI: WhatsApp +39 320 689 1014 | info@aurarometours.com | @aura.intravel
Rispondi nella lingua dell'utente (IT/EN/FR/ES). Tono caldo e professionale. Risposte brevi (2-4 righe).`;

/* ════════════════════════════════
   PUBLIC ENDPOINTS
════════════════════════════════ */

app.get('/health', async (req, res) => {
  let dbOk = false;
  try { await db.query('SELECT 1'); dbOk = true; } catch(e) {}
  res.json({ status: 'ok', db: dbOk, stripe: !!stripe, anthropic: !!anthropic, time: new Date().toISOString() });
});

/* CHAT */
app.post('/chat', async (req, res) => {
  try {
    if (!anthropic) return res.json({ reply: 'Chatbot non disponibile. WhatsApp: +39 320 689 1014' });
    const { messages = [] } = req.body;
    const history = messages.slice(-12).filter(m => m.role && m.content);
    const response = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 400, system: SYSTEM_PROMPT, messages: history });
    res.json({ reply: response.content?.[0]?.text || 'Errore temporaneo. WhatsApp: +39 320 689 1014' });
  } catch(e) {
    res.status(500).json({ reply: 'Errore temporaneo. WhatsApp: +39 320 689 1014' });
  }
});

/* PAYMENT INTENT */
app.post('/create-payment-intent', async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Pagamenti non disponibili' });
    const { amount, tour, people, customerEmail } = req.body;
    if (!amount || amount < 100) return res.status(400).json({ error: 'Importo non valido' });
    const pi = await stripe.paymentIntents.create({ amount: Math.round(amount), currency: 'eur', metadata: { tour, people }, receipt_email: customerEmail });
    res.json({ clientSecret: pi.client_secret });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

/* BOOKING */
app.post('/booking', async (req, res) => {
  try {
    const { name, email, phone, tour, people, date, time, notes, paymentMethod, stripePaymentId } = req.body;
    if (!name || !email || !tour) return res.status(400).json({ error: 'Campi obbligatori mancanti' });
    const idRes = await db.query("SELECT 'AT'||nextval('booking_counter') AS id");
    const id = idRes.rows[0].id;
    await db.query(
      `INSERT INTO bookings (id,name,email,phone,tour,people,date,time,notes,payment_method,stripe_payment_id,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')`,
      [id, name, email, phone||null, tour, people||null, date||null, time||null, notes||null, paymentMethod||null, stripePaymentId||null]
    );
    const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
    if (transporter && process.env.EMAIL_USER) {
      await Promise.allSettled([
        transporter.sendMail({
          from: process.env.EMAIL_USER, to: process.env.EMAIL_NOTIFY || process.env.EMAIL_USER,
          subject: `🛺 [${id}] Nuova Prenotazione — ${tour} — ${name}`,
          html: `<div style="font-family:Georgia,serif;background:#0F0E0C;color:#E8E0D0;padding:2rem;max-width:600px"><h2 style="color:#C8A96A">🛺 [${id}] Nuova Prenotazione</h2><p><b>Nome:</b> ${name}</p><p><b>Email:</b> ${email}</p><p><b>Tel:</b> ${phone||'—'}</p><p><b>Tour:</b> ${tour}</p><p><b>Persone:</b> ${people||'—'}</p><p><b>Data:</b> ${date||'—'} ${time||''}</p><p><b>Pagamento:</b> ${paymentMethod||'—'}</p><p><b>Note:</b> ${notes||'—'}</p><small style="color:#6B6358">${now}</small></div>`
        }),
        transporter.sendMail({
          from: `"Aura Rome Tours" <${process.env.EMAIL_USER}>`, to: email,
          subject: `✦ Richiesta ricevuta [${id}] — ${tour}`,
          html: `<div style="font-family:Georgia,serif;background:#0F0E0C;color:#E8E0D0;padding:2rem;max-width:600px"><h2 style="color:#C8A96A">Aura Rome Tours</h2><p>Ciao ${name.split(' ')[0]}! ✦</p><p>Abbiamo ricevuto la tua richiesta per <strong style="color:#C8A96A">${tour}</strong> (Ref: <b>${id}</b>).</p><p>Ti risponderemo entro <strong>2 ore</strong>.</p><p><a href="https://wa.me/393206891014" style="color:#C8A96A">WhatsApp: +39 320 689 1014</a></p></div>`
        })
      ]);
    }
    res.json({ success: true, bookingId: id });
  } catch(e) {
    console.error('[/booking]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* REVIEWS — public */
app.get('/reviews', async (req, res) => {
  const r = await db.query('SELECT * FROM reviews WHERE approved=TRUE ORDER BY created_at DESC');
  res.json(r.rows);
});

app.post('/reviews', async (req, res) => {
  try {
    const { name, location, stars, text, tourName } = req.body;
    if (!name || !text || !stars) return res.status(400).json({ error: 'Campi obbligatori mancanti' });
    const s = parseInt(stars);
    if (s < 1 || s > 5) return res.status(400).json({ error: 'Stelle non valide' });
    const id = crypto.randomUUID();
    const autoApprove = s >= 4;
    await db.query(
      'INSERT INTO reviews (id,name,location,tour_name,stars,text,approved) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, name, location||'', tourName||'', s, text, autoApprove]
    );
    res.json({ success: true, autoApproved: autoApprove });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

/* BLOCKED DATES — public */
app.get('/blocked-dates', async (req, res) => {
  const r = await db.query('SELECT * FROM blocked_dates ORDER BY date');
  res.json(r.rows);
});

/* ════════════════════════════════
   ADMIN ENDPOINTS
════════════════════════════════ */

app.post('/admin/login', (req, res) => {
  if (req.body.password === process.env.ADMIN_PASSWORD) res.json({ success: true, token: process.env.ADMIN_PASSWORD });
  else res.status(401).json({ error: 'Password errata' });
});

/* BOOKINGS */
app.get('/admin/bookings', adminAuth, async (req, res) => {
  const r = await db.query('SELECT * FROM bookings ORDER BY created_at DESC');
  res.json(r.rows.map(b => ({
    id: b.id, name: b.name, email: b.email, phone: b.phone,
    tour: b.tour, people: b.people, date: b.date, time: b.time,
    notes: b.notes, paymentMethod: b.payment_method, status: b.status,
    amount: b.amount, notes_admin: b.notes_admin,
    createdAt: b.created_at, updatedAt: b.updated_at
  })));
});

app.patch('/admin/bookings/:id', adminAuth, async (req, res) => {
  const { status, notes_admin, amount } = req.body;
  const updates = [];
  const vals = [];
  let i = 1;
  if (status)                         { updates.push(`status=$${i++}`);       vals.push(status); }
  if (notes_admin !== undefined)       { updates.push(`notes_admin=$${i++}`);  vals.push(notes_admin); }
  if (amount !== undefined)            { updates.push(`amount=$${i++}`);       vals.push(amount); }
  updates.push(`updated_at=NOW()`);
  vals.push(req.params.id);
  await db.query(`UPDATE bookings SET ${updates.join(',')} WHERE id=$${i}`, vals);
  if (status === 'confirmed' && transporter && process.env.EMAIL_USER) {
    const br = await db.query('SELECT * FROM bookings WHERE id=$1', [req.params.id]);
    const b = br.rows[0];
    if (b) transporter.sendMail({
      from: `"Aura Rome Tours" <${process.env.EMAIL_USER}>`, to: b.email,
      subject: `✅ Prenotazione Confermata [${b.id}] — ${b.tour}`,
      html: `<div style="font-family:Georgia,serif;background:#0F0E0C;color:#E8E0D0;padding:2rem;max-width:600px"><h2 style="color:#C8A96A">Prenotazione Confermata! ✦</h2><p>Ciao ${b.name.split(' ')[0]},</p><p>La tua prenotazione per <strong style="color:#C8A96A">${b.tour}</strong> è <strong>confermata</strong>!</p><p>📅 ${b.date||'—'} · 🕐 ${b.time||'—'} · 👥 ${b.people||'—'}</p><p><a href="https://wa.me/393206891014" style="color:#C8A96A">WhatsApp: +39 320 689 1014</a></p></div>`
    }).catch(e => console.error('Email conf:', e.message));
  }
  res.json({ success: true });
});

/* PAYMENTS */
app.get('/admin/payments', adminAuth, async (req, res) => {
  try {
    if (!stripe) return res.json([]);
    const intents = await stripe.paymentIntents.list({ limit: 100 });
    res.json(intents.data.map(pi => ({
      id: pi.id, amount: pi.amount/100, currency: pi.currency,
      status: pi.status, tour: pi.metadata?.tour||'—',
      people: pi.metadata?.people||'—', email: pi.receipt_email||'—',
      date: new Date(pi.created*1000).toISOString()
    })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* REVIEWS ADMIN */
app.get('/admin/reviews', adminAuth, async (req, res) => {
  const r = await db.query('SELECT * FROM reviews ORDER BY created_at DESC');
  res.json(r.rows);
});

app.patch('/admin/reviews/:id', adminAuth, async (req, res) => {
  await db.query('UPDATE reviews SET approved=$1 WHERE id=$2', [req.body.approved, req.params.id]);
  res.json({ success: true });
});

app.delete('/admin/reviews/:id', adminAuth, async (req, res) => {
  await db.query('DELETE FROM reviews WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

/* CALENDAR */
app.get('/admin/calendar', adminAuth, async (req, res) => {
  const { month, year } = req.query;
  let query = 'SELECT * FROM bookings WHERE 1=1';
  const vals = [];
  if (month && year) {
    query += ` AND EXTRACT(MONTH FROM date::date)=$1 AND EXTRACT(YEAR FROM date::date)=$2`;
    vals.push(month, year);
  }
  const [bookings, blocked] = await Promise.all([
    db.query(query, vals),
    db.query('SELECT * FROM blocked_dates ORDER BY date')
  ]);
  res.json({
    bookings: bookings.rows.map(b => ({ id: b.id, name: b.name, tour: b.tour, date: b.date, time: b.time, status: b.status })),
    blocked: blocked.rows
  });
});

app.post('/admin/block-date', adminAuth, async (req, res) => {
  const { date, reason } = req.body;
  if (!date) return res.status(400).json({ error: 'Data richiesta' });
  await db.query('INSERT INTO blocked_dates (date,reason) VALUES ($1,$2) ON CONFLICT (date) DO NOTHING', [date, reason||'Indisponibile']);
  res.json({ success: true });
});

app.delete('/admin/block-date/:date', adminAuth, async (req, res) => {
  await db.query('DELETE FROM blocked_dates WHERE date=$1', [req.params.date]);
  res.json({ success: true });
});

/* STATS */
app.get('/admin/stats', adminAuth, async (req, res) => {
  try {
    const [bTotal, bPending, bConfirmed, bCancelled, revApproved, revPending, topTour] = await Promise.all([
      db.query('SELECT COUNT(*) FROM bookings'),
      db.query("SELECT COUNT(*) FROM bookings WHERE status='pending'"),
      db.query("SELECT COUNT(*) FROM bookings WHERE status='confirmed'"),
      db.query("SELECT COUNT(*) FROM bookings WHERE status='cancelled'"),
      db.query('SELECT COUNT(*) FROM reviews WHERE approved=TRUE'),
      db.query('SELECT COUNT(*) FROM reviews WHERE approved=FALSE'),
      db.query('SELECT tour, COUNT(*) as cnt FROM bookings GROUP BY tour ORDER BY cnt DESC LIMIT 1'),
    ]);
    let stripeTotal = 0, stripeMonth = 0;
    try {
      if (stripe) {
        const monthStart = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()/1000);
        const [all, month] = await Promise.all([
          stripe.paymentIntents.list({ limit: 100 }),
          stripe.paymentIntents.list({ limit: 100, created: { gte: monthStart } })
        ]);
        stripeTotal = all.data.filter(p=>p.status==='succeeded').reduce((s,p)=>s+p.amount/100,0);
        stripeMonth = month.data.filter(p=>p.status==='succeeded').reduce((s,p)=>s+p.amount/100,0);
      }
    } catch(e) {}
    res.json({
      bookings: { total: parseInt(bTotal.rows[0].count), pending: parseInt(bPending.rows[0].count), confirmed: parseInt(bConfirmed.rows[0].count), cancelled: parseInt(bCancelled.rows[0].count) },
      payments: { total: stripeTotal, thisMonth: stripeMonth },
      reviews:  { approved: parseInt(revApproved.rows[0].count), pending: parseInt(revPending.rows[0].count) },
      topTour:  topTour.rows[0]?.tour || '—',
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── START ── */
initDB().then(() => {
  app.listen(PORT, () => console.log(`🛺 AuraTours Backend — porta ${PORT} | DB:✅ | Stripe:${!!stripe} | Anthropic:${!!anthropic}`));
}).catch(e => {
  console.error('❌ DB init failed:', e.message);
  app.listen(PORT, () => console.log(`🛺 AuraTours Backend — porta ${PORT} | DB:❌`));
});
