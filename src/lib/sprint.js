'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · writing sprint
 *  A timed run with a word goal. State lives on the PLUGIN, not on a view, so
 *  the sprint survives switching notes, closing the tab or opening the
 *  dashboard — the same reason the timers work that way.
 *
 *  Words are counted as a DELTA against the count at the start, per file. Only
 *  what you add during the sprint counts; deleting takes it away again, and
 *  switching to another note keeps adding to the same total.
 * ========================================================================== */

const { MarkdownView, Modal, Notice, moment, setIcon } = require('obsidian');

const countWords = (text) => {
  if (!text) return 0;
  // Strip frontmatter and code fences: neither is prose you wrote just now.
  let t = String(text).replace(/^---\n[\s\S]*?\n---\n?/, '');
  t = t.replace(/```[\s\S]*?```/g, ' ');
  // A token has to START with a letter or digit — otherwise a bare list dash
  // or a stray hyphen counts as a word and every bulleted line inflates the
  // score.
  const m = t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
};

class NexusSprint {
  constructor(plugin) { this.plugin = plugin; this.app = plugin.app; this.run = null; }
  get s() { return this.plugin.settings.sprint; }

  init() {
    const p = this.plugin;
    p.addCommand({ id: 'nexus-start-sprint', name: 'Start a writing sprint', callback: () => this.open() });
    p.addCommand({ id: 'nexus-stop-sprint', name: 'Stop the writing sprint', callback: () => this.finish(true) });

    p.registerEvent(this.app.workspace.on('editor-change', () => this.recount()));
    p.registerEvent(this.app.workspace.on('active-leaf-change', () => this.baseline()));
    p.registerInterval(window.setInterval(() => this.tick(), 1000));
  }

  open() {
    if (this.run) { new Notice('A sprint is already running.'); return; }
    new NexusSprintStartModal(this.plugin, (cfg) => this.start(cfg)).open();
  }

  async start(cfg) {
    this.run = {
      startedAt: Date.now(),
      endsAt: cfg.useTime ? Date.now() + cfg.minutes * 60000 : null,
      minutes: cfg.minutes, goal: cfg.useWords ? cfg.words : 0,
      base: new Map(),          // path → word count when the sprint first saw it
      written: 0,
      focusWasOn: null,
    };
    // Optionally pull the focus mode in for the duration and put it back after.
    if (cfg.withFocus && this.plugin.focus) {
      this.run.focusWasOn = !!this.plugin.settings.focus.enabled;
      this.plugin.settings.focus.enabled = true;
      this.plugin.focus.apply();
    }
    this.baseline();
    this.paint();
    new Notice('Sprint started' + (cfg.useTime ? ' — ' + cfg.minutes + ' min' : '') + (cfg.useWords ? ', ' + cfg.words + ' words' : ''));
  }

  /* Remember the starting count for whatever file is in front of us now. */
  baseline() {
    if (!this.run) return;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file || !view.editor) return;
    if (!this.run.base.has(view.file.path)) this.run.base.set(view.file.path, countWords(view.editor.getValue()));
    this.recount();
  }
  recount() {
    if (!this.run) return;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file || !view.editor) return;
    const path = view.file.path;
    if (!this.run.base.has(path)) this.run.base.set(path, countWords(view.editor.getValue()));
    const now = countWords(view.editor.getValue());
    this.run.current = this.run.current || new Map();
    this.run.current.set(path, now);
    let total = 0;
    for (const [p, start] of this.run.base) {
      const cur = this.run.current.has(p) ? this.run.current.get(p) : start;
      total += cur - start;
    }
    this.run.written = total;
    this.paint();
    if (this.run.goal && total >= this.run.goal && !this.run.endsAt) this.finish(false);
  }

  tick() {
    if (!this.run) return;
    this.paint();
    if (this.run.endsAt && Date.now() >= this.run.endsAt) this.finish(false);
  }

  paint() {
    if (!this.s || this.s.statusBar === false) { this.clearBar(); return; }
    if (!this.run) { this.clearBar(); return; }
    if (!this._bar) {
      this._bar = this.plugin.addStatusBarItem();
      this._bar.addClass('nx-sprint-bar');
      this._bar.onclick = () => this.finish(true);
      this._bar.setAttribute('aria-label', 'Writing sprint — click to stop');
    }
    this._bar.empty();
    const r = this.run;
    if (r.endsAt) {
      const left = Math.max(0, r.endsAt - Date.now());
      const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
      setIcon(this._bar.createSpan('nx-sprint-icon'), 'timer');
      this._bar.createSpan({ cls: 'nx-sprint-time', text: mm + ':' + String(ss).padStart(2, '0') });
    }
    if (r.goal) {
      const pct = Math.max(0, Math.min(1, r.written / r.goal));
      const track = this._bar.createSpan('nx-sprint-track');
      track.createSpan('nx-sprint-fill').style.width = (pct * 100).toFixed(1) + '%';
      this._bar.createSpan({ cls: 'nx-sprint-count', text: r.written + '/' + r.goal + ' W' });
      this._bar.toggleClass('is-done', r.written >= r.goal);
    } else {
      this._bar.createSpan({ cls: 'nx-sprint-count', text: r.written + ' W' });
    }
  }
  clearBar() { if (this._bar) { this._bar.remove(); this._bar = null; } }

  finish(manual) {
    const r = this.run;
    if (!r) return;
    this.run = null;
    this.clearBar();
    if (r.focusWasOn !== null && this.plugin.focus) {
      this.plugin.settings.focus.enabled = r.focusWasOn;
      this.plugin.focus.apply();
      this.plugin.saveSettings();
    }
    const secs = Math.max(1, Math.round((Date.now() - r.startedAt) / 1000));
    new NexusSprintDoneModal(this.plugin, {
      words: r.written, goal: r.goal, seconds: secs, manual,
      reached: r.goal ? r.written >= r.goal : true,
    }).open();
  }

  unload() { this.clearBar(); }
}

/* ---- start dialog -------------------------------------------------------- */
class NexusSprintStartModal extends Modal {
  constructor(plugin, onStart) { super(plugin.app); this.plugin = plugin; this.onStart = onStart; }
  onOpen() {
    const { contentEl } = this;
    const s = this.plugin.settings.sprint;
    contentEl.addClass('nx-sprint-modal');
    contentEl.createEl('h3', { text: 'Writing sprint' });

    const cfg = {
      minutes: s.minutes || 15, words: s.words || 300,
      useTime: s.useTime !== false, useWords: s.useWords !== false,
      withFocus: !!s.focusDuringSprint,
    };
    const row = (label, key, unit) => {
      const wrap = contentEl.createDiv('nx-sprint-row');
      const cb = wrap.createEl('input', { type: 'checkbox' });
      cb.checked = key === 'minutes' ? cfg.useTime : cfg.useWords;
      wrap.createSpan({ cls: 'nx-sprint-label', text: label });
      const inp = wrap.createEl('input', { cls: 'nx-sprint-num', attr: { type: 'number', min: '1' } });
      inp.value = String(cfg[key]);
      wrap.createSpan({ cls: 'nx-sprint-unit', text: unit });
      inp.oninput = () => { const n = parseInt(inp.value, 10); if (n > 0) cfg[key] = n; };
      cb.onchange = () => { if (key === 'minutes') cfg.useTime = cb.checked; else cfg.useWords = cb.checked; inp.disabled = !cb.checked; };
      inp.disabled = !cb.checked;
    };
    row('Duration', 'minutes', 'minutes');
    row('Word goal', 'words', 'words');

    const fw = contentEl.createDiv('nx-sprint-row');
    const fcb = fw.createEl('input', { type: 'checkbox' });
    fcb.checked = cfg.withFocus;
    fw.createSpan({ cls: 'nx-sprint-label', text: 'Turn on focus mode for the sprint' });
    fcb.onchange = () => { cfg.withFocus = fcb.checked; };

    const bar = contentEl.createDiv('nx-sprint-bar-actions');
    bar.createEl('button', { text: 'Cancel' }).onclick = () => this.close();
    bar.createEl('button', { text: 'Start', cls: 'mod-cta' }).onclick = async () => {
      if (!cfg.useTime && !cfg.useWords) { new Notice('Pick a duration, a word goal, or both.'); return; }
      Object.assign(s, { minutes: cfg.minutes, words: cfg.words, useTime: cfg.useTime, useWords: cfg.useWords, focusDuringSprint: cfg.withFocus });
      await this.plugin.saveSettings();
      this.close();
      this.onStart(cfg);
    };
  }
  onClose() { this.contentEl.empty(); }
}

/* ---- summary ------------------------------------------------------------- */
class NexusSprintDoneModal extends Modal {
  constructor(plugin, res) { super(plugin.app); this.plugin = plugin; this.res = res; }
  onOpen() {
    const { contentEl } = this;
    const r = this.res;
    contentEl.addClass('nx-sprint-done');
    contentEl.createEl('h3', { text: r.manual ? 'Sprint stopped' : (r.reached ? 'Goal reached' : 'Time is up') });

    const grid = contentEl.createDiv('nx-sprint-stats');
    const stat = (num, label) => {
      const b = grid.createDiv('nx-sprint-stat');
      b.createDiv({ cls: 'nx-sprint-stat-num', text: String(num) });
      b.createDiv({ cls: 'nx-sprint-stat-label', text: label });
    };
    const mins = r.seconds / 60;
    stat(r.words, r.words === 1 ? 'word' : 'words');
    stat(moment.utc(r.seconds * 1000).format(r.seconds >= 3600 ? 'H:mm:ss' : 'm:ss'), 'on the clock');
    stat(Math.round(r.words / Math.max(mins, 1 / 60)), 'words / minute');
    if (r.goal) contentEl.createEl('p', { cls: 'setting-item-description',
      text: r.reached ? 'Goal of ' + r.goal + ' words met.' : (r.goal - r.words) + ' words short of ' + r.goal + '.' });

    const msg = String((this.plugin.settings.sprint || {}).doneMessage || '').trim();
    if (msg) contentEl.createEl('p', { cls: 'nx-sprint-msg', text: msg });

    const bar = contentEl.createDiv('nx-sprint-bar-actions');
    bar.createEl('button', { text: 'Done', cls: 'mod-cta' }).onclick = () => this.close();
  }
  onClose() { this.contentEl.empty(); }
}

module.exports = { NexusSprint, NexusSprintStartModal, countWords };
