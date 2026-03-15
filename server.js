require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const Stripe     = require('stripe');
const nodemailer = require('nodemailer');
const Anthropic  = require('@anthropic-ai/sdk');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

/* CORS — GitHub Pages + Aruba */
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      origin.includes('github.io') ||
      origin.includes('aurarometours.com') ||
      origin.includes('localhost') ||
      origin.includes('127.0.0.1')
    ) return callback(null, true);
    console.log('[CORS] Bloccato:', origin);
    callback(new Error('CORS: origine non permessa'));
  }
}));

/* SERVICES */
let stripe, anthropic, transporter;
try { stripe = new Stripe(process.env.STRIPE_SECRET_KEY); } catch(e) { console.error('[STRIPE]', e.message); }
try { anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }); } catch(e) { console.error('[ANTHROPIC]', e.message); }
try {
  transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
} catch(e) { console.error('[EMAIL]', e.message); }

const SYSTEM_PROMPT = `Sei l'assistente virtuale di Aura Rome Tours, azienda che offre tour privati esclusivi in golf cart Alba nel centro storico di Roma.

TOUR E PREZZI:
- La Grande Bellezza: 3h, da €250 p.p. — Colosseo, Fori Imperiali, Piazza Venezia, Bocca della Verità
- Roma by Night: 2.5h, da €310 p.p. — Fontana di Trevi illuminata, Piazza Navona, Pantheon, aperitivo incluso
- Full Roma Experience: 3h+, da €400 p.p. — il meglio + foto professionali (la più richiesta)
- Shooting Tour: da €500 — tour + fotografo professionale
- Gruppi 7+ persone: prezzo su richiesta

PRENOTAZIONE: form sul sito, WhatsApp +39 320 689 1014, Calendly, email info@aurarometours.com
POLITICHE: Tour privato, partenza dall'hotel, cancellazione gratuita 24h, max 6 persone per cart.
CONTATTI: WhatsApp +39 320 689 1014 | info@aurarometours.com | @aura.intravel

Rispondi nella lingua dell'utente (IT/EN/FR/ES). Tono caldo e professionale. Risposte brevi (2-4 righe).`;

/* HEALTH */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', stripe: !!process.env.STRIPE_SECRET_KEY, anthropic: !!process.env.ANTHROPIC_API_KEY, time: new Date().toISOString() });
});

/* CHAT */
app.post('/chat', async (req, res) => {
  try {
    if (!anthropic) return res.status(503).json({ reply: 'Chatbot non disponibile. Scrivici su WhatsApp: +39 320 689 1014' });
    const { messages = [] } = req.body;
    const history = messages.slice(-12).filter(m => m.role && m.content);
    const response = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 400, system: SYSTEM_PROMPT, messages: history });
    res.json({ reply: response.content?.[0]?.text || 'Errore temporaneo. Scrivici su WhatsApp: +39 320 689 1014' });
  } catch(err) {
    console.error('[/chat]', err.message);
    res.status(500).json({ reply: 'Errore temporaneo. Scrivici su WhatsApp: +39 320 689 1014' });
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
  } catch(err) {
    console.error('[/payment]', err.message);
    res.status(500).json({ error: 'Errore pagamento' });
  }
});

/* BOOKING */
app.post('/booking', async (req, res) => {
  try {
    const { name, email, phone, tour, people, date, time, notes, paymentMethod } = req.body;
    if (!name || !email || !tour) return res.status(400).json({ error: 'Campi obbligatori mancanti' });
    const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
    if (transporter && process.env.EMAIL_USER) {
      await Promise.allSettled([
        transporter.sendMail({ from: process.env.EMAIL_USER, to: process.env.EMAIL_NOTIFY || process.env.EMAIL_USER, subject: `🛺 Prenotazione — ${tour} — ${name}`, html: `<p><b>Nome:</b> ${name}</p><p><b>Email:</b> ${email}</p><p><b>Tel:</b> ${phone}</p><p><b>Tour:</b> ${tour}</p><p><b>Persone:</b> ${people}</p><p><b>Data:</b> ${date} ${time}</p><p><b>Note:</b> ${notes}</p><p><b>Pagamento:</b> ${paymentMethod}</p><small>${now}</small>` }),
        transporter.sendMail({ from: `"Aura Rome Tours" <${process.env.EMAIL_USER}>`, to: email, subject: `✦ Richiesta ricevuta — ${tour}`, html: `<p>Ciao ${name.split(' ')[0]}, abbiamo ricevuto la tua richiesta per <b>${tour}</b>. Ti risponderemo entro 2 ore.</p><p><a href="https://wa.me/393206891014">WhatsApp: +39 320 689 1014</a></p>` })
      ]);
    }
    res.json({ success: true });
  } catch(err) {
    console.error('[/booking]', err.message);
    res.json({ success: true, warning: 'Email non inviata' });
  }
});

app.listen(PORT, () => console.log(`🛺 AuraTours Backend — porta ${PORT} | stripe:${!!process.env.STRIPE_SECRET_KEY} | anthropic:${!!process.env.ANTHROPIC_API_KEY}`));
