const { IgApiClient } = require("instagram-private-api");
const fs = require("fs");

const ig = new IgApiClient();
let _loggedIn = false;

async function login(username, password) {
  try {
    ig.state.generateDevice(username);
    await ig.simulate.preLoginFlow();
    await ig.account.login(username, password);
    await ig.simulate.postLoginFlow();
    _loggedIn = true;
    return { ok: true };
  } catch (e) {
    _loggedIn = false;
    return { ok: false, error: e.message };
  }
}

function ensureLoggedIn() {
  if (!_loggedIn) throw new Error("Instagram not connected. Go to Settings > Instagram and log in.");
}

async function post({ type, imagePath, videoPath, caption }) {
  ensureLoggedIn();

  if (type === "photo" && imagePath) {
    const imageBuffer = fs.readFileSync(imagePath);
    const res = await ig.publish.photo({ file: imageBuffer, caption });
    return { ok: true, mediaId: res.media.id };
  }

  if (type === "video" && videoPath) {
    const videoBuffer = fs.readFileSync(videoPath);
    const res = await ig.publish.video({ video: videoBuffer, caption });
    return { ok: true, mediaId: res.media.id };
  }

  return { ok: false, error: "Provide imagePath or videoPath" };
}

module.exports = { login, post };
