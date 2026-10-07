'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · Quick Note and Book capture
 *  Turning a recording into a note, and opening the book capture dialog.
 *  Mixed into the plugin class (lib/mixin.js).
 * ========================================================================== */

const { Notice, moment } = require('obsidian');
const { ensureFolder } = require('../lib/vaultpaths.js');
const quicknote = require('../lib/quicknote.js');
const extcommand = require('../lib/extcommand.js');

class QuickCapture {
  /* ── QuickNote ─────────────────────────────────────────────────────────────
     The recording goes to a program the user installed; the text comes back and
     becomes a note. Same bargain as the handwriting reader: nothing is uploaded
     and nothing is bundled, at the cost of being desktop only. */
  async transcribeAudio(blob) {
    const cfg = this.settings.quicknote || {};
    if (!this.ocrAvailable()) throw new Error('the local recogniser needs a desktop shell — switch to the browser engine in the settings');
    const built = extcommand.buildCommand(cfg.command || '', '', '');
    if (built.error) throw new Error(built.error);
    const cp = require('child_process');
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-speech-'));
    const inPath = path.join(dir, 'clip.webm');
    const outStem = path.join(dir, 'clip');
    const argv = extcommand.buildCommand(cfg.command || '', inPath, outStem);
    try {
      fs.writeFileSync(inPath, Buffer.from(await blob.arrayBuffer()));
      const stdout = await new Promise((resolve, reject) => {
        cp.execFile(argv.command, argv.args, { timeout: 300000, maxBuffer: 8 * 1024 * 1024 }, (err, out, stderr) => {
          // ENOENT is the common one and "spawn whisper-cli ENOENT" says nothing
          // to anybody: the program in the settings is simply not installed.
          if (err && err.code === 'ENOENT') {
            reject(new Error('“' + argv.command + '” is not installed on this machine — install it, or change the command in Settings → Chatter.'));
          } else if (err) {
            reject(new Error((argv.command + ' failed: ' + (stderr || err.message)).trim()));
          } else resolve(out);
        });
      });
      // Some recognisers write a file, others just print. Both are accepted so
      // the command line is not forced into one shape.
      let raw = '';
      for (const candidate of [outStem + '.txt', outStem]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) { raw = fs.readFileSync(candidate, 'utf8'); break; }
      }
      if (!raw) raw = String(stdout || '');
      return quicknote.cleanTranscript(raw);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    }
  }
  async writeQuickNote(lines, meta) {
    const cfg = this.settings.quicknote || {};
    const folder = (cfg.folder || 'Inbox/Quicknote').replace(/\/+$/, '');
    await this.ensureFolderPath(folder);
    const stamp = moment().format('YYYY-MM-DD HHmm');
    const title = quicknote.titleFrom(lines, 'Chatter');
    let path = quicknote.notePath(folder, title, '');
    if (this.app.vault.getAbstractFileByPath(path)) path = quicknote.notePath(folder, title, stamp);
    const body = quicknote.noteBody(lines, {
      recorded: moment().format('YYYY-MM-DDTHH:mm'),
      seconds: meta && meta.seconds, engine: meta && meta.engine,
    });
    const file = await this.app.vault.create(path, body);
    if (cfg.openAfter !== false) this.app.workspace.getLeaf(false).openFile(file);
    return path;
  }
  openBookCapture(mode, file) {
    const s = this.settings.bookCapture;
    if (!s || !s.enabled) { new Notice('Nexus: Book capture is off — Settings → Book capture.'); return; }
    const { NexusBookCaptureModal } = require('../modals/bookcapture.js');
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
  /* Create a folder and its parents (see lib/vaultpaths.js for why one segment
     at a time). Throws, naming the folder, when it cannot. */
  ensureFolderPath(folder) { return ensureFolder(this.app.vault.adapter, folder); }
}

module.exports = QuickCapture;
