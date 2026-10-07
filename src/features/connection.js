'use strict';

/* ============================================================================
 *  NEXUS SUITE · features · the sync connection
 *  Secrets kept in this device's localStorage, never in the vault, and the
 *  connection test that uses them. Mixed into the plugin class (lib/mixin.js).
 * ========================================================================== */

const { WebDavClient } = require('../lib/webdav.js');
const secrets = require('../lib/secrets.js');

class Connection {

  /* Ask the vault-sync server whether it is there and whether it knows this
     device. The answer has to be a sentence, not a status code. */
  /* Test the vault-sync server. `entry` is what the add-a-server dialog holds
     before saving; without it the stored connection is tested. */
  async testConnection(entry) {
    const conn = entry || {};
    const url = conn.url || this.deviceSetting('vaultSyncUrl', '');
    if (!url) throw new Error('fill in the URL first');
    const cred = this.getCredential('vaultsync');
    const client = new WebDavClient({ baseUrl: url,
      username: conn.username !== undefined ? conn.username : (cred.username || ''),
      password: conn.secret !== undefined ? conn.secret : (cred.secret || '') });
    return (await client.check()).message;
  }

  /* ---- Credentials ----
     Live in localStorage (device-local, NOT synced by Syncthing — same
     precedent as deviceId()). data.json holds only non-secret config. */
  credKey(id) { return 'nexus-suite-cred-' + id; }
  /* The secret is encrypted at rest where the OS offers a keyring, and stored
     as it was where it does not — see lib/secrets.js for what that is and is
     not worth. Reading tolerates both, so a store written before this, or on a
     phone, still opens. */
  getCredential(id) {
    try {
      const raw = JSON.parse(window.localStorage.getItem(this.credKey(id)) || '{}') || {};
      return Object.assign({}, raw, { secret: secrets.decrypt(raw.secret) });
    } catch (e) { return {}; }
  }
  setCredential(id, obj) {
    try {
      const value = Object.assign({}, obj || {});
      if (value.secret) value.secret = secrets.encrypt(value.secret);
      window.localStorage.setItem(this.credKey(id), JSON.stringify(value));
    } catch (e) { /* private mode, or a full store */ }
  }
  /* Whether THIS device can encrypt — the settings page says so per device
     rather than showing one padlock for a vault used from three machines. */
  secretsEncrypted() { return secrets.available(); }
}

module.exports = Connection;
