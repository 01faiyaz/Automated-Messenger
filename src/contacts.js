const { parse } = require("csv-parse/sync");
const { phone: parsePhone } = require("phone");

/**
 * Auto-clean a phone number to E.164 format.
 * Works for Indian numbers (default) and international numbers.
 * e.g. "9876543210" → "+919876543210"
 *      "09876543210" → "+919876543210"
 *      "+447911123456" → "+447911123456"
 */
function cleanPhone(raw, defaultCountryCode = "IN") {
  if (!raw) return null;
  const str = String(raw).trim();

  // Try parsing as-is first (handles numbers with country code)
  let result = parsePhone(str);
  if (result.isValid) return result.phoneNumber;

  // Try with default country code
  result = parsePhone(str, { country: defaultCountryCode });
  if (result.isValid) return result.phoneNumber;

  // Last resort: strip non-digits and prepend +91 if 10 digits
  const digits = str.replace(/\D/g, "");
  if (digits.length === 10) {
    result = parsePhone(digits, { country: "IN" });
    if (result.isValid) return result.phoneNumber;
  }

  return null; // unrecognised — will be flagged in preview
}

/**
 * Parse a CSV string.
 * Detects phone column automatically (phone, mobile, number, whatsapp, tel).
 * Returns { contacts, skipped, columns, preview }
 */
function parseCSV(rawText, defaultCountryCode = "IN") {
  const rows = parse(rawText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  if (!rows.length) {
    return { contacts: [], skipped: 0, columns: [], preview: [] };
  }

  const columns = Object.keys(rows[0]);

  // Find the phone column
  const phoneCol = columns.find((c) =>
    /^(phone|mobile|number|whatsapp|tel|cell|contact)$/i.test(c.trim())
  ) || columns[0]; // fall back to first column

  // Find optional name and email columns
  const nameCol  = columns.find((c) => /^(name|full.?name|contact.?name)$/i.test(c)) || null;
  const emailCol = columns.find((c) => /^(email|e.?mail)$/i.test(c)) || null;

  const contacts = [];
  let skipped = 0;

  for (const row of rows) {
    const rawPhone = row[phoneCol] || "";
    const cleaned  = cleanPhone(rawPhone, defaultCountryCode);

    if (!cleaned) {
      skipped++;
      continue;
    }

    contacts.push({
      phone:        cleaned,
      original:     rawPhone,
      name:         nameCol  ? (row[nameCol]  || "") : "",
      email:        emailCol ? (row[emailCol] || "") : "",
      _raw:         row,
    });
  }

  return {
    contacts,
    skipped,
    columns,
    phoneColumn: phoneCol,
    preview: contacts.slice(0, 5),
  };
}

module.exports = { parseCSV, cleanPhone };
