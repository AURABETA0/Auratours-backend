/**
 * ═══════════════════════════════════════════════════════════
 *  AURA ROME TOURS — Backend Server
 *  Node.js + Express
 *
 *  Endpoints:
 *    POST /chat              → Chatbot AI (Claude)
 *    POST /create-payment-intent → Stripe PaymentIntent
 *    POST /booking           → Form prenotazione + email
 *    GET  /health            → Health check
 * ═══════════════════════════════════════════════════════════
 */

const express    = require('express');
const cors       = require('cors');
const Stripe     = require('stripe');
const nodemailer = require('nodemailer');
const Anthropic  = require('@anthropic-ai/sdk');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── CORS: permetti solo il tuo dominio in produzione ── */
const ALLOWED_ORIGINS = [
  'https://aurarometours.com',
  'https://www.aurarometours.com',
  'http://localhost:5500',   // Live Server VS Code
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'null', // file:// aperto localmente
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS: origine non permessa — ' + origin));
  }
}));
app.use(express.json());

/* ── CLIENTS ── */
const stripe    = new Stripe(process.env.STRIPE_SECRET_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/* ── EMAIL TRANSPORTER (Gmail oppure SMTP Aruba) ── */
const transporter = nodemailer.createTransport({
  service: 'gmail',       // oppure: host:'smtps.aruba.it', port:465, secure:true
  auth: {
    user: process.env.EMAIL_USER,   // es. info@aurarometours.com
    pass: process.env.EMAIL_PASS,   // App Password Gmail (non la password normale)
  }
});

/* ═══════════════════════════════════════════════════════════
   SYSTEM PROMPT del chatbot — istruzioni complete su AuraTours
═══════════════════════════════════════════════════════════ */
const SYSTEM_PROMPT = `Sei l'assistente virtuale di Aura Rome Tours, azienda che offre tour privati esclusivi in golf cart Alba nel centro storico di Roma.

TOUR E PREZZI:
- La Grande Bellezza: 3h, da €250 p.p. — Colosseo, Fori Imperiali, Piazza Venezia, Bocca della Verità
- Roma by Night: 2.5h, da €310 p.p. — Fontana di Trevi illuminata, Piazza Navona, Pantheon, aperitivo incluso
- Full Roma Experience: 3h+, da €400 p.p. — il meglio di tutto + foto professionali (la più richiesta)
- Shooting Tour: da €500 — tour + fotografo professionale con 100+ scatti editati
- Fiat 500 Tour: coming soon — esperienza vintage
- Gruppi 7+ persone: prezzo su richiesta, usiamo più cart coordinati

PRENOTAZIONE: form sul sito (Stripe/PayPal), WhatsApp +39 320 689 1014, Calendly, email info@aurarometours.com

POLITICHE:
- Tour 100% privato: solo il gruppo del cliente, zero estranei
- Partenza direttamente dall'hotel del cliente (zero logistica)
- Guide parlano: italiano, inglese, francese, spagnolo
- Cancellazione gratuita fino a 24h prima
- Maltempo estremo: rimborso completo o spostamento gratuito
- Max 6 persone per cart; gruppi grandi = più cart coordinati
- Ideale per bambini, anziani, persone con difficoltà motorie

CONTATTI: WhatsApp +39 320 689 1014 | info@aurarometours.com | Instagram @aura.intravel

REGOLE DI RISPOSTA:
- Rispondi SEMPRE nella lingua dell'utente (IT, EN, FR, ES)
- Tono caldo, professionale, appassionato di Roma
- Risposte concise (2-4 righe), usa emoji con moderazione
- Se vuole prenotare, guidalo verso il form del sito o WhatsApp
- Non inventare informazioni non fornite sopra`;

/* ═══════════════════════════════════════════════════════════
   GET /health
═══════════════════════════════════════════════════════════ */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'AuraTours Backend',
    timestamp: new Date().toISOString(),
    stripe:    !!process.env.STRIPE_SECRET_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    email:     !!process.env.EMAIL_USER,
  });
});

/* ═══════════════════════════════════════════════════════════
   POST /chat  — Chatbot AI
   Body: { messages: [{role, content}], lang: 'it'|'en'|'fr'|'es' }
═══════════════════════════════════════════════════════════ */
app.post('/chat', async (req, res) => {
  try {
    const { messages = [], lang = 'it' } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array richiesto' });
    }

    // Prendi solo gli ultimi 12 messaggi per evitare token eccessivi
    const history = messages.slice(-12).filter(m =>
      m.role && m.content && typeof m.content === 'string'
    );

    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 500,
      system:     SYSTEM_PROMPT,
      messages:   history,
    });

    const reply = response.content?.[0]?.text || 'Scusa, si è verificato un errore. Contattaci su WhatsApp: +39 320 689 1014';
    res.json({ reply });

  } catch (err) {
    console.error('[/chat] Error:', err.message);
    res.status(500).json({ error: 'Chatbot temporaneamente non disponibile', details: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════
   POST /create-payment-intent  — Stripe
   Body: { tour, people, amount }  (amount in centesimi, es. 25000 = €250)
═══════════════════════════════════════════════════════════ */
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { tour, people, amount, customerEmail, customerName } = req.body;

    if (!amount || amount < 100) {
      return res.status(400).json({ error: 'Importo non valido' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount:   Math.round(amount), // già in centesimi
      currency: 'eur',
      metadata: {
        tour:    tour    || 'non specificato',
        people:  people  || 'non specificato',
        service: 'AuraTours',
      },
      receipt_email: customerEmail || undefined,
      description: `Aura Rome Tours — ${tour || 'Tour'} per ${people || '?'} persone`,
    });

    res.json({ clientSecret: paymentIntent.client_secret });

  } catch (err) {
    console.error('[/create-payment-intent] Error:', err.message);
    res.status(500).json({ error: 'Errore creazione pagamento', details: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════
   POST /booking  — Form prenotazione + email notifica
   Body: { name, email, phone, tour, people, date, time, notes, paymentMethod }
═══════════════════════════════════════════════════════════ */
app.post('/booking', async (req, res) => {
  try {
    const { name, email, phone, tour, people, date, time, notes, paymentMethod } = req.body;

    // Validazione base
    if (!name || !email || !tour) {
      return res.status(400).json({ error: 'Campi obbligatori mancanti: name, email, tour' });
    }

    const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });

    /* ── EMAIL A AURA TOURS (notifica interna) ── */
    const internalMail = {
      from:    `"Aura Website" <${process.env.EMAIL_USER}>`,
      to:      process.env.EMAIL_NOTIFY || process.env.EMAIL_USER,
      subject: `🛺 Nuova Prenotazione — ${tour} — ${name}`,
      html: `
        <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#0F0E0C;color:#E8E0D0;padding:2rem;border:1px solid #C8A96A">
          <h2 style="color:#C8A96A;font-size:1.6rem;margin-bottom:1.5rem">🛺 Nuova Prenotazione Aura</h2>
          <table style="width:100%;border-collapse:collapse">
            ${[
              ['Nome',             name],
              ['Email',            email],
              ['Telefono',         phone || '—'],
              ['Tour',             tour],
              ['Persone',          people || '—'],
              ['Data',             date || '—'],
              ['Orario',           time || '—'],
              ['Pagamento',        paymentMethod || '—'],
              ['Note',             notes || '—'],
              ['Ricevuta alle',    now],
            ].map(([k,v]) => `
              <tr>
                <td style="padding:0.6rem;border-bottom:1px solid #2E2A24;color:#9A9088;font-size:0.85rem;width:140px">${k}</td>
                <td style="padding:0.6rem;border-bottom:1px solid #2E2A24;color:#E8E0D0;font-size:0.9rem">${v}</td>
              </tr>
            `).join('')}
          </table>
          <div style="margin-top:1.5rem;padding:1rem;background:#1A1814;border-left:3px solid #C8A96A">
            <p style="font-size:0.8rem;color:#9A9088;margin:0">Rispondi entro 2 ore. WhatsApp: +39 320 689 1014</p>
          </div>
        </div>
      `
    };

    /* ── EMAIL AL CLIENTE (conferma) ── */
    const clientMail = {
      from:    `"Aura Rome Tours" <${process.env.EMAIL_USER}>`,
      to:      email,
      subject: `✦ Richiesta ricevuta — ${tour} · Aura Rome Tours`,
      html: `
        <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#0F0E0C;color:#E8E0D0;padding:2rem">
          <div style="text-align:center;padding:2rem 0;border-bottom:1px solid #C8A96A">
            <h1 style="font-size:2rem;color:#C8A96A;margin-bottom:0.3rem">Aura Rome Tours</h1>
            <p style="font-size:0.78rem;letter-spacing:0.2em;text-transform:uppercase;color:#6B6358">Tour Privati · Golf Cart · Roma</p>
          </div>
          <div style="padding:2rem 0">
            <h2 style="color:#FDFAF5;font-size:1.4rem;margin-bottom:1rem">Ciao ${name.split(' ')[0]}! ✦</h2>
            <p style="color:#9A9088;line-height:1.8;margin-bottom:1.2rem">Abbiamo ricevuto la tua richiesta per <strong style="color:#C8A96A">${tour}</strong>. Ti risponderemo entro <strong style="color:#FDFAF5">2 ore</strong> con la conferma della disponibilità.</p>
            <div style="background:#1A1814;padding:1.5rem;border:1px solid #2E2A24;margin:1.5rem 0">
              <p style="font-size:0.75rem;letter-spacing:0.15em;text-transform:uppercase;color:#C8A96A;margin-bottom:0.8rem">Riepilogo richiesta</p>
              <p style="color:#E8E0D0;margin:0.3rem 0;font-size:0.9rem">🛺 <strong>${tour}</strong></p>
              <p style="color:#9A9088;margin:0.3rem 0;font-size:0.85rem">👥 ${people || '—'} · 📅 ${date || '—'} · 🕐 ${time || '—'}</p>
            </div>
            <p style="color:#9A9088;line-height:1.8">Nel frattempo puoi scriverci direttamente su:</p>
            <a href="https://wa.me/393206891014" style="display:inline-block;margin:0.8rem 0;background:#1da851;color:white;padding:0.8rem 1.5rem;text-decoration:none;font-size:0.85rem">💬 WhatsApp · +39 320 689 1014</a>
          </div>
          <div style="border-top:1px solid #2E2A24;padding-top:1.5rem;font-size:0.75rem;color:#3D3830;text-align:center">
            <p>Aura Rome Tours · info@aurarometours.com · +39 320 689 1014</p>
            <p>© 2025 Aura Rome Tours · www.aurarometours.com</p>
          </div>
        </div>
      `
    };

    // Invia entrambe le email
    await Promise.all([
      transporter.sendMail(internalMail),
      transporter.sendMail(clientMail),
    ]);

    res.json({ success: true, message: 'Prenotazione ricevuta. Email inviata.' });

  } catch (err) {
    console.error('[/booking] Error:', err.message);
    // Non bloccare l'utente se l'email fallisce — logga e rispondi OK
    res.status(500).json({ error: 'Errore invio email', details: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════
   START
═══════════════════════════════════════════════════════════ */
app.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════╗
  ║   🛺  Aura Rome Tours — Backend       ║
  ║   Server attivo su porta ${PORT}          ║
  ╚════════════════════════════════════════╝
  `);
});
