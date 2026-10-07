'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · EAN-13
 *  A book's barcode is always EAN-13: 978/979 followed by the ISBN. One row of
 *  pixels is enough to read it, and decoding that is small enough to own — so
 *  the scanner works on every device. The browser's BarcodeDetector is only a
 *  faster path where it exists (see bookscan.js).
 * ========================================================================== */

// Run widths of each digit in modules, left-hand odd parity (L). G is L
// reversed. R has L's widths with the colours swapped, which a run list does
// not see, so the right half is matched against L.
const L_CODES = ['3211', '2221', '2122', '1411', '1132', '1231', '1114', '1312', '1213', '3112']
  .map(s => s.split('').map(Number));
const G_CODES = L_CODES.map(c => c.slice().reverse());
// The parity pattern of the six left digits encodes the first digit. 1 = G.
const FIRST_DIGIT = ['000000', '001011', '001101', '001110', '010011', '011001', '011100', '010101', '010110', '011010'];

function checksumOk(code) {
  if (!/^\d{13}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

function isBookCode(code) {
  return checksumOk(String(code || '')) && /^97[89]/.test(code);
}

function isbn10Ok(ten) {
  if (!/^\d{9}[\dX]$/.test(ten)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (ten[i] === 'X' ? 10 : Number(ten[i])) * (10 - i);
  return sum % 11 === 0;
}

/* Any written form of an ISBN → the 13-digit one, or null. Everything that
   compares ISBNs goes through here, so 3-423-… and 978-3-423-… are equal. */
function toIsbn13(input) {
  const s = String(input == null ? '' : input).replace(/[^0-9Xx]/g, '').toUpperCase();
  if (s.length === 13) return isBookCode(s) ? s : null;
  if (s.length === 10 && isbn10Ok(s)) {
    const core = '978' + s.slice(0, 9);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 ? 3 : 1);
    return core + ((10 - (sum % 10)) % 10);
  }
  return null;
}

/* Dark/light runs of one row. The threshold is the midpoint between the darkest and lightest
   pixel nearby, so a shadow across the cover does not swallow half the bars
   and bar edges stay put next to a quiet zone; a band around it keeps sensor
   noise on white paper from flickering into fake bars. */
function runsOf(row) {
  const n = row.length;
  if (n < 20) return [];
  let lo = 255, hi = 0;
  for (let i = 0; i < n; i++) { if (row[i] < lo) lo = row[i]; if (row[i] > hi) hi = row[i]; }
  if (hi - lo < 40) return [];
  // A 3-tap average first: sensor noise is per pixel, bars are not.
  const px = new Float64Array(n);
  for (let i = 0; i < n; i++) px[i] = (row[Math.max(0, i - 1)] + row[i] + row[Math.min(n - 1, i + 1)]) / 3;
  const band = (hi - lo) * 0.08;
  const win = Math.max(8, Math.round(n / 10));
  const runs = [];
  let dark = false;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - win), b = Math.min(n, i + win);
    let wlo = 255, whi = 0;
    for (let k = a; k < b; k++) { if (px[k] < wlo) wlo = px[k]; if (px[k] > whi) whi = px[k]; }
    const mean = (wlo + whi) / 2;
    if (px[i] < mean - band) dark = true;
    else if (px[i] > mean + band) dark = false;
    const last = runs[runs.length - 1];
    if (last && last.dark === dark) last.len++;
    else runs.push({ dark, len: 1 });
  }
  return runs;
}

function matchDigit(w, tables) {
  const total = w[0] + w[1] + w[2] + w[3];
  const norm = w.map(x => x * 7 / total);
  let best = null;
  for (const [codes, parity] of tables) codes.forEach((c, digit) => {
    const err = Math.abs(c[0] - norm[0]) + Math.abs(c[1] - norm[1]) + Math.abs(c[2] - norm[2]) + Math.abs(c[3] - norm[3]);
    if (!best || err < best.err) best = { digit, parity, err };
  });
  return best && best.err < 2.2 ? best : null;
}

function guardOk(lens, module) {
  return lens.every(l => l > module * 0.4 && l < module * 1.8);
}

/* 3 guard + 6×4 + 5 middle + 6×4 + 3 guard = 59 runs starting on a bar. */
function decodeRuns(runs) {
  const lens = runs.map(r => r.len);
  for (let i = 1; i + 59 <= runs.length; i++) {
    if (!runs[i].dark) continue;
    let width = 0;
    for (let k = i; k < i + 59; k++) width += lens[k];
    const module = width / 95;
    if (lens[i - 1] < module * 3) continue;                       // quiet zone
    if (!guardOk(lens.slice(i, i + 3), module)) continue;
    if (!guardOk(lens.slice(i + 27, i + 32), module)) continue;
    if (!guardOk(lens.slice(i + 56, i + 59), module)) continue;
    let digits = '', parity = '', bad = false;
    for (let d = 0; d < 6 && !bad; d++) {
      const m = matchDigit(lens.slice(i + 3 + d * 4, i + 7 + d * 4), [[L_CODES, '0'], [G_CODES, '1']]);
      if (!m) bad = true; else { digits += m.digit; parity += m.parity; }
    }
    for (let d = 0; d < 6 && !bad; d++) {
      const m = matchDigit(lens.slice(i + 32 + d * 4, i + 36 + d * 4), [[L_CODES, '0']]);
      if (!m) bad = true; else digits += m.digit;
    }
    if (bad) continue;
    const first = FIRST_DIGIT.indexOf(parity);
    if (first < 0) continue;
    const code = first + digits;
    if (checksumOk(code)) return code;
  }
  return null;
}

function decodeRow(row) {
  const fwd = decodeRuns(runsOf(row));
  if (fwd) return fwd;
  return decodeRuns(runsOf(Array.from(row).reverse()));
}

function lumaRow(img, y) {
  const row = new Uint8Array(img.width), d = img.data, base = y * img.width * 4;
  for (let x = 0; x < img.width; x++) {
    const i = base + x * 4;
    row[x] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  }
  return row;
}

function lumaColumn(img, x) {
  const col = new Uint8Array(img.height), d = img.data;
  for (let y = 0; y < img.height; y++) {
    const i = (y * img.width + x) * 4;
    col[y] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  }
  return col;
}

const DEFAULT_ROWS = Array.from({ length: 41 }, (_, k) => 0.1 + k * 0.02);

/* Several scanlines; the first that decodes with a valid checksum wins. A
   photo can be sideways, so `columns` also tries vertical lines. */
function decodeImage(img, opts = {}) {
  const fractions = opts.rows || DEFAULT_ROWS;
  for (const f of fractions) {
    const code = decodeRow(lumaRow(img, Math.min(img.height - 1, Math.round(img.height * f))));
    if (code) return code;
  }
  if (opts.columns) for (const f of fractions) {
    const code = decodeRow(lumaColumn(img, Math.min(img.width - 1, Math.round(img.width * f))));
    if (code) return code;
  }
  return null;
}

module.exports = { checksumOk, isBookCode, toIsbn13, decodeRow, decodeImage, runsOf };
