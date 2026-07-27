'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · workspace switcher
 *  Nicer modal over the core Workspaces plugin.
 * ========================================================================== */

const { Modal, Notice, setIcon } = require('obsidian');
const { NexusNameModal } = require('./misc.js');

class NexusWorkspaceModal extends Modal {
  constructor(plugin, releaseMode) { super(plugin.app); this.plugin = plugin; this.sel = 0; this.tiles = []; this.releaseMode = !!releaseMode; }
  wp() { return this.app.internalPlugins.getPluginById('workspaces'); }
  onOpen() {
    this.plugin._wsModal = this;
    this.contentEl.addClass('nx-ws-modal');
    this.modalEl.addClass('nx-ws-modal-el');
    if (this.releaseMode) this.modalEl.addClass('nx-ws-release');
    this.render();
    // Keyboard (alt-tab feel): Tab / Shift+Tab or ← → select, Enter loads
    this.scope.register([], 'Tab', e => { e.preventDefault(); this.move(1); });
    this.scope.register(['Shift'], 'Tab', e => { e.preventDefault(); this.move(-1); });
    // Keep cycling while Ctrl+Alt is held (the global command is blocked while
    // the modal is open → catch it here in the modal scope). Mod = Ctrl.
    this.scope.register(['Mod', 'Alt'], 'Tab', e => { e.preventDefault(); this.move(1); });
    this.scope.register(['Mod', 'Alt', 'Shift'], 'Tab', e => { e.preventDefault(); this.move(-1); });
    this.scope.register([], 'ArrowRight', e => { e.preventDefault(); this.move(1); });
    this.scope.register([], 'ArrowLeft', e => { e.preventDefault(); this.move(-1); });
    this.scope.register([], 'Enter', e => { e.preventDefault(); if (this.tiles[this.sel]) this.tiles[this.sel].click(); });
  }
  move(d) { if (this.tiles.length) { this.sel = (this.sel + d + this.tiles.length) % this.tiles.length; this.highlight(); } }
  /* Release mode: load the current selection + close (on releasing Ctrl/Alt).
     ONCE — then disarmed, so further typing (e.g. a layout name) does not
     trigger it again. */
  confirmSelection() {
    if (this._confirmed) return;
    this._confirmed = true;
    this.releaseMode = false;
    const t = this.tiles[this.sel];
    if (t) t.click(); else this.close();
  }
  highlight() {
    this.tiles.forEach((t, i) => t.toggleClass('is-selected', i === this.sel));
    if (this.tiles[this.sel]) this.tiles[this.sel].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /* Mini schematic of a saved split tree (symbolizes the panel layout) */
  buildMini(node, parent) {
    const box = parent.createDiv('nx-ws-mini-box');
    // Only real splits produce multiple boxes. A tab group (tabs) is ONE
    // visible pane (only the active tab counts) → a single box.
    if (node && node.type === 'split' && Array.isArray(node.children) && node.children.length) {
      // Obsidian: 'horizontal' = horizontal divider → stacked (column);
      //           'vertical'   = vertical divider   → side by side (row)
      box.style.flexDirection = node.direction === 'horizontal' ? 'column' : 'row';
      node.children.forEach(ch => this.buildMini(ch, box));
    } else {
      box.addClass('nx-ws-mini-leaf');
    }
  }
  renderPreview(data, wrap) {
    const row = wrap.createDiv('nx-ws-preview-row');
    // left sidebar: content (panes/tabs) + vault switcher at the bottom
    if (data && data.left && data.left.collapsed !== true) {
      const l = row.createDiv('nx-ws-side');
      this.buildMini(data.left, l.createDiv('nx-ws-side-content'));
      l.createDiv('nx-ws-vault');
    }
    this.buildMini((data && data.main) || { type: 'leaf' }, row.createDiv('nx-ws-main'));
    // right sidebar: content
    if (data && data.right && data.right.collapsed !== true) {
      const r = row.createDiv('nx-ws-side');
      this.buildMini(data.right, r.createDiv('nx-ws-side-content'));
    }
  }

  render() {
    const c = this.contentEl;
    c.empty();
    c.createEl('h3', { text: 'Workspaces' });
    const p = this.wp();
    if (!p || !p.enabled) {
      c.createDiv({ cls: 'nx-ws-empty', text: 'The core "Workspaces" plugin is disabled.' });
      const b = c.createEl('button', { text: 'Enable', cls: 'mod-cta' });
      b.onclick = async () => { try { await p.enable(); } catch (e) {} this.render(); };
      return;
    }
    const inst = p.instance;
    const names = Object.keys(inst.workspaces || {}).sort((a, b) => a.localeCompare(b));
    const active = inst.activeWorkspace;
    const strip = c.createDiv('nx-ws-strip');
    this.tiles = [];
    names.forEach(name => {
      const tile = strip.createDiv('nx-ws-tile' + (name === active ? ' is-active' : ''));
      this.renderPreview(inst.workspaces[name], tile.createDiv('nx-ws-preview'));
      tile.createDiv({ cls: 'nx-ws-tile-name', text: name });
      const acts = tile.createDiv('nx-ws-tile-actions');
      const mk = (icon, tip, fn) => { const b = acts.createDiv('nx-ws-act'); setIcon(b, icon); b.setAttribute('aria-label', tip); b.onclick = e => { e.stopPropagation(); fn(); }; };
      mk('save', 'Overwrite layout here', () => { inst.saveWorkspace(name); new Notice('Overwritten: ' + name); this.render(); });
      mk('pencil', 'Rename', () => this.rename(inst, name));
      mk('trash-2', 'Delete', () => { inst.deleteWorkspace(name); this.render(); });
      tile.onclick = () => { inst.loadWorkspace(name); new Notice('Layout loaded: ' + name); this.close(); };
      this.tiles.push(tile);
    });
    // "+ Save" tile at the end
    const add = strip.createDiv('nx-ws-tile nx-ws-tile-add');
    setIcon(add.createDiv('nx-ws-add-icon'), 'plus');
    add.createDiv({ cls: 'nx-ws-tile-name', text: 'Save layout…' });
    add.onclick = async () => {
      const name = await new NexusNameModal(this.app, 'Save current layout as', '').openAndGet();
      if (name) { inst.saveWorkspace(name); new Notice('Saved: ' + name); this.render(); }
    };
    this.tiles.push(add);   // "+ Save" is part of the cycle
    this.sel = Math.max(0, names.indexOf(active));
    this.highlight();
  }
  async rename(inst, name) {
    const nn = await new NexusNameModal(this.app, 'Rename layout', name).openAndGet();
    if (!nn || nn === name || inst.workspaces[nn]) return;
    inst.workspaces[nn] = inst.workspaces[name];
    delete inst.workspaces[name];
    if (inst.activeWorkspace === name) inst.activeWorkspace = nn;
    if (inst.saveData) inst.saveData();
    this.render();
  }
  onClose() { this.contentEl.empty(); if (this.plugin._wsModal === this) this.plugin._wsModal = null; }
}

module.exports = { NexusWorkspaceModal };
