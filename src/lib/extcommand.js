'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · running a local program
 *  Shared by the two features that need something the plugin cannot ship:
 *  reading handwriting, and turning speech into text. Both would otherwise mean
 *  bundling tens of megabytes of model into a plugin that has to stay ONE file
 *  and also run on a phone.
 *
 *  So the plugin runs a binary the user already has. The template names where
 *  the input goes and where the output comes back:
 *
 *      tesseract {in} {out} -l deu
 *      whisper-cli -f {in} -otxt -of {out} -l de
 *
 *  Nothing here knows what either of those programs is, which is the point.
 * ========================================================================== */

const PLACEHOLDER_IN = '{in}';
const PLACEHOLDER_OUT = '{out}';

/* Split a command line the way a shell would for the simple cases, and no
   further: quotes group, whitespace separates. Handing the string to an actual
   shell would turn a vault path with a space in it into an injection point, so
   the argv is built here and passed straight to execFile. */
function tokenizeCommand(line) {
  const out = [];
  let current = '';
  let quote = null;
  let started = false;
  for (const ch of String(line || '')) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
    if (/\s/.test(ch)) {
      if (started) { out.push(current); current = ''; started = false; }
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) out.push(current);
  return out;
}

/* argv for one run, or an error saying exactly which placeholder is missing. */
function buildCommand(template, inPath, outPath) {
  const tokens = tokenizeCommand(template);
  if (!tokens.length) return { error: 'the command is empty' };
  const joined = tokens.join(' ');
  if (joined.indexOf(PLACEHOLDER_IN) < 0) return { error: 'the command has no ' + PLACEHOLDER_IN + ' for the input file' };
  if (joined.indexOf(PLACEHOLDER_OUT) < 0) return { error: 'the command has no ' + PLACEHOLDER_OUT + ' for the result' };
  const argv = tokens.map(t => t.split(PLACEHOLDER_IN).join(inPath).split(PLACEHOLDER_OUT).join(outPath));
  return { command: argv[0], args: argv.slice(1) };
}

module.exports = { PLACEHOLDER_IN, PLACEHOLDER_OUT, tokenizeCommand, buildCommand };
