'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · folder notes
 *  Replaces the folder-notes plugin: a folder can own a note, opened by
 *  clicking the folder itself. Ink Capture already depends on this convention
 *  (its sidecars ARE folder notes), so it belongs in here rather than in a
 *  third-party plugin.
 *
 *  Kept from the original: name template, storage inside/parent, .md/.canvas/
 *  .base, open-on-click with optional modifier, new tab / focus existing tab,
 *  hide the note in the explorer, underline/bold/italic markers, breadcrumb
 *  clicks, auto-create, templates, rename/delete sync with confirmations,
 *  excluded folders, and the folder-overview code block.
 * ========================================================================== */

const { Notice, TFile, TFolder, moment, setIcon } = require('obsidian');

const FN_TYPES = ['md', 'canvas', 'base'];

class NexusFolderNotes {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this._marked = new WeakSet();
  }
  get s() { return this.plugin.settings.folderNotes; }

  /* ---- naming / lookup -------------------------------------------------- */

  /* Template tokens mirror the ones the original plugin understood, so an
     existing vault full of "{{folder_name}}" notes keeps working untouched. */
  noteBaseName(folder) {
    const tpl = String(this.s.noteName || '{{folder_name}}');
    return tpl
      .replace(/\{\{\s*folder_name\s*\}\}/gi, folder.name)
      .replace(/\{\{\s*date\s*\}\}/gi, moment().format('YYYY-MM-DD'))
      .trim() || folder.name;
  }
  /* Where the note for this folder would live. storage 'parent' puts it NEXT
     to the folder instead of inside it (some people prefer that; Obsidian
     treats both the same, only the path differs). */
  notePath(folder, ext) {
    const base = this.noteBaseName(folder);
    const e = ext || this.s.fileType || 'md';
    if ((this.s.storage || 'inside') === 'parent') {
      const p = folder.parent && folder.parent.path && folder.parent.path !== '/' ? folder.parent.path + '/' : '';
      return p + base + '.' + e;
    }
    return folder.path + '/' + base + '.' + e;
  }
  /* The existing note, whatever supported type it happens to be. */
  noteFor(folder) {
    if (!folder || !folder.children) return null;
    for (const ext of this.types()) {
      const f = this.app.vault.getAbstractFileByPath(this.notePath(folder, ext));
      if (f && f.stat) return f;
    }
    return null;
  }
  types() {
    const list = Array.isArray(this.s.supportedTypes) ? this.s.supportedTypes : FN_TYPES;
    return list.filter(x => FN_TYPES.includes(x));
  }
  /* Reverse lookup: is this file the folder note of some folder? */
  folderOf(file) {
    if (!file || !file.parent) return null;
    const ext = (file.extension || '').toLowerCase();
    if (!this.types().includes(ext)) return null;
    if ((this.s.storage || 'inside') === 'parent') {
      // A sibling folder whose computed note path is exactly this file.
      for (const sib of (file.parent.children || [])) {
        if (sib.children && this.notePath(sib, ext) === file.path) return sib;
      }
      return null;
    }
    return this.notePath(file.parent, ext) === file.path ? file.parent : null;
  }
  excluded(folder) {
    const list = (this.s.excludeFolders || []).map(x => String(x).trim().replace(/^\/|\/$/g, '')).filter(Boolean);
    if (!list.length) return false;
    return list.some(p => folder.path === p || folder.path.startsWith(p + '/'));
  }

  /* ---- create / delete / open ------------------------------------------- */

  async createNote(folder, openIt) {
    if (!folder || this.excluded(folder)) return null;
    const existing = this.noteFor(folder);
    if (existing) { if (openIt) this.openNote(existing); return existing; }
    const path = this.notePath(folder);
    let body = '';
    const tpl = String(this.s.templatePath || '').trim();
    if (tpl) {
      const tf = this.app.vault.getAbstractFileByPath(tpl.endsWith('.md') ? tpl : tpl + '.md');
      if (tf && tf.stat) {
        try {
          body = (await this.app.vault.read(tf))
            .replace(/\{\{\s*folder_name\s*\}\}/gi, folder.name)
            .replace(/\{\{\s*title\s*\}\}/gi, this.noteBaseName(folder))
            .replace(/\{\{\s*date\s*\}\}/gi, moment().format('YYYY-MM-DD'))
            .replace(/\{\{\s*time\s*\}\}/gi, moment().format('HH:mm'));
        } catch (e) {}
      } else new Notice('Nexus: folder-note template "' + tpl + '" not found.');
    }
    let file;
    try { file = await this.app.vault.create(path, body); }
    catch (e) { new Notice('Nexus: could not create folder note (' + e.message + ')'); return null; }
    this.refreshExplorer();
    if (openIt) this.openNote(file);
    return file;
  }
  async deleteNote(folder) {
    const file = this.noteFor(folder);
    if (!file) return;
    if (this.s.confirmDelete !== false) {
      const { NexusConfirmModal } = require('../modals/misc.js');
      const ok = await new NexusConfirmModal(this.app, 'Delete folder note?',
        file.path + '\nThe folder itself and everything else in it stays.', 'Delete').openAndGet();
      if (!ok) return;
    }
    try { await this.app.fileManager.trashFile(file); } catch (e) {}
    this.refreshExplorer();
  }
  openNote(file) {
    if (!file) return;
    if (this.s.focusExistingTab) {
      const hit = this.app.workspace.getLeavesOfType('markdown')
        .find(l => l.view && l.view.file && l.view.file.path === file.path);
      if (hit) { this.app.workspace.revealLeaf(hit); return; }
    }
    this.app.workspace.getLeaf(this.s.openInNewTab ? 'tab' : false).openFile(file);
  }

  /* ---- explorer wiring --------------------------------------------------- */

  /* Which modifier (if any) has to be held for a folder click to open its
     note instead of collapsing the folder. */
  triggerMatches(evt) {
    const mode = this.s.openTrigger || 'click';
    if (mode === 'off') return false;
    if (mode === 'ctrl') return evt.ctrlKey || evt.metaKey;
    if (mode === 'alt') return evt.altKey;
    return !evt.ctrlKey && !evt.metaKey && !evt.altKey;   // plain click
  }
  folderFromTitleEl(el) {
    if (!el || !el.getAttribute) return null;
    const path = el.getAttribute('data-path')
      || (el.parentElement && el.parentElement.getAttribute && el.parentElement.getAttribute('data-path'));
    if (!path) return null;
    const f = this.app.vault.getAbstractFileByPath(path);
    return (f && f.children) ? f : null;
  }

  init() {
    const p = this.plugin;

    // Click in the file explorer. CAPTURE phase, because Obsidian's own
    // handler on the same element toggles the collapse — we have to decide
    // before it runs, not after.
    p.registerDomEvent(document, 'click', (evt) => {
      if (!this.s.enabled) return;
      const title = evt.target && evt.target.closest && evt.target.closest('.nav-folder-title');
      if (!title || !title.closest('.nav-files-container')) return;
      if (evt.target.closest('.collapse-icon')) return;          // the arrow always collapses
      const folder = this.folderFromTitleEl(title);
      if (!folder || this.excluded(folder)) return;
      const note = this.noteFor(folder);
      if (!note) return;
      if (!this.triggerMatches(evt)) return;
      this.openNote(note);
      if (!this.s.collapseOnClick) { evt.preventDefault(); evt.stopPropagation(); }
    }, { capture: true });

    // Breadcrumb (the folder path above a note): clicking a segment opens that
    // folder's note instead of doing nothing.
    p.registerDomEvent(document, 'click', (evt) => {
      if (!this.s.enabled || this.s.openFromPath === false) return;
      const crumb = evt.target && evt.target.closest && evt.target.closest('.view-header-breadcrumb');
      if (!crumb) return;
      const folder = this.folderFromCrumb(crumb);
      const note = folder && this.noteFor(folder);
      if (!note) return;
      evt.preventDefault(); evt.stopPropagation();
      this.openNote(note);
    }, { capture: true });

    // Context menu on a folder → create / open / delete its note.
    p.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!this.s.enabled || !file || !file.children) return;
      const note = this.noteFor(file);
      if (note) {
        menu.addItem(i => i.setTitle('Open folder note').setIcon('file-text').onClick(() => this.openNote(note)));
        menu.addItem(i => i.setTitle('Delete folder note').setIcon('trash-2').onClick(() => this.deleteNote(file)));
      } else {
        menu.addItem(i => i.setTitle('Create folder note').setIcon('file-plus').onClick(() => this.createNote(file, true)));
      }
    }));

    // Auto-create for new folders.
    p.registerEvent(this.app.vault.on('create', (f) => {
      if (!this.s.enabled || !this.s.autoCreate) return;
      if (!f || !f.children) return;
      window.setTimeout(() => this.createNote(f, false), 60);   // let the folder settle
    }));

    // Keep note and folder in sync.
    p.registerEvent(this.app.vault.on('rename', (f, oldPath) => {
      if (!this.s.enabled) return;
      if (f && f.children) this.onFolderRenamed(f, oldPath);
      this.refreshExplorer();
    }));
    p.registerEvent(this.app.vault.on('delete', (f) => {
      if (!this.s.enabled) return;
      if (this.s.syncDelete && f instanceof TFile) this.onNoteDeleted(f);
      this.refreshExplorer();
    }));
    p.registerEvent(this.app.vault.on('create', () => this.refreshExplorer()));

    // The explorer re-renders on scroll/expand, so the markers have to be
    // re-applied. One debounced observer beats hooking every code path.
    this.app.workspace.onLayoutReady(() => {
      this.refreshExplorer();
      const container = document.querySelector('.nav-files-container');
      if (container && window.MutationObserver) {
        this._obs = new MutationObserver(() => this.refreshExplorerDebounced());
        this._obs.observe(container, { childList: true, subtree: true });
        p.register(() => { if (this._obs) { this._obs.disconnect(); this._obs = null; } });
      }
    });
    p.registerEvent(this.app.workspace.on('layout-change', () => this.refreshExplorerDebounced()));

    // Code block: a rendered overview of the folder's contents.
    p.registerMarkdownCodeBlockProcessor('folder-overview', (src, el, ctx) => this.renderOverview(src, el, ctx));

    p.addCommand({ id: 'nexus-create-folder-note', name: 'Create a folder note for this folder', callback: () => {
      const file = this.app.workspace.getActiveFile();
      const folder = file && file.parent;
      if (folder) this.createNote(folder, true); else new Notice('Nexus: no folder in context.');
    }});
  }

  folderFromCrumb(crumb) {
    // Obsidian renders the breadcrumb as a flat list of segments; rebuild the
    // path from the segments up to and including the clicked one.
    const parent = crumb.parentElement;
    if (!parent) return null;
    const parts = [];
    for (const child of Array.from(parent.children)) {
      if (!child.classList.contains('view-header-breadcrumb')) continue;
      parts.push(child.textContent.trim());
      if (child === crumb) break;
    }
    const path = parts.filter(Boolean).join('/');
    const f = this.app.vault.getAbstractFileByPath(path);
    return (f && f.children) ? f : null;
  }

  async onFolderRenamed(folder, oldPath) {
    if (!this.s.syncRename) return;
    const oldName = String(oldPath || '').split('/').pop();
    if (!oldName || oldName === folder.name) return;
    // Find the note that was named after the OLD folder name and rename it.
    const fake = { name: oldName, path: folder.path, parent: folder.parent };
    for (const ext of this.types()) {
      const oldNote = this.app.vault.getAbstractFileByPath(this.notePath(fake, ext));
      if (!oldNote || !oldNote.stat) continue;
      const dest = this.notePath(folder, ext);
      if (dest === oldNote.path) continue;
      if (this.s.confirmRename !== false) {
        const { NexusConfirmModal } = require('../modals/misc.js');
        const ok = await new NexusConfirmModal(this.app, 'Rename the folder note too?',
          oldNote.path + '\n→ ' + dest, 'Rename').openAndGet();
        if (!ok) return;
      }
      try { await this.app.fileManager.renameFile(oldNote, dest); } catch (e) {}
      return;
    }
  }
  async onNoteDeleted(file) {
    // syncDelete: removing the note removes the (now note-less) folder too.
    const folder = this.folderOf(file);
    if (!folder) return;
    const rest = (folder.children || []).filter(c => c.path !== file.path);
    if (rest.length) return;                       // never delete a folder with content
    try { await this.app.fileManager.trashFile(folder); } catch (e) {}
  }

  /* ---- explorer markers -------------------------------------------------- */

  refreshExplorerDebounced() {
    window.clearTimeout(this._t);
    this._t = window.setTimeout(() => this.refreshExplorer(), 120);
  }
  /* Tags every folder that owns a note and every file that IS one, so the CSS
     can underline the former and hide the latter. Cheap: one pass over the
     rendered rows, and only the class differs from run to run. */
  refreshExplorer() {
    const on = this.s && this.s.enabled;
    document.body.toggleClass('nx-fn-hide', !!(on && this.s.hideInExplorer));
    document.body.toggleClass('nx-fn-underline', !!(on && this.s.underline));
    document.body.toggleClass('nx-fn-bold', !!(on && this.s.bold));
    document.body.toggleClass('nx-fn-italic', !!(on && this.s.italic));
    const rows = document.querySelectorAll('.nav-files-container .nav-folder-title, .nav-files-container .nav-file-title');
    rows.forEach(el => {
      const path = el.getAttribute('data-path');
      if (!path) return;
      const af = this.app.vault.getAbstractFileByPath(path);
      if (!af) return;
      if (af.children) el.toggleClass('nx-fn-has-note', !!(on && !this.excluded(af) && this.noteFor(af)));
      else el.toggleClass('nx-fn-is-note', !!(on && this.folderOf(af)));
    });
    this.refreshBreadcrumbs(on);
  }
  refreshBreadcrumbs(on) {
    document.querySelectorAll('.view-header-breadcrumb').forEach(crumb => {
      const folder = on && this.s.openFromPath !== false ? this.folderFromCrumb(crumb) : null;
      crumb.toggleClass('nx-fn-crumb', !!(folder && this.noteFor(folder)));
    });
  }

  /* ---- folder overview code block ---------------------------------------
     ```folder-overview
     title: Contents
     depth: 2
     include: folder, markdown
     sort: name
     style: list
     ```
     Everything optional; no body at all = the current folder, depth 3. ---- */
  /* Parses BOTH spellings: the folder-notes plugin's own key names
     (folderPath / includeTypes / sortBy / sortByAsc / showEmptyFolders …) and
     the shorter ones. That is what makes an existing vault full of
     folder-overview blocks keep rendering after the switch, unchanged.
     YAML block lists ("includeTypes:\n  - folder") are understood too. */
  renderOverview(src, el, ctx) {
    const cfg = { title: '', showTitle: null, depth: 3, include: ['folder', 'markdown'],
      sort: 'name', asc: true, style: 'list', folder: '', showEmpty: false,
      showFolderNotes: false, onlySubfolders: false };
    const bool = (v) => /^(true|yes|1)$/i.test(String(v).trim());
    const lines = String(src || '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const ci = lines[i].indexOf(':');
      if (ci < 0) continue;
      const k = lines[i].slice(0, ci).trim().toLowerCase();
      let v = lines[i].slice(ci + 1).trim().replace(/^["']|["']$/g, '');
      // Collect a following "- item" list when the value itself is empty.
      const items = [];
      if (!v) {
        let j = i + 1;
        while (j < lines.length && /^\s*-\s+/.test(lines[j])) { items.push(lines[j].replace(/^\s*-\s+/, '').trim()); j++; }
        if (items.length) i = j - 1;
      }
      const list = () => (items.length ? items : v.replace(/^\[|\]$/g, '').split(','))
        .map(x => x.trim().replace(/^["']|["']$/g, '').toLowerCase()).filter(Boolean);

      switch (k) {
        case 'title': cfg.title = v; break;
        case 'showtitle': cfg.showTitle = bool(v); break;
        case 'depth': cfg.depth = Math.max(1, parseInt(v, 10) || 3); break;
        case 'include': case 'includetypes': cfg.include = list(); break;
        case 'sort': case 'sortby': cfg.sort = v.toLowerCase(); break;
        case 'asc': case 'sortbyasc': cfg.asc = bool(v); break;
        case 'style': cfg.style = v.toLowerCase(); break;
        case 'folder': case 'folderpath': cfg.folder = v; break;
        case 'showempty': case 'showemptyfolders': cfg.showEmpty = bool(v); break;
        case 'showfoldernotes': cfg.showFolderNotes = bool(v); break;
        case 'onlyincludesubfolders': cfg.onlySubfolders = bool(v); break;
        default: break;   // unknown keys (autoSync, useWikilinks, id …) are ignored, not an error
      }
    }

    const here = ctx && ctx.sourcePath ? this.app.vault.getAbstractFileByPath(ctx.sourcePath) : null;
    const root = cfg.folder
      ? this.app.vault.getAbstractFileByPath(cfg.folder.replace(/^\/|\/$/g, ''))
      : (here && here.parent);
    el.empty();
    el.addClass('nx-fo');
    if (!root || !root.children) { el.createDiv({ cls: 'nx-fo-empty', text: 'Folder overview: folder not found.' }); return; }
    if (cfg.title && cfg.showTitle !== false) {
      el.createDiv({ cls: 'nx-fo-title',
        text: cfg.title.replace(/\{\{\s*folderName\s*\}\}/gi, root.name).replace(/\{\{\s*folder_name\s*\}\}/gi, root.name) });
    }

    const noteOfRoot = this.noteFor(root);
    const wantFolder = cfg.include.includes('folder');
    const wantMd = cfg.include.includes('markdown') || cfg.include.includes('md');
    const wantAll = cfg.include.includes('all') || cfg.include.includes('file');

    const build = (folder, depth, parent) => {
      const list = parent.createEl('ul', { cls: 'nx-fo-list' + (cfg.style === 'grid' ? ' is-grid' : '') });
      const kids = (folder.children || []).slice().sort((a, b) => {
        if (cfg.sort === 'created') return (a.stat ? a.stat.ctime : 0) - (b.stat ? b.stat.ctime : 0);
        if (cfg.sort === 'modified') return (a.stat ? a.stat.mtime : 0) - (b.stat ? b.stat.mtime : 0);
        return a.name.localeCompare(b.name);
      });
      if (!cfg.asc) kids.reverse();
      let printed = 0;
      for (const child of kids) {
        if (child.children) {
          if (!wantFolder) continue;
          const li = list.createEl('li', { cls: 'nx-fo-item is-folder' });
          const row = li.createDiv('nx-fo-row');
          setIcon(row.createSpan('nx-fo-icon'), 'folder');
          const note = this.noteFor(child);
          const a = row.createSpan({ cls: 'nx-fo-name', text: child.name });
          if (note) { a.addClass('is-link'); a.onclick = () => this.openNote(note); }
          if (depth > 1) build(child, depth - 1, li);
          printed++;
        } else {
          if (cfg.onlySubfolders) continue;                                // folders only
          const ext = (child.extension || '').toLowerCase();
          if (!wantAll && !(wantMd && ext === 'md')) continue;
          if (noteOfRoot && child.path === noteOfRoot.path) continue;      // the folder's own note is the page you're on
          if (!cfg.showFolderNotes && this.folderOf(child)) continue;      // other folders' notes are reached via the folder
          const li = list.createEl('li', { cls: 'nx-fo-item' });
          const row = li.createDiv('nx-fo-row');
          setIcon(row.createSpan('nx-fo-icon'), ext === 'md' ? 'file-text' : 'file');
          const a = row.createSpan({ cls: 'nx-fo-name is-link', text: child.basename });
          a.onclick = () => this.app.workspace.getLeaf(false).openFile(child);
          printed++;
        }
      }
      if (!printed && !cfg.showEmpty) list.remove();
      return printed;
    };
    const n = build(root, cfg.depth, el);
    if (!n) el.createDiv({ cls: 'nx-fo-empty', text: 'Nothing to show.' });
  }

  unload() {
    ['nx-fn-hide', 'nx-fn-underline', 'nx-fn-bold', 'nx-fn-italic'].forEach(c => document.body.removeClass(c));
    document.querySelectorAll('.nx-fn-has-note, .nx-fn-is-note, .nx-fn-crumb')
      .forEach(el => el.removeClasses(['nx-fn-has-note', 'nx-fn-is-note', 'nx-fn-crumb']));
    if (this._obs) { this._obs.disconnect(); this._obs = null; }
  }
}

module.exports = { NexusFolderNotes, FN_TYPES };
