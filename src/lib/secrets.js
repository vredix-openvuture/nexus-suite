'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · secrets at rest
 *
 *  What this can and cannot do, said plainly, because a security feature that
 *  overstates itself is worse than none:
 *
 *  Vault sync runs unattended. Whatever the plugin can decrypt without you
 *  present, anything running as you can decrypt too — no arrangement inside a
 *  plugin changes that. So this does NOT defend against malware in your
 *  session, and nothing here should be read as claiming it does.
 *
 *  What it DOES defend against is the realistic case: a backup of ~/.config, a
 *  disk that leaves the building, a synced dotfile directory. Electron's
 *  safeStorage keeps the key in the OS keyring (kwallet, gnome-keyring,
 *  Keychain, DPAPI), so the stored bytes are useless anywhere but this machine,
 *  in this account.
 *
 *  Mobile has no keyring a plugin can reach. There the secret stays as it was,
 *  in plain text, and the settings page says so for that device rather than
 *  showing a padlock that means nothing.
 * ========================================================================== */

const PREFIX = 'nx1:';   // marks a value this module encrypted, so plain text still reads

function safeStorage() {
  try {
    const electron = require('electron');
    const s = (electron && electron.remote ? electron.remote.safeStorage : null) || electron.safeStorage;
    return s && s.isEncryptionAvailable && s.isEncryptionAvailable() ? s : null;
  } catch (e) {
    return null;   // mobile, or a build without the module
  }
}

function available() { return !!safeStorage(); }

/* Encrypted values carry a prefix so a store written before this existed still
   reads back, and so a device that loses its keyring can tell "cannot decrypt"
   from "was never encrypted". */
function encrypt(text) {
  const store = safeStorage();
  const value = String(text == null ? '' : text);
  if (!store || !value) return value;
  try { return PREFIX + store.encryptString(value).toString('base64'); }
  catch (e) { return value; }   // better a readable secret than a lost one
}

function decrypt(value) {
  const text = String(value == null ? '' : value);
  if (text.indexOf(PREFIX) !== 0) return text;      // plain, from before or from mobile
  const store = safeStorage();
  if (!store) return '';                            // encrypted elsewhere; unreadable here
  try { return store.decryptString(Buffer.from(text.slice(PREFIX.length), 'base64')); }
  catch (e) { return ''; }
}

function isEncrypted(value) { return String(value == null ? '' : value).indexOf(PREFIX) === 0; }

module.exports = { PREFIX, available, encrypt, decrypt, isEncrypted };
