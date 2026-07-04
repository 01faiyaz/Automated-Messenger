const { google } = require("googleapis");
const { app }    = require("electron");
const fs         = require("fs");
const path       = require("path");

const db = require("./database");

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

const TOKEN_PATH = path.join(app.getPath("userData"), "youtube_token.json");

// NOTE: Users need to create their own OAuth client ID at console.cloud.google.com
// and paste the client_id and client_secret into Settings.
// This is a one-time setup step.

function getOAuthClient() {
  const clientId     = db.getPreference("youtube_client_id")     || "";
  const clientSecret = db.getPreference("youtube_client_secret") || "";

  if (!clientId || !clientSecret) {
    throw new Error(
      "YouTube client ID and secret not set. Go to Settings > YouTube and follow the setup instructions."
    );
  }

  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    "urn:ietf:wg:oauth:2.0:oob" // desktop flow — user copies code from browser
  );
}

function getAuthUrl() {
  const auth = getOAuthClient();
  return auth.generateAuthUrl({ access_type: "offline", scope: SCOPES });
}

async function exchangeCode(code) {
  const auth = getOAuthClient();
  const { tokens } = await auth.getToken(code);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
  db.setPreference("youtube_tokens", JSON.stringify(tokens));
  return { ok: true };
}

function getAuthedClient() {
  const auth   = getOAuthClient();
  const stored = db.getPreference("youtube_tokens");
  if (!stored) throw new Error("YouTube not connected. Go to Settings > YouTube to connect.");
  auth.setCredentials(JSON.parse(stored));
  return auth;
}

async function uploadVideo({ videoPath, title, description, tags = [], privacy = "private" }) {
  const auth    = getAuthedClient();
  const youtube = google.youtube({ version: "v3", auth });

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: { title, description, tags, categoryId: "22" },
      status:  { privacyStatus: privacy, selfDeclaredMadeForKids: false },
    },
    media: {
      body: fs.createReadStream(videoPath),
    },
  });

  const id = res.data.id;
  return { ok: true, videoId: id, url: `https://youtube.com/watch?v=${id}` };
}

async function communityPost(text) {
  const auth    = getAuthedClient();
  const youtube = google.youtube({ version: "v3", auth });
  const res = await youtube.communityPosts.insert({
    part: ["snippet"],
    requestBody: { snippet: { type: "text", textOriginal: text } },
  });
  return { ok: true, postId: res.data.id };
}

module.exports = { getAuthUrl, exchangeCode, uploadVideo, communityPost };
