'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · event
 *  Create / edit a VEVENT in a LOCAL calendar (offline, any device) or a REMOTE
 *  CalDAV calendar (write-through PUT/DELETE, desktop only). Editing keeps the
 *  event in its calendar; moving between calendars is not offered here.
 * ========================================================================== */

const { Modal, Setting, moment, Notice } = require('obsidian');
const calstore = require('../lib/calstore.js');
const { CalDavClient } = require('../lib/caldav.js');

function whenToInputs(when) {
  if (!when) return { date: moment().format('YYYY-MM-DD'), time: '09:00', allDay: false };
  if (when.d) return { date: when.d, time: '09:00', allDay: true };
  const m = when.utc ? moment.utc(when.dt).local() : moment(when.dt);
  return { date: m.format('YYYY-MM-DD'), time: m.format('HH:mm'), allDay: false };
}
function inputsToWhen(dateStr, timeStr, allDay) {
  if (allDay) return { d: dateStr };
  return { dt: dateStr + 'T' + (timeStr || '00:00') + ':00', utc: false, tzid: null };
}
function calTok(c) { return c.kind === 'local' ? 'local:' + c.calendarId : 'remote:' + c.accountId + ':' + c.calendarId; }

class NexusEventModal extends Modal {
  /* event = normalized event (edit) or seed {start} (new). calendars = loaded
     list (local + remote). calRef = the calendar the event belongs to (edit). */
  constructor(plugin, event, onSave, calendars, calRef) {
    super(plugin.app);
    this.plugin = plugin;
    this.ev = Object.assign({}, event || {});
    this.onSave = onSave;
    this.calendars = (calendars || []).filter(c => c && (c.kind === 'local' || c.kind === 'remote'));
    this.calRef = calRef || null;
    this.isNew = !this.ev.uid;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('nx-event-modal');
    contentEl.createEl('h3', { text: this.isNew ? 'New event' : 'Edit event' });

    if (!this.calendars.length) { contentEl.createEl('p', { text: 'No calendars available — add a local calendar or sync a CalDAV account first.' }); return; }

    const s = whenToInputs(this.ev.start);
    const eEnd = this.ev.end ? whenToInputs(this.ev.end) : { date: s.date, time: '10:00', allDay: s.allDay };
    this.state = {
      summary: this.ev.summary && this.ev.summary !== '(untitled)' ? this.ev.summary : '',
      allDay: s.allDay, startDate: s.date, startTime: s.time, endDate: eEnd.date, endTime: eEnd.time,
      calTok: this.calRef ? calTok(this.calRef) : calTok(this.calendars[0]),
      location: this.ev.location || '', description: this.ev.description || '', rrule: this.ev.rrule || '',
    };

    new Setting(contentEl).setName('Title').addText(t => { t.setValue(this.state.summary).onChange(v => this.state.summary = v); t.inputEl.style.width = '100%'; window.setTimeout(() => t.inputEl.focus(), 0); });

    new Setting(contentEl).setName('Calendar').addDropdown(d => {
      this.calendars.forEach(c => d.addOption(calTok(c), c.display + (c.kind === 'remote' ? '  (server)' : '')));
      d.setValue(this.state.calTok).onChange(v => this.state.calTok = v);
      if (!this.isNew) d.setDisabled(true);   // editing stays in its calendar
    });

    new Setting(contentEl).setName('All day').addToggle(t => t.setValue(this.state.allDay).onChange(v => { this.state.allDay = v; this._times(); }));
    this.timesWrap = contentEl.createDiv('nx-event-times');
    this._times();

    new Setting(contentEl).setName('Repeat').addDropdown(d => {
      d.addOption('', 'None').addOption('FREQ=DAILY', 'Daily').addOption('FREQ=WEEKLY', 'Weekly').addOption('FREQ=MONTHLY', 'Monthly').addOption('FREQ=YEARLY', 'Yearly');
      const known = ['', 'FREQ=DAILY', 'FREQ=WEEKLY', 'FREQ=MONTHLY', 'FREQ=YEARLY'];
      if (this.state.rrule && !known.includes(this.state.rrule)) d.addOption(this.state.rrule, 'Custom');
      d.setValue(this.state.rrule).onChange(v => this.state.rrule = v);
    });
    new Setting(contentEl).setName('Location').addText(t => t.setValue(this.state.location).onChange(v => this.state.location = v));
    new Setting(contentEl).setName('Description').addTextArea(t => { t.setValue(this.state.description).onChange(v => this.state.description = v); t.inputEl.rows = 3; t.inputEl.style.width = '100%'; });

    const foot = contentEl.createDiv('nx-event-foot');
    if (!this.isNew) foot.createEl('button', { text: 'Delete', cls: 'mod-warning' }).onclick = () => this._delete();
    foot.createDiv().style.flex = '1';
    foot.createEl('button', { text: 'Save', cls: 'mod-cta' }).onclick = () => this._save();
  }

  _times() {
    this.timesWrap.empty();
    const mk = (label, dKey, tKey) => {
      const set = new Setting(this.timesWrap).setName(label);
      set.addText(t => { t.inputEl.type = 'date'; t.setValue(this.state[dKey]); t.onChange(v => this.state[dKey] = v); });
      if (!this.state.allDay) set.addText(t => { t.inputEl.type = 'time'; t.setValue(this.state[tKey]); t.onChange(v => this.state[tKey] = v); });
    };
    mk('Start', 'startDate', 'startTime'); mk('End', 'endDate', 'endTime');
  }

  _targetCal() { return this.calRef || this.calendars.find(c => calTok(c) === this.state.calTok); }

  _remoteClient(cal) {
    let fsOk = false; try { require('fs'); fsOk = true; } catch (e) {}
    if (!fsOk) { new Notice('Nexus: editing server events is desktop-only (the tablet reads the synced cache).'); return null; }
    const acc = (this.plugin.settings.tasksCalendar.accounts || []).find(a => a.id === cal.accountId);
    if (!acc) { new Notice('Nexus: account not found.'); return null; }
    const cred = this.plugin.getCredential(acc.id);
    if (!cred.secret) { new Notice('Nexus: no credential on this device.'); return null; }
    return new CalDavClient({ serverUrl: acc.serverUrl, username: acc.username || cred.username, password: cred.secret });
  }

  async _save() {
    if (!this.state.summary.trim()) { new Notice('Nexus: title required.'); return; }
    const cal = this._targetCal();
    if (!cal) { new Notice('Nexus: pick a calendar.'); return; }
    const ev = Object.assign({}, this.ev);
    ev.summary = this.state.summary.trim();
    ev.allDay = this.state.allDay;
    ev.start = inputsToWhen(this.state.startDate, this.state.startTime, this.state.allDay);
    ev.end = inputsToWhen(this.state.endDate, this.state.endTime, this.state.allDay);
    ev.location = this.state.location; ev.description = this.state.description;
    ev.rrule = this.state.rrule || null; ev.status = ev.status || 'CONFIRMED';
    try {
      if (cal.kind === 'local') { await calstore.saveLocalEvent(this.plugin, cal.calendarId, ev); }
      else {
        const client = this._remoteClient(cal); if (!client) return;
        const res = await calstore.writeRemoteEvent(this.plugin, cal, ev, client);
        if (res.conflict) { new Notice('Nexus: the server copy changed — sync first, then retry.'); return; }
        if (res.error) { new Notice('Nexus: save failed (' + res.error + ')'); return; }
      }
      new Notice('Event saved.');
      if (this.onSave) this.onSave();
      this.close();
    } catch (e) { new Notice('Nexus: save failed (' + (e && e.message || e) + ')'); }
  }

  async _delete() {
    const cal = this._targetCal();
    try {
      if (cal && cal.kind === 'local') await calstore.deleteLocalEvent(this.plugin, cal.calendarId, this.ev.uid);
      else if (cal) { const client = this._remoteClient(cal); if (!client) return; await calstore.deleteRemoteEvent(this.plugin, cal, this.ev, client); }
      if (this.onSave) this.onSave();
      this.close();
    } catch (e) { new Notice('Nexus: delete failed (' + (e && e.message || e) + ')'); }
  }

  onClose() { this.contentEl.empty(); }
}

module.exports = { NexusEventModal };
