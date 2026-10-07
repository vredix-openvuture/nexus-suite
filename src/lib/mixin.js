'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · mixin
 *  The plugin class, the settings tab, the dashboard and the sketch surface are
 *  each one object with a lot of jobs. Their methods live in one file per job
 *  (src/features/, src/settings/, src/views/home/, src/views/sketch/), written
 *  as plain classes, and are copied onto the real class here — so every
 *  `this.x()` keeps working without a forwarding stub per method.
 * ========================================================================== */

/* Copy every method (and getter) of each part onto `target.prototype`.
   A name defined twice is a mistake that would otherwise be decided silently
   by load order, so it throws instead. */
function mixin(target, parts) {
  for (const part of parts) {
    for (const name of Object.getOwnPropertyNames(part.prototype)) {
      if (name === 'constructor') continue;
      if (Object.prototype.hasOwnProperty.call(target.prototype, name)) {
        throw new Error('mixin: ' + target.name + '.' + name + ' is defined twice (again in ' + part.name + ')');
      }
      Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(part.prototype, name));
    }
  }
  return target;
}

module.exports = { mixin };
