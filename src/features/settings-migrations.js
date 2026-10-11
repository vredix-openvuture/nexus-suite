'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · loading settings
 *  loadSettings and the one-off migrations it runs: removed modules, renamed
 *  keys, the old scratch cards. Mixed into the plugin class (lib/mixin.js).
 * ========================================================================== */

const { Notice, moment } = require('obsidian');
const { DEFAULT_SETTINGS, PEN_IDS } = require('../constants.js');
const deviceSettings = require('../lib/devicesettings.js');
const { NexusConfirmModal } = require('../modals/misc.js');

class SettingsMigrations {

  /* ---- Settings ---- */
  /* `raw` is a data.json already in hand (adoptIncomingSettings); without it
     the file is read. */
  async loadSettings(raw) {
    const data = raw !== undefined ? raw : await this.loadData();
    // What is on disk now, for onExternalSettingsChange (see main.js).
    if (raw === undefined && data) this._lastWrittenSettings = JSON.parse(JSON.stringify(data));
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    // ensure deep defaults per module
    for (const k of Object.keys(DEFAULT_SETTINGS))
      this.settings[k] = Object.assign({}, DEFAULT_SETTINGS[k], (data && data[k]) || {});
    { // The merge is one level deep: copy the book-capture lists so edits never reach the defaults.
      const bc = this.settings.bookCapture;
      bc.profiles = (bc.profiles || []).map(p => Object.assign({}, p));
      bc.sources = (bc.sources || []).map(x => Object.assign({}, x));
      for (const d of DEFAULT_SETTINGS.bookCapture.sources)
        if (!bc.sources.some(x => x.id === d.id)) bc.sources.push(Object.assign({}, d, { on: true }));
    }
    /* Migration: the sync connection and its schedule were vault-wide, so every device read the one the last sync happened to
       deliver. They move into this device's bag; the vault-wide keys are left
       untouched, because the OTHER device reads the same data.json and still
       has to migrate its own copy. */
    deviceSettings.migrateDeviceSettings(this.settings, this.deviceId());
    this.migrateScratchCards();
    // Migration: old image cards (homepage.images) → widget system
    const hp = this.settings.homepage;
    /* Migration: the startup toggle became a three-way choice. Read from the
       SAVED data, not from hp — the default has already been merged in by now,
       so hp.startup is never missing. */
    const savedHome = (data && data.homepage) || {};
    if (savedHome.startup === undefined && savedHome.openOnStartup !== undefined) {
      hp.startup = savedHome.openOnStartup === false ? 'off' : 'tab';
    }
    delete hp.openOnStartup;
    if (hp.images && hp.images.length && (!hp.widgets || !hp.widgets.length)) {
      hp.widgets = hp.images.map(it => Object.assign({ type: 'image', uid: 'w' + Math.random().toString(36).slice(2, 9) }, it));
    }
    hp.images = [];
    (hp.widgets || []).forEach(w => { if (!w.uid) w.uid = 'w' + Math.random().toString(36).slice(2, 9); });
    // Migration: quicksketch single palette → named palettes. If the vault has a
    // customised flat `palette` but no `palettes` yet, seed "Default" from it and
    // keep `palette` as an ALIAS of the active palette's colours array.
    const qs = this.settings.quicksketch;
    if (qs) {
      const hadPalettes = !!(data && data.quicksketch && Array.isArray(data.quicksketch.palettes) && data.quicksketch.palettes.length);
      if (!hadPalettes && Array.isArray(qs.palette) && qs.palette.length) {
        qs.palettes = [{ name: 'Default', colors: qs.palette.slice(0, 8) }];
      }
      if (!Array.isArray(qs.palettes) || !qs.palettes.length) qs.palettes = [{ name: 'Default', colors: ['#2f2f2f'] }];
      if (qs.activePalette == null || qs.activePalette >= qs.palettes.length) qs.activePalette = 0;
      qs.palette = qs.palettes[qs.activePalette].colors;
      // Migration: one shared favourites triplet → one PER PEN. A 10px marker
      // and a 2px pencil never wanted the same three quick widths.
      const DEF_FAV = [1.5, 3, 8];
      if (!qs.sizeFavorites || Array.isArray(qs.sizeFavorites)) {
        const base = (Array.isArray(qs.sizeFavorites) && qs.sizeFavorites.length) ? qs.sizeFavorites.slice(0, 3) : DEF_FAV;
        const per = {};
        PEN_IDS.forEach(p => { per[p] = (p === 'marker' ? [6, 10, 18] : base).slice(0, 3); });
        qs.sizeFavorites = per;
      }
      PEN_IDS.forEach(p => {
        const v = qs.sizeFavorites[p];
        if (!Array.isArray(v) || !v.length) qs.sizeFavorites[p] = (p === 'marker' ? [6, 10, 18] : DEF_FAV).slice();
      });
    }
    // Migration: fixed ink sources (paper/saber/butterfly as an object) → a
    // user-defined LIST. Only "paper" stays mandatory (the in-app camera).
    const ink = this.settings.inkCapture;
    if (ink) {
      if (ink.sources && !Array.isArray(ink.sources)) {
        const LABEL = { paper: 'Paper (camera)', saber: 'Saber', butterfly: 'Butterfly' };
        ink.sources = Object.entries(ink.sources).map(([id, src]) => ({
          id, label: LABEL[id] || id, folder: (src && src.folder) || ('Inbox/' + id), enabled: !src || src.enabled !== false,
        }));
      }
      if (!Array.isArray(ink.sources)) ink.sources = [];
      if (!ink.sources.some(x => x && x.id === 'paper'))
        ink.sources.unshift({ id: 'paper', label: 'Paper (camera)', folder: 'Inbox/Paper', enabled: true });
    }
    /* The default columns used to be German, and a default is written into
       data.json the first time anything saves — so changing the default alone
       would leave every vault that ever opened the settings on "In Arbeit".
       An untouched set is rewritten once; columns anybody picked are theirs and
       are never renamed. `bucketsTranslated` marks it done. */
    if (!this.settings.bucketsTranslated) {
      const same = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);
      const kb = this.settings.kanban;
      if (kb && same(kb.buckets, ['Backlog', 'In Arbeit', 'Erledigt'])) {
        kb.buckets = DEFAULT_SETTINGS.kanban.buckets.slice();
      }
      this.settings.bucketsTranslated = true;
    }
    /* The Board module became the folder source of the kanban board. Its one
       setting moves along, so a vault that had chosen a status property keeps
       it — the defaults are already merged in by now, so "untouched" is the
       default value, not a missing key. The board key itself goes: nothing
       reads it any more. */
    if (this.settings.board) {
      const kanban = this.settings.kanban;
      const chosen = this.settings.board.statusProperty;
      // Read from the SAVED data: kanban.statusProperty did not exist before
      // this change, so a value there can only be one the user set afterwards
      // — and only then does it outrank what the Board page held.
      const already = ((data && data.kanban) || {}).statusProperty;
      if (kanban && chosen && already === undefined) kanban.statusProperty = chosen;
      delete this.settings.board;
    }
    this.dropTasksCalendar(data);
  }


  /* The tasksCalendar module was removed (docs/removed-features.md). What a
     saved data.json still holds of it is dropped here so nothing reads it by
     accident — except the two values that outlived it: weekStart and dayTextKey
     now belong to the mini calendar and the planner, so a value the user set
     moves to settings.calendar unless one is already saved there. The Vikunja
     tokens in this device's localStorage go too: a secret for an account
     nothing can use any more is a leftover, not a convenience. Task and project
     notes in the vault are NOT touched — they stay ordinary notes. */
  dropTasksCalendar(data) {
    const old = this.settings.tasksCalendar;
    const savedCalendar = (data && data.calendar) || {};
    if (old && typeof old === 'object') {
      for (const key of ['weekStart', 'dayTextKey']) {
        if (savedCalendar[key] === undefined && old[key] !== undefined) this.settings.calendar[key] = old[key];
      }
    }
    const accountIds = new Set();
    const collect = (list) => (Array.isArray(list) ? list : []).forEach(a => { if (a && a.id) accountIds.add(String(a.id)); });
    if (old && typeof old === 'object') { collect(old.accounts); collect(old.accountsBeforeDeviceStore); }
    for (const bag of Object.values(this.settings.devices || {})) {
      if (!bag || typeof bag !== 'object') continue;
      collect(bag.taskAccounts);
      delete bag.taskAccounts;
    }
    accountIds.delete('vaultsync');   // never the vault-sync credential, whatever an id says
    for (const id of accountIds) {
      // Not for a file adopted from another device: its leftovers are not this device's.
      if (!this._adoptingSettings) { try { window.localStorage.removeItem(this.credKey(id)); } catch (e) { /* no storage here */ } }
    }
    delete this.settings.tasksCalendar;
    // The calendar page was the other pinnable tab; only the dashboard is left.
    if (this.settings.pinnedTabs) delete this.settings.pinnedTabs.calendar;
    this.dropTaskCards();
  }
  /* The dashboard's calendar and tasks cards read the removed module. A stored
     card of either type would render as an empty frame, so it goes — in every
     profile, because data.json travels between devices. */
  dropTaskCards() {
    const home = this.settings.homepage;
    if (!home) return;
    const keep = (list) => (Array.isArray(list) ? list.filter(c => !c || (c.type !== 'calendar' && c.type !== 'tasks')) : list);
    home.widgets = keep(home.widgets);
    for (const profile of Object.values(home.profiles || {})) if (profile && profile.widgets) profile.widgets = keep(profile.widgets);
  }

  /* ---- Per-device dashboard -------------------------------------------------
     The device ID lives in localStorage (per device/installation, NOT in the
     vault → NOT synced by Syncthing). The dashboard documents live in
     homepage.profiles[deviceId] and do sync — but each device reads only its
     own entry. hp() returns the active document:
       perDevice OFF → the shared top-level homepage (behavior as before);
       perDevice ON  → the device profile (cloned from the shared document on
                       first access). */
  /* The dashboard's pad used to be called "quicknote" and shared that word with
     the module you speak into. The card is now "scratch"; a stored card still
     carrying the old type would simply not render, so it is renamed on load.
     Every profile is walked, not just this device's — data.json travels. */
  migrateScratchCards() {
    const home = this.settings.homepage;
    if (!home) return;
    const rename = (list) => {
      if (!Array.isArray(list)) return 0;
      let n = 0;
      for (const card of list) {
        if (!card || card.type !== 'quicknote') continue;
        card.type = 'scratch';
        if (card.title === 'Quicknote') card.title = 'Scratch';
        n++;
      }
      return n;
    };
    let moved = rename(home.widgets);
    for (const profile of Object.values(home.profiles || {})) moved += rename(profile && profile.widgets);
    if (moved) console.log('[Nexus] renamed ' + moved + ' quicknote card(s) to scratch');
  }

  /* The planner used to keep a day's line in its own fence; it now reads the
     same field the calendar writes. This carries what is already written over —
     on request, because it creates a daily note per day that has none. */
  async migratePlannerLines() {
    const plannerMigrate = require('../lib/plannermigrate.js');
    new Notice('Nexus: looking through the planner blocks…');
    let plan;
    try { plan = await plannerMigrate.scan(this.app, this, moment); }
    catch (e) { new Notice('Nexus: could not read the planner blocks — ' + ((e && e.message) || e)); return; }
    if (!plan.move.length && !plan.clash.length) { new Notice(plannerMigrate.describe(plan)); return; }
    const go = await new NexusConfirmModal(this.app, 'Move planner lines into the daily notes',
      plannerMigrate.describe(plan), 'Move them').openAndGet();
    if (!go) return;
    const res = await plannerMigrate.apply(this.app, this, moment, plan);
    this.settings.plannerMigrated = true;
    await this.saveSettings();
    if (typeof this.refreshCalendarViews === 'function') this.refreshCalendarViews();
    const lines = [res.written + ' day(s) written.'];
    if (plan.clash.length) lines.push(plan.clash.length + ' left alone (their note already had a text).');
    if (res.failed.length) lines.push('Failed: ' + res.failed.slice(0, 5).join('; '));
    new Notice('Nexus\n' + lines.join('\n'), 12000);
  }
}

module.exports = SettingsMigrations;
