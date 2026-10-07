'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · the colour picker
 *  The hue ring, saturation square and alpha strip used by the sketch toolbar.
 *  Mixed into the plugin class (lib/mixin.js).
 * ========================================================================== */

const { parseColor, rgbToHex } = require('../lib/color.js');

class ColorPicker {

  /* A compact HSV colour picker: hue ring + inner saturation/value square + an
     opacity strip. onChange(color) fires live on every drag; onCommit(color)
     fires on release / hex edit (the point to persist). Emits "#rrggbb" when
     fully opaque, else "rgba(r,g,b,a)" — both render in SVG fill and on the
     live canvas, so stroke colour can now carry transparency. */
  _buildColorPicker(host, initial, onChange, onCommit) {
    host.addClass('nx-cp');
    const clamp01 = (x) => Math.max(0, Math.min(1, x));
    const hsv2rgb = (h, s, v) => {
      h = (h % 360 + 360) % 360;
      const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
      let r = 0, g = 0, b = 0;
      if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
      else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
      else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
      return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
    };
    const rgb2hsv = (r, g, b) => {
      r /= 255; g /= 255; b /= 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      let h = 0;
      if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
      return [h, mx ? d / mx : 0, mx];
    };
    // Anything unreadable (a var(), a typo) starts the picker on near-black.
    const read = (str) => parseColor(String(str || '')) || { r: 47, g: 47, b: 47, a: 1 };
    const init = read(initial);
    let hsv = rgb2hsv(init.r, init.g, init.b);
    let h = hsv[0], s = hsv[1], v = hsv[2], a = init.a, last = '';

    const wheel = host.createDiv('nx-cp-wheel');
    const ring = wheel.createDiv('nx-cp-ring');
    const ringThumb = wheel.createDiv('nx-cp-ring-thumb');
    const sv = wheel.createDiv('nx-cp-sv');
    const svThumb = sv.createDiv('nx-cp-sv-thumb');
    const alpha = host.createDiv('nx-cp-alpha');
    const alphaThumb = alpha.createDiv('nx-cp-alpha-thumb');
    const foot = host.createDiv('nx-cp-foot');
    const preview = foot.createDiv('nx-cp-preview');
    const hexInp = foot.createEl('input', { cls: 'nx-cp-hex', type: 'text' });

    const CENTER = 108, R = 89, SV = 104;   // wheel is 216px; SV square 104px centred
    const toStr = () => {
      const rgb = hsv2rgb(h, s, v);
      if (a >= 0.999) return rgbToHex(rgb[0], rgb[1], rgb[2]);
      return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.round(a * 100) / 100})`;
    };
    const paint = (emit) => {
      const hueCol = 'hsl(' + Math.round(h) + ', 100%, 50%)';
      const rgb = hsv2rgb(h, s, v), solid = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      sv.style.setProperty('--cp-hue', hueCol);
      alpha.style.setProperty('--cp-solid', solid);
      const rad = h * Math.PI / 180;
      ringThumb.style.left = (CENTER + R * Math.sin(rad)) + 'px';
      ringThumb.style.top = (CENTER - R * Math.cos(rad)) + 'px';
      ringThumb.style.background = hueCol;
      svThumb.style.left = (s * SV) + 'px';
      svThumb.style.top = ((1 - v) * SV) + 'px';
      svThumb.style.background = solid;
      last = toStr();
      preview.style.background = last;
      if (document.activeElement !== hexInp) hexInp.value = last;
      if (emit && onChange) onChange(last);
    };

    const drag = (el, onMove) => {
      let active = false;
      const move = (e) => { if (!active) return; e.preventDefault(); const r = el.getBoundingClientRect(); onMove(e.clientX - r.left, e.clientY - r.top, r); paint(true); };
      el.addEventListener('pointerdown', (e) => { active = true; try { el.setPointerCapture(e.pointerId); } catch (err) {} move(e); });
      el.addEventListener('pointermove', move);
      const up = () => { if (active && onCommit) onCommit(last); active = false; };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    };
    // Ring: angle (0 at top, clockwise → matches the conic gradient) = hue.
    // Ignore the masked-out centre (that's the SV square) and the far corners.
    drag(ring, (x, y, r) => {
      const dx = x - r.width / 2, dy = y - r.height / 2, dist = Math.hypot(dx, dy);
      if (dist < 58 || dist > r.width / 2 + 6) return;
      h = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    });
    drag(sv, (x, y, r) => { s = clamp01(x / r.width); v = clamp01(1 - y / r.height); });
    drag(alpha, (x, y, r) => { a = clamp01(x / r.width); alphaThumb.style.left = (a * r.width) + 'px'; });

    hexInp.onchange = () => { const p = read(hexInp.value); const c = rgb2hsv(p.r, p.g, p.b); h = c[0]; s = c[1]; v = c[2]; a = p.a; paint(true); if (onCommit) onCommit(last); };

    requestAnimationFrame(() => { const aw = alpha.getBoundingClientRect().width || 212; alphaThumb.style.left = (a * aw) + 'px'; });
    paint(false);
  }
}

module.exports = ColorPicker;
