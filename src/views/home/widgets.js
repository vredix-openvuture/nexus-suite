'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · dashboard · small widgets
 *  The card frame, and the scratch, image, random note, clock, timer and
 *  weather widgets. Mixed into the dashboard view (lib/mixin.js).
 * ========================================================================== */

const { Notice, moment, setIcon } = require('obsidian');
const { NexusScratchConfigModal, NexusRandomConfigModal } = require('../../modals/cards.js');
const scratch = require('../../lib/scratch.js');
const { WMO, WMO_ICON } = require('../../constants.js');
const { renderMd } = require('../../lib/helpers.js');
const { stripFrontmatter } = require('../../lib/text.js');

class HomeWidgets {

  _widgetCard(grid, item, idx) {
    const card = grid.createDiv('nx-home-card nx-home-widget nx-widget-' + item.type);
    this._dragify(card, 'w:' + item.uid);
    this._place(card);
    this._resizable(card, 'w:' + item.uid);
    // Edit (right-click menu) only in edit mode — otherwise widgets
    // (e.g. the clock) can't be accidentally changed in normal mode.
    if (this._editing) card.oncontextmenu = (e) => { e.preventDefault(); this._widgetMenu(e, idx); };
    if (item.type === 'image') this._wImage(card, item);
    else if (item.type === 'clock') this._wClock(card, item);
    else if (item.type === 'timer') this._wTimer(card, item);
    else if (item.type === 'weather') this._wWeather(card, item);
    else if (item.type === 'list') this._wList(card, item);
    else if (item.type === 'scratch') this._wScratch(card, item);
    else if (item.type === 'habit') this._wHabit(card, item);
    else if (item.type === 'orphans') this._wOrphans(card, item);
    else if (item.type === 'random') this._wRandom(card, item);
    else if (item.type === 'sketches') this._wSketches(card, item);
    else if (item.type === 'captures') this._wCaptures(card, item);
    // Headless widgets get a gear in the corner in edit mode (settings)
    if (this._editing && ['image', 'clock', 'timer', 'weather'].includes(item.type)) {
      const gear = card.createDiv('nx-home-card-gear nx-home-gear-corner');
      setIcon(gear, 'settings-2');
      gear.setAttribute('aria-label', 'Customize card');
      gear.onclick = (e) => { e.stopPropagation(); this._widgetMenu(e, idx); };
    }
  }

  /* Scratch: just start writing → Save creates a note with a timestamp name.
     It used to be called Quicknote and shared that word with the module you
     speak into, which had nothing to do with it. This is a pad; that is a
     microphone. */
  _wScratch(card, item) {
    const head = card.createDiv('nx-home-card-head');
    setIcon(head.createSpan('nx-home-card-icon'), 'pencil-line');
    head.createSpan({ cls: 'nx-home-card-title', text: item.title || 'Scratch' });
    if (this._editing) {
      const gear = head.createSpan('nx-home-card-gear');
      setIcon(gear, 'settings-2');
      gear.onclick = (e) => { e.stopPropagation(); new NexusScratchConfigModal(this.plugin, this, item).open(); };
    }
    const body = card.createDiv('nx-home-card-body nx-scratch-body');
    const ta = body.createEl('textarea', { cls: 'nx-scratch-input' });
    ta.placeholder = 'Start writing …';
    ta.value = this._qnDraft[item.uid] || '';
    ta.oninput = () => { this._qnDraft[item.uid] = ta.value; };
    const bar = body.createDiv('nx-scratch-bar');
    const btn = bar.createEl('button', { cls: 'nx-scratch-save', text: 'Save' });
    btn.onclick = async () => {
      const text = ta.value.trim();
      if (!text) { new Notice('Nexus: nothing to save yet.'); return; }
      await this._saveScratch(item, text);
      this._qnDraft[item.uid] = ''; ta.value = '';
    };
  }
  async _saveScratch(item, text) {
    const file = await scratch.saveScratch(this.app, item, text);
    new Notice('Scratch saved: ' + file.basename);
  }
  _wImage(card, item) {
    card.addClass('nx-home-imgcard');
    if (item.border === false) card.addClass('nx-noborder');
    const img = card.createEl('img', { cls: 'nx-home-imgcard-img' });
    img.draggable = false;   // otherwise the browser drags the image instead of the card
    // Slideshow: prefer the images[] list; fall back to the legacy single src.
    const list = (Array.isArray(item.images) && item.images.length) ? item.images : (item.src ? [item.src] : []);
    let idx = 0;
    const show = (i) => { const s = this.plugin.resolveBannerSrc(list[i] || '', ''); if (s) img.src = s; };
    if (list.length) show(0);
    img.alt = item.caption || '';
    // Zoom & crop: fit (cover = fill the card completely; contain = no crop)
    img.style.objectFit = item.fit || 'cover';
    img.style.objectPosition = (item.posX != null ? item.posX : 50) + '% ' + (item.posY != null ? item.posY : 50) + '%';
    img.style.transform = 'scale(' + (item.zoom || 1) + ')';
    if (list.length > 1) {
      // Advance via the shared 1 s liveEls tick (no extra timer). elapsed counts
      // seconds so the interval is per-widget; idx is shared with the click handler.
      const interval = Math.max(1, item.interval || 5);
      let elapsed = 0;
      card.addClass('nx-home-imgcard-slideshow');
      this._liveEls.push(() => { if (++elapsed >= interval) { elapsed = 0; idx = (idx + 1) % list.length; show(idx); } });
    }
    if (item.caption) card.createDiv({ cls: 'nx-home-imgcard-cap', text: item.caption });
    // Clickable (default on). Off → pure display image. Never navigate while editing.
    if (item.clickable !== false && !this._editing) {
      card.addClass('nx-home-imgcard-clickable');
      card.onclick = () => { const t = item.link || list[idx] || item.src; if (t) this._openTarget(t); };
    } else {
      card.onclick = null;
    }
  }
  /* ---- Random note ---------------------------------------------------------
     One note out of the filtered set, shown with a real preview — the point is
     to run into what you wrote months ago, so the draw happens when the
     dashboard is OPENED (not on every repaint: the view re-renders on a timer
     and on every vault event, which would make the card flicker through the
     vault). _randomPick therefore holds the current draw per card. ---- */
  _randomFiles(item) {
    const clean = (s) => this._expandTokens(s).split(',').map(x => x.trim().replace(/^\/|\/$/g, '')).filter(Boolean);
    const inc = clean(item.folders), exc = clean(item.exclude);
    const name = this._expandTokens(item.name).trim().toLowerCase();
    const minAge = Math.max(0, parseInt(item.minAge, 10) || 0);
    const cutoff = minAge ? moment().subtract(minAge, 'day').valueOf() : 0;
    return this.app.vault.getMarkdownFiles().filter(f => {
      if (inc.length && !inc.some(p => f.path === p + '.md' || f.path.startsWith(p + '/'))) return false;
      if (exc.length && exc.some(p => f.path === p + '.md' || f.path.startsWith(p + '/'))) return false;
      if (String(item.tags || '').trim() && !this._tagMatch(f, this._expandTokens(item.tags))) return false;
      if (name && !f.basename.toLowerCase().includes(name)) return false;
      if (Array.isArray(item.propGroups) && item.propGroups.length && !this._propGroupsMatch(f, item.propGroups)) return false;
      if (cutoff && f.stat.mtime > cutoff) return false;
      return true;
    });
  }
  _randomFile(item) {
    const uid = item.uid;
    const today = moment().format('YYYY-MM-DD');
    // "Once per day" has to survive a restart → it lives in the card itself.
    if ((item.mode || 'open') === 'day' && item.lastPick && item.lastPick.date === today) {
      const f = this.app.vault.getAbstractFileByPath(item.lastPick.path);
      if (f) return f;
    }
    const held = this._randomPick[uid];
    if (held) {
      const f = this.app.vault.getAbstractFileByPath(held);
      if (f) return f;
    }
    const pool = this._randomFiles(item);
    if (!pool.length) return null;
    const f = pool[Math.floor(Math.random() * pool.length)];
    this._randomPick[uid] = f.path;
    if ((item.mode || 'open') === 'day') {
      item.lastPick = { date: today, path: f.path };
      this.plugin.saveSettings();
    }
    return f;
  }
  _wRandom(card, item) {
    card.addClass('nx-home-random');
    const head = card.createDiv('nx-home-card-head');
    setIcon(head.createSpan('nx-home-card-icon'), item.icon || 'shuffle');
    head.createSpan({ cls: 'nx-home-card-title', text: item.title || 'Random note' });
    const shuffle = head.createSpan('nx-home-card-gear');
    setIcon(shuffle, 'shuffle');
    shuffle.setAttribute('aria-label', 'Draw another note');
    shuffle.onclick = (e) => { e.stopPropagation(); this._randomPick[item.uid] = null; item.lastPick = null; this.render(); };
    if (this._editing) {
      const gear = head.createSpan('nx-home-card-gear');
      setIcon(gear, 'settings-2');
      gear.onclick = (e) => { e.stopPropagation(); new NexusRandomConfigModal(this.plugin, this, item).open(); };
    }
    const body = card.createDiv('nx-home-card-body nx-random-body');
    const file = this._randomFile(item);
    if (!file) { this._empty(body, 'No note matches this filter.'); return; }

    if (item.showBanner !== false) {
      const fm = this._fm(file);
      const src = this.plugin.resolveBannerSrc(fm.banner || fm.cover || '', file.path);
      if (src) {
        const b = body.createDiv('nx-random-banner');
        b.style.backgroundImage = 'url("' + src.replace(/"/g, '\\"') + '")';
        b.onclick = () => this._open(file);
      }
    }
    const t = body.createDiv({ cls: 'nx-random-title', text: file.basename });
    t.onclick = () => this._open(file);
    if (item.showMeta !== false) {
      const dir = file.parent && file.parent.path && file.parent.path !== '/' ? file.parent.path : '/';
      body.createDiv({ cls: 'nx-random-meta', text: dir + ' · ' + moment(file.stat.mtime).format('D MMM YYYY') });
    }
    const lines = item.lines == null ? 20 : item.lines;
    if (lines <= 0) return;
    const prev = body.createDiv('nx-random-preview');
    prev.onclick = () => this._open(file);
    this.app.vault.cachedRead(file).then(txt => {
      if (!prev.isConnected) return;
      // Frontmatter is metadata, not writing — the preview starts at the prose.
      const src = stripFrontmatter(txt).split('\n').slice(0, lines).join('\n');
      renderMd(this.plugin, src || '*(empty note)*', prev, file.path);
    }).catch(() => {});
  }
  _wClock(card, item) {
    const box = card.createDiv('nx-home-live nx-clock');
    const time = box.createDiv('nx-clock-time');
    const date = box.createDiv('nx-clock-date');
    const upd = () => {
      time.setText(moment().format(item.seconds ? 'HH:mm:ss' : 'HH:mm'));
      date.setText(moment().format(item.dateFmt || 'dddd, D. MMMM'));
    };
    upd(); this._liveEls.push(upd);
  }
  _wTimer(card, item) {
    // Shared timer logic in the plugin (state survives leaving the dashboard).
    // The edit icon allows setting the time in ANY mode (normal too).
    const paint = this.plugin.buildTimer(card, item.uid, { minutes: item.minutes }, async (n) => {
      item.minutes = n; await this.plugin.saveSettings();
    });
    this._liveEls.push(paint);
  }
  _wWeather(card, item) {
    const box = card.createDiv('nx-home-live nx-weather');
    if (!item.lat || !item.lon) { box.createDiv({ cls: 'nx-home-empty', text: 'Set location: right-click → Location …' }); return; }
    box.createDiv({ cls: 'nx-weather-label', text: item.label || 'Weather' });
    const iconEl = box.createDiv('nx-weather-icon');
    const temp = box.createDiv({ cls: 'nx-weather-temp', text: '…' });
    const desc = box.createDiv({ cls: 'nx-weather-desc', text: '' });
    const fill = (d) => { temp.setText(Math.round(d.temp) + '°'); desc.setText(d.desc); setIcon(iconEl, WMO_ICON[d.code] || 'cloud'); };
    const cache = this._weatherCache[item.uid];
    if (cache && Date.now() - cache.ts < 15 * 60 * 1000) { fill(cache.data); return; }
    fetch('https://api.open-meteo.com/v1/forecast?latitude=' + item.lat + '&longitude=' + item.lon + '&current=temperature_2m,weather_code')
      .then(r => r.json()).then(j => {
        const c = j.current || {};
        const data = { temp: c.temperature_2m, code: c.weather_code, desc: WMO[c.weather_code] || '' };
        this._weatherCache[item.uid] = { ts: Date.now(), data };
        fill(data);
      }).catch(() => temp.setText('—'));
  }
}

module.exports = HomeWidgets;
