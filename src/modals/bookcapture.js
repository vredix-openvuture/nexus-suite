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

  /* File name of the cover the note already links to, or '' when there is none. */
  existingCoverName() {
    const raw = [].concat(this.noteFm[this.profile.coverProperty] || '')[0];
    if (!raw) return '';
    const link = String(raw).replace(/^!?\[\[|\]\]$/g, '').split('|')[0];
    const f = this.app.metadataCache.getFirstLinkpathDest(link, this.file.path);
    return f ? f.name : '';
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
    // No cover being written: {{cover}} means the note's own existing cover file.
    const coverName = this.wantCover
      ? (this.chosenCover() ? (this.chosenCover().vaultFile ? this.chosenCover().vaultFile.name : '\u0000cover') : '')
      : this.existingCoverName();
    // A cover link to a file that is gone counts as empty — that is what fill is for.
    const brokenCover = this.wantCover && this.coverMissing();
    const noteFm = Object.assign({}, this.noteFm);
    if (brokenCover) delete noteFm[this.profile.coverProperty];
    // Without a resolvable cover an empty {{cover}} renders "[[]]" — never propose that.
    const proposals = flow.fillProposals(this.templateText, this.dataFor(coverName), this.answers, noteFm)
      .filter(p => ![].concat(p.value).some(v => String(v).includes('[[]]')));
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
