/* Minimal stand-in for Obsidian's runtime, enough to drive _buildSketchBar in
   a real browser: the DOM is real, only the app shell is faked. */
class Plugin { constructor(app, manifest) { this.app = app; this.manifest = manifest; } }
/* The settings tab, Setting, Modal and ItemView carry just enough real DOM for
   test/smoke.html to render every settings page and dialog: each control is a
   fluent object whose unknown methods return itself, so a page that calls
   something new does not crash here before it can crash for a real reason. */
class PluginSettingTab {
  constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = document.createElement('div'); }
}
function control(host) {
  const el = (tag, cls) => host.createEl(tag, { cls });
  const state = { value: undefined, change: null, click: null };
  const named = {
    inputEl: () => el('input'), textAreaEl: () => el('textarea'), selectEl: () => el('select'),
    buttonEl: () => el('button'), toggleEl: () => el('div', 'checkbox-container'),
    sliderEl: () => el('input'), extraSettingsEl: () => el('div', 'clickable-icon'),
  };
  const cache = {};
  const proxy = new Proxy(state, {
    get(target, key) {
      if (key in named) return cache[key] || (cache[key] = named[key]());
      if (key === 'getValue') return () => state.value;
      if (key === 'setValue') return (v) => { state.value = v; return proxy; };
      if (key === 'onChange') return (fn) => { state.change = fn; return proxy; };
      if (key === 'onClick') return (fn) => { state.click = fn; return proxy; };
      if (key === 'then') return undefined;            // not a thenable
      if (key === '__state') return state;
      return () => proxy;
    },
  });
  return proxy;
}
class Setting {
  constructor(containerEl) {
    this.settingEl = (containerEl || document.createElement('div')).createDiv('setting-item');
    this.infoEl = this.settingEl.createDiv('setting-item-info');
    this.nameEl = this.infoEl.createDiv('setting-item-name');
    this.descEl = this.infoEl.createDiv('setting-item-description');
    this.controlEl = this.settingEl.createDiv('setting-item-control');
    this.components = [];
  }
  _text(el, v) { if (v instanceof Node) el.appendChild(v); else el.textContent = v == null ? '' : String(v); return this; }
  setName(v) { return this._text(this.nameEl, v); }
  setDesc(v) { return this._text(this.descEl, v); }
  setClass(c) { this.settingEl.addClass(c); return this; }
  setHeading() { this.settingEl.addClass('setting-item-heading'); return this; }
  setTooltip() { return this; }
  setDisabled() { return this; }
  then(fn) { fn(this); return this; }
}
for (const kind of ['Toggle', 'Text', 'TextArea', 'Dropdown', 'Button', 'ExtraButton', 'Slider',
  'ColorPicker', 'Search', 'MomentFormat', 'ProgressBar']) {
  Setting.prototype['add' + kind] = function (fn) {
    const c = control(this.controlEl); this.components.push(c); if (fn) fn(c); return this;
  };
}
class Modal {
  constructor(app) {
    this.app = app;
    this.modalEl = document.createElement('div');
    this.titleEl = this.modalEl.createDiv('modal-title');
    this.contentEl = this.modalEl.createDiv('modal-content');
    this.scope = { register() {}, unregister() {} };
  }
  setTitle(t) { this.titleEl.textContent = t; return this; }
  open() { this.isOpen = true; if (this.onOpen) return this.onOpen(); }
  close() { this.isOpen = false; if (this.onClose) this.onClose(); }
}
class ItemView {
  constructor(leaf) {
    this.leaf = leaf;
    this.app = leaf && leaf.app;      // as in Obsidian: a view reaches the app through its leaf
    this.containerEl = document.createElement('div');
    this.containerEl.createDiv('view-header');
    this.contentEl = this.containerEl.createDiv('view-content');
  }
  register() {}
  registerEvent() {}
  registerDomEvent(el, type, fn, opts) { el.addEventListener(type, fn, opts); }
  registerInterval(id) { return id; }
  addAction() { return document.createElement('div'); }
}
class Notice { constructor(msg) { (window.__notices = window.__notices || []).push(msg); } }
class TFile {}
class TFolder {}
class TAbstractFile {}
class Component {}
/* Obsidian ties a rendered code block's lifetime to one of these: onunload fires
   when the element goes away. The plugin uses it to stop a sketch pad's timers. */
class MarkdownRenderChild extends Component {
  constructor(containerEl) { super(); this.containerEl = containerEl; }
  onload() {}
  onunload() {}
}
class MarkdownView {}
class FuzzySuggestModal {}
class SuggestModal {}
class EditorSuggest {}
/* A menu records what it was given and where it was shown (window.__menus),
   so a test can assert on a menu nobody can see. */
class MenuItem {
  setTitle(t) { this.title = t; return this; }
  setIcon(i) { this.icon = i; return this; }
  onClick(fn) { this.click = fn; return this; }
  setChecked(v) { this.checked = v; return this; }
  setDisabled(v) { this.disabled = v; return this; }
  setSection() { return this; }
  setWarning() { return this; }
}
class Menu {
  constructor() { this.items = []; }
  addItem(fn) { const item = new MenuItem(); fn(item); this.items.push(item); return this; }
  addSeparator() { return this; }
  showAtPosition(at) { this.shownAt = at; (window.__menus = window.__menus || []).push(this); return this; }
  showAtMouseEvent(e) { return this.showAtPosition({ x: e.clientX, y: e.clientY }); }
  hide() { return this; }
  onHide() { return this; }
}
class ButtonComponent {}
class Platform {}
/* Enough of moment for the code under test. Called with NO argument it is a
   fixed instant, so a timestamp written into frontmatter is a real string an
   assertion can check — several pages depend on exactly that. Called WITH a
   date it is a real calendar day that can be cloned, stepped and compared,
   which is what anything walking a range needs. */
const FIXED = '2026-01-02T03:04';
const PAD = (n) => String(n).padStart(2, '0');
function calendarDay(y, m, d) {
  const at = new Date(Date.UTC(y, m, d));
  const self = {
    _at: at,
    clone: () => calendarDay(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
    add(n, unit) {
      if (unit === 'month') at.setUTCMonth(at.getUTCMonth() + n);
      else at.setUTCDate(at.getUTCDate() + (unit === 'week' ? n * 7 : n));
      return self;
    },
    format: (f) => String(f || 'YYYY-MM-DD')
      .replace(/YYYY/g, String(at.getUTCFullYear()))
      .replace(/MM/g, PAD(at.getUTCMonth() + 1))
      .replace(/DD/g, PAD(at.getUTCDate())),
    valueOf: () => at.getTime(),
    isValid: () => !isNaN(at.getTime()),
    isSame: (other) => at.getTime() === other.valueOf(),
    isBefore: (other) => at.getTime() < other.valueOf(),
    isAfter: (other) => at.getTime() > other.valueOf(),
    isSameOrBefore: (other) => at.getTime() <= other.valueOf(),
    isSameOrAfter: (other) => at.getTime() >= other.valueOf(),
    startOf: () => self,
    endOf: () => self,
    month: () => at.getUTCMonth(),
    date: () => at.getUTCDate(),
    toISOString: () => at.toISOString(),
  };
  return self;
}
function moment(value) {
  if (value == null) {
    return {
      format: (f) => (f === 'HHmm' ? FIXED.slice(11).replace(':', '') : f && f.indexOf('T') < 0 ? FIXED.slice(0, 10) : FIXED),
      isValid: () => true,
      add() { return this; },
      subtract() { return this; },
      from: () => 'a while ago',
      fromNow: () => 'a while ago',
      toISOString: () => FIXED + ':00.000Z',
      // Enough for the dashboard's clock and greeting (test/smoke.html).
      hour: () => 3, minute: () => 4, second: () => 0, day: () => 5, date: () => 2,
      month: () => 0, year: () => 2026, weekday: () => 5, isoWeekday: () => 5,
      valueOf: () => Date.UTC(2026, 0, 2, 3, 4),
      clone() { return moment(); }, startOf() { return this; }, endOf() { return this; },
      diff: () => 0, isSame: () => true, isBefore: () => false, isAfter: () => false,
      locale: () => 'en',
    };
  }
  const m = /^(\d{4})\D(\d{2})\D(\d{2})/.exec(String(value));
  if (!m) throw new Error('the moment stub only understands YYYY?MM?DD, got ' + value);
  return calendarDay(+m[1], +m[2] - 1, +m[3]);
}
moment.locale = () => 'en';
moment.weekdays = () => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
moment.weekdaysShort = () => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
moment.weekdaysMin = () => ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
moment.months = () => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
moment.monthsShort = () => moment.months().map(m => m.slice(0, 3));
moment.localeData = () => ({ firstDayOfWeek: () => 1 });
const requestUrl = async () => ({ status: 200, text: '', json: {} });
const normalizePath = (p) => p;
const debounce = (fn) => fn;
const setTooltip = () => {};
const parseYaml = () => ({});
const stringifyYaml = () => '';
const addIcon = () => {};
const getIcon = () => null;
/* Icons are the one thing that must be observable: the tests assert on which
   icon a button got, so record it as a data attribute instead of drawing SVG. */
function setIcon(el, name) {
  el.dataset.icon = name;
  el.innerHTML = '<span class="svg-icon"></span>';
}
/* A workspace with real leaves. Only what the startup paths touch, but that is
   the point: which leaf setViewState was called on, and in what order things
   happened, is the whole assertion. `events` records both, so "closes first,
   then opens" can be proven rather than assumed. */
function makeWorkspace(viewTypes) {
  const workspace = {
    leaves: [], revealed: [], events: [], splits: [], newTabs: 0, activeIndex: 0,
    addLeaf(type) {
      const leaf = {
        viewType: type, detached: false, pinned: false, stateCalls: [],
        view: { getViewType: () => leaf.viewType },
        async setViewState(state) {
          // A real one crosses at least one microtask; without that hop a race
          // between two callers cannot be reproduced here at all.
          await Promise.resolve();
          leaf.stateCalls.push(state);
          leaf.viewType = state.type;
          workspace.events.push('open:' + state.type);
        },
        setPinned(on) { leaf.pinned = on; },
        detach() {
          leaf.detached = true;
          workspace.events.push('close:' + leaf.viewType);
          workspace.leaves = workspace.leaves.filter(other => other !== leaf);
        },
      };
      workspace.leaves.push(leaf);
      return leaf;
    },
    getLeavesOfType(type) { return workspace.leaves.filter(leaf => leaf.viewType === type); },
    getLeaf(newLeaf) {
      if (newLeaf) { workspace.newTabs++; return workspace.addLeaf('empty'); }
      return workspace.leaves[workspace.activeIndex] || workspace.addLeaf('empty');
    },
    createLeafBySplit(anchor, dir, before) {
      workspace.splits.push({ dir, before: !!before });
      return workspace.addLeaf('empty');
    },
    getMostRecentLeaf() { return workspace.leaves[workspace.activeIndex] || null; },
    revealLeaf(leaf) { workspace.revealed.push(leaf); },
    iterateRootLeaves(fn) { workspace.leaves.slice().forEach(fn); },
    onLayoutReady(fn) { fn(); },
    on() { return {}; },
  };
  (viewTypes || []).forEach(type => workspace.addLeaf(type));
  return workspace;
}

module.exports = {
  makeWorkspace,
  Plugin, PluginSettingTab, Setting, Modal, ItemView, Notice, TFile, TFolder,
  TAbstractFile, Component, MarkdownRenderChild, MarkdownView, FuzzySuggestModal, SuggestModal, Menu,
  MenuItem, ButtonComponent, Platform, EditorSuggest, moment, requestUrl, normalizePath,
  debounce, setIcon, setTooltip, parseYaml, stringifyYaml, addIcon, getIcon,
  MarkdownRenderer: { render: async () => {}, renderMarkdown: async () => {} },
};
