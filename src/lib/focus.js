'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · focus mode
 *  Dims everything except what you are writing, optionally keeps that line at a
 *  fixed height (typewriter scrolling) and gives the keyboard a voice.
 *
 *  Every part is its own switch: dimming, typewriter and sound do not depend on
 *  each other — the master toggle only gates all three at once.
 *
 *  No CodeMirror extension anywhere (that is a deliberate constraint of this
 *  plugin): the dimming rides on CM's own `.cm-active` line class, paragraph
 *  scope is walked in the DOM, and the scrolling moves the scroller directly.
 * ========================================================================== */

const { MarkdownView } = require('obsidian');

class NexusFocus {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this._marked = [];
  }
  get s() { return this.plugin.settings.focus; }

  init() {
    const p = this.plugin;
    // Cursor moves without changing text (arrow keys, clicks) fire neither
    // 'editor-change' nor any workspace event — selectionchange is the only
    // signal that covers all of them.
    p.registerDomEvent(document, 'selectionchange', () => this.schedule());
    p.registerEvent(this.app.workspace.on('active-leaf-change', () => this.schedule()));
    p.registerEvent(this.app.workspace.on('editor-change', () => this.schedule()));

    // Sound hangs off keydown so it fires on the press, not after the text
    // has been laid out.
    p.registerDomEvent(document, 'keydown', (e) => this.onKey(e), { capture: true });

    p.addCommand({ id: 'nexus-toggle-focus', name: 'Toggle focus mode', callback: async () => {
      this.s.enabled = !this.s.enabled;
      await p.saveSettings();
      this.apply();
    }});
    this.apply();
  }

  /* Body classes + custom properties — one place, so a settings flip is
     instant and nothing has to be re-walked. */
  apply() {
    const s = this.s || {};
    const on = !!s.enabled;
    const b = document.body;
    b.toggleClass('nx-focus', on && s.dim !== false);
    b.toggleClass('nx-focus-para', on && s.dim !== false && (s.scope || 'line') === 'paragraph');
    b.style.setProperty('--nx-focus-dim', ((s.dimOpacity == null ? 45 : s.dimOpacity) / 100).toFixed(2));
    if (!on || s.dim === false) this.clearParagraph();
    if (!on || !s.typewriter) this._lastTop = null;
    this.schedule();
  }

  schedule() {
    if (this._raf) return;
    this._raf = window.requestAnimationFrame(() => { this._raf = null; this.update(); });
  }

  activeLine() {
    const view = this.app.workspace.activeEditor || this.app.workspace.getActiveViewOfType(MarkdownView);
    const root = view && view.contentEl;
    if (!root) return null;
    return root.querySelector('.markdown-source-view .cm-line.cm-active');
  }

  update() {
    const s = this.s || {};
    if (!s.enabled) return;
    const line = this.activeLine();
    if (!line) return;
    if (s.dim !== false && (s.scope || 'line') === 'paragraph') this.markParagraph(line);
    if (s.typewriter) this.centre(line);
  }

  /* Paragraph scope: CM has no notion of a paragraph, so walk out from the
     active line until a blank one on each side and tag what's in between. */
  markParagraph(line) {
    this.clearParagraph();
    const take = (el) => { el.addClass('nx-focus-in'); this._marked.push(el); };
    take(line);
    for (let el = line.previousElementSibling; el; el = el.previousElementSibling) {
      if (!el.classList.contains('cm-line') || !el.textContent.trim()) break;
      take(el);
    }
    for (let el = line.nextElementSibling; el; el = el.nextElementSibling) {
      if (!el.classList.contains('cm-line') || !el.textContent.trim()) break;
      take(el);
    }
  }
  clearParagraph() {
    this._marked.forEach(el => { try { el.removeClass('nx-focus-in'); } catch (e) {} });
    this._marked = [];
  }

  /* Typewriter scrolling. Only nudges when the line is actually off target —
     scrolling on every keystroke would fight the editor's own scrolling and
     make the page shiver. */
  centre(line) {
    const scroller = line.closest('.cm-scroller');
    if (!scroller) return;
    const pct = (this.s.typewriterOffset == null ? 50 : this.s.typewriterOffset) / 100;
    const lineRect = line.getBoundingClientRect();
    const scRect = scroller.getBoundingClientRect();
    const want = scRect.top + scRect.height * pct - lineRect.height / 2;
    const delta = lineRect.top - want;
    if (Math.abs(delta) < 2) return;
    scroller.scrollTop += delta;
  }

  /* ---- keystroke sound ---------------------------------------------------
     Synthesised, not sampled: a short filtered noise burst is a convincing
     key click and costs zero bytes in the bundle (an audio file would have to
     be base64'd into main.js and shipped to mobile as well). */
  onKey(evt) {
    const s = this.s || {};
    if (!s.enabled || !s.sound) return;
    if (evt.ctrlKey || evt.metaKey || evt.altKey) return;
    if (evt.key && evt.key.length > 1 && !['Enter', 'Backspace', 'Tab', ' '].includes(evt.key)) return;
    if (!evt.target || !evt.target.closest || !evt.target.closest('.cm-editor')) return;
    try { (evt.key === 'Enter' && s.bell) ? this.bell() : this.click(); } catch (e) {}
  }
  ctx() {
    if (!this._ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this._ctx = new AC();
    }
    if (this._ctx.state === 'suspended') this._ctx.resume();
    return this._ctx;
  }
  noise(ctx) {
    // One buffer, reused — regenerating 30 ms of noise per keystroke is
    // needless garbage on a fast typist. The rate is tracked in our OWN field:
    // AudioBuffer.sampleRate is read-only and assigning to it throws in strict
    // mode.
    if (this._noise && this._noiseRate === ctx.sampleRate) return this._noise;
    const len = Math.floor(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
    this._noise = buf;
    this._noiseRate = ctx.sampleRate;
    return buf;
  }
  click() {
    const ctx = this.ctx(); if (!ctx) return;
    const hard = (this.s.soundStyle || 'soft') === 'mechanical';
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = hard ? 2600 : 1150;
    bp.Q.value = hard ? 1.4 : 0.6;
    const g = ctx.createGain();
    g.gain.value = ((this.s.soundVolume == null ? 25 : this.s.soundVolume) / 100) * (hard ? 0.5 : 0.35);
    src.connect(bp); bp.connect(g); g.connect(ctx.destination);
    src.start();
  }
  bell() {
    const ctx = this.ctx(); if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine'; osc.frequency.value = 1180;
    const g = ctx.createGain();
    const vol = ((this.s.soundVolume == null ? 25 : this.s.soundVolume) / 100) * 0.22;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.36);
  }

  unload() {
    document.body.removeClasses(['nx-focus', 'nx-focus-para']);
    document.body.style.removeProperty('--nx-focus-dim');
    this.clearParagraph();
    if (this._ctx) { try { this._ctx.close(); } catch (e) {} this._ctx = null; }
  }
}

module.exports = { NexusFocus };
