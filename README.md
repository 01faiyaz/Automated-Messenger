# SMA Platform — Desktop App

A cross-platform desktop app (Windows + Mac) for automating WhatsApp, Gmail, YouTube, Instagram, and iMessage campaigns.

---

## For developers — running and building

### Requirements

- Node.js 18+ — https://nodejs.org
- Git (optional)

### Run in development

```bash
cd sma-desktop
npm install
npm start
```

### Build installers

**Windows (.exe installer):**
```bash
npm run build:win
```

**Mac (.dmg):**
```bash
npm run build:mac
```

**Both at once:**
```bash
npm run build:all
```

Outputs go to the `dist/` folder.

---

## For end users — setup guide (inside the app)

### WhatsApp
1. Open the app → WhatsApp tab → click **Connect WhatsApp**
2. A QR code appears — open WhatsApp on your phone → tap the three dots → Linked Devices → Link a Device → scan the code
3. Connected. Upload your contacts CSV and send.

### Gmail
1. Go to https://myaccount.google.com/apppasswords
2. Create an App Password for "Mail"
3. In the app → Gmail tab → enter your Gmail address and the app password → click Test Connection
4. Upload your CSV (needs an `email` column) and send.

### YouTube
1. Go to https://console.cloud.google.com
2. Create a project → APIs & Services → Enable YouTube Data API v3
3. Credentials → Create OAuth 2.0 Client ID → Desktop app → download
4. In the app → YouTube tab → enter your Client ID and Secret → click Get auth link → follow browser flow → paste the code back

### Instagram
1. YouTube tab → enter your Instagram username and password → Log in
2. Choose photo or video, add caption, post.

### iMessage (Mac only)
1. Make sure Messages.app is open and signed in with your Apple ID
2. iMessage tab → enter recipients and message → send

---

## Contacts CSV format

Your CSV needs at minimum a phone number column. The app auto-detects the column and cleans the numbers.

Column names it recognises: `phone`, `mobile`, `number`, `whatsapp`, `tel`, `cell`, `contact`

Example:
```
name,phone,email
Alice,9876543210,alice@example.com
Bob,+919876543210,bob@example.com
Carol,09876543210,carol@example.com
```

All three phone formats above are automatically cleaned to `+919876543210`. Numbers the app cannot clean are skipped and shown in the preview.

---

## How the recipient preference flow works (WhatsApp)

When you send a campaign:

- **New contacts** receive a numbered menu:
  ```
  Choose your language:
  1 - English
  2 - Hindi
  3 - Tamil
  4 - Telugu
  5 - Kannada
  ```
  They reply with a number. Then:
  ```
  Choose format:
  1 - Text
  2 - Voice audio
  ```
  They reply → your message arrives in their chosen language and format.

- **Returning contacts** (already chose) skip the menu entirely. Their message arrives immediately in their saved preference.

- Preferences are stored locally. They persist between campaigns.

---

## Where data is stored

Everything is stored locally on the user's machine in the app's data folder:
- Windows: `C:\Users\<you>\AppData\Roaming\sma-platform\`
- Mac: `~/Library/Application Support/sma-platform/`

No data is sent to any server. The only external calls are to WhatsApp Web, Gmail SMTP, Google APIs, and Instagram.
