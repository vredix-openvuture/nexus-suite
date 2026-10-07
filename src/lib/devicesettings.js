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

module.exports = { LEGACY_KEYS, deviceStore, migrateDeviceSettings };
