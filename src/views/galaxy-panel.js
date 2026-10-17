'use strict';

/* ============================================================================
 *  NEXUS SUITE · views · the galaxy's control panel
 *
 *  The dials Obsidian's own graph has — filters, display, forces — floating
 *  over the map they change. Every change lands at once: forces reheat the
 *  layout from where it stands, display changes only repaint. Saving is
 *  debounced, because a dragged slider fires on every pixel.
 * ========================================================================== */

const { Setting, debounce } = require('obsidian');
const f3 = require('../lib/force3d.js');

const DISPLAY = [
  { key: 'nodeSize',  name: 'Node size',      min: 0.3, max: 3,  step: 0.1, fallback: 1 },
  { key: 'linkWidth', name: 'Link thickness', min: 0.25, max: 4, step: 0.25, fallback: 1 },
  { key: 'labels',    name: 'Names shown',    min: 0,   max: 60, step: 1,   fallback: 7 },
];

// Below "Keep turning", which it belongs to; a multiple of the default drift.
const TURN_SPEED = { key: 'driftSpeed', name: 'Turn speed', min: 0.1, max: 5, step: 0.1, fallback: 1 };

class GalaxyPanel {
  constructor(view) {
    this.view = view;
    this.el = view.stage.createDiv('nx-galaxy-panel');
    this.save = debounce(() => view.plugin.saveSettings(), 400, true);
    this.render();
  }

  toggle() {
    const open = !this.el.hasClass('is-open');
    this.el.toggleClass('is-open', open);
    return open;
  }

  render() {
    const view = this.view, s = view.settings, el = this.el;
    el.empty();

    this.section('Filters');
    new Setting(el).setName('Notes without links')
      .addToggle(t => t.setValue(s.showOrphans !== false)
        .onChange(v => { s.showOrphans = v; this.save(); view.reload(); }));

    this.section('Display');
    DISPLAY.forEach(d => this.slider(d, s[d.key] == null ? d.fallback : s[d.key], () => {
      if (d.key === 'labels') view.pickHubs();
      view.wake();
    }));
    new Setting(el).setName('Keep turning')
      .addToggle(t => t.setValue(s.drift !== false)
        .onChange(v => { s.drift = v; this.save(); view.wake(); }));
    this.slider(TURN_SPEED, s.driftSpeed == null ? TURN_SPEED.fallback : s.driftSpeed, () => view.wake());

    this.section('Forces');
    const forces = view.forces();
    f3.FORCES.forEach(f => this.slider(f, forces[f.key], () => view.applyForces()));

    const foot = el.createDiv('nx-galaxy-panel-foot');
    const reset = foot.createEl('button', { cls: 'nx-btn is-sm is-quiet', text: 'Default forces & display' });
    reset.onclick = () => {
      f3.FORCES.forEach(f => { delete s[f.key]; });
      DISPLAY.forEach(d => { delete s[d.key]; });
      delete s[TURN_SPEED.key];
      this.save();
      view.pickHubs();
      view.applyForces();
      this.render();
    };
  }

  section(title) {
    this.el.createDiv({ cls: 'nx-galaxy-panel-head', text: title });
  }

  slider(spec, value, apply) {
    const s = this.view.settings;
    new Setting(this.el).setName(spec.name)
      .addSlider(sl => {
        sl.setLimits(spec.min, spec.max, spec.step).setValue(value).setDynamicTooltip();
        sl.onChange(v => { s[spec.key] = v; this.save(); apply(); });
      });
  }
}

module.exports = { GalaxyPanel };
