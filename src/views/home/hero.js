'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · dashboard · the hero
 *  The dashboard's top: background image and pattern, the book covers, and
 *  the action buttons. Mixed into the dashboard view (lib/mixin.js).
 * ========================================================================== */

const { Menu, Notice, moment } = require('obsidian');
const { openDailyNote } = require('../../lib/helpers.js');
const { NexusPopupMenu } = require('../../modals/pickers.js');
const { NexusSearchModal } = require('../../modals/search.js');

class HomeHero {

  /* Choose image via system dialog, copy to attachments/homepage, set as hero */
  _pickHero() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const dir = 'attachments/homepage';
      if (!this.app.vault.getAbstractFileByPath(dir)) { try { await this.app.vault.createFolder(dir); } catch (e) {} }
      const ext = ((f.name.split('.').pop() || 'jpg').toLowerCase()).replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = dir + '/hero-' + Date.now() + '.' + ext;
      await this.app.vault.createBinary(path, await f.arrayBuffer());
      this.plugin.hp().hero = path;
      await this.plugin.saveSettings();
      this.render();
    };
    input.click();
  }

  /* ---- Book cover ---- */
  _coverSrc(file, fm, field) {
    const v = (field && fm[field]) || fm.cover || fm.image || fm.banner;   // path, [[link]] or URL
    return v ? this.plugin.resolveBannerSrc(v, file.path) : null;
  }
  _hue(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; }
  _initials(s) {
    return s.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2)
      .map(w => w[0].toUpperCase()).join('') || '?';
  }
  _bookTile(gallery, x, planned, coverField) {
    const t = gallery.createDiv('nx-home-book');
    if (planned) t.addClass('is-planned');
    const cov = t.createDiv('nx-home-book-cover');
    const src = this._coverSrc(x.f, x.fm, coverField);
    if (src) { cov.addClass('has-img'); cov.style.setProperty('--img', 'url("' + src.replace(/"/g, '\\"') + '")'); }
    else {
      cov.addClass('is-placeholder');
      cov.style.setProperty('--h', String(this._hue(x.f.basename)));
      cov.createSpan({ cls: 'nx-home-book-initials', text: this._initials(x.f.basename) });
    }
    if (planned) cov.createDiv({ cls: 'nx-home-book-badge', text: 'planned' });
    else { const r = Number(x.fm.rating); if (r > 0) cov.createDiv({ cls: 'nx-home-book-rate', text: '★'.repeat(Math.min(5, r)) }); }
    t.createDiv({ cls: 'nx-home-book-title', text: x.f.basename });
    if (x.fm.author) t.createDiv({ cls: 'nx-home-book-author', text: String(x.fm.author) });
    t.onclick = () => this._open(x.f);
    t.oncontextmenu = (e) => { e.preventDefault(); this._coverMenu(e, x.f); };
    return t;
  }
  _coverMenu(evt, file) {
    const menu = new NexusPopupMenu(this.app, 'Cover');
    menu.addItem(i => i.setTitle('Choose cover …').setIcon('image-plus').onClick(() => this._pickCover(file)));
    if (this._fm(file).cover)
      menu.addItem(i => i.setTitle('Remove cover').setIcon('x').onClick(async () => {
        await this.app.fileManager.processFrontMatter(file, f => { delete f.cover; }); this.render();
      }));
    menu.showAtMouseEvent(evt);
  }
  _pickCover(file) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const dir = 'attachments/covers';
      if (!this.app.vault.getAbstractFileByPath(dir)) { try { await this.app.vault.createFolder(dir); } catch (e) {} }
      const ext = ((f.name.split('.').pop() || 'jpg').toLowerCase()).replace(/[^a-z0-9]/g, '') || 'jpg';
      const slug = file.basename.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase().replace(/^-|-$/g, '');
      const path = dir + '/' + slug + '-' + Date.now() + '.' + ext;
      await this.app.vault.createBinary(path, await f.arrayBuffer());
      await this.app.fileManager.processFrontMatter(file, fr => { fr.cover = path; });
      this.render();
    };
    input.click();
  }

  /* Menu "+ Card" (top) */
  /* Homepage background pattern — SUBTLE & DECORATIVE (larger scale, very
     low contrast). Set inline → independent of styles.css. */
  _applyHomeBg(root) {
    const type = (this.plugin.hp().bg || 'none');
    const c = 'color-mix(in srgb, var(--text-normal) 3%, transparent)';   // very subtle, theme-aware
    const svg = (inner, w, h) => "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='" + w + "' height='" + h + "'%3E" + inner + "%3C/svg%3E\")";
    const st = "stroke='%23888888' stroke-opacity='0.06' fill='none' stroke-width='1.5'";
    const P = {
      dots:     { img: 'radial-gradient(circle, ' + c + ' 2.5px, transparent 3px)', size: '72px 72px' },
      grid:     { img: 'linear-gradient(' + c + ' 1px, transparent 1px), linear-gradient(90deg, ' + c + ' 1px, transparent 1px)', size: '104px 104px' },
      diagonal: { img: 'repeating-linear-gradient(45deg, ' + c + ' 0 1px, transparent 1px 72px)', size: 'auto' },
      cross:    { img: svg("%3Cpath d='M46 26v40 M26 46h40' " + st + "/%3E", 92, 92), size: '92px 92px' },
      rings:    { img: svg("%3Ccircle cx='72' cy='72' r='44' " + st + "/%3E", 144, 144), size: '144px 144px' },
      waves:    { img: svg("%3Cpath d='M0 40 Q 45 12 90 40 T 180 40' " + st + "/%3E", 180, 64), size: '180px 64px' },
      chevron:  { img: svg("%3Cpath d='M0 34 L 22 12 L 44 34 M44 34 L 66 12 L 88 34' " + st + "/%3E", 88, 42), size: '92px 44px' },
    };
    const a = 'var(--nx-accent, var(--interactive-accent))';
    const p = P[type];
    root.style.backgroundColor = 'var(--background-primary)';
    root.style.backgroundAttachment = 'fixed';
    if (type === 'gradient') {
      // ONLY a soft gradient from the theme colors (accent → base → accent)
      root.style.backgroundImage = 'linear-gradient(135deg, ' +
        'color-mix(in srgb, ' + a + ' 24%, var(--background-primary)) 0%, ' +
        'var(--background-primary) 58%, ' +
        'color-mix(in srgb, ' + a + ' 14%, var(--background-primary)) 100%)';
      root.style.backgroundSize = 'cover';
      root.style.backgroundRepeat = 'no-repeat';
      root.style.backgroundPosition = 'center';
    } else if (p) {
      root.style.backgroundImage = p.img; root.style.backgroundSize = p.size;
      root.style.backgroundRepeat = 'repeat'; root.style.backgroundPosition = 'center';
    } else {
      root.style.removeProperty('background-image');
      root.style.removeProperty('background-size');
      root.style.removeProperty('background-repeat');
    }
  }
  _bgPatternMenu(evt) {
    const s = this.plugin.hp();
    const cur = s.bg || 'none';
    const menu = new Menu();
    const opt = (val, label, icon) => menu.addItem(i => i.setTitle(label).setIcon(icon).setChecked(cur === val)
      .onClick(async () => { s.bg = val; await this.plugin.saveSettings(); this.render(); }));
    opt('none', 'No pattern', 'x');
    opt('gradient', 'Gradient (theme colors)', 'blend');
    opt('dots', 'Dots', 'grip');
    opt('grid', 'Grid', 'grid-3x3');
    opt('diagonal', 'Diagonal', 'move-diagonal');
    opt('cross', 'Crosses', 'plus');
    opt('rings', 'Rings', 'circle');
    opt('waves', 'Waves', 'waves');
    opt('chevron', 'Zigzag', 'chevrons-up');
    menu.showAtMouseEvent(evt);
  }

  /* Run primary action (kind dispatch) */
  _runAction(a) {
    const k = a && a.kind;
    if (k === 'journal') return openDailyNote(this.app, moment());
    if (k === 'search') return new NexusSearchModal(this.plugin).open();
    if (k === 'calendar') return this.plugin.activateCalendar();
    if (k === 'newNote') {
      const c = this.app.commands;
      if (c && c.executeCommandById && c.executeCommandById('file-explorer:new-file')) return;
      return this.app.vault.create('Untitled ' + moment().format('YYYY-MM-DD HHmmss') + '.md', '').then(f => this._open(f));
    }
    if (k === 'command') { if (a.arg) this.app.commands.executeCommandById(a.arg); return; }
    if (k === 'note') {
      if (!a.arg) return;
      const dest = this.app.metadataCache.getFirstLinkpathDest(String(a.arg).replace(/\.md$/, ''), '');
      if (dest) this._open(dest); else new Notice('Note not found: ' + a.arg);
      return;
    }
    if (k === 'url') { if (a.arg) window.open(a.arg, '_blank'); return; }
  }
  _allCommands() {
    const cmds = (this.app.commands && this.app.commands.commands) || {};
    return Object.values(cmds).map(c => c.name).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }
  _cmdIdByName(name) {
    const cmds = (this.app.commands && this.app.commands.commands) || {};
    const hit = Object.values(cmds).find(c => c.name === name);
    return hit ? hit.id : '';
  }
  _cmdNameById(id) {
    const cmds = (this.app.commands && this.app.commands.commands) || {};
    return (cmds[id] && cmds[id].name) || '';
  }
}

module.exports = HomeHero;
