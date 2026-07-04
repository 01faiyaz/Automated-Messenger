const { exec } = require("child_process");

function isSupported() {
  return process.platform === "darwin";
}

function sendMessage(recipient, message) {
  return new Promise((resolve, reject) => {
    if (!isSupported()) {
      return reject(new Error("iMessage is only available on macOS."));
    }

    const safe = message.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const script = `
      tell application "Messages"
        set targetService to 1st account whose service type = iMessage
        set targetBuddy to participant "${recipient}" of targetService
        send "${safe}" to targetBuddy
      end tell
    `;

    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

async function runCampaign(contacts, message) {
  if (!isSupported()) {
    return { ok: false, error: "iMessage is only available on macOS." };
  }

  const results = { sent: 0, failed: 0, errors: [] };

  for (const contact of contacts) {
    const recipient = contact.imessage || contact.phone || "";
    if (!recipient) continue;

    try {
      await sendMessage(recipient, message);
      results.sent++;
    } catch (e) {
      results.failed++;
      results.errors.push({ recipient, error: e.message });
    }

    await new Promise((r) => setTimeout(r, 1500));
  }

  return results;
}

module.exports = { isSupported, sendMessage, runCampaign };
