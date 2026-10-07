'use strict';

/* ============================================================================
 *  NEXUS SUITE · settings · capture
 *  Settings pages: Ink capture, Quick Note, Book capture.
 *  Mixed into the settings tab (lib/mixin.js); `this` is the tab.
 * ========================================================================== */

const { Notice, Setting, TFile } = require('obsidian');
const { NexusConfirmModal, NexusNameModal } = require('../modals/misc.js');
const quicknoteLib = require('../lib/quicknote.js');
const bookCaptureLib = require('../lib/bookcapture.js');
const bookSources = require('../lib/booksources.js');
const bookScan = require('../lib/bookscan.js');
const extcommand = require('../lib/extcommand.js');

class CapturePages {

  tInkCapture(e) {
    const s = this.plugin.settings.inkCapture;
    this.head(e, s);
    new Setting(e).setName('Ribbon icon').addToggle(t => t.setValue(s.ribbon)
      .onChange(async v => { s.ribbon = v; await this.save(); new Notice('Nexus: Restart/reload for the ribbon change.'); }));
    new Setting(e).setName('Tag dialog after capture')
      .setDesc('Only for scans taken via the Capture button/command — files that just appear in a source folder never trigger a popup.')
      .addToggle(t => t.setValue(s.tagOnCapture).onChange(async v => { s.tagOnCapture = v; await this.save(); }));

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Sources' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Anything landing in a source folder (via the camera button, or synced/exported in some other way) automatically gets its own capture folder — a sidecar note (as a folder note, requires the folder-notes plugin to open with one click) plus the raw file, flat inside it. Accepts images and PDF.' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Add one source per app you export from — the name is yours to choose and is what the gallery shows as the origin badge. "Paper" is the built-in camera capture and cannot be removed.' });
    this.plugin.inkSources().forEach(src => {
      const isPaper = src.id === 'paper';
      const set = new Setting(e).setName(src.label || src.id).setDesc(isPaper ? 'Built-in camera capture' : 'id: ' + src.id);
      set.addToggle(t => t.setValue(src.enabled !== false)
        .onChange(async v => { src.enabled = v; await this.save(); await this.plugin.ensureInkFolders(); }));
      if (!isPaper) set.addExtraButton(b => b.setIcon('pencil').setTooltip('Rename').onClick(async () => {
        const name = await new NexusNameModal(this.app, 'Source name', src.label || src.id).openAndGet();
        if (name && name.trim()) { src.label = name.trim(); await this.save(); this.display(); }
      }));
      if (!isPaper) set.addExtraButton(b => b.setIcon('trash-2').setTooltip('Remove source').onClick(async () => {
        const ok = await new NexusConfirmModal(this.app, 'Remove source "' + (src.label || src.id) + '"?',
          'Only stops watching "' + (src.folder || '—') + '". Existing captures and their notes stay untouched.',
          'Remove').openAndGet();
        if (!ok) return;
        s.sources = this.plugin.inkSources().filter(x => x !== src);
        await this.save(); this.display();
      }));
      new Setting(e).setName('Folder').setClass('nx-set-sub')
        .addText(t => t.setPlaceholder('Inbox/' + (src.label || src.id)).setValue(src.folder || '')
          .onChange(async v => { src.folder = v.trim() || src.folder; await this.save(); await this.plugin.ensureInkFolders(); }));
    });
    new Setting(e).addButton(b => b.setButtonText('Add source').setCta().onClick(async () => {
      const name = await new NexusNameModal(this.app, 'Name of the app you export from', '').openAndGet();
      const label = (name || '').trim();
      if (!label) return;
      const id = this.plugin.inkSourceId(label);
      this.plugin.inkSources().push({ id, label, folder: 'Inbox/' + label.replace(/[\\/:*?"<>|]/g, '_'), enabled: true });
      await this.save(); await this.plugin.ensureInkFolders(); this.display();
    }));

    e.createEl('div', { cls: 'nx-cardcfg-sec', text: 'Excalidraw' });
    new Setting(e).setName('Show in gallery')
      .setDesc('Surfaces existing Excalidraw drawings (frontmatter excalidraw-plugin: parsed) in the Ink Capture gallery for tagging/findability — no folder needed, no sidecar created.')
      .addToggle(t => t.setValue(s.excalidraw.enabled).onChange(async v => { s.excalidraw.enabled = v; await this.save(); }));

    e.createEl('p', { cls: 'setting-item-description',
      text: 'Command "Capture scan" or the camera ribbon icon opens the gallery / takes a paper photo. Your own sources have no in-app capture (they are separate apps) — export a PDF/image from them into their source folder instead.' });
  }
  tQuickNote(e) {
    const s = this.plugin.settings.quicknote;
    this.head(e, s);
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Command "Chatter (speak a note)" opens a recorder. Say the thing, stop, and it becomes a note — the first few words become the file name, because that is what you will scan for later.' });

    new Setting(e).setName('Folder').setDesc('Where spoken notes are filed.')
      .addText(t => t.setPlaceholder('Inbox/Quicknote').setValue(s.folder || '')
        .onChange(async v => { s.folder = v.trim() || 'Inbox/Quicknote'; await this.save(); }));

    new Setting(e).setName('Recogniser')
      .setDesc(quicknoteLib.ENGINES.map(x => x.label + ' — ' + x.note).join(' · '))
      .addDropdown(dd => {
        quicknoteLib.ENGINES.forEach(x => dd.addOption(x.id, x.label));
        dd.setValue(s.engine || 'local').onChange(async v => { s.engine = v; await this.save(); this.display(); });
      });

    if ((s.engine || 'local') === 'local') {
      new Setting(e).setName('Command').setClass('nx-set-sub')
        .setDesc('Run on the recording. ' + extcommand.PLACEHOLDER_IN + ' is the audio file, ' + extcommand.PLACEHOLDER_OUT + ' is where the text should land — printing it instead also works. Example: whisper-cli -f {in} -otxt -of {out} -l de')
        .addText(t => t.setPlaceholder('whisper-cli -f {in} -otxt -of {out} -l auto').setValue(s.command || '')
          .onChange(async v => { s.command = v; await this.save(); }));
      new Setting(e).setName('Check the command').setClass('nx-set-sub')
        .addButton(b => b.setButtonText('Test').onClick(() => {
          const built = extcommand.buildCommand(s.command || '', '/tmp/clip.webm', '/tmp/clip');
          if (built.error) { new Notice('Nexus: ' + built.error + '.'); return; }
          if (!this.plugin.ocrAvailable()) { new Notice('Nexus: no desktop shell here — use the browser recogniser on this device.'); return; }
          new Notice('Nexus: would run "' + built.command + '" with ' + built.args.length + ' argument(s).');
        }));
    } else {
      const { speechApi } = require('../modals/quicknote.js');
      new Setting(e).setName('Language').setClass('nx-set-sub')
        .setDesc('A BCP-47 tag, e.g. de-DE or en-GB.')
        .addText(t => t.setPlaceholder('en-US').setValue(s.language || 'en-US')
          .onChange(async v => { s.language = v.trim() || 'en-US'; await this.save(); }));
      e.createEl('p', { cls: 'setting-item-description',
        text: speechApi()
          ? 'This device has a browser recogniser. Be aware that most builds send the audio to the browser vendor to transcribe it.'
          : 'This device has NO browser recogniser, so recording will refuse to start. Use the local engine here.' });
    }

    new Setting(e).setName('Open the note afterwards')
      .addToggle(t => t.setValue(s.openAfter !== false).onChange(async v => { s.openAfter = v; await this.save(); }));
  }

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
    const isFile = (p) => app.vault.getAbstractFileByPath(p) instanceof TFile;   // a folder is no template

    e.createEl('h3', { text: 'Profiles' });
    e.createEl('p', { cls: 'setting-item-description',
      text: 'Placeholders: ' + require('../lib/booktemplate.js').FIELDS.map(f => '{{' + f + '}}').join(' ')
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
        const problems = bookCaptureLib.validateProfile(p, { exists, isFile, templateText: p.template ? tplText : null });
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
}

module.exports = CapturePages;
