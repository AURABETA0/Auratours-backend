# 🛺 AURA ROME TOURS — Guida Setup Completo
## Dal codice al sito live in meno di un'ora

---

## COSA DEVI FARE (panoramica)
1. Creare account Stripe → ottieni le chiavi API
2. Creare account Anthropic → ottieni la chiave API
3. Configurare l'email
4. Caricare il backend su Railway
5. Collegare il frontend al backend
6. Caricare il sito su Aruba

Tempo stimato: **30–45 minuti**

---

## STEP 1 — STRIPE (pagamenti con carta)
*Tempo: ~10 minuti*

1. Vai su **https://stripe.com** → clicca "Inizia"
2. Inserisci email, nome, password → crea account
3. Verifica l'email
4. Dashboard Stripe → menu a sinistra → **"Developers"** → **"API Keys"**
5. Copia:
   - **Publishable key** (inizia con `pk_test_...`) → va nel file `auratours_v2.html`
   - **Secret key** (inizia con `sk_test_...`) → va nel file `.env` del backend
6. Per ricevere pagamenti reali dovrai completare il KYC (documento identità) — puoi farlo dopo

---

## STEP 2 — ANTHROPIC API (chatbot AI)
*Tempo: ~5 minuti*

1. Vai su **https://console.anthropic.com**
2. Crea account → verifica email
3. Menu a sinistra → **"API Keys"** → **"Create Key"**
4. Dai un nome (es. "AuraTours Production") → copia la chiave
   - Inizia con `sk-ant-...`
   - **IMPORTANTE: copiala subito, non la vedrai più!**
5. Vai su **"Billing"** → aggiungi una carta per pagare l'utilizzo dell'API
   - Il chatbot costa circa €0.01–0.05 per conversazione

---

## STEP 3 — EMAIL (notifiche prenotazioni)
*Tempo: ~5 minuti*

**Opzione A — Gmail (più semplice per iniziare):**
1. Vai su **https://myaccount.google.com**
2. Sicurezza → Verifica in 2 passaggi → abilitala
3. Sicurezza → **"Password per le app"**
4. Seleziona "App: Posta" / "Dispositivo: Altro" → scrivi "AuraTours"
5. Copia la password di 16 caratteri generata

**Opzione B — Email Aruba (quando hai il dominio):**
- Usa i dati SMTP del pannello Aruba
- Host: `smtps.aruba.it`, Porta: `465`, SSL: sì

---

## STEP 4 — RAILWAY (deploy backend)
*Tempo: ~15 minuti*

### 4a. Crea account GitHub (se non ce l'hai)
1. Vai su **https://github.com** → Sign up
2. Verifica email

### 4b. Carica il backend su GitHub
1. Vai su **https://github.com/new**
2. Nome repository: `auratours-backend`
3. **Privato** (importante! contiene codice sensibile)
4. Clicca "Create repository"
5. Carica i file: `server.js`, `package.json`, `.gitignore`
   - Clicca "uploading an existing file"
   - Trascina i 3 file
   - Clicca "Commit changes"
   - **NON caricare il file `.env` — solo `.env.example`!**

### 4c. Deploy su Railway
1. Vai su **https://railway.app**
2. Clicca "Login" → "Login with GitHub" → autorizza
3. Clicca **"New Project"**
4. Seleziona **"Deploy from GitHub repo"**
5. Seleziona `auratours-backend`
6. Railway detecta automaticamente Node.js e fa il deploy

### 4d. Configura le variabili d'ambiente su Railway
1. Nel progetto Railway → clicca sul servizio
2. Tab **"Variables"** → clicca "New Variable"
3. Aggiungi UNA PER UNA (copia dal tuo `.env`):

```
STRIPE_SECRET_KEY    = sk_test_...
ANTHROPIC_API_KEY    = sk-ant-...
EMAIL_USER           = info@aurarometours.com
EMAIL_PASS           = (app password gmail)
EMAIL_NOTIFY         = tua-email@gmail.com
```

4. Railway fa il redeploy automatico

### 4e. Copia l'URL del backend
1. Tab **"Settings"** → **"Domains"**
2. Copia l'URL generato (es. `https://auratours-backend-production.up.railway.app`)
3. **Questo è il tuo `backendUrl`!**

---

## STEP 5 — COLLEGA FRONTEND AL BACKEND
*Tempo: ~2 minuti*

Apri `auratours_v2.html` con un editor di testo (anche Blocco Note va bene).

Cerca il blocco `CONFIG` (circa riga 600) e modifica:

```javascript
const CONFIG = {
  stripePublicKey: 'pk_test_LA_TUA_CHIAVE_STRIPE',    // ← da Step 1
  backendUrl: 'https://TUO-NOME.up.railway.app',       // ← da Step 4e
  formspreeId: 'INSERISCI_ID_FORMSPREE',               // ← opzionale
  whatsapp: '393206891014',
  calendly: 'https://calendly.com/aura-intravel/aura-private-tour',
};
```

Salva il file.

---

## STEP 6 — TEST LOCALE
Prima di caricare su Aruba, testa aprendo `auratours_v2.html` nel browser:

1. Apri il file con Chrome o Firefox
2. Premi F12 → Console: non devono esserci errori rossi
3. Prova il chatbot: clicca l'icona in basso a destra
4. Prova il form prenotazione con i dati di Stripe test:
   - Carta test: `4242 4242 4242 4242`
   - Scadenza: qualsiasi data futura (es. 12/28)
   - CVC: qualsiasi 3 cifre (es. 123)
5. Controlla che arrivi l'email di notifica

---

## STEP 7 — ARUBA (sito live)
*Tempo: ~10 minuti*

1. Compra il piano **hosting base** su Aruba (include FTP)
2. Collega il dominio `aurarometours.com` all'hosting
3. Accedi al pannello Aruba → **File Manager** o **FTP**
4. Carica `auratours_v2.html` nella cartella `public_html` o `www`
5. Rinomina il file in `index.html`
6. Visita `https://aurarometours.com` — il sito è live! 🎉

---

## RIEPILOGO COSTI MENSILI

| Servizio       | Costo           | Note                          |
|----------------|-----------------|-------------------------------|
| Dominio Aruba  | ~€10–15/anno    | Una tantum                    |
| Hosting Aruba  | ~€3–5/mese      | Sito HTML statico             |
| Railway        | Gratuito        | Fino a $5/mese di utilizzo    |
| Stripe         | 1.4% + €0.25    | Solo su transazioni reali     |
| Anthropic      | ~€0.01–0.05     | Per conversazione chatbot     |
| **TOTALE**     | **~€5–8/mese**  | + commissioni Stripe          |

---

## PROBLEMI COMUNI

**"CORS error" nella console**
→ Aggiungi il tuo dominio in `ALLOWED_ORIGINS` in `server.js` e rideploya su Railway

**"Stripe not configured"**
→ Verifica di aver inserito la chiave `pk_test_...` nel CONFIG del file HTML

**Il chatbot non risponde**
→ Verifica che `ANTHROPIC_API_KEY` sia corretta in Railway → Variables

**Le email non arrivano**
→ Verifica App Password Gmail (non la password normale)
→ Controlla la cartella SPAM

---

## SUPPORTO
Per qualsiasi problema durante il setup, riapri questa chat e descrivi l'errore esatto.
