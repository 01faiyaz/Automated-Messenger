const https = require("https");

const LANGUAGE_CODES = {
  English: "en",
  Telugu:  "te",
  Kannada: "kn",
  Tamil:   "ta",
  Hindi:   "hi",
};

/**
 * Translate text using Google Translate's free endpoint.
 * No API key required.
 */
function translate(text, targetLanguageName) {
  const code = LANGUAGE_CODES[targetLanguageName] || "en";
  if (code === "en") return Promise.resolve(text);

  return new Promise((resolve) => {
    const encoded = encodeURIComponent(text);
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${code}&dt=t&q=${encoded}`;

    const req = https.get(
      url,
      { headers: { "User-Agent": "Mozilla/5.0" } },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json   = JSON.parse(data);
            const result = json[0].map((s) => s[0]).join("");
            resolve(result || text);
          } catch {
            resolve(text); // fall back to original on parse error
          }
        });
      }
    );

    req.on("error", () => resolve(text));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve(text);
    });
  });
}

module.exports = { translate, LANGUAGE_CODES };
