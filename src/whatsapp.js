const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const path   = require("path");
const fs     = require("fs");
const { app } = require("electron");

let client       = null;
let _connected   = false;
let _inboundCb   = null;

const SESSION_DIR = path.join(app.getPath("userData"), "whatsapp_session");

/** Register a callback for inbound messages (drives the preference state machine). */
function onInbound(cb) {
  _inboundCb = cb;
}

/**
 * Connect to WhatsApp Web.
 * onQR(dataUrl)  — called with a base64 PNG of the QR code
 * onReady()      — called when connected
 * onDisconnected()
 */
function connect(onQR, onReady, onDisconnected) {
  if (client) {
    client.destroy().catch(() => {});
  }

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    },
  });

  client.on("qr", async (qr) => {
    try {
      const dataUrl = await qrcode.toDataURL(qr, { width: 256 });
      onQR(dataUrl);
    } catch (e) {
      onQR(null);
    }
  });

  client.on("ready", () => {
    _connected = true;
    onReady();
  });

  client.on("disconnected", () => {
    _connected = false;
    onDisconnected();
  });

  client.on("message", async (msg) => {
    if (!_inboundCb) return;
    const phone      = msg.from.replace("@c.us", "").replace(/^\+/, "");
    const msgType    = msg.type;
    const replyId    = msg.selectedRowId || msg.selectedButtonId || "";
    const textBody   = (msg.body || "").trim().toUpperCase();
    await _inboundCb(`+${phone}`, msgType, replyId, textBody);
  });

  client.initialize();
}

async function destroy() {
  if (client) {
    await client.destroy().catch(() => {});
    client     = null;
    _connected = false;
  }
}

function isConnected() {
  return _connected;
}

async function sendText(phone, message) {
  if (!client || !_connected) throw new Error("WhatsApp not connected");
  const chatId = phone.replace("+", "") + "@c.us";
  await client.sendMessage(chatId, message);
}

async function sendAudio(phone, audioPath) {
  if (!client || !_connected) throw new Error("WhatsApp not connected");
  const chatId = phone.replace("+", "") + "@c.us";
  const media  = MessageMedia.fromFilePath(audioPath);
  await client.sendMessage(chatId, media, { sendAudioAsVoice: true });
}

async function sendLanguageMenu(phone) {
  const msg =
    "Hi! Before we send you our message, please reply with a number to choose your language:\n\n" +
    "1 - English\n" +
    "2 - Hindi\n" +
    "3 - Tamil\n" +
    "4 - Telugu\n" +
    "5 - Kannada";
  await sendText(phone, msg);
}

async function sendFormatMenu(phone) {
  const msg =
    "How would you like to receive messages?\n\n" +
    "1 - Text\n" +
    "2 - Voice audio";
  await sendText(phone, msg);
}

// Map plain text replies to IDs (fallback for when interactive buttons aren't available)
const TEXT_LANG_MAP = {
  "1": "lang_en", "ENGLISH": "lang_en",
  "2": "lang_hi", "HINDI":   "lang_hi",
  "3": "lang_ta", "TAMIL":   "lang_ta",
  "4": "lang_te", "TELUGU":  "lang_te",
  "5": "lang_kn", "KANNADA": "lang_kn",
};
const TEXT_FMT_MAP = {
  "1": "fmt_text",  "TEXT":  "fmt_text",
  "2": "fmt_audio", "VOICE": "fmt_audio", "AUDIO": "fmt_audio",
};

function resolveReplyId(stage, replyId, textBody) {
  if (replyId) return replyId;
  if (stage === "AWAITING_LANGUAGE") return TEXT_LANG_MAP[textBody] || "";
  if (stage === "AWAITING_FORMAT")   return TEXT_FMT_MAP[textBody]  || "";
  return "";
}

/**
 * Run a campaign.
 * New contacts → language menu → their message is held.
 * Returning contacts (COMPLETED) → translate + send directly.
 */
async function runCampaign(contacts, message, onProgress) {
  const db         = require("./database");
  const translator = require("./translator");
  const tts        = require("./tts");

  const BATCH     = 20;
  const DELAY_MS  = 3000;
  const results   = { sent_direct: 0, awaiting_preference: 0, failed: 0, errors: [] };

  const limited = contacts.slice(0, 2000);

  for (let i = 0; i < limited.length; i++) {
    const contact = limited[i];
    const phone   = contact.phone;

    try {
      const pref = db.getOrCreateContact(phone);

      if (pref.opted_out) {
        results.failed++;
        continue;
      }

      if (pref.stage === "COMPLETED") {
        // Send directly in their preference
        const translated = await translator.translate(message, pref.language_name || "English");
        if (pref.preferred_format === "audio") {
          const audioPath = await tts.generate(translated, pref.language_code || "en");
          await sendAudio(phone, audioPath);
        } else {
          await sendText(phone, translated);
        }
        results.sent_direct++;
      } else {
        // New / incomplete — send language menu, hold message
        db.updateContact(phone, { stage: "AWAITING_LANGUAGE", pending_message: message });
        await sendLanguageMenu(phone);
        results.awaiting_preference++;
      }
    } catch (e) {
      results.failed++;
      results.errors.push({ phone, error: e.message });
    }

    onProgress({
      done: i + 1,
      total: limited.length,
      ...results,
    });

    // Rate limit: pause between batches
    if ((i + 1) % BATCH === 0 && i + 1 < limited.length) {
      await sleep(DELAY_MS);
    } else {
      await sleep(500);
    }
  }

  return results;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  connect, destroy, isConnected,
  sendText, sendAudio, sendLanguageMenu, sendFormatMenu,
  runCampaign, onInbound, resolveReplyId,
};
