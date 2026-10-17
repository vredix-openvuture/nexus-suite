'use strict';

/* Zen mode for the Sketch tab: the drawing and its own toolbar cover the whole
   Obsidian window — no tab bar, ribbon, sidebars or status bar.

   The view's content is moved into a layer on <body> rather than the leaf being
   pinned with position:fixed where it stands: any ancestor with a transform or
   `contain` (a theme, a split) turns "fixed" back into "inside me", and a body
   child has no such ancestor. Esc or the same button puts it back. */

const { setIcon } = require('obsidian');

class SketchZen {
  constructor(view) {
    this.view = view;
    this.isOn = false;
    this.button = null;
    this.layer = null;
    this._onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isTyping(e.target)) return;
      e.preventDefault();
      this.set(false);
    };
  }
  /* The button is rebuilt with the toolbar on every render; the state is not. */
  addButton(bar) {
    this.button = bar.createDiv({ cls: 'nx-sk-btn nx-skpane-zen', attr: { role: 'button', tabindex: '0' } });
    this.button.onclick = () => this.set(!this.isOn);
    this._paintButton();
  }
  set(isOn) {
    if (!!isOn === this.isOn) return;
    this.isOn = !!isOn;
    const content = this.view.contentEl;
    // A Sketch tab in a popout window lives in that window's document, not the main one.
    const doc = this.view.containerEl.ownerDocument;
    if (this.isOn) {
      this.layer = doc.body.createDiv('nx-sketch-zen-layer');
      this.layer.appendChild(content);
      doc.addEventListener('keydown', this._onKey);
    } else {
      this.view.containerEl.appendChild(content);
      if (this.layer) this.layer.remove();
      this.layer = null;
      doc.removeEventListener('keydown', this._onKey);
    }
    this._paintButton();
  }
  _paintButton() {
    if (!this.button) return;
    setIcon(this.button, this.isOn ? 'minimize-2' : 'maximize-2');
    this.button.setAttribute('aria-label', this.isOn ? 'Leave zen mode (Esc)' : 'Zen mode: the drawing fills the window');
    this.button.classList.toggle('is-active', this.isOn);
  }
}

/* Esc in a field (renaming a palette) belongs to the field. */
function isTyping(target) {
  if (!target || !target.tagName) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

module.exports = { SketchZen };
