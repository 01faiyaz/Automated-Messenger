const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

function createTransport(email, appPassword) {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: email, pass: appPassword },
  });
}

async function testConnection(email, appPassword) {
  try {
    const transport = createTransport(email, appPassword);
    await transport.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function sendEmail({ transport, from, to, subject, body, audioPath }) {
  const mailOptions = {
    from,
    to,
    subject,
    text: body,
    attachments: [],
  };

  if (audioPath && fs.existsSync(audioPath)) {
    mailOptions.attachments.push({
      filename: "message.mp3",
      path: audioPath,
      contentType: "audio/mpeg",
    });
  }

  return transport.sendMail(mailOptions);
}

async function runCampaign({ email, appPassword, subject, body, contacts, audioPath }, onProgress) {
  const transport = createTransport(email, appPassword);
  const results   = { sent: 0, failed: 0, errors: [] };

  for (let i = 0; i < contacts.length; i++) {
    const contact  = contacts[i];
    const to       = contact.email || contact._raw?.email || "";

    if (!to || !to.includes("@")) {
      results.failed++;
      onProgress({ done: i + 1, total: contacts.length, ...results });
      continue;
    }

    try {
      await sendEmail({ transport, from: email, to, subject, body, audioPath });
      results.sent++;
    } catch (e) {
      results.failed++;
      results.errors.push({ email: to, error: e.message });
    }

    onProgress({ done: i + 1, total: contacts.length, ...results });

    // Small delay to avoid Gmail rate limits
    await new Promise((r) => setTimeout(r, 300));
  }

  return results;
}

module.exports = { testConnection, runCampaign };
