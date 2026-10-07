'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · hidden properties
 *  Properties hidden from the note header, the toggle that shows them again,
 *  and the entry in Obsidian's property menu. Mixed into the plugin class.
 * ========================================================================== */

const { MarkdownView, setIcon } = require('obsidian');
const { cssAttrValue } = require('../lib/text.js');

class PropertyHider {

  /* ---- Property Hider ---- */
  applyPropertyHider() {
    if (!this._propStyle) this._propStyle = document.head.createEl('style', { attr: { id: 'nx-prop-hider' } });
    const s = this.settings.propertyHider;
    if (!s.enabled || !s.hidden.length) {
      this._propStyle.textContent = '';
      document.body.removeClass('nx-reveal-props');
      this.mountPropToggle();
      return;
    }
    const hide = s.hidden.map(k => `.metadata-property[data-property-key="${cssAttrValue(k)}"]`).join(',');
    const show = s.hidden.map(k => `body.nx-reveal-props .metadata-property[data-property-key="${cssAttrValue(k)}"]`).join(',');
    this._propStyle.textContent = `${hide}{display:none!important;}${show}{display:flex!important;opacity:.45;}`;
    document.body.toggleClass('nx-reveal-props', !!s.reveal);
    this.mountPropToggle();
  }
  async hideProperty(key) {
    const h = this.settings.propertyHider.hidden;
    if (!h.includes(key)) h.push(key);
    await this.saveSettings();
    this.applyPropertyHider();
  }
  async unhideProperty(key) {
    this.settings.propertyHider.hidden = this.settings.propertyHider.hidden.filter(k => k !== key);
    await this.saveSettings();
    this.applyPropertyHider();
  }
  mountPropToggle() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;
    const addBtn = view.contentEl.querySelector('.metadata-add-button');
    if (!addBtn || !addBtn.parentElement) return;
    let toggle = addBtn.parentElement.querySelector('.nx-prop-toggle');
    if (!this.settings.propertyHider.enabled) { if (toggle) toggle.remove(); return; }
    if (!toggle) {
      toggle = createDiv('nx-prop-toggle');
      addBtn.after(toggle);
      toggle.onclick = async () => {
        this.settings.propertyHider.reveal = !this.settings.propertyHider.reveal;
        await this.saveSettings();
        this.applyPropertyHider();
      };
    }
    const rev = this.settings.propertyHider.reveal;
    setIcon(toggle, rev ? 'eye' : 'eye-off');
    toggle.setAttribute('aria-label', rev ? 'Hide hidden properties' : 'Show hidden properties');
    toggle.toggleClass('is-active', rev);
  }
  /* Inject a "Hide/Show property" item into the NATIVE property context menu.
     Obsidian gives us no API event for this menu, so we watch the DOM — but only
     for a menu that is NEW (added after the right-click) and already POPULATED.
     That avoids the old bug of grabbing a stale/hidden leftover `.menu` (which is
     why the item never showed up). The observer self-stops on success/timeout. */
  _watchForPropMenu(key, knownBefore, ttl) {
    this._stopPropMenuWatch();
    const known = knownBefore || new Set(document.body.querySelectorAll('.menu'));
    const tryInject = () => {
      for (const menu of document.body.querySelectorAll('.menu')) {
        if (known.has(menu) || menu.dataset.nxHideInjected) continue;
        if (!menu.querySelector('.menu-item')) continue;   // not filled in yet → wait
        menu.dataset.nxHideInjected = '1';
        this._injectHideItem(menu, key);
        this._stopPropMenuWatch();
        return true;
      }
      return false;
    };
    if (tryInject()) return;                               // menu already open & ready
    this._propObs = new MutationObserver(() => tryInject());
    this._propObs.observe(document.body, { childList: true, subtree: true });
    this._propTimer = window.setTimeout(() => this._stopPropMenuWatch(), ttl || 2200);
  }
  _stopPropMenuWatch() {
    if (this._propObs) { this._propObs.disconnect(); this._propObs = null; }
    if (this._propTimer) { window.clearTimeout(this._propTimer); this._propTimer = null; }
  }
  _injectHideItem(menu, key) {
    const hidden = this.settings.propertyHider.hidden.includes(key);
    const item = createDiv('menu-item tappable');
    const icon = item.createDiv('menu-item-icon');
    setIcon(icon, hidden ? 'eye' : 'eye-off');
    item.createDiv({ cls: 'menu-item-title', text: hidden ? 'Show property' : 'Hide property' });
    item.addEventListener('click', () => {
      if (hidden) this.unhideProperty(key); else this.hideProperty(key);
      menu.remove();
    });
    // Match the native hover highlight (Obsidian toggles .selected on the item).
    item.addEventListener('mouseenter', () => {
      menu.querySelectorAll('.menu-item.selected').forEach(el => el.removeClass('selected'));
      item.addClass('selected');
    });
    item.addEventListener('mouseleave', () => item.removeClass('selected'));
    // IMPORTANT: the real structure is .menu > .menu-scroll > .menu-group > .menu-item,
    // and the separators are children of .menu-scroll (NOT of .menu). Inserting
    // relative to .menu threw a NotFoundError (silent) → this is why the item never
    // appeared. Give our item its own .menu-group and place it above the first
    // separator, i.e. just above the "Remove" group.
    const scroll = menu.querySelector('.menu-scroll') || menu;
    const group = createDiv('menu-group');
    group.appendChild(item);
    const sep = scroll.querySelector('.menu-separator');
    if (sep) scroll.insertBefore(group, sep); else scroll.appendChild(group);
  }
}

module.exports = PropertyHider;
