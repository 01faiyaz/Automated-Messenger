/**
 * WhatsApp Business Cloud API integration.
 * Official Meta API — no ban risk, costs ~$0.005/conversation in India.
 * Requires: WABA phone number ID + permanent system user token from Meta.
 */

const https = require("https");

const GRAPH_URL = "https://graph.facebook.com/v20.0";
const BATCH_SIZE = 50;
const BATCH_DELAY = 2000;
const MAX_CONTACTS = 2000;

const LANG_MAP = {
  lang_en: ["English", "en"],
  lang_hi: ["Hindi",   "hi"],
  lang_ta: ["Tamil",   "ta"],
  lang_te: ["Telugu",  "te"],
  lang_kn: ["Kannada", "kn"],
};
const FMT_MAP = { fmt_text: "text", fmt_audio: "audio" };

// ── HTTP helper ───────────────────────────────────────────────────────────────

function apiPost(path, body, token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = https.request(
      {
        hostname: "graph.facebook.com",
        path:     `/v20.0${path}`,
        method:   "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${token}`,
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", c => raw += c);
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, body: raw }); }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ── Senders ───────────────────────────────────────────────────────────────────

async function sendText(phone, message, phoneId, token) {
  return apiPost(`/${phoneId}/messages`, {
    messaging_product: "whatsapp",
    to:   phone,
    type: "text",
    text: { body: message },
  }, token);
}

async function sendLanguageMenu(phone, phoneId, token) {
  return apiPost(`/${phoneId}/messages`, {
    messaging_product: "whatsapp",
    to:   phone,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: "Hi! Please choose your preferred language before we send you our message." },
      action: {
        button: "Choose language",
        sections: [{
          title: "Languages",
          rows: [
            { id: "lang_en", title: "English" },
            { id: "lang_hi", title: "Hindi"   },
            { id: "lang_ta", title: "Tamil"   },
            { id: "lang_te", title: "Telugu"  },
            { id: "lang_kn", title: "Kannada" },
          ],
        }],
      },
    },
  }, token);
}

async function sendFormatMenu(phone, phoneId, token) {
  return apiPost(`/${phoneId}/messages`, {
    messaging_product: "whatsapp",
    to:   phone,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "How would you like to receive messages?" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "fmt_text",  title: "Text"        } },
          { type: "reply", reply: { id: "fmt_audio", title: "Voice audio" } },
        ],
      },
    },
  }, token);
}

async function uploadAudio(audioPath, phoneId, token) {
  const fs   = require("fs");
  const path = require("path");
  const http = require("https");
  const FormData = require("form-data");

  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type",  "audio/mpeg");
    form.append("file",  fs.createReadStream(audioPath), {
      filename:    path.basename(audioPath),
      contentType: "audio/mpeg",
    });

    const req = https.request(
      {
        hostname: "graph.facebook.com",
        path:     `/v20.0/${phoneId}/media`,
        method:   "POST",
        headers: {
          ...form.getHeaders(),
          "Authorization": `Bearer ${token}`,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", c => raw += c);
        res.on("end", () => {
          try { resolve(JSON.parse(raw)); }
          catch { resolve({ error: raw }); }
        });
      }
    );
    req.on("error", reject);
    form.pipe(req);
  });
}

async function sendAudio(phone, audioPath, phoneId, token) {
  const upload = await uploadAudio(audioPath, phoneId, token);
  if (!upload.id) throw new Error(`Audio upload failed: ${JSON.stringify(upload)}`);

  return apiPost(`/${phoneId}/messages`, {
    messaging_product: "whatsapp",
    to:   phone,
    type: "audio",
    audio: { id: upload.id },
  }, token);
}

// ── Webhook verification ──────────────────────────────────────────────────────

function verifyWebhook(verifyToken, hubChallenge, receivedToken) {
  if (receivedToken === verifyToken) return hubChallenge;
  return null;
}

// ── Campaign ──────────────────────────────────────────────────────────────────

async function runCampaign(contacts, message, phoneId, token, db, onProgress) {
  const translator = require("./translator");
  const tts        = require("./tts");

  const limited = contacts.slice(0, MAX_CONTACTS);
  const results  = { sent_direct: 0, awaiting_preference: 0, failed: 0, errors: [] };

  for (let i = 0; i < limited.length; i++) {
    const contact = limited[i];
    const phone   = contact.phone;

    try {
      const pref = db.getOrCreateContact(phone);

      if (pref.opted_out) { results.failed++; continue; }

      if (pref.stage === "COMPLETED") {
        const translated = await translator.translate(message, pref.language_name || "English");
        if (pref.preferred_format === "audio") {
          const audio = await tts.generate(translated, pref.language_code || "en");
          await sendAudio(phone, audio, phoneId, token);
        } else {
          await sendText(phone, translated, phoneId, token);
        }
        results.sent_direct++;
      } else {
        db.updateContact(phone, { stage: "AWAITING_LANGUAGE", pending_message: message });
        await sendLanguageMenu(phone, phoneId, token);
        results.awaiting_preference++;
      }
    } catch (e) {
      results.failed++;
      results.errors.push({ phone, error: e.message });
    }

    onProgress({ done: i + 1, total: limited.length, ...results });

    if ((i + 1) % BATCH_SIZE === 0 && i + 1 < limited.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY));
    } else {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return results;
}

// ── Inbound webhook handler ───────────────────────────────────────────────────

async function handleInbound(payload, phoneId, token, db) {
  const translator = require("./translator");
  const tts        = require("./tts");

  try {
    const msg      = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return "no_message";

    const phone        = "+" + msg.from;
    const listReplyId  = msg?.interactive?.list_reply?.id   || "";
    const btnReplyId   = msg?.interactive?.button_reply?.id || "";
    const replyId      = listReplyId || btnReplyId;
    const textBody     = (msg?.text?.body || "").trim().toUpperCase();
    const contact      = db.getOrCreateContact(phone);

    if (textBody === "STOP") {
      db.updateContact(phone, { opted_out: 1 });
      await sendText(phone, "You've been unsubscribed. Reply START to resubscribe.", phoneId, token);
      return `opted_out:${phone}`;
    }
    if (textBody === "START" && contact.opted_out) {
      db.updateContact(phone, { opted_out: 0, stage: "NEW" });
      await sendText(phone, "You've been resubscribed!", phoneId, token);
      return `resubscribed:${phone}`;
    }
    if (contact.opted_out) return `ignored:${phone}`;

    if (contact.stage === "AWAITING_LANGUAGE" && LANG_MAP[replyId]) {
      const [langName, langCode] = LANG_MAP[replyId];
      db.updateContact(phone, { stage: "AWAITING_FORMAT", language_name: langName, language_code: langCode });
      await sendFormatMenu(phone, phoneId, token);
      return `language_set:${phone}:${langName}`;
    }

    if (contact.stage === "AWAITING_FORMAT" && FMT_MAP[replyId]) {
      const format  = FMT_MAP[replyId];
      db.updateContact(phone, { stage: "COMPLETED", preferred_format: format });
      const updated = db.getOrCreateContact(phone);

      if (updated.pending_message) {
        const translated = await translator.translate(updated.pending_message, updated.language_name);
        if (format === "audio") {
          const audio = await tts.generate(translated, updated.language_code);
          await sendAudio(phone, audio, phoneId, token);
        } else {
          await sendText(phone, translated, phoneId, token);
        }
        db.updateContact(phone, { pending_message: null });
      }
      return `delivered:${phone}:${updated.language_name}:${format}`;
    }

    return `unhandled:${phone}:stage=${contact.stage}`;
  } catch (e) {
    return `error:${e.message}`;
  }
}

module.exports = {
  sendText, sendLanguageMenu, sendFormatMenu, sendAudio,
  runCampaign, handleInbound, verifyWebhook,
};
