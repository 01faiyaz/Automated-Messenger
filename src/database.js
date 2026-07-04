const path    = require("path");
const fs      = require("fs");
const { app } = require("electron");
const initSqlJs = require("sql.js");

const DB_PATH = path.join(app.getPath("userData"), "sma.db");

let db = null;

async function getDB() {
  if (db) return db;

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS preferences (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contact_preferences (
      phone            TEXT PRIMARY KEY,
      stage            TEXT DEFAULT 'NEW',
      language_name    TEXT,
      language_code    TEXT,
      preferred_format TEXT,
      pending_message  TEXT,
      opted_out        INTEGER DEFAULT 0
    );
  `);

  // Seed defaults
  const DEFAULTS = {
    tts_enabled:          "true",
    tts_language:         "en",
    platforms:            JSON.stringify({ whatsapp:false, gmail:false, youtube:false, instagram:false, imessage:false }),
    gmail_address:        "",
    gmail_app_password:   "",
    instagram_username:   "",
    instagram_password:   "",
    youtube_tokens:       "",
    default_country_code: "91",
  };
  for (const [k, v] of Object.entries(DEFAULTS)) {
    db.run("INSERT OR IGNORE INTO preferences (key,value) VALUES (?,?)", [k, v]);
  }

  save();
  return db;
}

function save() {
  if (!db) return;
  const data = db.export();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ── Sync wrappers (initialise DB first via ensureReady) ───────────────────────

let _ready = false;
let _readyPromise = null;

function ensureReady() {
  if (_ready) return Promise.resolve();
  if (_readyPromise) return _readyPromise;
  _readyPromise = getDB().then(() => { _ready = true; });
  return _readyPromise;
}

function getPreference(key) {
  if (!db) return null;
  const res = db.exec("SELECT value FROM preferences WHERE key=?", [key]);
  return res.length && res[0].values.length ? res[0].values[0][0] : null;
}

function setPreference(key, value) {
  if (!db) return;
  db.run("INSERT OR REPLACE INTO preferences (key,value) VALUES (?,?)", [key, String(value)]);
  save();
}

function getAllPreferences() {
  return {
    tts_enabled:          getPreference("tts_enabled") === "true",
    tts_language:         getPreference("tts_language") || "en",
    platforms:            JSON.parse(getPreference("platforms") || "{}"),
    gmail_address:        getPreference("gmail_address") || "",
    gmail_app_password:   getPreference("gmail_app_password") || "",
    instagram_username:   getPreference("instagram_username") || "",
    instagram_password:   getPreference("instagram_password") || "",
    youtube_connected:    !!getPreference("youtube_tokens"),
    default_country_code: getPreference("default_country_code") || "91",
  };
}

function savePreferences(prefs) {
  for (const [k, v] of Object.entries(prefs)) {
    setPreference(k, k === "platforms" ? JSON.stringify(v) : v);
  }
}

function togglePlatform(platform, enabled) {
  const platforms = JSON.parse(getPreference("platforms") || "{}");
  platforms[platform] = enabled;
  setPreference("platforms", JSON.stringify(platforms));
}

function getOrCreateContact(phone) {
  if (!db) return null;
  db.run("INSERT OR IGNORE INTO contact_preferences (phone,stage) VALUES (?,?)", [phone, "NEW"]);
  save();
  const res = db.exec("SELECT * FROM contact_preferences WHERE phone=?", [phone]);
  if (!res.length || !res[0].values.length) return null;
  const cols = res[0].columns;
  const vals = res[0].values[0];
  return Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
}

function updateContact(phone, fields) {
  if (!db) return;
  const allowed = ["stage","language_name","language_code","preferred_format","pending_message","opted_out"];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) {
      db.run(`UPDATE contact_preferences SET ${k}=? WHERE phone=?`, [v, phone]);
    }
  }
  save();
}

function getAllContactPreferences() {
  if (!db) return [];
  const res = db.exec("SELECT * FROM contact_preferences ORDER BY phone");
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

module.exports = {
  ensureReady,
  getPreference, setPreference,
  getAllPreferences, savePreferences,
  togglePlatform,
  getOrCreateContact, updateContact, getAllContactPreferences,
};
