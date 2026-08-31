'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · QuickNote
 *  A note you speak instead of type. The sister of Quick Sketch: same idea —
 *  catch the thought before it is gone — with the other hand free.
 *
 *  Two ways to get from sound to text, and the difference is worth stating in
 *  the settings rather than hiding:
 *
 *    local    a program you installed (whisper.cpp, vosk) runs on the recorded
 *             file. Nothing leaves the machine. Desktop only, because there is
 *             no shell on a phone to run it in.
 *    browser  the Web Speech API. No install, works on mobile — but on most
 *             builds it sends the audio to the browser vendor's service, which
 *             is the opposite of local, so it is never the default.
 *
 *  Everything in this file is pure: what the note is called, what goes in it,
 *  and how the transcript is tidied.
 * ========================================================================== */

const ENGINES = [
  { id: 'local', label: 'A program on this machine', note: 'Runs the command below on the recording. Nothing is uploaded. Desktop only.' },
  { id: 'browser', label: 'The browser\'s own recogniser', note: 'No install and it works on mobile, but most browsers send the audio to their vendor to do it.' },
];

/* A spoken sentence arrives as one long line with no punctuation and a lot of
   filler. This does the two things that are safe to do without guessing at
   meaning: collapse the whitespace, and split on the pauses the recogniser
   already marked with a newline. */
function cleanTranscript(raw) {
  return String(raw == null ? '' : raw)
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/* The first few words make a better file name than a timestamp, because that is
   what you will be scanning for later. The timestamp stays in the frontmatter,
   where it is precise and does not have to be short. */
function titleFrom(lines, fallback) {
  const first = (lines && lines.length) ? lines[0] : '';
  const words = String(first).split(/\s+/).filter(Boolean).slice(0, 8).join(' ');
  const clean = words.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return clean.slice(0, 60) || fallback || 'Quick Note';
}

function notePath(folder, title, stamp) {
  const dir = String(folder || 'Inbox/Quicknote').replace(/\/+$/, '');
  const safe = String(title).replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Quick Note';
  return dir + '/' + safe + (stamp ? ' ' + stamp : '') + '.md';
}

/* The note itself. The transcript goes in as paragraphs, not as one block: a
   recogniser's line breaks are where the speaker paused, and that is the only
   structure the recording actually has. */
function noteBody(lines, meta) {
  const front = ['---', 'nexus-type: quicknote'];
  if (meta && meta.recorded) front.push('recorded: ' + meta.recorded);
  if (meta && meta.seconds) front.push('seconds: ' + Math.round(meta.seconds));
  if (meta && meta.engine) front.push('engine: ' + meta.engine);
  if (meta && meta.task) front.push('nexus-task: true');
  front.push('---', '');
  return front.join('\n') + (lines || []).join('\n\n') + '\n';
}

module.exports = { ENGINES, cleanTranscript, titleFrom, notePath, noteBody };
