'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · a ZIP writer
 *  Written by hand rather than pulled in, for the same reason the PDF writer
 *  was: the plugin has to stay one bundled file that also runs on a phone, and
 *  a backup archive needs about a hundred lines of the format — the local
 *  header, the central directory, and the record that says where it starts.
 *
 *  Compression uses CompressionStream('deflate-raw'), which is exactly what ZIP
 *  wants. Where a runtime lacks it the entries are STORED instead, which every
 *  unzipper accepts — the archive is bigger, not broken.
 * ========================================================================== */

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/* CRC-32 (IEEE), table built once. Every entry carries one and unzippers check
   it, so a wrong table means archives that look fine and refuse to extract. */
let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  CRC_TABLE = table;
  return table;
}
function crc32(bytes) {
  const table = crcTable();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ZIP stores names as bytes. UTF-8 with the language-encoding flag set is what
   every modern tool reads; without the flag an umlaut in a path comes out as
   mojibake on Windows. */
function utf8(str) { return new TextEncoder().encode(String(str)); }

/* DOS date and time, which is what the format has. Before 1980 does not exist
   in a ZIP, so anything earlier is clamped rather than wrapping to nonsense. */
function dosDateTime(date) {
  const d = date instanceof Date ? date : new Date(date || 0);
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2)),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function writer(size) {
  const bytes = new Uint8Array(size);
  let at = 0;
  return {
    bytes,
    u16(v) { bytes[at++] = v & 0xFF; bytes[at++] = (v >>> 8) & 0xFF; },
    u32(v) { bytes[at++] = v & 0xFF; bytes[at++] = (v >>> 8) & 0xFF; bytes[at++] = (v >>> 16) & 0xFF; bytes[at++] = (v >>> 24) & 0xFF; },
    raw(src) { bytes.set(src, at); at += src.length; },
    get length() { return at; },
  };
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const packed = new Uint8Array(await new Response(stream).arrayBuffer());
    // A file that grows when compressed is stored instead — which is the normal
    // outcome for anything already compressed, like a PNG.
    return packed.length < bytes.length ? packed : null;
  } catch (e) { return null; }
}

/* Build an archive from [{ name, data:Uint8Array, date }]. Everything is held
   in memory: a vault of notes is a few megabytes, and streaming it would mean
   an interface that cannot be handed a plain array. */
async function zipArchive(entries, options) {
  const opts = options || {};
  const prepared = [];
  for (const entry of entries || []) {
    const data = entry.data instanceof Uint8Array ? entry.data : utf8(entry.data == null ? '' : entry.data);
    const packed = opts.store ? null : await deflateRaw(data);
    prepared.push({
      name: utf8(entry.name),
      data, packed,
      crc: crc32(data),
      method: packed ? METHOD_DEFLATE : METHOD_STORE,
      stamp: dosDateTime(entry.date || opts.date || new Date(0)),
    });
  }

  let total = 0;
  for (const e of prepared) {
    total += 30 + e.name.length + (e.packed || e.data).length;   // local header + name + payload
    total += 46 + e.name.length;                                  // central directory record
  }
  total += 22;                                                    // end of central directory

  const out = writer(total);
  const offsets = [];
  for (const e of prepared) {
    offsets.push(out.length);
    const payload = e.packed || e.data;
    out.u32(0x04034b50);        // local file header
    out.u16(20);                // version needed
    out.u16(0x0800);            // flags: names are UTF-8
    out.u16(e.method);
    out.u16(e.stamp.time);
    out.u16(e.stamp.date);
    out.u32(e.crc);
    out.u32(payload.length);
    out.u32(e.data.length);
    out.u16(e.name.length);
    out.u16(0);                 // no extra field
    out.raw(e.name);
    out.raw(payload);
  }

  const centralAt = out.length;
  prepared.forEach((e, i) => {
    const payload = e.packed || e.data;
    out.u32(0x02014b50);        // central directory header
    out.u16(20);                // version made by
    out.u16(20);                // version needed
    out.u16(0x0800);
    out.u16(e.method);
    out.u16(e.stamp.time);
    out.u16(e.stamp.date);
    out.u32(e.crc);
    out.u32(payload.length);
    out.u32(e.data.length);
    out.u16(e.name.length);
    out.u16(0); out.u16(0);     // extra, comment
    out.u16(0);                 // disk number
    out.u16(0);                 // internal attributes
    out.u32(0);                 // external attributes
    out.u32(offsets[i]);
    out.raw(e.name);
  });

  // Measured BEFORE the end record starts, or the size includes part of the
  // record that is supposed to describe it.
  const centralSize = out.length - centralAt;
  out.u32(0x06054b50);          // end of central directory
  out.u16(0); out.u16(0);       // this disk, disk with the directory
  out.u16(prepared.length);
  out.u16(prepared.length);
  out.u32(centralSize);
  out.u32(centralAt);
  out.u16(0);                   // no comment

  return out.bytes.subarray(0, out.length);
}

module.exports = { crc32, utf8, dosDateTime, deflateRaw, zipArchive, METHOD_STORE, METHOD_DEFLATE };
