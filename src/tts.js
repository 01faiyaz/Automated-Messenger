const https = require("https");
const fs    = require("fs");
const path  = require("path");
const { app } = require("electron");

const TMP_DIR = app.getPath("temp");

/**
 * Generate an MP3 using Google Translate's TTS endpoint.
 * Free, no API key, works for all 5 languages.
 */
function generate(text, langCode = "en") {
  return new Promise((resolve, reject) => {
    if (!text || !text.trim()) return reject(new Error("Empty text"));

    // Google TTS silently truncates above ~200 chars — chunk if needed
    const chunks = chunkText(text, 180);
    const promises = chunks.map((chunk, i) => generateChunk(chunk, langCode, i));

    Promise.all(promises)
      .then((paths) => {
        if (paths.length === 1) return resolve(paths[0]);
        // Merge chunks by concatenating raw MP3 bytes (works for simple playback)
        const outPath = path.join(TMP_DIR, `tts_merged_${Date.now()}.mp3`);
        const out = fs.createWriteStream(outPath);
        for (const p of paths) {
          out.write(fs.readFileSync(p));
          fs.unlinkSync(p);
        }
        out.end();
        out.on("finish", () => resolve(outPath));
      })
      .catch(reject);
  });
}

function generateChunk(text, langCode, index) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(text);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=${langCode}&client=tw-ob&ttsspeed=0.9`;
    const outPath = path.join(TMP_DIR, `tts_${Date.now()}_${index}.mp3`);
    const file = fs.createWriteStream(outPath);

    const req = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: "https://translate.google.com/",
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`TTS HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve(outPath);
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("TTS request timed out"));
    });
  });
}

/** Play an MP3 file using the OS default player (no extra deps). */
function play(audioPath) {
  const { exec } = require("child_process");
  if (process.platform === "darwin") {
    exec(`afplay "${audioPath}"`);
  } else if (process.platform === "win32") {
    exec(
      `powershell -c "(New-Object Media.SoundPlayer '${audioPath}').PlaySync()"`
    );
  } else {
    exec(`mpg123 "${audioPath}" 2>/dev/null || aplay "${audioPath}" 2>/dev/null`);
  }
}

function chunkText(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    let end = maxLen;
    // Try to split on a sentence boundary
    if (remaining.length > maxLen) {
      const period = remaining.lastIndexOf(".", maxLen);
      const space  = remaining.lastIndexOf(" ", maxLen);
      end = period > maxLen * 0.6 ? period + 1 : space > 0 ? space : maxLen;
    }
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  return chunks;
}

module.exports = { generate, play };
