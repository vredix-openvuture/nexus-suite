'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · dashboard · adding and editing widgets
 *  The add-a-widget menu, each widget's own menu, and the small dialogs they
 *  open. Mixed into the dashboard view (lib/mixin.js).
 * ========================================================================== */

const { Menu, Notice } = require('obsidian');
const { NexusHabitConfigModal, NexusListConfigModal, NexusOrphanConfigModal, NexusScratchConfigModal, NexusRandomConfigModal, NexusSketchConfigModal, NexusStatConfigModal } = require('../../modals/cards.js');
const { CARD_DEFS } = require('../../constants.js');
const { NexusImageAdjustModal, NexusImageConfigModal } = require('../../modals/image.js');
const { NexusNameModal } = require('../../modals/misc.js');
const { NexusPopupMenu } = require('../../modals/pickers.js');
const { NexusTimerConfigModal } = require('../timers.js');

class HomeMenus {
  _addWidgetMenu(evt) {
    const menu = new Menu();
    const add = async (w) => { w.uid = this._uid(); this._widgets().push(w); await this.plugin.saveSettings(); this.render(); };
    menu.addItem(i => i.setTitle('List / query …').setIcon('list').onClick(() => this._addList()));
    menu.addItem(i => i.setTitle('Random note …').setIcon('shuffle').onClick(() => this._addRandom()));
    menu.addItem(i => i.setTitle('Scratch …').setIcon('pencil-line').onClick(() => this._addScratch()));
    // Three entries, one renderer: they are three decisions, not one card with
    // a dropdown, because a vault that never speaks should not have to carry a
    // third of an empty card.
    [['ink', 'Ink Capture', 'camera'], ['sketch', 'Quick Sketch', 'pencil-line'], ['chatter', 'Chatter', 'mic']]
      .forEach(([kind, label, icon]) => menu.addItem(i => i.setTitle(label + ' …').setIcon(icon)
        .onClick(() => this._addCaptures(kind, label, icon))));
    menu.addItem(i => i.setTitle('Habit tracker …').setIcon('flame').onClick(() => this._addHabit()));
    menu.addItem(i => i.setTitle('Orphan finder …').setIcon('unlink').onClick(() => this._addOrphans()));
    menu.addSeparator();
    menu.addItem(i => i.setTitle('Quick sketches …').setIcon('pencil-line').onClick(() => this._addSketches()));
    menu.addSeparator();
    menu.addItem(i => i.setTitle('Image (file) …').setIcon('image-plus').onClick(() => this._pickImageWidget()));
    menu.addItem(i => i.setTitle('Image (URL) …').setIcon('link').onClick(() => this._addImageUrl()));
    menu.addItem(i => i.setTitle('Clock').setIcon('clock').onClick(() => add({ type: 'clock', w: 5, h: 5 })));
    menu.addItem(i => i.setTitle('Timer').setIcon('timer').onClick(() => add({ type: 'timer', w: 5, h: 5, minutes: 5 })));
    menu.addItem(i => i.setTitle('Weather …').setIcon('cloud-sun').onClick(() => this._addWeather()));
    // Show hidden template cards again
    const hidden = this.plugin.hp().hidden || [];
    if (hidden.length) {
      menu.addSeparator();
      hidden.forEach(id => { const def = CARD_DEFS[id]; if (!def) return;
        menu.addItem(i => i.setTitle('Restore: ' + def.title).setIcon(def.icon).onClick(async () => {
          this.plugin.hp().hidden = hidden.filter(h => h !== id);
          await this.plugin.saveSettings(); this.render();
        }));
      });
    }
    menu.showAtMouseEvent(evt);
  }
  async _addList() {
    const item = { type: 'list', uid: this._uid(), w: 6, h: 8, title: 'List', icon: 'list', folders: '', tags: '', name: '', sort: 'modified', count: 8 };
    this._widgets().push(item);
    await this.plugin.saveSettings(); this.render();
    new NexusListConfigModal(this.plugin, this, item).open();
  }
  async _addCaptures(kind, label, icon) {
    const item = { type: 'captures', kind, uid: this._uid(), w: 4, h: 5, title: label, icon };
    this.hp().widgets.push(item);
    await this.plugin.saveSettings();
    this.render();
  }
  async _addScratch() {
    const item = { type: 'scratch', uid: this._uid(), w: 6, h: 6, title: 'Scratch', folder: '', template: '' };
    this._widgets().push(item);
    await this.plugin.saveSettings(); this.render();
    new NexusScratchConfigModal(this.plugin, this, item).open();
  }
  async _addHabit() {
    const item = { type: 'habit', uid: this._uid(), w: 6, h: 6, title: 'Habit', icon: 'flame',
      prop: '', mode: 'number', period: 'month', low: 1, medium: 2, high: 3, color: '', folder: '', format: '' };
    this._widgets().push(item);
    await this.plugin.saveSettings(); this.render();
    new NexusHabitConfigModal(this.plugin, this, item).open();
  }
  async _addRandom() {
    const item = { type: 'random', uid: this._uid(), w: 8, h: 10, title: 'Random note', icon: 'shuffle',
      folders: '', tags: '', name: '', propGroups: [], mode: 'open', lines: 20, showMeta: true, showBanner: true };
    this._widgets().push(item);
    await this.plugin.saveSettings(); this.render();
    new NexusRandomConfigModal(this.plugin, this, item).open();
  }
  async _addSketches() {
    const item = { type: 'sketches', uid: this._uid(), w: 8, h: 10, title: 'Quick sketches', icon: 'pencil-line',
      folders: '', sort: 'modified', count: 8, display: 'grid', showName: true };
    this._widgets().push(item);
    await this.plugin.saveSettings(); this.render();
    new NexusSketchConfigModal(this.plugin, this, item).open();
  }
  async _addOrphans() {
    const item = { type: 'orphans', uid: this._uid(), w: 6, h: 8, title: 'Orphans', icon: 'unlink',
      kinds: ['image'], folders: '', exclude: '', mode: 'incoming', countFrontmatter: true, countCanvas: true,
      tagState: 'any', tags: '', tagsNot: '', fmState: 'any', propGroups: [], propGroupsNot: [], name: '',
      display: 'list', sort: 'size', sortDir: 'desc', showPath: true, count: 25 };
    this._widgets().push(item);
    await this.plugin.saveSettings(); this.render();
    new NexusOrphanConfigModal(this.plugin, this, item).open();
  }

  /* ---- Stat tiles (generic, configurable) ---- */
  _addStatMenu(evt) {
    const arr = this.plugin.hp().stats || (this.plugin.hp().stats = []);
    const menu = new Menu();
    menu.addItem(i => i.setTitle('Counter (query) …').setIcon('hash').onClick(async () => {
      const it = { kind: 'count', label: 'Counter', icon: 'hash', folders: '', tags: '', props: '', name: '' };
      arr.push(it); await this.plugin.saveSettings(); this.render();
      new NexusStatConfigModal(this.plugin, this, it).open();
    }));
    menu.addItem(i => i.setTitle('Total notes').setIcon('files').onClick(async () => { arr.push({ kind: 'total' }); await this.plugin.saveSettings(); this.render(); }));
    menu.addItem(i => i.setTitle('Journal streak').setIcon('flame').onClick(async () => { arr.push({ kind: 'streak' }); await this.plugin.saveSettings(); this.render(); }));
    menu.showAtMouseEvent(evt);
  }
  _statMenu(evt, idx) {
    const arr = this.plugin.hp().stats || [];
    const it = arr[idx]; if (!it) return;
    const menu = new Menu();
    const save = async () => { await this.plugin.saveSettings(); this.render(); };
    menu.addItem(i => i.setTitle('Configure …').setIcon('settings-2').onClick(() => new NexusStatConfigModal(this.plugin, this, it).open()));
    if (idx > 0) menu.addItem(i => i.setTitle('Move left').setIcon('arrow-left').onClick(async () => { arr.splice(idx - 1, 0, arr.splice(idx, 1)[0]); await save(); }));
    if (idx < arr.length - 1) menu.addItem(i => i.setTitle('Move right').setIcon('arrow-right').onClick(async () => { arr.splice(idx + 1, 0, arr.splice(idx, 1)[0]); await save(); }));
    menu.addItem(i => i.setTitle('Remove').setIcon('trash-2').onClick(async () => { arr.splice(idx, 1); await save(); }));
    menu.showAtMouseEvent(evt);
  }
  async _addImageUrl() {
    const url = await new NexusNameModal(this.app, 'Image URL', '').openAndGet();
    if (!url) return;
    this._widgets().push({ type: 'image', uid: this._uid(), w: 8, h: 8, src: url.trim() });
    await this.plugin.saveSettings(); this.render();
  }
  _pickImageWidget() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const dir = 'attachments/homepage';
      if (!this.app.vault.getAbstractFileByPath(dir)) { try { await this.app.vault.createFolder(dir); } catch (e) {} }
      const ext = ((f.name.split('.').pop() || 'jpg').toLowerCase()).replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = dir + '/img-' + Date.now() + '.' + ext;
      await this.app.vault.createBinary(path, await f.arrayBuffer());
      this._widgets().push({ type: 'image', uid: this._uid(), w: 8, h: 8, src: path });
      await this.plugin.saveSettings(); this.render();
    };
    input.click();
  }
  async _addWeather() { await this._geocodeInto({ type: 'weather', w: 5, h: 5 }, true); }
  async _changeWeather(item) { await this._geocodeInto(item, false); }
  async _geocodeInto(item, isNew) {
    const q = await new NexusNameModal(this.app, 'Location (city)', item.label || '').openAndGet();
    if (!q) return;
    try {
      const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&name=' + encodeURIComponent(q));
      const j = await r.json(); const g = j.results && j.results[0];
      if (!g) { new Notice('Nexus: location not found.'); return; }
      item.lat = g.latitude; item.lon = g.longitude; item.label = g.name;
      delete this._weatherCache[item.uid || ''];
      if (isNew) { item.uid = this._uid(); this._widgets().push(item); }
      await this.plugin.saveSettings(); this.render();
    } catch (e) { new Notice('Nexus: could not load location (offline?).'); }
  }
  _widgetMenu(evt, idx) {
    const ws = this._widgets(); const item = ws[idx]; if (!item) return;
    const menu = new NexusPopupMenu(this.app, item.type ? item.type.charAt(0).toUpperCase() + item.type.slice(1) : 'Card');
    const save = async () => { await this.plugin.saveSettings(); this.render(); };
    if (item.type === 'image') {
      menu.addItem(i => i.setTitle('Caption …').setIcon('text-cursor-input').onClick(async () => {
        const cap = await new NexusNameModal(this.app, 'Caption', item.caption || '').openAndGet();
        item.caption = (cap || '').trim(); await save();
      }));
      menu.addItem(i => i.setTitle('Link (note/URL) …').setIcon('link').onClick(async () => {
        const lk = await new NexusNameModal(this.app, 'Link', item.link || '').openAndGet();
        item.link = (lk || '').trim(); await save();
      }));
      menu.addItem(i => i.setTitle('Images / slideshow …').setIcon('images').onClick(() => new NexusImageConfigModal(this.plugin, this, item).open()));
      menu.addItem(i => i.setTitle('Zoom & crop …').setIcon('move').onClick(() => new NexusImageAdjustModal(this.plugin, this, item).open()));
      menu.addItem(i => i.setTitle(item.clickable === false ? 'Make clickable' : 'Not clickable').setIcon('mouse-pointer-click')
        .onClick(async () => { item.clickable = item.clickable === false; await save(); }));
      menu.addItem(i => i.setTitle(item.border === false ? 'Show border' : 'Hide border').setIcon('square')
        .onClick(async () => { item.border = !(item.border === false) ? false : true; await save(); }));
    }
    if (item.type === 'clock') menu.addItem(i => i.setTitle(item.seconds ? 'Hide seconds' : 'Show seconds').setIcon('clock').onClick(async () => { item.seconds = !item.seconds; await save(); }));
    if (item.type === 'timer') menu.addItem(i => i.setTitle('Configure …').setIcon('settings-2').onClick(() => new NexusTimerConfigModal(this.plugin, this, item).open()));
    if (item.type === 'weather') menu.addItem(i => i.setTitle('Location …').setIcon('map-pin').onClick(() => this._changeWeather(item)));
    if (item.type === 'list') menu.addItem(i => i.setTitle('Configure …').setIcon('settings-2').onClick(() => new NexusListConfigModal(this.plugin, this, item).open()));
    if (item.type === 'scratch') menu.addItem(i => i.setTitle('Configure …').setIcon('settings-2').onClick(() => new NexusScratchConfigModal(this.plugin, this, item).open()));
    if (item.type === 'habit') menu.addItem(i => i.setTitle('Configure …').setIcon('settings-2').onClick(() => new NexusHabitConfigModal(this.plugin, this, item).open()));
    if (item.type === 'orphans') menu.addItem(i => i.setTitle('Configure …').setIcon('settings-2').onClick(() => new NexusOrphanConfigModal(this.plugin, this, item).open()));
    if (item.type === 'random') {
      menu.addItem(i => i.setTitle('Shuffle now').setIcon('shuffle').onClick(() => { this._randomPick[item.uid] = null; this.render(); }));
      menu.addItem(i => i.setTitle('Configure …').setIcon('settings-2').onClick(() => new NexusRandomConfigModal(this.plugin, this, item).open()));
    }
    if (item.type === 'sketches') menu.addItem(i => i.setTitle('Configure …').setIcon('settings-2').onClick(() => new NexusSketchConfigModal(this.plugin, this, item).open()));
    const resize = (dw, dh) => async () => { item.w = Math.max(1, Math.min(48, (item.w || 1) + dw)); item.h = Math.max(1, Math.min(48, (item.h || 1) + dh)); await save(); };
    menu.addSeparator();
    menu.addItem(i => i.setTitle('Wider').setIcon('chevrons-right').onClick(resize(1, 0)));
    menu.addItem(i => i.setTitle('Narrower').setIcon('chevrons-left').onClick(resize(-1, 0)));
    menu.addItem(i => i.setTitle('Taller').setIcon('chevrons-down').onClick(resize(0, 1)));
    menu.addItem(i => i.setTitle('Shorter').setIcon('chevrons-up').onClick(resize(0, -1)));
    menu.addSeparator();
    menu.addItem(i => i.setTitle('Remove').setIcon('trash-2').setWarning(true).onClick(async () => { ws.splice(idx, 1); await save(); }));
    menu.showAtMouseEvent(evt);
  }
}

module.exports = HomeMenus;
