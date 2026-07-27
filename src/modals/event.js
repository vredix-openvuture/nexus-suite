'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · event
 *  Create / edit a VEVENT in a LOCAL calendar (offline). Remote events open
 *  read-only in Milestone 1 (writing them back is Milestone 2).
 * ========================================================================== */

const { Modal, Setting, moment, Notice } = require('obsidian');
const calstore = require('../lib/calstore.js');

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

class NexusEventModal extends Modal {
  /* event = normalized event (edit) or a seed like {start} (new).
     onSave() called after save/delete. localCalId = target local calendar.
     readOnly = remote event → view only. */
  constructor(plugin, event, onSave, localCalId, readOnly) {
    super(plugin.app);
    this.plugin = plugin;
    this.ev = Object.assign({}, event || {});
    this.onSave = onSave;
    this.localCalId = localCalId || null;
    this.readOnly = !!readOnly;
    this.isNew = !this.ev.uid;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('nx-event-modal');
    if (this.readOnly) return this._renderReadonly();

    contentEl.createEl('h3', { text: this.isNew ? 'New event' : 'Edit event' });

    const s = whenToInputs(this.ev.start);
    const eEnd = this.ev.end ? whenToInputs(this.ev.end) : { date: s.date, time: '10:00', allDay: s.allDay };
    this.state = {
      summary: this.ev.summary && this.ev.summary !== '(untitled)' ? this.ev.summary : '',
      allDay: s.allDay,
      startDate: s.date, startTime: s.time,
      endDate: eEnd.date, endTime: eEnd.time,
      calId: this.localCalId || (this.plugin.settings.tasksCalendar.localCalendars[0] || {}).id,
      location: this.ev.location || '',
      description: this.ev.description || '',
      rrule: this.ev.rrule || '',
    };

    new Setting(contentEl).setName('Title').addText(t => { t.setValue(this.state.summary).onChange(v => this.state.summary = v); t.inputEl.style.width = '100%'; window.setTimeout(() => t.inputEl.focus(), 0); });

    const cals = this.plugin.settings.tasksCalendar.localCalendars || [];
    new Setting(contentEl).setName('Calendar').addDropdown(d => {
      cals.forEach(c => d.addOption(c.id, c.name));
      d.setValue(this.state.calId).onChange(v => this.state.calId = v);
    });

    new Setting(contentEl).setName('All day').addToggle(t => t.setValue(this.state.allDay).onChange(v => { this.state.allDay = v; this._times(); }));

    this.timesWrap = contentEl.createDiv('nx-event-times');
    this._times();

    new Setting(contentEl).setName('Repeat').addDropdown(d => {
      d.addOption('', 'None').addOption('FREQ=DAILY', 'Daily').addOption('FREQ=WEEKLY', 'Weekly')
        .addOption('FREQ=MONTHLY', 'Monthly').addOption('FREQ=YEARLY', 'Yearly');
      const known = ['', 'FREQ=DAILY', 'FREQ=WEEKLY', 'FREQ=MONTHLY', 'FREQ=YEARLY'];
      if (this.state.rrule && !known.includes(this.state.rrule)) d.addOption(this.state.rrule, 'Custom (' + this.state.rrule + ')');
      d.setValue(known.includes(this.state.rrule) ? this.state.rrule : this.state.rrule).onChange(v => this.state.rrule = v);
    });

    new Setting(contentEl).setName('Location').addText(t => t.setValue(this.state.location).onChange(v => this.state.location = v));
    new Setting(contentEl).setName('Description').addTextArea(t => { t.setValue(this.state.description).onChange(v => this.state.description = v); t.inputEl.rows = 3; t.inputEl.style.width = '100%'; });

    const foot = contentEl.createDiv('nx-event-foot');
    if (!this.isNew && this.localCalId) {
      const del = foot.createEl('button', { text: 'Delete', cls: 'mod-warning' });
      del.onclick = () => this._delete();
    }
    const spacer = foot.createDiv(); spacer.style.flex = '1';
    const save = foot.createEl('button', { text: 'Save', cls: 'mod-cta' });
    save.onclick = () => this._save();
  }

  _times() {
    this.timesWrap.empty();
    const mk = (label, dKey, tKey) => {
      const set = new Setting(this.timesWrap).setName(label);
      set.addText(t => { t.inputEl.type = 'date'; t.setValue(this.state[dKey]); t.onChange(v => this.state[dKey] = v); });
      if (!this.state.allDay) set.addText(t => { t.inputEl.type = 'time'; t.setValue(this.state[tKey]); t.onChange(v => this.state[tKey] = v); });
    };
    mk('Start', 'startDate', 'startTime');
    mk('End', 'endDate', 'endTime');
  }

  async _save() {
    if (!this.state.summary.trim()) { new Notice('Nexus: title required.'); return; }
    if (!this.state.calId) { new Notice('Nexus: pick a calendar.'); return; }
    const ev = Object.assign({}, this.ev);
    ev.summary = this.state.summary.trim();
    ev.allDay = this.state.allDay;
    ev.start = inputsToWhen(this.state.startDate, this.state.startTime, this.state.allDay);
    ev.end = inputsToWhen(this.state.endDate, this.state.endTime, this.state.allDay);
    ev.location = this.state.location;
    ev.description = this.state.description;
    ev.rrule = this.state.rrule || null;
    ev.status = ev.status || 'CONFIRMED';
    try {
      // moved calendars: drop from the old one first
      if (this.localCalId && this.localCalId !== this.state.calId && ev.uid) await calstore.deleteLocalEvent(this.plugin, this.localCalId, ev.uid);
      await calstore.saveLocalEvent(this.plugin, this.state.calId, ev);
      new Notice('Event saved.');
      if (this.onSave) this.onSave();
      this.close();
    } catch (e) { new Notice('Nexus: save failed (' + (e && e.message || e) + ')'); }
  }

  async _delete() {
    try { await calstore.deleteLocalEvent(this.plugin, this.localCalId, this.ev.uid); if (this.onSave) this.onSave(); this.close(); }
    catch (e) { new Notice('Nexus: delete failed.'); }
  }

  _renderReadonly() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.ev.summary || '(untitled)' });
    const s = this.ev.start, e = this.ev.end;
    const fmt = (w) => !w ? '' : (w.d ? moment(w.d).format('ddd D MMM YYYY') : (w.utc ? moment.utc(w.dt).local() : moment(w.dt)).format('ddd D MMM YYYY, H:mm'));
    const row = (label, val) => { if (!val) return; const r = contentEl.createDiv('nx-event-ro'); r.createSpan({ cls: 'nx-event-ro-k', text: label }); r.createSpan({ cls: 'nx-event-ro-v', text: val }); };
    row('When', fmt(s) + (e ? ' – ' + fmt(e) : ''));
    row('Location', this.ev.location);
    if (this.ev.rrule) row('Repeats', this.ev.rrule);
    if (this.ev.description) contentEl.createDiv({ cls: 'nx-event-ro-desc', text: this.ev.description });
    contentEl.createEl('p', { cls: 'nx-event-ro-hint', text: 'Read-only — editing server events comes in a later update.' });
  }

  onClose() { this.contentEl.empty(); }
}

module.exports = { NexusEventModal };
