const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs   = require("fs");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 740,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(async () => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ── Lazy module loader — only loads a module when first used ──────────────────
const modules = {};
function get(name) {
  if (!modules[name]) modules[name] = require(`./src/${name}`);
  return modules[name];
}

// ── Preferences ───────────────────────────────────────────────────────────────

ipcMain.handle("get-preferences", async () => {
  await get("database").ensureReady();
  return get("database").getAllPreferences();
});

ipcMain.handle("save-preferences", async (_, prefs) => {
  await get("database").ensureReady();
  get("database").savePreferences(prefs);
  return get("database").getAllPreferences();
});

ipcMain.handle("toggle-platform", async (_, { platform, enabled }) => {
  await get("database").ensureReady();
  get("database").togglePlatform(platform, enabled);
  return get("database").getAllPreferences();
});

// ── WhatsApp ──────────────────────────────────────────────────────────────────

ipcMain.handle("whatsapp-connect", async () => {
  return new Promise((resolve) => {
    get("whatsapp").connect(
      (qrDataUrl) => mainWindow.webContents.send("whatsapp-qr", qrDataUrl),
      () => { mainWindow.webContents.send("whatsapp-ready"); resolve({ status: "connected" }); },
      () => mainWindow.webContents.send("whatsapp-disconnected")
    );
  });
});

ipcMain.handle("whatsapp-disconnect", async () => {
  await get("whatsapp").destroy();
  return { status: "disconnected" };
});

ipcMain.handle("whatsapp-status", () => ({
  connected: modules.whatsapp ? get("whatsapp").isConnected() : false,
}));

ipcMain.handle("whatsapp-campaign", async (_, { message, contacts }) => {
  return get("whatsapp").runCampaign(contacts, message, (p) => {
    mainWindow.webContents.send("campaign-progress", p);
  });
});

// ── Gmail ─────────────────────────────────────────────────────────────────────

ipcMain.handle("gmail-test", async (_, { email, appPassword }) =>
  get("gmail").testConnection(email, appPassword)
);

ipcMain.handle("gmail-campaign", async (_, payload) => {
  const db = get("database");
  const ttsEnabled = db.getPreference("tts_enabled") === "true";
  const lang = db.getPreference("tts_language") || "en";
  let audioPath = null;
  if (ttsEnabled) {
    try { audioPath = await get("tts").generate(payload.body, lang); } catch (_) {}
  }
  return get("gmail").runCampaign({ ...payload, audioPath }, (p) => {
    mainWindow.webContents.send("campaign-progress", p);
  });
});

// ── YouTube ───────────────────────────────────────────────────────────────────

ipcMain.handle("youtube-auth-url",  async ()      => get("youtube").getAuthUrl());
ipcMain.handle("youtube-auth-code", async (_, c)  => get("youtube").exchangeCode(c));
ipcMain.handle("youtube-upload",    async (_, p)  => get("youtube").uploadVideo(p));
ipcMain.handle("youtube-community", async (_, {text}) => get("youtube").communityPost(text));

// ── Instagram ─────────────────────────────────────────────────────────────────

ipcMain.handle("instagram-login", async (_, p) => get("instagram").login(p.username, p.password));
ipcMain.handle("instagram-post",  async (_, p) => get("instagram").post(p));

// ── iMessage ──────────────────────────────────────────────────────────────────

ipcMain.handle("imessage-campaign", async (_, { message, contacts }) =>
  get("imessage").runCampaign(contacts, message)
);

// ── TTS ───────────────────────────────────────────────────────────────────────

ipcMain.handle("tts-preview", async (_, { text, lang }) => {
  const p = await get("tts").generate(text, lang);
  get("tts").play(p);
  return { ok: true };
});

// ── Contacts ──────────────────────────────────────────────────────────────────

ipcMain.handle("open-csv-dialog", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select contacts CSV",
    filters: [{ name: "CSV files", extensions: ["csv"] }],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const raw = fs.readFileSync(result.filePaths[0], "utf-8");
  const cc  = get("database").getPreference("default_country_code") || "IN";
  return get("contacts").parseCSV(raw, cc);
});

ipcMain.handle("get-contact-prefs", async () => {
  await get("database").ensureReady();
  return get("database").getAllContactPreferences();
});

// ── Inbound WhatsApp ──────────────────────────────────────────────────────────

// Wire up after whatsapp module is loaded
ipcMain.handle("whatsapp-wire-inbound", () => {
  get("whatsapp").onInbound(async (phone, msgType, replyId, textBody) => {
    const result = await handleInbound(phone, replyId, textBody);
    mainWindow.webContents.send("whatsapp-inbound-log", result);
  });
  return { ok: true };
});

async function handleInbound(phone, replyId, textBody) {
  const db = get("database");
  const contact = db.getOrCreateContact(phone);

  if (textBody === "STOP") {
    db.updateContact(phone, { opted_out: 1 });
    await get("whatsapp").sendText(phone, "You've been unsubscribed. Reply START to resubscribe.");
    return `opted_out:${phone}`;
  }
  if (textBody === "START") {
    db.updateContact(phone, { opted_out: 0, stage: "NEW" });
    await get("whatsapp").sendText(phone, "You've been resubscribed!");
    return `resubscribed:${phone}`;
  }
  if (contact.opted_out) return `ignored:${phone}`;

  const LANG_MAP = {
    lang_en:["English","en"], "1":["English","en"],
    lang_hi:["Hindi","hi"],   "2":["Hindi","hi"],
    lang_ta:["Tamil","ta"],   "3":["Tamil","ta"],
    lang_te:["Telugu","te"],  "4":["Telugu","te"],
    lang_kn:["Kannada","kn"], "5":["Kannada","kn"],
  };
  const FMT_MAP = { fmt_text:"text","1":"text", fmt_audio:"audio","2":"audio" };

  if (contact.stage === "AWAITING_LANGUAGE") {
    const match = LANG_MAP[replyId] || LANG_MAP[textBody];
    if (match) {
      const [langName, langCode] = match;
      db.updateContact(phone, { stage:"AWAITING_FORMAT", language_name:langName, language_code:langCode });
      await get("whatsapp").sendFormatMenu(phone);
      return `language_set:${phone}:${langName}`;
    }
  }

  if (contact.stage === "AWAITING_FORMAT") {
    const format = FMT_MAP[replyId] || FMT_MAP[textBody];
    if (format) {
      db.updateContact(phone, { stage:"COMPLETED", preferred_format:format });
      const updated = db.getOrCreateContact(phone);
      if (updated.pending_message) {
        const translated = await get("translator").translate(updated.pending_message, updated.language_name);
        if (format === "audio") {
          const audio = await get("tts").generate(translated, updated.language_code);
          await get("whatsapp").sendAudio(phone, audio);
        } else {
          await get("whatsapp").sendText(phone, translated);
        }
        db.updateContact(phone, { pending_message: null });
      }
      return `delivered:${phone}:${updated.language_name}:${format}`;
    }
  }

  return `unhandled:${phone}:stage=${contact.stage}`;
}

// ── WhatsApp Business API handlers ────────────────────────────────────────────

ipcMain.handle("wa-business-test", async (_, { phoneId, token }) => {
  const https = require("https");
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "graph.facebook.com",
        path:     `/v20.0/${phoneId}`,
        method:   "GET",
        headers:  { "Authorization": `Bearer ${token}` },
      },
      (res) => {
        let raw = "";
        res.on("data", c => raw += c);
        res.on("end", () => {
          try {
            const body = JSON.parse(raw);
            if (body.id) resolve({ ok: true, name: body.display_phone_number || body.id });
            else         resolve({ ok: false, error: body.error?.message || "Invalid credentials" });
          } catch { resolve({ ok: false, error: "Could not parse response" }); }
        });
      }
    );
    req.on("error", e => resolve({ ok: false, error: e.message }));
    req.end();
  });
});

ipcMain.handle("wa-business-campaign", async (_, { message, contacts }) => {
  const db      = get("database");
  const phoneId = db.getPreference("wa_business_phone_id") || "";
  const token   = db.getPreference("wa_business_token")    || "";
  if (!phoneId || !token) {
    return { ok: false, error: "Business API not configured. Go to Settings > WhatsApp Business." };
  }
  return get("whatsapp-business").runCampaign(
    contacts, message, phoneId, token, db,
    (p) => mainWindow.webContents.send("campaign-progress", p)
  );
});

ipcMain.handle("wa-business-webhook", async (_, payload) => {
  const db      = get("database");
  const phoneId = db.getPreference("wa_business_phone_id") || "";
  const token   = db.getPreference("wa_business_token")    || "";
  const result  = await get("whatsapp-business").handleInbound(payload, phoneId, token, db);
  mainWindow.webContents.send("whatsapp-inbound-log", result);
  return { ok: true };
});
