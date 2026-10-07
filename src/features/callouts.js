'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · custom callouts
 *  The stylesheet for user-defined callouts, in whichever colour convention
 *  this Obsidian build speaks. Mixed into the plugin class (lib/mixin.js).
 * ========================================================================== */

const { cssAttrValue } = require('../lib/text.js');
const { parseColor } = require('../lib/color.js');

class Callouts {

  /* ---- Callouts ---- */
  /* Inject one <style> that sets --callout-icon + --callout-color per type,
     light/dark aware. Same result as eth-p Callout Manager, but managed here. */
  /* "168, 130, 255" (Callout Manager's storage form) → rgb(168, 130, 255).
     Anything that already reads as a colour — #hex, rgb(), a var() — is passed
     through untouched. */
  /* Which convention THIS Obsidian build uses for --callout-color.
     Older builds store a bare "r, g, b" triplet and consume it as
     `rgba(var(--callout-color), .1)`; current builds store a COLOUR and consume
     it via `color-mix(… var(--callout-color) …)`. Emitting the wrong form makes
     every rule that reads the variable drop silently, so the callout loses its
     fill. That is why one vault could look different on two devices without
     anything being out of sync: the devices were on different Obsidian
     versions. Read from Obsidian's OWN value, so it is right on any build. */
  _calloutTripletMode() {
    try {
      const cs = getComputedStyle(document.body);
      const v = (cs.getPropertyValue('--callout-quote') || cs.getPropertyValue('--callout-note') || '').trim();
      return /^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(v);
    } catch (e) { return false; }
  }
  applyCallouts() {
    const triplet = this._calloutTripletMode();
    const calloutColor = (v) => {
      const t = String(v || '').trim();
      const isTriplet = /^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(t);
      if (triplet) {
        if (isTriplet) return t;
        const c = parseColor(t);
        return c ? [c.r, c.g, c.b].map(Math.round).join(', ') : t;
      }
      return isTriplet ? 'rgb(' + t + ')' : t;
    };
    if (!this._calloutStyle) this._calloutStyle = document.head.createEl('style', { attr: { id: 'nx-callouts' } });
    // One normalised, ALWAYS-a-colour handle for the theme to consume, whichever
    // convention this build speaks. Emitted even when the module is switched
    // off, because the theme's callout fill depends on it. The theme keeps
    // `var(--nx-callout-c, var(--callout-color))` so it also stands alone.
    const norm = `.callout{--nx-callout-c:${triplet ? 'rgb(var(--callout-color))' : 'var(--callout-color)'};}\n`;
    const s = this.settings.callouts;
    if (!s.enabled) { this._calloutStyle.textContent = norm; return; }
    let css = '';
    for (const c of s.items) {
      const id = (c.id || '').toLowerCase().trim();
      if (!id) continue;
      const sel = `.callout[data-callout="${cssAttrValue(id)}"]`;
      // --callout-color is a COLOUR, not a triplet: Obsidian defines its own as
      // `--callout-quote: #9e9e9e` / `var(--color-blue)` and consumes them as
      // `color-mix(in oklch, var(--callout-color) 10%, transparent)` and
      // `color: var(--callout-color)`. (It used to be a bare "r, g, b" triplet —
      // that is what the eth-p Callout Manager still stores and what we migrate
      // from, so the value is wrapped on the way out. Emitting the raw triplet
      // made every rule that consumes it silently drop: colour-less callouts.)
      const decl = [];
      if (c.color) decl.push(`--callout-color:${calloutColor(c.color)};`);
      if (c.icon) decl.push(`--callout-icon:${c.icon.startsWith('lucide-') ? c.icon : 'lucide-' + c.icon};`);
      if (decl.length) css += `${sel}{${decl.join('')}}\n`;
      if (c.colorLight) css += `.theme-light ${sel}{--callout-color:${calloutColor(c.colorLight)};}\n`;
      if (c.colorDark)  css += `.theme-dark ${sel}{--callout-color:${calloutColor(c.colorDark)};}\n`;
    }
    this._calloutStyle.textContent = norm + css;
  }
  /* One-time import of the user's existing callouts from the eth-p Callout
     Manager plugin (icons + colors, incl. light/dark colorScheme conditions),
     so switching to this module loses nothing. Re-runnable via the settings
     "Import" button (sets migrated=false first). */
  async migrateCallouts() {
    const s = this.settings.callouts;
    if (s.migrated) return;
    s.migrated = true;
    try {
      const path = this.app.vault.configDir + '/plugins/callout-manager/data.json';
      if (await this.app.vault.adapter.exists(path)) {
        const raw = JSON.parse(await this.app.vault.adapter.read(path));
        const rules = (raw && raw.callouts && raw.callouts.settings) || {};
        const have = new Set(s.items.map(i => i.id));
        for (const [id, list] of Object.entries(rules)) {
          if (have.has(id)) continue;
          const item = { id, icon: '', color: '', colorLight: '', colorDark: '' };
          for (const rule of (list || [])) {
            const ch = rule.changes || {}, cond = rule.condition || {};
            if (ch.icon) item.icon = ch.icon.replace(/^lucide-/, '');
            if (ch.color) {
              if (cond.colorScheme === 'light') item.colorLight = ch.color;
              else if (cond.colorScheme === 'dark') item.colorDark = ch.color;
              else item.color = ch.color;
            }
          }
          if (item.icon || item.color || item.colorLight || item.colorDark) s.items.push(item);
        }
      }
    } catch (e) { console.error('[Nexus] callout migration failed:', e); }
    await this.saveSettings();
  }
}

module.exports = Callouts;
