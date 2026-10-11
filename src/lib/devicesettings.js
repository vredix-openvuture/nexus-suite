'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · per-device settings
 *  Settings that describe ONE machine — the server it syncs against, the
 *  schedule it keeps — kept inside data.json
 *  but under that device's own key.
 *
 *  data.json is a file in the vault, and the vault is what vault sync uploads.
 *  A connection written at the top level is therefore the other machine's copy
 *  the moment it lands: that is how two devices ended up with the same device
 *  name. localStorage would avoid the collision but would also never be backed
 *  up, and the user asked for the opposite — sync everything a device knows,
 *  just never let one device's answer become another's. Keying by device id
 *  gives both, and it is the arrangement homepage.profiles already proves.
 * ========================================================================== */

/* Where a setting used to live while it was still vault-wide → its key in the
   device's own bag. The task accounts (`tasksCalendar.accounts` →
   `taskAccounts`) were moved here too until the tasks module was removed;
   loadSettings now deletes what is left of them (plugin.dropTasksCalendar). */
const LEGACY_KEYS = [
  { module: 'vaultSync', legacy: 'url', key: 'vaultSyncUrl' },
  { module: 'vaultSync', legacy: 'deviceName', key: 'vaultSyncDeviceName' },
  { module: 'vaultSync', legacy: 'onStart', key: 'vaultSyncOnStart' },
  { module: 'vaultSync', legacy: 'intervalMin', key: 'vaultSyncIntervalMin' },
];

function deviceStore(settings, deviceId) {
  const devices = settings.devices || (settings.devices = {});
  return devices[deviceId] || (devices[deviceId] = {});
}

function copyOf(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch (e) { return value; }
}

/* Move the vault-wide values into THIS device's bag, once.

   The old keys stay exactly where they are. data.json travels between the
   devices, so the second machine still has to find them when it updates —
   deleting them here would migrate one device and leave the other with nothing
   to migrate from. A flag in the bag, not the presence of a value, decides
   whether it ran: a connection someone has since removed must not come back. */
function migrateDeviceSettings(settings, deviceId) {
  const store = deviceStore(settings, deviceId);
  if (store.migrated) return false;
  store.migrated = true;
  for (const move of LEGACY_KEYS) {
    const from = settings[move.module];
    if (!from) continue;
    const value = from[move.legacy];
    if (value === undefined) continue;
    if (store[move.key] !== undefined) continue;
    store[move.key] = copyOf(value);
  }
  return true;
}

/* A data.json that arrives from elsewhere — a sync download, or any tool that
   copies the vault — is the sender's whole file. Taken as it is, it replaced
   this device's own entries with the sender's view of them (that is how the
   tablet lost its server URL on its first sync, 2026-10-11) and threw away any
   setting this device had changed since the two last agreed.

   So it is merged three ways, against `base` — the file as both sides last
   agreed on it. A value only the server changed is taken, a value only this
   device changed is kept, and objects are merged key by key, so a theme
   changed here and a folder changed there both survive. A list of plain values
   (an exclude list) changed on both sides keeps both sides' additions and
   removals. Anything else both changed differently is a clash: the server's
   value wins and the path is reported.

   Without a base (a device joining, or the first run after this update) there
   is no telling who changed what: every value that differs takes the server's
   and is reported the same way; keys only this device has are kept.

   What belongs to ONE device is never taken from the file: its bag under
   `devices`, and its dashboard and name under `homepage` (perDevice). Every
   other device's bag is kept, from whichever side has it. */
const OWN_ENTRIES = [['devices'], ['homepage', 'profiles'], ['homepage', 'profileNames']];

function isPlain(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function isPrimitiveList(value) { return Array.isArray(value) && value.every(v => v === null || typeof v !== 'object'); }

function threeWay(mine, theirs, base, path, clashes) {
  if (sameJson(mine, theirs)) return copyOf(theirs);
  if (sameJson(mine, base)) return copyOf(theirs);        // only the server moved
  if (sameJson(theirs, base)) return copyOf(mine);        // only this device moved
  if (isPrimitiveList(mine) && isPrimitiveList(theirs) && (base === undefined || isPrimitiveList(base))) {
    const was = base || [];
    const out = theirs.filter(v => !(was.indexOf(v) >= 0 && mine.indexOf(v) < 0));   // removed here
    for (const v of mine) if (was.indexOf(v) < 0 && out.indexOf(v) < 0) out.push(v);   // added here
    return out;
  }
  if (isPlain(mine) && isPlain(theirs)) {
    const out = {};
    const b = isPlain(base) ? base : undefined;
    for (const key of new Set(Object.keys(theirs).concat(Object.keys(mine)))) {
      const value = threeWay(mine[key], theirs[key], b && b[key], path.concat(key), clashes);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
  if (clashes) clashes.push(path.join('.'));
  return copyOf(theirs === undefined ? mine : theirs);
}

function mergeIncoming(incoming, current, deviceId, base) {
  const theirs = isPlain(incoming) ? incoming : {};
  const mine = isPlain(current) ? current : {};
  const clashes = [];
  const merged = threeWay(mine, theirs, isPlain(base) ? base : undefined, [], clashes) || {};
  for (const path of OWN_ENTRIES) {
    const pick = (root) => path.reduce((at, key) => (isPlain(at) ? at[key] : undefined), root);
    const mapHere = pick(mine), mapThere = pick(theirs);
    if (!isPlain(mapHere) && !isPlain(mapThere)) continue;
    const parent = path.slice(0, -1).reduce((at, key) => (isPlain(at[key]) ? at[key] : (at[key] = {})), merged);
    const map = Object.assign({}, copyOf(mapHere || {}), copyOf(mapThere || {}));
    if (isPlain(mapHere) && mapHere[deviceId] !== undefined) map[deviceId] = copyOf(mapHere[deviceId]);
    else delete map[deviceId];
    parent[path[path.length - 1]] = map;
  }
  // A clash inside an own entry is not one: this device's side was kept.
  const own = (c) => OWN_ENTRIES.some(p => c === p.join('.') || c.indexOf(p.join('.') + '.') === 0);
  return { merged, clashes: clashes.filter(c => !own(c)) };
}

/* Two settings values (a bag, or the whole file) hold the same data, whatever
   order their keys were written in. */
function sameJson(a, b) {
  const sorted = (value) => {
    if (Array.isArray(value)) return value.map(sorted);
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sorted(value[key]);
    return out;
  };
  return JSON.stringify(sorted(a === undefined ? null : a)) === JSON.stringify(sorted(b === undefined ? null : b));
}

/* Copy `source` into `target` without replacing the objects and lists that
   are already there, so whatever holds one of them (a settings page, a modal,
   a dashboard card) keeps holding the live one. */
function assignInPlace(target, source) {
  for (const key of Object.keys(target)) if (!(key in source)) delete target[key];
  if (target === source) return target;
  for (const [key, value] of Object.entries(source)) {
    const here = target[key];
    if (here === value) continue;               // the same object (a shared default): nothing to copy
    if (isPlain(here) && isPlain(value)) assignInPlace(here, value);
    else if (Array.isArray(here) && Array.isArray(value)) {
      const keep = here.length === value.length && here.every((v, i) => isPlain(v) && isPlain(value[i]));
      if (keep) here.forEach((v, i) => assignInPlace(v, value[i]));
      else { here.length = 0; for (const v of value) here.push(v); }
    } else target[key] = value;
  }
  return target;
}

module.exports = { LEGACY_KEYS, deviceStore, migrateDeviceSettings, mergeIncoming, sameJson, assignInPlace };
