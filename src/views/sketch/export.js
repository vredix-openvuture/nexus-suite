'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · sketch surface · export
 *  Bounds of the drawing and the standalone SVG it is saved and exported as.
 *  Mixed into NexusSketchSurface (lib/mixin.js).
 * ========================================================================== */

const canvas = require('../../lib/sketchcanvas.js');
const objects = require('../../lib/sketchobjects.js');
const { SVGNS, pencilFilterStr, bgPatternTile, paperTexDefsStr } = require('../../lib/sketchsvg.js');

class SurfaceExport {

  /* Everything that is ON the drawing, as one box: ink, objects AND sections —
     a section is drawn by the exporter too, so a frame that ignored it would
     crop a rule and its title out of the file. null for an empty page. */
  _contentBounds() {
    let b = canvas.strokeBounds(this.strokes);
    const fold = (ob) => {
      if (!ob) return;
      b = b ? {
        minX: Math.min(b.minX, ob.minX), minY: Math.min(b.minY, ob.minY),
        maxX: Math.max(b.maxX, ob.maxX), maxY: Math.max(b.maxY, ob.maxY),
      } : ob;
    };
    for (const o of this.objects) fold(objects.objectBounds(o));
    // A section is a rule across the page with its name above it — 28 units of
    // headroom is what _sectionsSVG puts the text in.
    for (const sec of this.sections) fold({ minX: 0, minY: sec.y - 28, maxX: this.W, maxY: sec.y });
    return b;
  }
  /* Move the whole drawing. Used when a plane becomes a sheet: a sheet clamps
     its view to 0,0 and exports 0 0 W H, so ink up or left of the origin would
     be both unreachable and missing from the file. One undo step puts it back. */
  _shiftAll(dx, dy) {
    if (!dx && !dy) return;
    for (const st of this.strokes) {
      for (const p of st.points) { p[0] = +(p[0] + dx).toFixed(1); p[1] = +(p[1] + dy).toFixed(1); }
      delete st._d;   // memoised outline is stale now
    }
    this.objects = this.objects.map(o => Object.assign({}, o, { x: o.x + dx, y: o.y + dy }));
    this.sections = this.sections.map(sec => ({ y: sec.y + dy, title: sec.title }));
    this._renderStrokes(); this._renderObjects(); this._renderSections();
  }
  _reclaimNegativeSpace() {
    const b = this._contentBounds();
    if (!b) return;
    const dx = b.minX < 0 ? Math.ceil(-b.minX) : 0;
    const dy = b.minY < 0 ? Math.ceil(-b.minY) : 0;
    if (dx || dy) {
      this._pushUndo({ t: 'origin', dx, dy, h: this.H });
      this._shiftAll(dx, dy);
    }
    // …and the sheet has to be long enough to hold what just landed on it.
    this.H = Math.max(this.H, Math.ceil(b.maxY + dy) + 40);
  }
  /* What a saved file is cropped to. A sheet is its own frame. A plane has none,
     so the picture is everything that was drawn on it plus a margin — otherwise
     the file would be a window onto wherever the camera happened to rest. */
  _exportFrame() {
    if (!this.infinite) return { x: 0, y: 0, w: this.W, h: this.H };
    const b = this._contentBounds();
    if (!b) return { x: 0, y: 0, w: this.W, h: Math.round(this.W * 3 / 4) };
    const m = Math.max(24, Math.round(this.W * 0.03));
    return {
      x: Math.round(b.minX) - m, y: Math.round(b.minY) - m,
      w: Math.max(1, Math.round(b.maxX - b.minX) + 2 * m),
      h: Math.max(1, Math.round(b.maxY - b.minY) + 2 * m),
    };
  }
  /* The paper rectangles of the exported file. Same shapes the live pad paints —
     one sheet, a stack of A4 pages, or the frame the plane was cropped to. */
  _exportPaperRects(frame) {
    if (this.infinite) return [frame];
    if (this.paperType === 'sectioned')
      return canvas.sheetPages(this.W, this.H, this.sheetLandscape)
        .map(pg => ({ x: 0, y: pg.y, w: this.W, h: pg.h }));
    return [{ x: 0, y: 0, w: this.W, h: this.H }];
  }
  /* The size of the file toSVGString writes, for whoever has to rasterise it.
     Not W x H: a mindmap is cropped to its own ink, and a PNG sized to the
     canvas instead of to the crop would come out stretched. */
  exportSize() { const f = this._exportFrame(); return { w: f.w, h: f.h }; }
  toSVGString() {
    const frame = this._exportFrame();
    const rects = this._exportPaperRects(frame);
    const rectsWith = (attrs) => rects.map(r =>
      `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" ${attrs}/>`).join('');
    const meta = JSON.stringify({
      v: 1, w: this.W, h: this.H, bg: this.bg, paper: this.paper, paperStyle: this.paperStyle,
      paperType: this.paperType, sheetLandscape: this.sheetLandscape || undefined,
      view: this.infinite ? { x: Math.round(this.viewX), y: Math.round(this.viewY), w: Math.round(this.viewW) } : undefined,
      bgType: this.bgType, bgSize: this.bgSize, bgOpacity: this.bgOpacity, bgColor: this.bgColor,
      autoGrow: this.autoGrow,
      title: this.title || undefined,
      cover: this.cover || undefined,
      objects: this.objects.length ? this.objects : undefined,
      sections: this.sections.length ? this.sections : undefined,
      ocr: this.ocr.length ? this.ocr : undefined,
      strokes: this.strokes,
    });
    let defs = '', body = '';
    if (this.strokes.some(st => st.grain)) defs += `<defs>${pencilFilterStr(this._pfx)}</defs>`;
    // Sectioned paper draws its page edge even on transparent paper: the edges
    // ARE the feature, and a file leaving the vault carries no stylesheet.
    if (this.bg || this.paperType === 'sectioned') {
      const edge = (this.paperType === 'sectioned')
        ? ` stroke="${this._sheetEdge()}" stroke-width="${Math.max(1, this.W / 800)}"` : '';
      body += rectsWith(`fill="${this.bg || 'none'}"${edge}`);
    }
    if (this.paperStyle) {
      defs += `<defs>${paperTexDefsStr(this._texFilt, this._texPat)}</defs>`;
      body += rectsWith(`fill="url(#${this._texPat})" style="mix-blend-mode:multiply"`);
    }
    if (this.bgType !== 'none' && this.bgOpacity) {
      const tile = bgPatternTile(this.bgType, this.bgSize, this.bgColor, this.bgOpacity);
      if (tile) {
        defs += `<defs><pattern id="${this._pid}" width="${tile.w}" height="${tile.h}" patternUnits="userSpaceOnUse">${tile.inner}</pattern></defs>`;
        body += rectsWith(`fill="url(#${this._pid})"`);
      }
    }
    // Same emitter as the live pad — two would drift, and the drift would only
    // ever show up in the exported copy.
    body += objects.objectsSVG(this.objects);
    body += this._sectionsSVG();
    for (let i = 0; i < this.strokes.length; i++) {
      const st = this.strokes[i];
      if (st.noStack) {
        // Run of consecutive same-look highlighter strokes → one shared-opacity group.
        let j = i;
        while (j < this.strokes.length && this.strokes[j].noStack &&
               this.strokes[j].color === st.color && this.strokes[j].opacity === st.opacity &&
               !this.strokes[j].blend === !st.blend) j++;
        let g = `<g fill="${this._inkColor(st.color)}"`;
        if (st.opacity != null && st.opacity < 1) g += ` opacity="${st.opacity}"`;   // group opacity = ONE composite layer, overlaps stay uniform
        if (st.blend) g += ' style="mix-blend-mode:multiply"';
        body += g + '>';
        for (; i < j; i++) { const d = this._strokeD(this.strokes[i]); if (d) body += `<path d="${d}"/>`; }
        body += '</g>';
        i--;   // for-loop increments again
        continue;
      }
      const d = this._strokeD(st);
      if (!d) continue;
      let a = `d="${d}" fill="${this._inkColor(st.color)}"`;
      if (st.opacity != null && st.opacity < 1) a += ` fill-opacity="${st.opacity}"`;
      if (st.blend) a += ' style="mix-blend-mode:multiply"';
      if (st.grain) a += ` filter="url(#${this._pfx})"`;
      body += `<path ${a}/>`;
    }
    /* A CDATA section ends at the first `]]>`, so a section title or a note that
       happens to contain one would truncate the metadata and leave a malformed
       file behind. Splitting it across two CDATA blocks is the standard escape
       and reads back identically. */
    const cdata = meta.split(']]>').join(']]]]><![CDATA[>');
    return `<svg xmlns="${SVGNS}" viewBox="${frame.x} ${frame.y} ${frame.w} ${frame.h}" width="${frame.w}" height="${frame.h}">`
      + `<metadata><nx-sketch xmlns="https://nexus-suite/sketch"><![CDATA[${cdata}]]></nx-sketch></metadata>`
      + defs + body + '</svg>';
  }
}

module.exports = SurfaceExport;
