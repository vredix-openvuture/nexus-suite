'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · sketch surface · sections and objects
 *  Named sections down the page, and the images, notes and stickers placed
 *  on it. Mixed into NexusSketchSurface (lib/mixin.js).
 * ========================================================================== */

const objects = require('../../lib/sketchobjects.js');

class SurfaceObjects {



  /* ── Sections ──────────────────────────────────────────────────────────────
     A rule across the page with a name on it. Deliberately drawn UNDER the ink:
     it is a divider, not an annotation, and it must never look like something
     that was written. */
  _sectionsSVG() {
    let body = '';
    for (const sec of this.sections) {
      const label = objects.xmlEscape(sec.title || 'Section');
      body += `<line x1="0" y1="${sec.y}" x2="${this.W}" y2="${sec.y}" class="nx-sk-secline"/>`;
      body += `<text x="14" y="${sec.y - 8}" class="nx-sk-sectext" font-size="20"`
        + ` font-family="ui-sans-serif, system-ui, sans-serif">${label}</text>`;
    }
    return body;
  }
  _renderSections() {
    const g = this.gSections;
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    if (!this.sections.length) return;
    const parsed = this._parseDefs(this._sectionsSVG());
    if (!parsed) return;
    while (parsed.firstChild) g.appendChild(parsed.firstChild);
  }
  addSection(y, title) {
    this._pushUndo({ t: 'sections', all: this.sections.slice() });
    this.sections = this.sections.concat([{ y: Math.round(y), title: String(title || 'Section') }])
      .sort((a, b) => a.y - b.y);
    this._renderSections();
    this._changed();
    return this.sections;
  }
  renameSection(i, title) {
    if (!this.sections[i]) return;
    this._pushUndo({ t: 'sections', all: this.sections.slice() });
    const next = this.sections.slice();
    next[i] = { y: next[i].y, title: String(title || 'Section') };
    this.sections = next;
    this._renderSections();
    this._changed();
  }
  removeSection(i) {
    if (!this.sections[i]) return;
    this._pushUndo({ t: 'sections', all: this.sections.slice() });
    this.sections = this.sections.filter((_, k) => k !== i);
    this._renderSections();
    this._changed();
  }
  /* Bring a y on the page into view. Returns false when there is no scroller to
     move, so the caller can say so instead of silently doing nothing. */
  scrollToY(y) {
    // A plane has no scroller: the camera goes there instead, a quarter of a
    // screen above the mark so it lands under the top of the view, not on it.
    if (this.infinite) { this.viewY = y - this._vh() * 0.25; this._applyView(); return true; }
    const sc = this._findScroller();
    if (!sc) return false;
    const rect = this.host.getBoundingClientRect();
    const scRect = sc.getBoundingClientRect();
    const px = (y / this.W) * (rect.width || this.W);
    sc.scrollTop += (rect.top + px) - scRect.top - 40;
    return true;
  }

  /* ── Objects on the page ───────────────────────────────────────────────────
     Rendered from the same emitter that writes the exported file, parsed once
     per change rather than built node by node: the whole layer is a handful of
     elements, and a string is the cheapest way to keep it in step. */
  _renderObjects() {
    const g = this.gObjects;
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    if (!this.objects.length) return;
    const parsed = this._parseDefs(objects.objectsSVG(this.objects));
    if (!parsed) return;
    while (parsed.firstChild) g.appendChild(parsed.firstChild);
  }
  addObject(obj) {
    if (!obj || objects.OBJECT_KINDS.indexOf(obj.kind) < 0) return -1;
    this._pushUndo({ t: 'objs', all: this.objects.slice() });
    this.objects = this.objects.concat([obj]);
    // A new object is what you want to move next, so it arrives selected.
    this.selection = [];
    this.selObjects = [this.objects.length - 1];
    this._renderObjects();
    if (this.gSel) this._paintSel(null);
    this._changed();
    this._emitSelect();
    return this.objects.length - 1;
  }
  updateObject(i, patch) {
    if (!this.objects[i]) return;
    this._pushUndo({ t: 'objs', all: this.objects.slice() });
    const next = this.objects.slice();
    next[i] = Object.assign({}, next[i], patch);
    this.objects = next;
    this._renderObjects();
    if (this.gSel) this._paintSel(null);
    this._changed();
  }
  removeObjects(indices) {
    if (!indices || !indices.length) return;
    this._pushUndo({ t: 'objs', all: this.objects.slice() });
    const drop = new Set(indices);
    this.objects = this.objects.filter((_, i) => !drop.has(i));
    this.selObjects = [];
    this._renderObjects();
    if (this.gSel) this._paintSel(null);
    this._changed();
    this._emitSelect();
  }
}

module.exports = SurfaceObjects;
