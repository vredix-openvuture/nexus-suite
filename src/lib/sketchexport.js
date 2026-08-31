'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · sketch export
 *  A drawing out of the vault and into a file anyone can open: SVG, PNG, PDF.
 *
 *  SVG is free — the sidecar already IS one. PNG is a canvas away. PDF is the
 *  one that normally drags in a library, so it is written by hand here: a
 *  single-page document with one image on it is about eighty lines, and a
 *  hand-rolled eighty lines beats a dependency that ships a font subsetter for
 *  a feature that draws one rectangle.
 *
 *  The image inside the PDF is LOSSLESS where the platform allows it: raw RGB
 *  samples deflated with CompressionStream and declared /FlateDecode.
 *  Handwriting through a JPEG looks like handwriting through a JPEG, so that is
 *  only the fallback for a runtime without it.
 * ========================================================================== */

const EXPORT_FORMATS = [
  { id: 'svg', label: 'SVG', ext: 'svg', note: 'Vector, and the same file the sketch is already stored as.' },
  { id: 'png', label: 'PNG', ext: 'png', note: 'A picture, at whatever scale you pick.' },
  { id: 'pdf', label: 'PDF', ext: 'pdf', note: 'One page, sized to the drawing.' },
];

/* ── Bytes ────────────────────────────────────────────────────────────────── */
function latin1(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}
function concatBytes(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/* Deflate, when the runtime has it. Returns null rather than throwing so the
   caller can fall back instead of failing the export. */
async function deflate(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (e) { return null; }
}

/* ── PDF ──────────────────────────────────────────────────────────────────── */
/* One page, one image, drawn to fill it. `image` is already encoded; `filter`
   says how ('FlateDecode' for raw deflated samples, 'DCTDecode' for a JPEG). */
function pdfDocument(image, opts) {
  const width = Math.max(1, Math.round(opts.width));
  const height = Math.max(1, Math.round(opts.height));
  const pageW = Math.max(1, Math.round(opts.pageWidth || width));
  const pageH = Math.max(1, Math.round(opts.pageHeight || height));
  const filter = opts.filter === 'DCTDecode' ? 'DCTDecode' : 'FlateDecode';
  const colorSpace = opts.colorSpace || 'DeviceRGB';

  const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q\n`;
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${pageW} ${pageH}]`
      + '/Resources<</XObject<</Im0 4 0 R>>>>/Contents 5 0 R>>',
    null,   // the image, assembled below because it carries a stream
    null,   // the content stream
  ];

  const chunks = [];
  const offsets = [];
  let position = 0;
  const push = (bytes) => { chunks.push(bytes); position += bytes.length; };

  push(latin1('%PDF-1.4\n'));
  // A comment of high bytes tells every tool that this file is binary.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const startObject = (n) => { offsets[n] = position; push(latin1(n + ' 0 obj\n')); };
  const endObject = () => push(latin1('\nendobj\n'));

  for (let n = 1; n <= 3; n++) {
    startObject(n);
    push(latin1(objects[n - 1]));
    endObject();
  }

  startObject(4);
  push(latin1(`<</Type/XObject/Subtype/Image/Width ${width}/Height ${height}`
    + `/ColorSpace/${colorSpace}/BitsPerComponent 8/Filter/${filter}/Length ${image.length}>>\nstream\n`));
  push(image);
  push(latin1('\nendstream'));
  endObject();

  const contentBytes = latin1(content);
  startObject(5);
  push(latin1(`<</Length ${contentBytes.length}>>\nstream\n`));
  push(contentBytes);
  push(latin1('\nendstream'));
  endObject();

  const xrefAt = position;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let n = 1; n <= 5; n++) xref += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
  push(latin1(xref));
  push(latin1(`trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF\n`));

  return concatBytes(chunks);
}

/* Canvas pixels → the raw RGB the PDF wants. The alpha channel is composited
   onto white first: a PDF page has no transparency to fall back on, and ink
   over nothing renders as ink over black in some viewers. */
function rgbaToRgbOnWhite(rgba) {
  const out = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) {
    const a = rgba[i + 3] / 255;
    out[o] = Math.round(rgba[i] * a + 255 * (1 - a));
    out[o + 1] = Math.round(rgba[i + 1] * a + 255 * (1 - a));
    out[o + 2] = Math.round(rgba[i + 2] * a + 255 * (1 - a));
  }
  return out;
}

/* A file name that is a name and not a path: no separators, no leading dot, and
   never empty, because "" silently becomes a hidden file. */
function exportFileName(title, ext, stamp) {
  const base = String(title || '')
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80);
  return (base || 'Sketch') + (stamp ? ' ' + stamp : '') + '.' + ext;
}

module.exports = {
  EXPORT_FORMATS, latin1, concatBytes, deflate,
  pdfDocument, rgbaToRgbOnWhite, exportFileName,
};
