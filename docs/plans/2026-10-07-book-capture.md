# Book capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scan or type an ISBN, look the book up, and create a note from a user-chosen template with the cover image downloaded into the vault — or fill the empty fields of an existing note.

**Architecture:** Four pure libraries (`ean13`, `booktemplate`, `booksources`, `bookcapture`) carry all logic and are tested in the headless-Chromium harness. A thin camera wrapper (`bookscan`) and one modal (`modals/bookcapture.js`) glue them to Obsidian. Settings hold a list of profiles; nothing about one user's library is in code.

**Tech Stack:** plain CommonJS JS bundled by esbuild, Obsidian API (`requestUrl`, `Modal`, `processFrontMatter`, `vault.createBinary`), test harness `./test/run.sh` (headless Chromium, `test/obsidian-stub.js`).

**Spec:** `docs/specs/2026-10-07-book-capture-design.md`

All paths below are relative to the plugin root
`~/DEV/Public/nexus-suite/project/.obsidian/plugins/nexus-suite`.

## Global Constraints

- No new runtime dependency. `package.json` keeps only `esbuild` as devDependency.
- Everything written to disk is English: code, comments, UI strings, docs.
- Nothing user-specific in code: template, folders, file name patterns, ISBN/cover property names, source order all come from `settings.bookCapture`.
- Fixed in code only: the EAN-13 scanner and the placeholder set `isbn, title, subtitle, author, authors, publisher, year, pages, language, description, genres, cover, date` plus `{{ask:Label|a,b}}` / `{{ask:Label}}`.
- A note is never created with a missing or broken cover when the template uses `{{cover}}`.
- Never overwrite: existing files get ` (2)`, ` (3)`; fill mode never replaces a non-empty value.
- Google Books key lives in the per-device credential store (`plugin.setCredential('googlebooks', { secret })`), never in `data.json`.
- Commits: no Claude attribution of any kind (no Co-Authored-By, no "Generated with").
- `./test/run.sh` must exit 0 after every task.

## File map

| File | Status | Job |
|---|---|---|
| `src/lib/ean13.js` | create | EAN-13 row decoder, checksum, ISBN-10↔13 |
| `src/lib/booktemplate.js` | create | placeholder scan + render, YAML escaping, frontmatter entries |
| `src/lib/booksources.js` | create | DNB / Open Library / Google adapters, query, merge, cover loading |
| `src/lib/bookcapture.js` | create | file names, unique paths, duplicates, fill proposals, profile validation |
| `src/lib/bookscan.js` | create | camera loop + photo decode |
| `src/modals/bookcapture.js` | create | the dialog |
| `src/modals/bookcapture-picker.js` | create | vault image picker |
| `src/styles/25-bookcapture.css` | create | dialog styles |
| `src/styles/index.css` | modify | import the new sheet |
| `src/constants.js` | modify | `DEFAULT_SETTINGS.bookCapture`, `NX_MODULES.bookCapture` |
| `src/settings.js` | modify | nav entry + `tBookCapture` |
| `src/main.js` | modify | commands, ribbon icon |
| `test/bookcapture.html` | create | all assertions for this feature |
| `test/fixtures/book-*.{xml,json}` | create | recorded API answers |
| `test/entry.js`, `test/run.sh` | modify | register libs and page |
| `README.md`, wiki, `CHANGELOG.md` | modify | docs |

---

### Task 1: EAN-13 decoder

**Files:**
- Create: `src/lib/ean13.js`
- Create: `test/bookcapture.html`
- Modify: `test/entry.js` (append one line), `test/run.sh` (page list)

**Interfaces:**
- Produces: `ean13.checksumOk(code: string): boolean`, `ean13.isBookCode(code): boolean`, `ean13.toIsbn13(input: string|number): string|null`, `ean13.decodeRow(row: ArrayLike<number>): string|null`, `ean13.decodeImage(img: ImageData, opts?: { rows?: number[], columns?: boolean }): string|null`

- [ ] **Step 1: Write the test page with failing tests**

Create `test/bookcapture.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>book capture harness</title>
<style>body { margin:0; background:#141414; color:#ddd; font:13px/1.5 system-ui; padding:20px; }</style>
</head><body>
<pre id="out"></pre>
<script>window.__err=[];window.onerror=(m,f,l,c,e)=>{window.__err.push(String(m)+"\n"+(e&&e.stack||""));};</script>
<script src="bundle.js"></script>
<script>
const out = []; let pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; out.push('PASS  ' + n); } else { fail++; out.push('FAIL  ' + n + (d ? '  →  ' + d : '')); } }
function eq(n, g, w) { const a = JSON.stringify(g), b = JSON.stringify(w); ok(n, a === b, 'got ' + a + ' want ' + b); }

/* ── a test-only EAN-13 encoder: digits → 95 modules → canvas ─────────────── */
const L_W = ['3211','2221','2122','1411','1132','1231','1114','1312','1213','3112'];
const PARITY = ['000000','001011','001101','001110','010011','011001','011100','010101','010110','011010'];
function widthsToBits(w, startDark) { let s = '', dark = startDark; for (const n of w) { s += (dark ? '1' : '0').repeat(Number(n)); dark = !dark; } return s; }
function eanBits(code) {
  let bits = '101';
  const par = PARITY[Number(code[0])];
  for (let i = 1; i <= 6; i++) {
    const w = L_W[Number(code[i])];
    bits += widthsToBits(par[i - 1] === '1' ? w.split('').reverse().join('') : w, false);
  }
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += widthsToBits(L_W[Number(code[i])], true);
  return bits + '101';
}
function drawBarcode(code, o = {}) {
  const scale = o.scale || 3, bits = eanBits(code);
  const c = document.createElement('canvas');
  c.width = (bits.length + 30) * scale + (o.pad || 0); c.height = 80 * scale;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.save();
  if (o.tilt) { g.translate(c.width / 2, c.height / 2); g.rotate(o.tilt * Math.PI / 180); g.translate(-c.width / 2, -c.height / 2); }
  if (o.blur) g.filter = 'blur(' + o.blur + 'px)';
  g.fillStyle = '#111';
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') g.fillRect((15 + i) * scale, 5 * scale, scale, 70 * scale);
  g.restore();
  const img = g.getImageData(0, 0, c.width, c.height);
  if (o.noise) for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() * 2 - 1) * o.noise;
    for (let k = 0; k < 3; k++) img.data[i + k] = Math.max(0, Math.min(255, img.data[i + k] + n));
  }
  if (o.shade) for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const i = (y * img.width + x) * 4, f = 1 - o.shade * x / img.width;
    for (let k = 0; k < 3; k++) img.data[i + k] *= f;
  }
  return img;
}
function rotate90(img) {
  const o = new ImageData(img.height, img.width);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++)
    for (let k = 0; k < 4; k++) o.data[(x * img.height + (img.height - 1 - y)) * 4 + k] = img.data[(y * img.width + x) * 4 + k];
  return o;
}
window.testTools = { drawBarcode, rotate90 };

(async () => {
try {
const E = window.ean13Lib;

// ── checksum and ISBN forms ────────────────────────────────────────────────
{
  ok('ean · a valid code passes', E.checksumOk('9783423343824'));
  ok('ean · one digit off fails', !E.checksumOk('9783423343825'));
  ok('ean · a book code starts 978/979', E.isBookCode('9783423343824'));
  ok('ean · a grocery code is not a book', !E.isBookCode('4006381333931'));
  eq('isbn · ISBN-10 becomes ISBN-13', E.toIsbn13('3-423-34382-6'), '9783423343824');
  eq('isbn · an X check digit is accepted', E.toIsbn13('080442957X'), '9780804429573');
  eq('isbn · hyphens and spaces go', E.toIsbn13(' 978-3-423-34382-4 '), '9783423343824');
  eq('isbn · a number works too', E.toIsbn13(9783423343824), '9783423343824');
  eq('isbn · a bad ISBN-10 is refused', E.toIsbn13('3423343827'), null);
  eq('isbn · a bad ISBN-13 is refused', E.toIsbn13('9783423343825'), null);
  eq('isbn · rubbish is refused', E.toIsbn13('hello'), null);
}

// ── decoding pixels ────────────────────────────────────────────────────────
{
  const codes = ['9783423343824', '9780140328721', '9791032305690', '9783257228007'];
  for (const c of codes) eq('decode · clean ' + c, E.decodeImage(drawBarcode(c)), c);
  eq('decode · small (2 px per module)', E.decodeImage(drawBarcode(codes[0], { scale: 2 })), codes[0]);
  eq('decode · blurred', E.decodeImage(drawBarcode(codes[1], { blur: 1.2 })), codes[1]);
  eq('decode · noisy', E.decodeImage(drawBarcode(codes[2], { noise: 25 })), codes[2]);
  eq('decode · a shadow across it', E.decodeImage(drawBarcode(codes[3], { shade: 0.6 })), codes[3]);
  eq('decode · tilted 3°', E.decodeImage(drawBarcode(codes[0], { tilt: 3 })), codes[0]);
  eq('decode · upside down', E.decodeImage(rotate90(rotate90(drawBarcode(codes[1])))), codes[1]);
  eq('decode · sideways needs columns', E.decodeImage(rotate90(drawBarcode(codes[2])), { columns: true }), codes[2]);
  eq('decode · a blank image is nothing', E.decodeImage(new ImageData(300, 100)), null);
  const flat = new ImageData(300, 100); flat.data.fill(255);
  eq('decode · a white image is nothing', E.decodeImage(flat), null);
}

} catch (e) { fail++; out.push('FAIL  threw: ' + (e && e.stack || e)); }
for (const e of window.__err) { fail++; out.push('FAIL  page error: ' + e); }
out.push('', fail ? fail + ' FAILED, ' + pass + ' passed' : 'ALL GREEN (' + pass + ')');
document.getElementById('out').textContent = out.join('\n');
})();
</script>
</body></html>
```

Later tasks add blocks before the `} catch` line of this page.

- [ ] **Step 2: Register lib and page**

Append to `test/entry.js`:

```js
window.ean13Lib = require('../src/lib/ean13.js');
```

In `test/run.sh`, add `bookcapture` to the end of the `for page in …` list.

Create `src/lib/ean13.js` with only `module.exports = {};` so the bundle builds.

- [ ] **Step 3: Run to verify it fails**

Run: `./test/run.sh 2>&1 | sed -n '/── bookcapture ──/,$p'`
Expected: `FAIL  threw: TypeError: E.checksumOk is not a function`

- [ ] **Step 4: Implement `src/lib/ean13.js`**

```js
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

/* Dark/light runs of one row. The threshold is a local mean, so a shadow
   across the cover does not swallow half the bars; a band around it keeps
   sensor noise on white paper from flickering into fake bars. */
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
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + px[i];
  const runs = [];
  let dark = false;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - win), b = Math.min(n, i + win);
    const mean = (pre[b] - pre[a]) / (b - a);
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
```

- [ ] **Step 5: Run to verify it passes**

Run: `./test/run.sh 2>&1 | sed -n '/── bookcapture ──/,$p'`
Expected: `ALL GREEN (24)` and the script exits 0 (`echo $?` → `0`).
If a decode case fails, print `E.runsOf(row)` for the middle row and tune `band`/`win`/`err` thresholds — do not loosen the checksum.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ean13.js test/bookcapture.html test/entry.js test/run.sh
git commit -m "Book capture: EAN-13 decoder and ISBN helpers"
```

---

### Task 2: Template engine

**Files:**
- Create: `src/lib/booktemplate.js`
- Modify: `test/bookcapture.html`, `test/entry.js`

**Interfaces:**
- Produces:
  - `FIELDS: string[]`
  - `scan(text): { fields: string[], asks: {label, options: string[]}[], unknown: string[], usesCover: boolean }`
  - `render(text, data, answers = {}): string` — `data` keys = FIELDS; `authors`/`genres` arrays
  - `renderName(pattern, data): string` (no sanitising — see Task 4)
  - `frontmatterEntries(text): {key, value: string|string[]}[]`
  - `splitFrontmatter(text): { fm: string|null, body: string }`
  - `bookData(record, extra: { isbn, cover, date }): object` — record shape from Task 3

- [ ] **Step 1: Add failing tests**

Add `window.bookTemplateLib = require('../src/lib/booktemplate.js');` to `test/entry.js`, create `src/lib/booktemplate.js` as `module.exports = {};`, and add this block to `test/bookcapture.html` before `} catch`:

```js
// ── template engine ───────────────────────────────────────────────────────
{
  const T = window.bookTemplateLib;
  const data = {
    isbn: '9783423343824', title: 'Persönlichkeit: und Menschenführung', subtitle: '',
    author: 'Wolfgang Schmidbauer, Anna "Ann" Muster', authors: ['Wolfgang Schmidbauer', 'Anna "Ann" Muster'],
    publisher: 'dtv', year: '2007', pages: '220', language: 'ger', description: 'Line one\nline two',
    genres: ['Psychologie', 'Führung'], cover: 'atm-Persönlichkeit.jpg', date: '2026-10-07',
  };
  const tpl = [
    '---',
    'tags:',
    '  - books',
    '  - {{genres}}',
    'book_author: {{author}}',
    'book_title: {{title}}',
    'book_sub: {{subtitle}}',
    'book_cover: "[[{{cover}}]]"',
    'book_type:',
    '  - {{ask:Type|physical,digital}}',
    'book_where: {{ask:Shelf}}',
    'book_rating:',
    '  - -----',
    'custom: {{nonsense}}',
    '---',
    '',
    '# {{title}}',
    '![[{{cover}}|200]]',
    'By {{authors}} · {{ask:Type|physical,digital}}',
    '{{description}}',
  ].join('\n');

  const s = T.scan(tpl);
  ok('tpl · scan finds the cover', s.usesCover);
  eq('tpl · scan lists each ask once', s.asks, [{ label: 'Type', options: ['physical', 'digital'] }, { label: 'Shelf', options: [] }]);
  eq('tpl · scan flags unknown placeholders', s.unknown, ['{{nonsense}}']);
  ok('tpl · a template without cover says so', !T.scan('# {{title}}').usesCover);

  const r = T.render(tpl, data, { Type: 'physical', Shelf: 'Living room' });
  const lines = r.split('\n');
  ok('tpl · a list placeholder becomes one item per value',
     r.includes('  - books\n  - Psychologie\n  - Führung\nbook_author'), r);
  eq('tpl · a scalar with a colon is quoted', lines.find(l => l.startsWith('book_title:')), 'book_title: "Persönlichkeit: und Menschenführung"');
  eq('tpl · quotes inside a value are escaped', lines.find(l => l.startsWith('book_author:')), 'book_author: "Wolfgang Schmidbauer, Anna \\"Ann\\" Muster"');
  eq('tpl · an empty scalar stays an empty key', lines.find(l => l.startsWith('book_sub')), 'book_sub:');
  eq('tpl · a placeholder inside quotes', lines.find(l => l.startsWith('book_cover:')), 'book_cover: "[[atm-Persönlichkeit.jpg]]"');
  ok('tpl · an ask answer lands in a list', r.includes('book_type:\n  - physical\n'));
  eq('tpl · a free-text ask', lines.find(l => l.startsWith('book_where:')), 'book_where: Living room');
  ok('tpl · literal list items are kept', r.includes('book_rating:\n  - -----'));
  eq('tpl · unknown placeholders stay as written', lines.find(l => l.startsWith('custom:')), 'custom: {{nonsense}}');
  ok('tpl · body: lists join with a comma', r.includes('By Wolfgang Schmidbauer, Anna "Ann" Muster · physical'));
  ok('tpl · body: a multi-line value stays multi-line', r.includes('Line one\nline two'));
  ok('tpl · body: cover embed', r.includes('![[atm-Persönlichkeit.jpg|200]]'));

  const noGenres = T.render(tpl, Object.assign({}, data, { genres: [] }), { Type: '', Shelf: '' });
  ok('tpl · an empty list placeholder drops its line', noGenres.includes('  - books\nbook_author'), noGenres);
  ok('tpl · an unanswered list ask drops its line', noGenres.includes('book_type:\nbook_where:'), noGenres);

  eq('tpl · no frontmatter is plain text', T.render('{{title}} — {{year}}', data), 'Persönlichkeit: und Menschenführung — 2007');
  eq('tpl · a name pattern', T.renderName('atm-{{title}}', data), 'atm-Persönlichkeit: und Menschenführung');

  const entries = T.frontmatterEntries(r);
  eq('tpl · entries: scalar unquoted', entries.find(e => e.key === 'book_title').value, 'Persönlichkeit: und Menschenführung');
  eq('tpl · entries: list', entries.find(e => e.key === 'tags').value, ['books', 'Psychologie', 'Führung']);
  eq('tpl · entries: empty', entries.find(e => e.key === 'book_sub').value, '');

  const rec = { title: 'A', subtitle: '', authors: ['X', 'Y'], publisher: '', year: '', pages: '', language: '', description: '', genres: ['g'], covers: [] };
  eq('tpl · bookData joins author and keeps authors',
     T.bookData(rec, { isbn: '1', cover: 'c.jpg', date: 'd' }),
     { isbn: '1', title: 'A', subtitle: '', author: 'X, Y', authors: ['X', 'Y'], publisher: '', year: '', pages: '', language: '', description: '', genres: ['g'], cover: 'c.jpg', date: 'd' });
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `./test/run.sh 2>&1 | sed -n '/── bookcapture ──/,$p'`
Expected: `FAIL  threw: TypeError: T.scan is not a function`

- [ ] **Step 3: Implement `src/lib/booktemplate.js`**

```js
'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · book templates
 *  Any note can be a template. {{field}} is filled from the book, {{ask:…}} is
 *  asked in the dialog. Inside frontmatter the result has to stay valid YAML,
 *  so values are escaped for where they sit, and a list line repeats once per
 *  value — `  - {{genres}}` becomes one tag per genre.
 * ========================================================================== */

const FIELDS = ['isbn', 'title', 'subtitle', 'author', 'authors', 'publisher', 'year',
  'pages', 'language', 'description', 'genres', 'cover', 'date'];
const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;

function parseToken(raw) {
  raw = String(raw).trim();
  if (raw.startsWith('ask:')) {
    const [label, opts] = raw.slice(4).split('|');
    return { kind: 'ask', label: label.trim(),
      options: opts ? opts.split(',').map(s => s.trim()).filter(Boolean) : [] };
  }
  if (FIELDS.includes(raw)) return { kind: 'field', name: raw };
  return { kind: 'unknown' };
}

function scan(text) {
  const fields = new Set(), asks = [], unknown = [], seen = new Set();
  for (const m of String(text || '').matchAll(TOKEN)) {
    const t = parseToken(m[1]);
    if (t.kind === 'field') fields.add(t.name);
    else if (t.kind === 'ask') { if (!seen.has(t.label)) { seen.add(t.label); asks.push({ label: t.label, options: t.options }); } }
    else if (!unknown.includes(m[0])) unknown.push(m[0]);
  }
  return { fields: [...fields], asks, unknown, usesCover: fields.has('cover') };
}

// null = unknown placeholder, left exactly as written.
function valueOf(t, data, answers) {
  if (t.kind === 'ask') return answers[t.label] == null ? '' : answers[t.label];
  if (t.kind === 'field') return data[t.name] == null ? '' : data[t.name];
  return null;
}
const asText = v => Array.isArray(v) ? v.filter(Boolean).join(', ') : String(v);
const oneLine = s => String(s).replace(/\s*\r?\n\s*/g, ' ').trim();

function yamlScalar(s) {
  s = oneLine(s);
  if (s === '') return '';
  const plain = !/[:#{}[\],&*!|>'"%@`]/.test(s) && !/^[-?\s]/.test(s)
    && !/^(true|false|null|yes|no|on|off|~)$/i.test(s);
  return plain ? s : '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(String(text || ''));
  if (!m) return { fm: null, body: String(text || '') };
  return { fm: m[1], body: String(text).slice(m[0].length) };
}

function renderFmLine(line, data, answers) {
  const tokens = [...line.matchAll(TOKEN)];
  if (!tokens.length) return [line];
  const item = /^(\s*-\s+)(.*)$/.exec(line);
  // A list item that is exactly one placeholder: one item per value, none when empty.
  if (item && tokens.length === 1 && item[2].trim() === tokens[0][0]) {
    const v = valueOf(parseToken(tokens[0][1]), data, answers);
    if (v === null) return [line];
    return (Array.isArray(v) ? v : [v]).map(x => oneLine(x)).filter(Boolean)
      .map(x => item[1] + yamlScalar(x));
  }
  // `key: {{x}}` — the whole value is the placeholder, so quote it as needed.
  const kv = /^(\s*[^\s:#-][^:]*:)\s+(.*)$/.exec(line);
  if (kv && tokens.length === 1 && kv[2].trim() === tokens[0][0]) {
    const v = valueOf(parseToken(tokens[0][1]), data, answers);
    if (v === null) return [line];
    const val = yamlScalar(asText(v));
    return [val ? kv[1] + ' ' + val : kv[1]];
  }
  // A placeholder inside a larger value: escape for the quotes around it.
  let out = '', last = 0;
  for (const m of tokens) {
    const v = valueOf(parseToken(m[1]), data, answers);
    let s = m[0];
    if (v !== null) {
      s = oneLine(asText(v));
      const before = line.slice(0, m.index);
      const dq = (before.match(/(^|[^\\])"/g) || []).length % 2 === 1;
      const sq = !dq && (before.match(/'/g) || []).length % 2 === 1;
      if (dq) s = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      else if (sq) s = s.replace(/'/g, "''");
    }
    out += line.slice(last, m.index) + s;
    last = m.index + m[0].length;
  }
  out += line.slice(last);
  if (item && out.slice(item[1].length).trim() === '') return [];
  return [out];
}

function renderPlain(text, data, answers) {
  return String(text).replace(TOKEN, (all, raw) => {
    const v = valueOf(parseToken(raw), data, answers);
    return v === null ? all : asText(v);
  });
}

function render(text, data, answers = {}) {
  const { fm, body } = splitFrontmatter(text);
  if (fm === null) return renderPlain(body, data, answers);
  const lines = fm.split(/\r?\n/).flatMap(l => renderFmLine(l, data, answers));
  return '---\n' + lines.join('\n') + '\n---\n' + renderPlain(body, data, answers);
}

function renderName(pattern, data) {
  return oneLine(renderPlain(pattern, data, {}));
}

function unquote(s) {
  if (/^".*"$/.test(s)) return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

/* Top-level keys of a frontmatter block, enough for templates: scalars and
   `- item` lists. Not a YAML parser, and does not pretend to be one. */
function frontmatterEntries(text) {
  const { fm } = splitFrontmatter(text);
  if (fm === null) return [];
  const out = [];
  let cur = null;
  for (const line of fm.split(/\r?\n/)) {
    const kv = /^([^\s#-][^:]*):\s*(.*)$/.exec(line);
    if (kv) { cur = { key: kv[1].trim(), value: unquote(kv[2].trim()) }; out.push(cur); continue; }
    const it = /^\s*-\s+(.*)$/.exec(line);
    if (it && cur) {
      if (!Array.isArray(cur.value)) cur.value = cur.value === '' ? [] : [cur.value];
      cur.value.push(unquote(it[1].trim()));
    }
  }
  return out;
}

function bookData(record, extra) {
  const r = record || {};
  const authors = (r.authors || []).filter(Boolean);
  return {
    isbn: extra.isbn || '', title: r.title || '', subtitle: r.subtitle || '',
    author: authors.join(', '), authors, publisher: r.publisher || '', year: r.year || '',
    pages: r.pages || '', language: r.language || '', description: r.description || '',
    genres: (r.genres || []).filter(Boolean), cover: extra.cover || '', date: extra.date || '',
  };
}

module.exports = { FIELDS, scan, render, renderName, frontmatterEntries, splitFrontmatter, bookData, yamlScalar };
```

- [ ] **Step 4: Run to verify it passes**

Run: `./test/run.sh 2>&1 | sed -n '/── bookcapture ──/,$p'`
Expected: `ALL GREEN`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/booktemplate.js test/bookcapture.html test/entry.js
git commit -m "Book capture: template engine with YAML-safe placeholders"
```

---

### Task 3: Sources, merge, cover loading

**Files:**
- Create: `src/lib/booksources.js`
- Create: `test/fixtures/book-dnb-9783423343824.xml`, `test/fixtures/book-dnb-empty.xml`, `test/fixtures/book-ol-9780140328721.json`, `test/fixtures/book-google-9783423343824.json`
- Modify: `test/bookcapture.html`, `test/entry.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `SOURCES: {id: 'dnb'|'openlibrary'|'google', label: string, needsKey: boolean}[]`
  - `parseDnb(xml: string, isbn): Record|null`, `parseOpenLibrary(json, isbn): Record|null`, `parseGoogle(json): Record|null`
  - `Record = { title, subtitle, authors: string[], publisher, year, pages, language, description, genres: string[], covers: string[] }` (all scalars are strings)
  - `queryAll(isbn, sources: {id, key?}[], opts?: { request?, timeoutMs? }): Promise<{ records: {id, record}[], status: {id, ok: boolean, found: boolean, error?: string}[] }>`
  - `merge(records: {id, record}[]): Record & { covers: {url, source}[] }`
  - `loadImage(url, opts?: { request?, timeoutMs? }): Promise<{bytes: ArrayBuffer, type, ext}|null>`
  - `loadCovers(covers: {url, source}[], opts?): Promise<{url, source, bytes, type, ext}[]>`
  - `extFor(type): string`

- [ ] **Step 1: Record fixtures**

```bash
mkdir -p test/fixtures
curl -s "https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&query=num%3D9783423343824&recordSchema=MARC21-xml" > test/fixtures/book-dnb-9783423343824.xml
curl -s "https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&query=num%3D9780140328721&recordSchema=MARC21-xml" > test/fixtures/book-dnb-empty.xml
curl -s "https://openlibrary.org/api/books?bibkeys=ISBN:9780140328721&jscmd=data&format=json" > test/fixtures/book-ol-9780140328721.json
grep -c 'numberOfRecords>1' test/fixtures/book-dnb-9783423343824.xml   # expect 1
grep -c 'numberOfRecords>0' test/fixtures/book-dnb-empty.xml           # expect 1
python3 -c "import json;print(json.load(open('test/fixtures/book-ol-9780140328721.json'))['ISBN:9780140328721']['title'])"  # Fantastic Mr. Fox
```

Google refuses anonymous requests (HTTP 429, quota 0), so its fixture is written by hand from the documented `volumes` schema. Create `test/fixtures/book-google-9783423343824.json`:

```json
{
  "kind": "books#volumes",
  "totalItems": 1,
  "items": [{
    "volumeInfo": {
      "title": "Persönlichkeit und Menschenführung",
      "subtitle": "Vom Umgang mit sich selbst und anderen",
      "authors": ["Wolfgang Schmidbauer"],
      "publisher": "Deutscher Taschenbuch Verlag",
      "publishedDate": "2007-03",
      "description": "Ein Klassiker der Führungspsychologie.",
      "pageCount": 220,
      "categories": ["Psychology"],
      "language": "de",
      "imageLinks": {
        "smallThumbnail": "http://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=5&edge=curl&source=gbs_api",
        "thumbnail": "http://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api"
      }
    }
  }]
}
```

When a Google key is available (Task 6), replace this file with a real answer and re-run the tests.

- [ ] **Step 2: Add failing tests**

Add `window.bookSourcesLib = require('../src/lib/booksources.js');` to `test/entry.js`, create the lib as `module.exports = {};`, and add before `} catch`:

```js
// ── sources ───────────────────────────────────────────────────────────────
{
  const S = window.bookSourcesLib;
  const get = async (p) => (await fetch(p)).text();
  const dnbXml = await get('fixtures/book-dnb-9783423343824.xml');
  const dnbEmpty = await get('fixtures/book-dnb-empty.xml');
  const olJson = JSON.parse(await get('fixtures/book-ol-9780140328721.json'));
  const gJson = JSON.parse(await get('fixtures/book-google-9783423343824.json'));

  const d = S.parseDnb(dnbXml, '9783423343824');
  eq('dnb · title', d.title, 'Persönlichkeit und Menschenführung');
  eq('dnb · subtitle', d.subtitle, 'vom Umgang mit sich selbst und anderen');
  eq('dnb · author flipped to first-last', d.authors, ['Wolfgang Schmidbauer']);
  // ISBD punctuation is cut, which also takes an abbreviation's last dot.
  eq('dnb · publisher', d.publisher, 'Dt. Taschenbuch-Verl');
  eq('dnb · year', d.year, '2007');
  eq('dnb · pages', d.pages, '220');
  eq('dnb · language', d.language, 'ger');
  eq('dnb · subjects become genres', d.genres, ['Führungspsychologie']);
  eq('dnb · the MVB cover', d.covers, ['https://portal.dnb.de/opac/mvb/cover?isbn=9783423343824']);
  eq('dnb · no record is null', S.parseDnb(dnbEmpty, '9780140328721'), null);

  const o = S.parseOpenLibrary(olJson, '9780140328721');
  eq('ol · title', o.title, 'Fantastic Mr. Fox');
  eq('ol · authors', o.authors, ['Roald Dahl']);
  eq('ol · year from a long date', o.year, '1988');
  eq('ol · pages', o.pages, '96');
  ok('ol · has a cover', o.covers.length === 1 && /^https:\/\/covers\.openlibrary\.org\//.test(o.covers[0]), o.covers[0]);
  eq('ol · unknown ISBN is null', S.parseOpenLibrary({}, '9783423343824'), null);

  const g = S.parseGoogle(gJson);
  eq('google · year from YYYY-MM', g.year, '2007');
  eq('google · pages as text', g.pages, '220');
  eq('google · cover upgraded to https without the page curl', g.covers,
     ['https://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1&source=gbs_api']);
  eq('google · nothing found is null', S.parseGoogle({ totalItems: 0 }), null);

  // merge: first source in order wins a field, covers come from all
  const m = S.merge([{ id: 'dnb', record: d }, { id: 'google', record: g }]);
  eq('merge · subtitle from the first source', m.subtitle, 'vom Umgang mit sich selbst und anderen');
  eq('merge · description filled by the second', m.description, 'Ein Klassiker der Führungspsychologie.');
  eq('merge · genres from the first that has any', m.genres, ['Führungspsychologie']);
  eq('merge · covers from both, labelled', m.covers.map(c => c.source), ['dnb', 'google']);

  // queryAll with a fake request: one hit, one miss, one timeout, one HTTP error
  const fake = async ({ url }) => {
    if (url.includes('dnb.de')) return { status: 200, text: dnbXml, json: null };
    if (url.includes('openlibrary')) return { status: 200, text: '{}', json: {} };
    if (url.includes('googleapis')) return new Promise(() => {});
    return { status: 500, text: '', json: null };
  };
  const q = await S.queryAll('9783423343824',
    [{ id: 'dnb' }, { id: 'openlibrary' }, { id: 'google', key: 'k' }], { request: fake, timeoutMs: 50 });
  eq('query · only the hit becomes a record', q.records.map(r => r.id), ['dnb']);
  eq('query · status per source', q.status.map(s => [s.id, s.ok, s.found]),
     [['dnb', true, true], ['openlibrary', true, false], ['google', false, false]]);
  eq('query · a timeout is named', q.status[2].error, 'timeout');
  const noKey = await S.queryAll('9783423343824', [{ id: 'google' }], { request: fake, timeoutMs: 50 });
  eq('query · google without a key is skipped, not called', noKey.status[0].error, 'no API key');

  // cover loading: only real images survive
  const jpeg = new Uint8Array(5000).buffer;
  const coverReq = async ({ url }) => {
    if (url === 'ok') return { status: 200, headers: { 'Content-Type': 'image/jpeg; charset=UTF-8' }, arrayBuffer: jpeg };
    if (url === 'html') return { status: 200, headers: { 'content-type': 'text/html' }, arrayBuffer: jpeg };
    if (url === 'tiny') return { status: 200, headers: { 'content-type': 'image/gif' }, arrayBuffer: new ArrayBuffer(43) };
    if (url === 'hang') return new Promise(() => {});
    return { status: 404, headers: {}, arrayBuffer: new ArrayBuffer(0) };
  };
  const covers = await S.loadCovers(['ok', 'html', 'tiny', 'missing', 'hang'].map(u => ({ url: u, source: u })),
    { request: coverReq, timeoutMs: 50 });
  eq('cover · only the real image is kept', covers.map(c => c.url), ['ok']);
  eq('cover · extension from the content type', covers[0].ext, 'jpg');
  eq('cover · png', S.extFor('image/png'), 'png');
  eq('cover · unknown image type falls back to jpg', S.extFor('image/x-foo'), 'jpg');
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `./test/run.sh 2>&1 | sed -n '/── bookcapture ──/,$p'`
Expected: `FAIL  threw: TypeError: S.parseDnb is not a function`

- [ ] **Step 4: Implement `src/lib/booksources.js`**

```js
'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · book sources
 *  Public catalogues, asked in parallel, merged by the user's order: per field
 *  the first source that has it wins, covers are collected from all. None of
 *  them is complete — on 2026-10-07 Open Library did not know a common dtv
 *  paperback and the DNB did not know a Puffin one — which is why there are
 *  several and why the order is the user's.
 * ========================================================================== */

const { requestUrl } = require('obsidian');

const SOURCES = [
  { id: 'dnb', label: 'DNB (Deutsche Nationalbibliothek)', needsKey: false },
  { id: 'openlibrary', label: 'Open Library', needsKey: false },
  // Anonymous requests get HTTP 429 with a quota of 0, so a key is required.
  { id: 'google', label: 'Google Books', needsKey: true },
];

const FIELDS = ['title', 'subtitle', 'publisher', 'year', 'pages', 'language', 'description'];
const empty = () => ({ title: '', subtitle: '', authors: [], publisher: '', year: '',
  pages: '', language: '', description: '', genres: [], covers: [] });
const yearOf = s => (String(s || '').match(/\d{4}/) || [''])[0];
const uniq = a => [...new Set(a.filter(Boolean))];

function parseGoogle(json) {
  const v = json && json.items && json.items[0] && json.items[0].volumeInfo;
  if (!v || !v.title) return null;
  const r = empty();
  r.title = v.title; r.subtitle = v.subtitle || ''; r.authors = v.authors || [];
  r.publisher = v.publisher || ''; r.year = yearOf(v.publishedDate);
  r.pages = v.pageCount ? String(v.pageCount) : ''; r.language = v.language || '';
  r.description = v.description || ''; r.genres = v.categories || [];
  const l = v.imageLinks || {};
  const img = l.extraLarge || l.large || l.medium || l.thumbnail;
  if (img) r.covers.push(img.replace(/^http:/, 'https:').replace(/&edge=curl/, ''));
  return r;
}

function parseOpenLibrary(json, isbn) {
  const b = json && json['ISBN:' + isbn];
  if (!b || !b.title) return null;
  const r = empty();
  r.title = b.title; r.subtitle = b.subtitle || '';
  r.authors = (b.authors || []).map(a => a.name);
  r.publisher = (b.publishers && b.publishers[0] && b.publishers[0].name) || '';
  r.year = yearOf(b.publish_date);
  r.pages = b.number_of_pages ? String(b.number_of_pages) : '';
  r.genres = (b.subjects || []).map(s => s.name).slice(0, 8);
  r.covers.push((b.cover && (b.cover.large || b.cover.medium))
    || 'https://covers.openlibrary.org/b/isbn/' + isbn + '-L.jpg?default=false');
  r.covers = r.covers.map(u => u.replace(/^http:/, 'https:'));
  return r;
}

/* MARC21 from the DNB's SRU interface. 245 title, 100/700 people, 264/260
   imprint, 300 extent, 041 language, 650 subjects. MARC wraps sort-skipped
   articles in control characters, and ends fields with ISBD punctuation. */
function parseDnb(xml, isbn) {
  const doc = new DOMParser().parseFromString(String(xml || ''), 'application/xml');
  const fields = [...doc.getElementsByTagNameNS('*', 'datafield')];
  if (!fields.length) return null;
  const clean = s => String(s || '').replace(/[\u0098\u009c]/g, '').replace(/\s*[/:;,.]\s*$/, '').trim();
  const subs = (tag, code) => fields.filter(f => f.getAttribute('tag') === tag)
    .flatMap(f => [...f.getElementsByTagNameNS('*', 'subfield')])
    .filter(s => s.getAttribute('code') === code).map(s => clean(s.textContent));
  const first = (tag, code) => subs(tag, code)[0] || '';
  const flip = n => n.includes(', ') ? n.split(', ').slice(1).join(', ') + ' ' + n.split(', ')[0] : n;
  const r = empty();
  r.title = first('245', 'a');
  if (!r.title) return null;
  r.subtitle = first('245', 'b');
  const people = fields.filter(f => f.getAttribute('tag') === '100' || f.getAttribute('tag') === '700')
    .filter(f => {
      const roles = [...f.getElementsByTagNameNS('*', 'subfield')]
        .filter(s => s.getAttribute('code') === '4' || s.getAttribute('code') === 'e').map(s => s.textContent);
      return f.getAttribute('tag') === '100' || roles.some(x => /aut|Verfasser/i.test(x));
    })
    .map(f => [...f.getElementsByTagNameNS('*', 'subfield')].find(s => s.getAttribute('code') === 'a'))
    .filter(Boolean).map(s => flip(clean(s.textContent)));
  r.authors = uniq(people);
  r.publisher = first('264', 'b') || first('260', 'b');
  r.year = yearOf(first('264', 'c') || first('260', 'c'));
  const extent = first('300', 'a');   // "220 S." — the S. marks pages
  r.pages = (extent.match(/(\d+)\s*S\b/) || extent.match(/(\d+)/) || [null, ''])[1];
  r.language = first('041', 'a');
  r.genres = uniq(subs('650', 'a')).slice(0, 8);
  r.covers.push('https://portal.dnb.de/opac/mvb/cover?isbn=' + isbn);
  return r;
}

function urlFor(id, isbn, key) {
  if (id === 'dnb') return 'https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&query=num%3D'
    + isbn + '&recordSchema=MARC21-xml';
  if (id === 'openlibrary') return 'https://openlibrary.org/api/books?bibkeys=ISBN:' + isbn + '&jscmd=data&format=json';
  return 'https://www.googleapis.com/books/v1/volumes?q=isbn:' + isbn + '&key=' + encodeURIComponent(key || '');
}

function withTimeout(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); })])
    .finally(() => clearTimeout(t));
}

async function querySource(id, isbn, key, opts) {
  const meta = SOURCES.find(s => s.id === id);
  if (meta && meta.needsKey && !key) throw new Error('no API key');
  const request = opts.request || requestUrl;
  const res = await withTimeout(request({ url: urlFor(id, isbn, key), throw: false }), opts.timeoutMs || 8000);
  if (res.status !== 200) throw new Error('HTTP ' + res.status);
  if (id === 'dnb') return parseDnb(res.text, isbn);
  if (id === 'openlibrary') return parseOpenLibrary(res.json, isbn);
  return parseGoogle(res.json);
}

async function queryAll(isbn, sources, opts = {}) {
  const settled = await Promise.allSettled(sources.map(s => querySource(s.id, isbn, s.key, opts)));
  const records = [], status = [];
  settled.forEach((r, i) => {
    const id = sources[i].id;
    if (r.status === 'fulfilled') {
      status.push({ id, ok: true, found: !!r.value });
      if (r.value) records.push({ id, record: r.value });
    } else status.push({ id, ok: false, found: false, error: r.reason && r.reason.message || String(r.reason) });
  });
  return { records, status };
}

function merge(records) {
  const out = empty();
  for (const { record } of records) {
    for (const f of FIELDS) if (!out[f] && record[f]) out[f] = record[f];
    if (!out.authors.length && record.authors.length) out.authors = record.authors.slice();
    if (!out.genres.length && record.genres.length) out.genres = record.genres.slice();
  }
  const seen = new Set();
  out.covers = [];
  for (const { id, record } of records) for (const url of record.covers)
    if (!seen.has(url)) { seen.add(url); out.covers.push({ url, source: id }); }
  return out;
}

const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
function extFor(type) { return EXT[type] || 'jpg'; }

function headerOf(headers, name) {
  for (const k of Object.keys(headers || {})) if (k.toLowerCase() === name) return headers[k];
  return '';
}

/* An image counts only when it is one: status 200, an image type, and more
   than a placeholder pixel. Everything else is null, never an exception. */
async function loadImage(url, opts = {}) {
  try {
    const request = opts.request || requestUrl;
    const res = await withTimeout(request({ url, throw: false }), opts.timeoutMs || 8000);
    const type = String(headerOf(res.headers, 'content-type')).split(';')[0].trim().toLowerCase();
    const bytes = res.arrayBuffer;
    if (res.status !== 200 || !/^image\//.test(type) || !bytes || bytes.byteLength < 1000) return null;
    return { bytes, type, ext: extFor(type) };
  } catch (e) { return null; }
}

async function loadCovers(covers, opts = {}) {
  const got = await Promise.all(covers.map(c => loadImage(c.url, opts)));
  return covers.map((c, i) => got[i] && Object.assign({ url: c.url, source: c.source }, got[i])).filter(Boolean);
}

module.exports = { SOURCES, parseGoogle, parseOpenLibrary, parseDnb, queryAll, merge, loadImage, loadCovers, extFor };
```

- [ ] **Step 5: Run to verify it passes**

Run: `./test/run.sh 2>&1 | sed -n '/── bookcapture ──/,$p'`
Expected: `ALL GREEN`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/booksources.js test/fixtures test/bookcapture.html test/entry.js
git commit -m "Book capture: DNB, Open Library and Google Books sources"
```

---

### Task 4: Flow helpers (names, duplicates, fill, validation)

**Files:**
- Create: `src/lib/bookcapture.js`
- Modify: `test/bookcapture.html`, `test/entry.js`

**Interfaces:**
- Consumes: `ean13.toIsbn13` (Task 1); `booktemplate.render`, `frontmatterEntries`, `scan` (Task 2).
- Produces:
  - `safeFileName(s, fallback = 'Untitled'): string`
  - `uniquePath(exists: (path) => boolean, folder, base, ext): string` — `ext` without dot
  - `findDuplicates(files: {path}[], frontmatterOf: (file) => object|null, folder, prop, isbn): file[]`
  - `profileForPath(profiles, path): number` (-1 when none)
  - `isEmptyValue(v): boolean`
  - `fillProposals(templateText, data, answers, noteFm): {key, value}[]`
  - `fillAsks(templateText, noteFm): {label, options}[]`
  - `validateProfile(p, ctx: { exists: (path) => boolean, templateText: string|null }): string[]`
  - `canCreate(usesCover: boolean, chosenCover: object|null): boolean`

- [ ] **Step 1: Add failing tests**

Add `window.bookCaptureLib = require('../src/lib/bookcapture.js');` to `test/entry.js`, create the lib as `module.exports = {};`, and add before `} catch`:

```js
// ── flow helpers ──────────────────────────────────────────────────────────
{
  const B = window.bookCaptureLib;
  eq('name · forbidden characters go', B.safeFileName('Persönlichkeit: und/oder? "Ja" #1 [x]'), 'Persönlichkeit und oder Ja 1 x');
  eq('name · a leading dot would hide it', B.safeFileName('...Hidden'), 'Hidden');
  eq('name · empty falls back', B.safeFileName('  /// '), 'Untitled');
  ok('name · long titles are cut', B.safeFileName('a'.repeat(300)).length <= 120);

  const taken = new Set(['Books/A.md', 'Books/A (2).md']);
  eq('path · free name stays', B.uniquePath(p => taken.has(p), 'Books', 'B', 'md'), 'Books/B.md');
  eq('path · never overwrite', B.uniquePath(p => taken.has(p), 'Books', 'A', 'md'), 'Books/A (3).md');
  eq('path · vault root', B.uniquePath(() => false, '', 'A', 'jpg'), 'A.jpg');

  const files = [{ path: 'Lib/Books/A.md' }, { path: 'Lib/Books/B.md' }, { path: 'Elsewhere/C.md' }, { path: 'Lib/Books/D.md' }];
  const fm = { 'Lib/Books/A.md': { isbn: '3-423-34382-6' }, 'Lib/Books/B.md': { isbn: '9780140328721' },
               'Elsewhere/C.md': { isbn: '9783423343824' }, 'Lib/Books/D.md': null };
  eq('dup · ISBN-10 in a note matches the scanned ISBN-13',
     B.findDuplicates(files, f => fm[f.path], 'Lib/Books', 'isbn', '9783423343824').map(f => f.path), ['Lib/Books/A.md']);
  eq('dup · only inside the profile folder',
     B.findDuplicates(files, f => fm[f.path], 'Lib/Books', 'isbn', '9780140328721').map(f => f.path), ['Lib/Books/B.md']);
  eq('dup · no ISBN property, no check', B.findDuplicates(files, f => fm[f.path], 'Lib/Books', '', '9783423343824'), []);
  eq('dup · a list value counts', B.findDuplicates([{ path: 'X/a.md' }], () => ({ isbn: ['9783423343824'] }), 'X', 'isbn', '9783423343824').length, 1);

  const profiles = [{ folder: 'Lib' }, { folder: 'Lib/Audio' }, { folder: 'Other' }];
  eq('profile · the deepest folder wins', B.profileForPath(profiles, 'Lib/Audio/x.md'), 1);
  eq('profile · parent folder', B.profileForPath(profiles, 'Lib/x.md'), 0);
  eq('profile · a prefix is not a folder', B.profileForPath(profiles, 'Library/x.md'), -1);

  ok('empty · undefined, "", [], [""]', [undefined, null, '', [], ['']].every(B.isEmptyValue));
  ok('empty · 0 and "-----" are values', !B.isEmptyValue(0) && !B.isEmptyValue('-----'));

  const tpl = '---\nisbn: {{isbn}}\nauthor: {{author}}\ncover: "[[{{cover}}]]"\ntype:\n  - {{ask:Type|a,b}}\nrating: {{ask:Rating}}\ntags:\n  - books\n---\nBody';
  const data = window.bookTemplateLib.bookData({ title: 'T', authors: ['X'], genres: [] }, { isbn: '978', cover: 'c.jpg', date: '' });
  const note = { author: 'Someone', cover: '', type: ['a'], tags: [] };
  eq('fill · only empty or missing keys, never existing values',
     B.fillProposals(tpl, data, { Rating: '5' }, note),
     [{ key: 'isbn', value: '978' }, { key: 'cover', value: '[[c.jpg]]' }, { key: 'rating', value: '5' }, { key: 'tags', value: ['books'] }]);
  eq('fill · asks only for keys that are empty', B.fillAsks(tpl, note), [{ label: 'Rating', options: [] }]);

  eq('validate · all good', B.validateProfile({ template: 'T.md', folder: 'Lib', coverFolder: 'Img' },
     { exists: () => true, templateText: '{{title}}' }), []);
  eq('validate · names what is wrong', B.validateProfile({ template: '', folder: 'Nope', coverFolder: '' },
     { exists: p => p !== 'Nope', templateText: null }),
     ['No template chosen.', 'Folder "Nope" does not exist.']);
  eq('validate · missing template file', B.validateProfile({ template: 'Gone.md', folder: '', coverFolder: '' },
     { exists: () => false, templateText: null }), ['Template "Gone.md" does not exist.']);
  eq('validate · unknown placeholders', B.validateProfile({ template: 'T.md', folder: '', coverFolder: '' },
     { exists: () => true, templateText: '{{titel}} {{title}}' }), ['Unknown placeholder in the template: {{titel}}']);

  ok('create · blocked while the template needs a cover and none is chosen', !B.canCreate(true, null));
  ok('create · allowed with a cover', B.canCreate(true, { bytes: new ArrayBuffer(1) }));
  ok('create · allowed when the template has no cover', B.canCreate(false, null));
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `./test/run.sh 2>&1 | sed -n '/── bookcapture ──/,$p'`
Expected: `FAIL  threw: TypeError: B.safeFileName is not a function`

- [ ] **Step 3: Implement `src/lib/bookcapture.js`**

```js
'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · book capture flow
 *  The decisions the dialog makes, without the dialog: what a file may be
 *  called, whether the book is already there, which fields a fill may touch.
 * ========================================================================== */

const { toIsbn13 } = require('./ean13.js');
const tpl = require('./booktemplate.js');

function safeFileName(s, fallback = 'Untitled') {
  const out = String(s || '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ')
    .trim().replace(/^\.+/, '').trim().slice(0, 120).trim();
  return out || fallback;
}

function uniquePath(exists, folder, base, ext) {
  const dir = String(folder || '').replace(/\/+$/, '');
  const at = (name) => (dir ? dir + '/' : '') + name + '.' + ext;
  if (!exists(at(base))) return at(base);
  for (let n = 2; ; n++) if (!exists(at(base + ' (' + n + ')'))) return at(base + ' (' + n + ')');
}

function inFolder(path, folder) {
  const dir = String(folder || '').replace(/\/+$/, '');
  return !dir || path.startsWith(dir + '/');
}

function findDuplicates(files, frontmatterOf, folder, prop, isbn) {
  if (!prop) return [];
  const want = toIsbn13(isbn);
  if (!want) return [];
  return files.filter(f => {
    if (!inFolder(f.path, folder)) return false;
    const fm = frontmatterOf(f);
    if (!fm || fm[prop] == null) return false;
    return [].concat(fm[prop]).some(v => toIsbn13(v) === want);
  });
}

function profileForPath(profiles, path) {
  let best = -1, depth = -1;
  (profiles || []).forEach((p, i) => {
    const dir = String(p.folder || '').replace(/\/+$/, '');
    if (dir && path.startsWith(dir + '/') && dir.length > depth) { best = i; depth = dir.length; }
  });
  return best;
}

function isEmptyValue(v) {
  if (v == null || v === '') return true;
  if (Array.isArray(v)) return v.every(isEmptyValue);
  return false;
}

/* What a fill may write: template keys the note lacks or has empty, with the
   value the template would have produced. Existing values are never touched. */
function fillProposals(templateText, data, answers, noteFm) {
  const fm = noteFm || {};
  return tpl.frontmatterEntries(tpl.render(templateText, data, answers))
    .filter(e => isEmptyValue(fm[e.key]) && !isEmptyValue(e.value))
    .map(e => ({ key: e.key, value: e.value }));
}

function fillAsks(templateText, noteFm) {
  const fm = noteFm || {};
  const seen = new Set(), out = [];
  for (const e of tpl.frontmatterEntries(templateText)) {
    if (!isEmptyValue(fm[e.key])) continue;
    for (const a of tpl.scan([].concat(e.value).join('\n')).asks)
      if (!seen.has(a.label)) { seen.add(a.label); out.push(a); }
  }
  return out;
}

function validateProfile(p, ctx) {
  const problems = [];
  if (!p.template) problems.push('No template chosen.');
  else if (!ctx.exists(p.template)) problems.push('Template "' + p.template + '" does not exist.');
  for (const [key, label] of [['folder', 'Folder'], ['coverFolder', 'Cover folder']])
    if (p[key] && !ctx.exists(p[key])) problems.push(label + ' "' + p[key] + '" does not exist.');
  if (ctx.templateText != null)
    for (const u of tpl.scan(ctx.templateText).unknown) problems.push('Unknown placeholder in the template: ' + u);
  return problems;
}

function canCreate(usesCover, chosenCover) {
  return !usesCover || !!chosenCover;
}

module.exports = { safeFileName, uniquePath, findDuplicates, profileForPath, isEmptyValue,
  fillProposals, fillAsks, validateProfile, canCreate };
```

- [ ] **Step 4: Run to verify it passes**

Run: `./test/run.sh 2>&1 | sed -n '/── bookcapture ──/,$p'`
Expected: `ALL GREEN`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookcapture.js test/bookcapture.html test/entry.js
git commit -m "Book capture: file names, duplicate check, fill proposals, profile validation"
```

---

### Task 5: Camera and photo scanning

**Files:**
- Create: `src/lib/bookscan.js`
- Modify: `test/bookcapture.html`, `test/entry.js`

**Interfaces:**
- Consumes: `ean13.decodeImage`, `ean13.isBookCode`.
- Produces:
  - `cameraAvailable(): boolean`, `nativeDetectorAvailable(): boolean`
  - `class BookScanner { constructor(video: HTMLVideoElement, onCode: (code) => void); start(): Promise<void> /* throws on denied camera */; stop(): void }`
  - `decodeFile(blob: Blob): Promise<string|null>`

- [ ] **Step 1: Add failing tests** (photo path; the live camera is checked on a device in Task 8)

Add `window.bookScanLib = require('../src/lib/bookscan.js');` to `test/entry.js`, create the lib as `module.exports = {};`, and add before `} catch`:

```js
// ── photo decoding ────────────────────────────────────────────────────────
{
  const SC = window.bookScanLib;
  const toBlob = (img) => {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(img, 0, 0);
    return new Promise(r => c.toBlob(r, 'image/png'));
  };
  eq('photo · decodes an upright photo', await SC.decodeFile(await toBlob(testTools.drawBarcode('9783423343824', { noise: 20 }))), '9783423343824');
  eq('photo · decodes a sideways photo', await SC.decodeFile(await toBlob(testTools.rotate90(testTools.drawBarcode('9780140328721')))), '9780140328721');
  eq('photo · nothing in it', await SC.decodeFile(await toBlob(new ImageData(200, 200))), null);
  eq('photo · not an image', await SC.decodeFile(new Blob(['hello'], { type: 'text/plain' })), null);
  ok('device · the checks answer booleans', typeof SC.cameraAvailable() === 'boolean' && typeof SC.nativeDetectorAvailable() === 'boolean');
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `./test/run.sh 2>&1 | sed -n '/── bookcapture ──/,$p'`
Expected: `FAIL  threw: TypeError: SC.decodeFile is not a function`

- [ ] **Step 3: Implement `src/lib/bookscan.js`**

```js
'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · barcode scanning
 *  The camera feeds frames to the browser's BarcodeDetector where it exists and
 *  to our own EAN-13 decoder everywhere else. Our decoder must agree with
 *  itself on two frames before a code counts, because a single misread that
 *  happens to pass the checksum would file the wrong book.
 * ========================================================================== */

const ean13 = require('./ean13.js');

const FRAME_MS = 120;   // ~8 frames a second is plenty and spares a tablet's battery

function cameraAvailable() {
  return !!(typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}
function nativeDetectorAvailable() {
  return typeof window !== 'undefined' && typeof window.BarcodeDetector === 'function';
}

async function makeDetector() {
  if (!nativeDetectorAvailable()) return null;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    return formats.includes('ean_13') ? new window.BarcodeDetector({ formats: ['ean_13'] }) : null;
  } catch (e) { return null; }
}

class BookScanner {
  constructor(video, onCode) {
    this.video = video;
    this.onCode = onCode;
    this.canvas = document.createElement('canvas');
    this.hits = {};
    this.stopped = false;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    if (this.stopped) { this.release(); return; }
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    this.video.srcObject = this.stream;
    await this.video.play();
    this.detector = await makeDetector();
    this.next();
  }

  next() { if (!this.stopped) this.timer = setTimeout(() => this.tick(), FRAME_MS); }

  async tick() {
    if (this.stopped) return;
    let code = null, trusted = false;
    try {
      if (this.detector) {
        const found = await this.detector.detect(this.video);
        const hit = found.find(b => ean13.isBookCode(b.rawValue));
        if (hit) { code = hit.rawValue; trusted = true; }
      }
      if (!code) code = this.decodeFrame();
    } catch (e) { /* a frame that cannot be read is just skipped */ }
    if (code && ean13.isBookCode(code)) {
      this.hits[code] = (this.hits[code] || 0) + 1;
      if (trusted || this.hits[code] >= 2) { this.stop(); this.onCode(code); return; }
    }
    this.next();
  }

  decodeFrame() {
    const v = this.video;
    if (!v.videoWidth) return null;
    const w = Math.min(960, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth);
    this.canvas.width = w; this.canvas.height = h;
    const g = this.canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(v, 0, 0, w, h);
    // The guide line sits in the middle; the rows around it are enough.
    return ean13.decodeImage(g.getImageData(0, 0, w, h), { rows: [0.4, 0.45, 0.5, 0.55, 0.6] });
  }

  release() {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.release();
  }
}

/* A photo from the gallery or the camera app: every row and column, because
   nobody holds the phone straight for a photo. */
async function decodeFile(blob) {
  let bmp;
  try { bmp = await createImageBitmap(blob); } catch (e) { return null; }
  const detector = await makeDetector();
  if (detector) {
    try {
      const hit = (await detector.detect(bmp)).find(b => ean13.isBookCode(b.rawValue));
      if (hit) return hit.rawValue;
    } catch (e) { /* fall through to our own decoder */ }
  }
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return ean13.decodeImage(g.getImageData(0, 0, c.width, c.height), { columns: true });
}

module.exports = { cameraAvailable, nativeDetectorAvailable, BookScanner, decodeFile };
```

- [ ] **Step 4: Run to verify it passes**

Run: `./test/run.sh 2>&1 | sed -n '/── bookcapture ──/,$p'`
Expected: `ALL GREEN`, exit 0. (Headless Chromium on Linux has no `BarcodeDetector`, so this exercises our decoder.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookscan.js test/bookcapture.html test/entry.js
git commit -m "Book capture: camera loop and photo decoding"
```

---

### Task 6: Settings

**Files:**
- Modify: `src/constants.js` (DEFAULT_SETTINGS next to `quicknote`, NX_MODULES next to `quicknote`)
- Modify: `src/settings.js` (Capture group at line ~73, new method after `tQuickNote`)
- Modify: `test/bookcapture.html`

**Interfaces:**
- Consumes: `bookcapture.validateProfile`, `booksources.SOURCES`, `bookscan.cameraAvailable/nativeDetectorAvailable`.
- Produces: `settings.bookCapture = { enabled, lastProfile: number, profiles: Profile[], sources: {id, on}[] }`, `Profile = { name, template, folder, coverFolder, fileName, coverName, isbnProperty, coverProperty }`; credential id `'googlebooks'` with `{ secret }`; `plugin.writeExampleBookTemplate(path): Promise<string>` (implemented in Task 7, called here).

- [ ] **Step 1: Failing test for the defaults**

Add before `} catch`:

```js
// ── settings defaults ─────────────────────────────────────────────────────
{
  const d = window.DEFAULT_SETTINGS.bookCapture;
  ok('settings · off by default', d && d.enabled === false);
  eq('settings · one empty profile, nothing of anyone\'s library in it', d.profiles,
     [{ name: 'Books', template: '', folder: '', coverFolder: '', fileName: '{{title}}', coverName: '{{title}}',
        isbnProperty: 'isbn', coverProperty: 'cover' }]);
  eq('settings · every source, in the default order', d.sources.map(s => s.id), window.bookSourcesLib.SOURCES.map(s => s.id));
}
```

Run: `./test/run.sh 2>&1 | sed -n '/── bookcapture ──/,$p'` → Expected: `FAIL  threw: TypeError: Cannot read properties of undefined (reading 'enabled')` or `FAIL settings · off by default`.

- [ ] **Step 2: Defaults and module name**

In `src/constants.js`, after the `quicknote: { … openAfter: true },` entry of `DEFAULT_SETTINGS`:

```js
  /* Book capture: a book note from its ISBN. Profiles, not one setup — a
     library can have paper, ebooks and audiobooks in different folders with
     different templates. Empty on purpose: the template and folders are the
     user's, and the command refuses until they are chosen. */
  bookCapture: { enabled: false, lastProfile: 0,
    profiles: [{ name: 'Books', template: '', folder: '', coverFolder: '', fileName: '{{title}}',
      coverName: '{{title}}', isbnProperty: 'isbn', coverProperty: 'cover' }],
    sources: [{ id: 'dnb', on: true }, { id: 'openlibrary', on: true }, { id: 'google', on: true }] },
```

In `NX_MODULES`, after `quicknote`:

```js
  bookCapture:   { name: 'Book capture', sub: 'A book note from its ISBN — scan the barcode, the cover comes with it' },
```

- [ ] **Step 3: Settings tab**

In `src/settings.js`, Capture group, after the `quicknote` tab:

```js
        { id: 'bookCapture',   icon: 'book-open',        fn: (e) => this.tBookCapture(e) },
```

Add at the top with the other requires:

```js
const bookCaptureLib = require('./lib/bookcapture.js');
const bookSources = require('./lib/booksources.js');
const bookScan = require('./lib/bookscan.js');
```

Add the method after `tQuickNote`:

```js
  tBookCapture(e) {
    const s = this.plugin.settings.bookCapture;
    this.head(e, s);
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Command "Capture book" scans an ISBN barcode (or takes one typed), looks the book up and writes a note from your template, with the cover saved into the vault. "Fill book from ISBN" fills only the empty fields of the open note.' });

    // What this device can do, before anyone tries.
    e.createEl('p', { cls: 'setting-item-description nx-bc-device',
      text: 'This device: camera ' + (bookScan.cameraAvailable() ? 'available' : 'not available — type the ISBN or pick a photo')
        + ' · native barcode reader ' + (bookScan.nativeDetectorAvailable() ? 'yes' : 'no (the built-in decoder is used)') + '.' });

    const app = this.plugin.app;
    const exists = (p) => !!app.vault.getAbstractFileByPath(p.replace(/\/+$/, ''));

    e.createEl('h3', { text: 'Profiles' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Placeholders: ' + require('./lib/booktemplate.js').FIELDS.map(f => '{{' + f + '}}').join(' ')
        + ' — plus {{ask:Label|a,b,c}} for a choice and {{ask:Label}} for free text, asked when the note is made.' });

    s.profiles.forEach((p, i) => {
      const box = e.createDiv('nx-bc-profile');
      const text = (name, desc, key, placeholder) => new Setting(box).setName(name).setDesc(desc)
        .addText(t => t.setPlaceholder(placeholder || '').setValue(p[key] || '')
          .onChange(async v => { p[key] = v.trim(); await this.save(); }));
      text('Name', 'Shown when you pick a profile.', 'name', 'Books');
      text('Template', 'Path of the note used as the template.', 'template', 'Templates/Book.md');
      text('Folder', 'Where new notes go.', 'folder', 'Library/Books');
      text('Cover folder', 'Where cover images go.', 'coverFolder', 'Library/Books/covers');
      text('Note name', 'Pattern for the file name.', 'fileName', '{{title}}');
      text('Cover name', 'Pattern for the cover file name.', 'coverName', '{{title}}');
      text('ISBN property', 'Frontmatter key holding the ISBN — used to find a book you already have. Empty turns the check off.', 'isbnProperty', 'isbn');
      text('Cover property', 'Frontmatter key holding the cover link — used when filling an existing note.', 'coverProperty', 'cover');

      const row = new Setting(box).setName('Check');
      app.vault.adapter.read(p.template).catch(() => null).then(tplText => {
        const problems = bookCaptureLib.validateProfile(p, { exists, templateText: p.template ? tplText : null });
        row.setDesc(problems.length ? problems.join(' ') : 'Ready.');
        row.settingEl.toggleClass('is-warning', problems.length > 0);
      });
      row.addButton(b => b.setButtonText('Create example template').onClick(async () => {
        const path = await this.plugin.writeExampleBookTemplate(p.template || 'Templates/Book capture.md');
        p.template = path; await this.save(); this.display();
      }));
      if (s.profiles.length > 1) row.addButton(b => b.setButtonText('Remove').setWarning().onClick(async () => {
        s.profiles.splice(i, 1); s.lastProfile = 0; await this.save(); this.display();
      }));
    });
    new Setting(e).addButton(b => b.setButtonText('Add profile').onClick(async () => {
      s.profiles.push(Object.assign({}, s.profiles[0], { name: 'New profile', template: '', folder: '', coverFolder: '' }));
      await this.save(); this.display();
    }));

    e.createEl('h3', { text: 'Sources' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Asked together; for each field the first source in this order that has it wins. Covers are collected from all.' });
    s.sources.forEach((src, i) => {
      const meta = bookSources.SOURCES.find(x => x.id === src.id) || { label: src.id };
      new Setting(e).setName(meta.label)
        .addExtraButton(b => b.setIcon('arrow-up').setTooltip('Earlier').setDisabled(i === 0).onClick(async () => {
          s.sources.splice(i - 1, 0, s.sources.splice(i, 1)[0]); await this.save(); this.display(); }))
        .addExtraButton(b => b.setIcon('arrow-down').setTooltip('Later').setDisabled(i === s.sources.length - 1).onClick(async () => {
          s.sources.splice(i + 1, 0, s.sources.splice(i, 1)[0]); await this.save(); this.display(); }))
        .addToggle(t => t.setValue(src.on !== false).onChange(async v => { src.on = v; await this.save(); }));
    });
    const cred = this.plugin.getCredential('googlebooks');
    new Setting(e).setName('Google Books API key').setClass('nx-set-sub')
      .setDesc('Google refuses requests without a key. Stored on this device only. Without one, Google Books is skipped.')
      .addText(t => { t.inputEl.type = 'password'; t.setValue(cred.secret || '')
        .onChange(v => this.plugin.setCredential('googlebooks', { secret: v.trim() })); });
  }
```

- [ ] **Step 4: Run tests and build**

Run: `./test/run.sh; echo exit=$?` → Expected: every page `ALL GREEN`, `exit=0`.
Run: `npm run build` → Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/constants.js src/settings.js test/bookcapture.html
git commit -m "Book capture: settings with profiles, sources and device status"
```

---

### Task 7: The dialog, commands and ribbon

**Files:**
- Create: `src/modals/bookcapture.js`
- Create: `src/styles/25-bookcapture.css`
- Modify: `src/styles/index.css` (add `@import "./25-bookcapture.css";` directly BEFORE the `19-touch.css` import — the touch overrides must stay last)
- Modify: `src/main.js` (commands next to `nexus-quicknote` ~line 248; ribbon next to the other `addRibbonIcon` calls ~line 310; methods after `writeQuickNote` ~line 2364)

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: commands `nexus-book-capture` ("Capture book"), `nexus-book-fill` ("Fill book from ISBN"); `plugin.openBookCapture(mode: 'create'|'fill', file?)`, `plugin.writeExampleBookTemplate(path): Promise<string>`.

- [ ] **Step 1: Plugin methods and commands in `src/main.js`**

After the `nexus-quicknote` command:

```js
    this.addCommand({ id: 'nexus-book-capture', name: 'Capture book',
      callback: () => this.openBookCapture('create') });
    this.addCommand({ id: 'nexus-book-fill', name: 'Fill book from ISBN',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) this.openBookCapture('fill', file);
        return true;
      } });
```

Next to the other ribbon icons, inside the same kind of enabled-check those use:

```js
    if (this.settings.bookCapture && this.settings.bookCapture.enabled)
      this.addRibbonIcon('book-open', NX_MODULES.bookCapture.name, () => this.openBookCapture('create'));
```

After `writeQuickNote`:

```js
  openBookCapture(mode, file) {
    const s = this.settings.bookCapture;
    if (!s || !s.enabled) { new Notice('Nexus: Book capture is off — Settings → Book capture.'); return; }
    const { NexusBookCaptureModal } = require('./modals/bookcapture.js');
    new NexusBookCaptureModal(this, mode, file || null).open();
  }

  /* A starting point for someone with no book notes yet. Never overwrites: an
     existing file at the path is simply used. */
  async writeExampleBookTemplate(path) {
    if (this.app.vault.getAbstractFileByPath(path)) return path;
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (folder) await this.ensureFolderPath(folder);
    await this.app.vault.create(path, [
      '---',
      'isbn: {{isbn}}',
      'author: {{author}}',
      'year: {{year}}',
      'pages: {{pages}}',
      'publisher: {{publisher}}',
      'cover: "[[{{cover}}]]"',
      'format: {{ask:Format|paper,ebook,audiobook}}',
      'tags:',
      '  - book',
      '  - {{genres}}',
      'added: {{date}}',
      '---',
      '',
      '![[{{cover}}|200]]',
      '',
      '# {{title}}',
      '{{subtitle}}',
      '',
      '{{description}}',
      '',
      '## Notes',
      '',
    ].join('\n'));
    return path;
  }
```

- [ ] **Step 2: The modal `src/modals/bookcapture.js`**

```js
'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · Book capture
 *  profile → ISBN (camera, photo or typed) → duplicate check → lookup →
 *  preview → note. Every decision lives in lib/bookcapture.js; this file only
 *  shows it. The cover is in memory before "Create" can be pressed, so making
 *  the note cannot fail on the network.
 * ========================================================================== */

const { Modal, Notice, setIcon, moment } = require('obsidian');
const ean13 = require('../lib/ean13.js');
const tpl = require('../lib/booktemplate.js');
const sources = require('../lib/booksources.js');
const flow = require('../lib/bookcapture.js');
const scan = require('../lib/bookscan.js');

const EDITABLE = [['title', 'Title'], ['subtitle', 'Subtitle'], ['author', 'Author'], ['publisher', 'Publisher'],
  ['year', 'Year'], ['pages', 'Pages'], ['language', 'Language'], ['genres', 'Genres'], ['description', 'Description']];

class NexusBookCaptureModal extends Modal {
  constructor(plugin, mode, file) {
    super(plugin.app);
    this.plugin = plugin;
    this.s = plugin.settings.bookCapture;
    this.mode = mode;            // 'create' | 'fill'
    this.file = file;
    this.covers = [];            // loaded images, plus the user's own when chosen
    this.coverIndex = 0;
    this.answers = {};
  }

  onOpen() {
    this.modalEl.addClass('nx-bc-modal');
    if (this.mode === 'fill') {
      const i = flow.profileForPath(this.s.profiles, this.file.path);
      if (i >= 0) return this.useProfile(i);
    }
    if (this.s.profiles.length === 1) return this.useProfile(0);
    this.showProfiles();
  }

  onClose() {
    if (this.scanner) this.scanner.stop();
    for (const c of this.covers) if (c.objectUrl) URL.revokeObjectURL(c.objectUrl);
    this.contentEl.empty();
  }

  view(title) {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: title });
    return contentEl;
  }

  showProfiles() {
    const el = this.view('Capture book — which kind?');
    this.s.profiles.forEach((p, i) => {
      const b = el.createEl('button', { cls: 'nx-bc-profile-btn' + (i === this.s.lastProfile ? ' mod-cta' : ''), text: p.name || 'Profile ' + (i + 1) });
      b.onclick = () => this.useProfile(i);
    });
  }

  async useProfile(i) {
    this.profile = this.s.profiles[i];
    this.s.lastProfile = i;
    await this.plugin.saveSettings();
    const tf = this.app.vault.getAbstractFileByPath(this.profile.template || '');
    if (!tf) { new Notice('Nexus: the template "' + (this.profile.template || '') + '" does not exist — Settings → Book capture.'); this.close(); return; }
    this.templateText = await this.app.vault.read(tf);
    this.templateInfo = tpl.scan(this.templateText);
    if (this.mode === 'fill') {
      this.noteFm = (this.app.metadataCache.getFileCache(this.file) || {}).frontmatter || {};
      const known = ean13.toIsbn13([].concat(this.noteFm[this.profile.isbnProperty] || '')[0]);
      if (known) return this.lookup(known);
    }
    this.showScanner();
  }

  showScanner() {
    const el = this.view('Scan the barcode');
    const status = el.createDiv({ cls: 'nx-bc-status' });
    if (scan.cameraAvailable()) {
      const frame = el.createDiv('nx-bc-camera');
      const video = frame.createEl('video');
      frame.createDiv('nx-bc-guide');
      this.scanner = new scan.BookScanner(video, code => this.gotIsbn(code));
      status.setText('Hold the barcode on the line.');
      this.scanner.start().catch(err => {
        frame.remove();
        status.setText('No camera here (' + (err && err.name || 'blocked') + '). Type the ISBN or pick a photo.');
        status.addClass('is-warning');
      });
    } else {
      status.setText('This device gives no camera access. Type the ISBN or pick a photo.');
    }

    const row = el.createDiv('nx-bc-manual');
    const input = row.createEl('input', { type: 'text', attr: { inputmode: 'numeric', placeholder: 'ISBN' } });
    const go = row.createEl('button', { cls: 'mod-cta', text: 'Look up' });
    const submit = () => {
      const isbn = ean13.toIsbn13(input.value);
      if (!isbn) { status.setText('That is not a valid ISBN.'); status.addClass('is-warning'); return; }
      this.gotIsbn(isbn);
    };
    go.onclick = submit;
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') submit(); });

    const photo = row.createEl('button', { text: 'Photo' });
    const picker = row.createEl('input', { type: 'file', attr: { accept: 'image/*', capture: 'environment' } });
    picker.style.display = 'none';
    photo.onclick = () => picker.click();
    picker.onchange = async () => {
      const f = picker.files && picker.files[0];
      if (!f) return;
      status.setText('Reading the photo…');
      const code = await scan.decodeFile(f);
      if (code) this.gotIsbn(code);
      else { status.setText('No barcode found in that photo. Try closer, or type the ISBN.'); status.addClass('is-warning'); }
    };
  }

  gotIsbn(isbn) {
    if (this.scanner) { this.scanner.stop(); this.scanner = null; }
    if (this.mode === 'create') {
      const dups = flow.findDuplicates(this.app.vault.getMarkdownFiles(),
        f => (this.app.metadataCache.getFileCache(f) || {}).frontmatter || null,
        this.profile.folder, this.profile.isbnProperty, isbn);
      if (dups.length) return this.showDuplicate(dups[0], isbn);
    }
    this.lookup(isbn);
  }

  showDuplicate(file, isbn) {
    const el = this.view('Already in your library');
    el.createEl('p', { text: file.basename + ' has this ISBN.' });
    const row = el.createDiv('nx-bc-actions');
    row.createEl('button', { cls: 'mod-cta', text: 'Open it' }).onclick = () => { this.app.workspace.getLeaf(false).openFile(file); this.close(); };
    row.createEl('button', { text: 'Fill its empty fields' }).onclick = () => {
      this.mode = 'fill'; this.file = file;
      this.noteFm = (this.app.metadataCache.getFileCache(file) || {}).frontmatter || {};
      this.lookup(isbn);
    };
    row.createEl('button', { text: 'Create anyway' }).onclick = () => this.lookup(isbn);
  }

  async lookup(isbn) {
    this.isbn = isbn;
    const el = this.view('Looking up ' + isbn + '…');
    const key = (this.plugin.getCredential('googlebooks') || {}).secret || '';
    const enabled = this.s.sources.filter(x => x.on !== false).map(x => ({ id: x.id, key: x.id === 'google' ? key : undefined }));
    const { records, status } = await sources.queryAll(isbn, enabled);
    this.status = status;
    this.record = sources.merge(records);
    const wantCover = this.templateInfo.usesCover && (this.mode === 'create' || this.coverMissing());
    if (wantCover) {
      el.createEl('p', { text: 'Loading covers…' });
      this.covers = await sources.loadCovers(this.record.covers);
      for (const c of this.covers) c.objectUrl = URL.createObjectURL(new Blob([c.bytes], { type: c.type }));
    }
    this.wantCover = wantCover;
    this.coverIndex = 0;   // with no covers, index 0 IS the "own image" slot
    this.showPreview();
  }

  coverMissing() {
    const raw = [].concat(this.noteFm[this.profile.coverProperty] || '')[0];
    if (!raw) return true;
    const link = String(raw).replace(/^!?\[\[|\]\]$/g, '').split('|')[0];
    return !this.app.metadataCache.getFirstLinkpathDest(link, this.file.path);
  }

  chosenCover() { return this.covers[this.coverIndex] || null; }

  showPreview() {
    const el = this.view(this.mode === 'fill' ? 'Fill ' + this.file.basename : 'New book · ' + (this.profile.name || ''));
    const failed = this.status.filter(s => !s.ok).map(s => (sources.SOURCES.find(x => x.id === s.id) || {}).label + ': ' + s.error);
    if (!this.status.some(s => s.found)) el.createDiv({ cls: 'nx-bc-status is-warning', text: 'No source knows this ISBN. Fill in what you know.' });
    if (failed.length) el.createDiv({ cls: 'nx-bc-status', text: 'Unavailable — ' + failed.join(' · ') });

    const grid = el.createDiv('nx-bc-grid');
    if (this.wantCover) this.renderCovers(grid.createDiv('nx-bc-covers'));
    const form = grid.createDiv('nx-bc-form');

    // The fields, editable. The record is what the template reads from.
    this.edit = { title: this.record.title, subtitle: this.record.subtitle, author: this.record.authors.join(', '),
      publisher: this.record.publisher, year: this.record.year, pages: this.record.pages, language: this.record.language,
      genres: this.record.genres.join(', '), description: this.record.description };
    for (const [k, label] of EDITABLE) {
      const row = form.createDiv('nx-bc-field');
      row.createEl('label', { text: label });
      const inp = k === 'description' ? row.createEl('textarea') : row.createEl('input', { type: 'text' });
      inp.value = this.edit[k] || '';
      inp.oninput = () => { this.edit[k] = inp.value; };
    }

    const asks = this.mode === 'fill' ? flow.fillAsks(this.templateText, this.noteFm) : this.templateInfo.asks;
    for (const a of asks) {
      const row = form.createDiv('nx-bc-field');
      row.createEl('label', { text: a.label });
      if (a.options.length) {
        const sel = row.createEl('select');
        for (const o of a.options) sel.createEl('option', { text: o, value: o });
        this.answers[a.label] = this.answers[a.label] || a.options[0];
        sel.value = this.answers[a.label];
        sel.onchange = () => { this.answers[a.label] = sel.value; };
      } else {
        const inp = row.createEl('input', { type: 'text' });
        inp.value = this.answers[a.label] || '';
        inp.oninput = () => { this.answers[a.label] = inp.value; };
      }
    }

    const actions = el.createDiv('nx-bc-actions');
    actions.createEl('button', { text: 'Cancel' }).onclick = () => this.close();
    this.createBtn = actions.createEl('button', { cls: 'mod-cta', text: this.mode === 'fill' ? 'Review fill' : 'Create' });
    this.createBtn.onclick = () => this.mode === 'fill' ? this.showFill() : this.create();
    this.refreshCreate();
  }

  refreshCreate() {
    if (this.createBtn) this.createBtn.disabled = !flow.canCreate(this.wantCover, this.chosenCover());
  }

  renderCovers(box) {
    box.empty();
    const slots = this.covers.length + 1;           // the last slot is always "Own image"
    const own = this.coverIndex >= this.covers.length;
    const stage = box.createDiv('nx-bc-cover-stage');
    if (!own) {
      stage.createEl('img', { attr: { src: this.covers[this.coverIndex].objectUrl } });
      box.createDiv({ cls: 'nx-bc-cover-src', text: (sources.SOURCES.find(s => s.id === this.covers[this.coverIndex].source) || {}).label || '' });
    } else {
      stage.addClass('is-own');
      stage.createDiv({ text: this.covers.length ? 'Own image' : 'No cover found — choose one' });
      const from = (label, fn) => stage.createEl('button', { text: label }).onclick = fn;
      from('From this device', () => this.pickDeviceImage(box));
      from('From the vault', () => this.pickVaultImage(box));
      from('From a URL', () => this.pickUrlImage(box));
    }
    const nav = box.createDiv('nx-bc-cover-nav');
    const prev = nav.createEl('button'); setIcon(prev, 'chevron-left');
    nav.createSpan({ text: (this.coverIndex + 1) + ' / ' + slots });
    const next = nav.createEl('button'); setIcon(next, 'chevron-right');
    prev.disabled = this.coverIndex === 0; next.disabled = this.coverIndex >= slots - 1;
    prev.onclick = () => { this.coverIndex--; this.renderCovers(box); this.refreshCreate(); };
    next.onclick = () => { this.coverIndex++; this.renderCovers(box); this.refreshCreate(); };
  }

  addOwnCover(cover, box) {
    if (!cover.vaultFile) cover.objectUrl = URL.createObjectURL(new Blob([cover.bytes], { type: cover.type }));
    else cover.objectUrl = this.app.vault.getResourcePath(cover.vaultFile);
    this.covers.push(cover);
    this.coverIndex = this.covers.length - 1;
    this.renderCovers(box); this.refreshCreate();
  }

  pickDeviceImage(box) {
    const picker = document.body.createEl('input', { type: 'file', attr: { accept: 'image/*' } });
    picker.style.display = 'none';
    picker.onchange = async () => {
      const f = picker.files && picker.files[0]; picker.remove();
      if (!f) return;
      const type = f.type || 'image/jpeg';
      this.addOwnCover({ source: 'own', bytes: await f.arrayBuffer(), type, ext: sources.extFor(type) }, box);
    };
    picker.click();
  }

  pickVaultImage(box) {
    const images = this.app.vault.getFiles().filter(f => /^(jpe?g|png|webp|gif)$/i.test(f.extension));
    const { NexusImageFilePicker } = require('./bookcapture-picker.js');
    new NexusImageFilePicker(this.app, images, f => this.addOwnCover({ source: 'vault', vaultFile: f }, box)).open();
  }

  pickUrlImage(box) {
    const stage = box.querySelector('.nx-bc-cover-stage');
    const row = stage.createDiv('nx-bc-manual');
    const inp = row.createEl('input', { type: 'url', attr: { placeholder: 'https://…' } });
    const go = row.createEl('button', { text: 'Load' });
    go.onclick = async () => {
      go.disabled = true;
      const img = await sources.loadImage(inp.value.trim());
      go.disabled = false;
      if (!img) { new Notice('Nexus: that URL did not give an image.'); return; }
      this.addOwnCover(Object.assign({ source: 'url' }, img), box);
    };
  }

  dataFor(coverName) {
    const e = this.edit;
    const split = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
    return tpl.bookData({ title: e.title, subtitle: e.subtitle, authors: split(e.author), publisher: e.publisher,
      year: e.year, pages: e.pages, language: e.language, description: e.description, genres: split(e.genres) },
      { isbn: this.isbn, cover: coverName || '', date: moment().format('YYYY-MM-DD') });
  }

  /* Write the chosen cover and return its vault file name. A vault image is
     used where it is; bytes are written once, never over an existing file. */
  async writeCover() {
    const c = this.chosenCover();
    if (!c) return '';
    if (c.vaultFile) return c.vaultFile.name;
    const folder = (this.profile.coverFolder || '').replace(/\/+$/, '');
    if (folder) await this.plugin.ensureFolderPath(folder);
    const base = flow.safeFileName(tpl.renderName(this.profile.coverName || '{{title}}', this.dataFor('')));
    const path = flow.uniquePath(p => !!this.app.vault.getAbstractFileByPath(p), folder, base, c.ext);
    await this.app.vault.createBinary(path, c.bytes);
    return path.slice(path.lastIndexOf('/') + 1);
  }

  async create() {
    this.createBtn.disabled = true;
    try {
      const cover = this.wantCover ? await this.writeCover() : '';
      const data = this.dataFor(cover);
      const folder = (this.profile.folder || '').replace(/\/+$/, '');
      if (folder) await this.plugin.ensureFolderPath(folder);
      const base = flow.safeFileName(tpl.renderName(this.profile.fileName || '{{title}}', data), this.isbn);
      const path = flow.uniquePath(p => !!this.app.vault.getAbstractFileByPath(p), folder, base, 'md');
      const file = await this.app.vault.create(path, tpl.render(this.templateText, data, this.answers));
      await this.app.workspace.getLeaf(false).openFile(file);
      this.close();
    } catch (err) {
      new Notice('Nexus: could not write the note — ' + (err && err.message || err));
      this.createBtn.disabled = false;
    }
  }

  showFill() {
    const coverName = this.wantCover && this.chosenCover() ? (this.chosenCover().vaultFile ? this.chosenCover().vaultFile.name : '\u0000cover') : '';
    // A cover link to a file that is gone counts as empty — that is what fill is for.
    const brokenCover = this.wantCover && this.coverMissing();
    const noteFm = Object.assign({}, this.noteFm);
    if (brokenCover) delete noteFm[this.profile.coverProperty];
    const proposals = flow.fillProposals(this.templateText, this.dataFor(coverName), this.answers, noteFm);
    const el = this.view('Fill ' + this.file.basename);
    if (!proposals.length) { el.createEl('p', { text: 'Nothing to fill — every field the template has is already set.' }); }
    const picked = new Set(proposals.map(p => p.key));
    for (const p of proposals) {
      const row = el.createDiv('nx-bc-fill-row');
      const cb = row.createEl('input', { type: 'checkbox' }); cb.checked = true;
      cb.onchange = () => cb.checked ? picked.add(p.key) : picked.delete(p.key);
      row.createSpan({ cls: 'nx-bc-fill-key', text: p.key });
      row.createSpan({ text: [].concat(p.value).join(', ').replace('\u0000cover', '(the chosen cover)') });
    }
    const actions = el.createDiv('nx-bc-actions');
    actions.createEl('button', { text: 'Back' }).onclick = () => this.showPreview();
    const go = actions.createEl('button', { cls: 'mod-cta', text: 'Fill' });
    go.disabled = !proposals.length;
    go.onclick = async () => {
      go.disabled = true;
      try {
        // The placeholder name stands in for a cover not written yet; only now is it written.
        const needsWrite = proposals.some(p => picked.has(p.key) && [].concat(p.value).some(v => String(v).includes('\u0000cover')));
        const cover = needsWrite ? await this.writeCover() : '';
        await this.app.fileManager.processFrontMatter(this.file, fm => {
          for (const p of proposals) if (picked.has(p.key)
              && (flow.isEmptyValue(fm[p.key]) || (brokenCover && p.key === this.profile.coverProperty)))
            fm[p.key] = Array.isArray(p.value) ? p.value.map(v => String(v).replace('\u0000cover', cover))
              : String(p.value).replace('\u0000cover', cover);
        });
        new Notice('Nexus: filled ' + picked.size + ' field(s).');
        this.close();
      } catch (err) {
        new Notice('Nexus: could not fill the note — ' + (err && err.message || err));
        go.disabled = false;
      }
    };
  }
}

module.exports = { NexusBookCaptureModal };
```

- [ ] **Step 3: Vault image picker `src/modals/bookcapture-picker.js`**

```js
'use strict';

/* Pick an image that is already in the vault, by name. */
const { FuzzySuggestModal } = require('obsidian');

class NexusImageFilePicker extends FuzzySuggestModal {
  constructor(app, files, onPick) {
    super(app);
    this.files = files;
    this.onPick = onPick;
    this.setPlaceholder('Pick an image from the vault');
  }
  getItems() { return this.files; }
  getItemText(f) { return f.path; }
  onChooseItem(f) { this.onPick(f); }
}

module.exports = { NexusImageFilePicker };
```

- [ ] **Step 4: Styles `src/styles/25-bookcapture.css`**

Read `~/.claude/rules/ui.md` and `docs/tokens.md` first; use only existing tokens (`--nx-*` / Obsidian variables), no raw colours.

```css
/* Book capture dialog — camera, cover carousel, fields. */
.nx-bc-modal { width: min(760px, 96vw); }
.nx-bc-status { color: var(--text-muted); font-size: var(--font-ui-small); margin-bottom: 8px; }
.nx-bc-status.is-warning, .setting-item.is-warning .setting-item-description { color: var(--text-warning); }
.nx-bc-camera { position: relative; border-radius: var(--radius-m); overflow: hidden; background: var(--background-secondary); }
.nx-bc-camera video { display: block; width: 100%; max-height: 50vh; object-fit: cover; }
.nx-bc-guide { position: absolute; left: 8%; right: 8%; top: 50%; height: 2px; background: var(--interactive-accent); box-shadow: 0 0 0 1px var(--background-primary); }
.nx-bc-manual { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.nx-bc-manual input { flex: 1 1 160px; min-width: 0; }
.nx-bc-grid { display: grid; grid-template-columns: 200px 1fr; gap: 16px; }
.nx-bc-covers { display: flex; flex-direction: column; gap: 6px; }
.nx-bc-cover-stage { aspect-ratio: 2 / 3; display: flex; align-items: center; justify-content: center; border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s); overflow: hidden; }
.nx-bc-cover-stage img { width: 100%; height: 100%; object-fit: contain; }
.nx-bc-cover-stage.is-own { flex-direction: column; gap: 6px; padding: 10px; text-align: center; }
.nx-bc-cover-src { color: var(--text-faint); font-size: var(--font-ui-smaller); text-align: center; }
.nx-bc-cover-nav { display: flex; align-items: center; justify-content: space-between; }
.nx-bc-form { display: flex; flex-direction: column; gap: 6px; }
.nx-bc-field { display: grid; grid-template-columns: 110px 1fr; gap: 8px; align-items: center; }
.nx-bc-field textarea { min-height: 70px; resize: vertical; }
.nx-bc-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
.nx-bc-fill-row { display: flex; gap: 8px; align-items: baseline; padding: 4px 0; }
.nx-bc-fill-key { font-family: var(--font-monospace); color: var(--text-muted); min-width: 120px; }
.nx-bc-profile-btn { display: block; width: 100%; margin-bottom: 6px; }
@media (max-width: 600px) {
  .nx-bc-grid { grid-template-columns: 1fr; }
  .nx-bc-covers { max-width: 220px; margin: 0 auto; }
  .nx-bc-field { grid-template-columns: 1fr; gap: 2px; }
}
```

Add `@import "./25-bookcapture.css";` to `src/styles/index.css` directly before `@import "./19-touch.css";`.

- [ ] **Step 5: Build and run the suite**

Run: `npm run build && ./test/run.sh; echo exit=$?`
Expected: build without errors, every page `ALL GREEN`, `exit=0`.

- [ ] **Step 6: Desktop run in Obsidian (the dev vault)**

Reload the plugin in the dev vault, enable Book capture, click *Create example template*, set Folder `Books` and Cover folder `Books/covers`, then:
1. Command *Capture book* → type `9783423343824` → preview shows DNB data and the DNB cover → *Create* → note in `Books/` with frontmatter rendered, cover file in `Books/covers/`.
2. Same ISBN again → "Already in your library" appears.
3. Type `9780140328721` → Open Library data and cover.
4. Turn off network (or use ISBN `9791032305690` with all sources off) → preview says no source knows it, carousel sits on Own image, *Create* is disabled until *From the vault* picks an image.
5. Open the note from 1, clear `year:` and delete the cover file (the link stays, now broken), run *Fill book from ISBN* → only `year` and `cover` are offered; after *Fill* both are set and the cover file exists again, nothing else changed (check with `git diff` on the dev vault note or by reading it).
Record each result in `.claude/tasks.md`.

- [ ] **Step 7: Commit**

```bash
git add src/modals/bookcapture.js src/modals/bookcapture-picker.js src/styles/25-bookcapture.css src/styles/index.css src/main.js
git commit -m "Book capture: dialog, commands and ribbon icon"
```

---

### Task 8: Docs, review, device check

**Files:**
- Modify: `README.md` (feature table row after Chatter; a `## Book capture` section after `## Chatter`)
- Create: `~/DEV/Public/nexus-suite/wiki/src/content/docs/writing/book-capture.md`
- Modify: `~/DEV/Public/nexus-suite/wiki/astro.config.mjs` (sidebar entry after `{ label: 'Chatter', slug: 'writing/chatter' }`)
- Modify: `CHANGELOG.md` (Unreleased section)
- Modify: `~/DEV/Public/nexus-suite/project/.claude/tasks.md`

- [ ] **Step 1: README**

Feature table row, after the Chatter row:

```markdown
| **Book capture** | A book note from its ISBN — scan the barcode, the cover comes with it | — |
```

Section after `## Chatter`, in the same style as the neighbouring sections: what the two commands do, that the template is any note with placeholders (list them), profiles, sources and their order, the Google key, the cover rule (Create stays disabled until a cover is chosen), and that fill never overwrites.

- [ ] **Step 2: Wiki page** `writing/book-capture.md` — the same content in full, with a worked example template, the placeholder table (`placeholder | value | example`), and a troubleshooting list: no camera, no source knows the ISBN, Google 429. Add the sidebar entry. Regenerate the settings reference with the wiki's generator (`node scripts/gen-settings.mjs` from `wiki/`), then `npm run build` in `wiki/` → Expected: build succeeds, page count +1.

- [ ] **Step 3: CHANGELOG** — under Unreleased: "Added: Book capture — ISBN scan or entry, DNB/Open Library/Google Books lookup, note from your own template with the cover saved into the vault; fill empty fields of an existing book note."

- [ ] **Step 4: Review**

Dispatch the `reviewer` agent on the uncommitted diff; fix every finding, each with a test in `test/bookcapture.html` where it is logic. Re-run `./test/run.sh; echo exit=$?` → `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md test/bookcapture.html src
git commit -m "Book capture: docs and review fixes"
cd ~/DEV/Public/nexus-suite/wiki && git add -A && git commit -m "Book capture page"
```

- [ ] **Step 6: Device check (user, on tablet and phone)**

Push with `sketch-push`, reload the plugin on the device, then:
1. Settings → Book capture → the "This device" line: camera available? native reader yes/no? (This answers the spec's two open questions.)
2. *Capture book* → camera opens with the guide line → scan a real book → preview.
3. If the camera is refused: *Photo* with a photo of a barcode → preview.
Record the answers in `.claude/tasks.md` and in the memory file for this feature. End the session's answer with `TABLET CHECK`.
