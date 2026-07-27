'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · task
 *  Quick-add a task to a (local) project. Creates a task note + a checklist
 *  line in the project note. Editing an existing task = open its note.
 * ========================================================================== */

const { Modal, Setting, Notice } = require('obsidian');
const tasks = require('../lib/tasks.js');

class NexusTaskModal extends Modal {
  constructor(plugin, onSave, presetProject) {
    super(plugin.app);
    this.plugin = plugin;
    this.onSave = onSave;
    this.state = { project: presetProject || '', newProject: '', title: '', due: '', priority: 0, repeat: '', description: '' };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('nx-event-modal');
    contentEl.createEl('h3', { text: 'New task' });

    const projects = tasks.listProjects(this.plugin);
    if (!this.state.project) this.state.project = projects[0] || '__new__';

    const projSet = new Setting(contentEl).setName('Project');
    projSet.addDropdown(d => {
      projects.forEach(p => d.addOption(p, p));
      d.addOption('__new__', '➕ New project…');
      d.setValue(this.state.project).onChange(v => { this.state.project = v; this._newProjRow(); });
    });
    this.newProjWrap = contentEl.createDiv();
    this._newProjRow();

    new Setting(contentEl).setName('Title').addText(t => { t.setValue(this.state.title).onChange(v => this.state.title = v); t.inputEl.style.width = '100%'; window.setTimeout(() => t.inputEl.focus(), 0); });
    new Setting(contentEl).setName('Due').addText(t => { t.inputEl.type = 'date'; t.setValue(this.state.due).onChange(v => this.state.due = v); });
    new Setting(contentEl).setName('Priority').addDropdown(d => { [['0', 'None'], ['1', 'Low'], ['5', 'Medium'], ['9', 'High']].forEach(([v, l]) => d.addOption(v, l)); d.setValue(String(this.state.priority)).onChange(v => this.state.priority = parseInt(v, 10)); });
    new Setting(contentEl).setName('Repeat').addDropdown(d => {
      d.addOption('', 'None').addOption('FREQ=DAILY', 'Daily').addOption('FREQ=WEEKLY', 'Weekly').addOption('FREQ=MONTHLY', 'Monthly').addOption('FREQ=YEARLY', 'Yearly');
      d.setValue(this.state.repeat).onChange(v => this.state.repeat = v);
    });
    new Setting(contentEl).setName('Description').addTextArea(t => { t.setValue(this.state.description).onChange(v => this.state.description = v); t.inputEl.rows = 3; t.inputEl.style.width = '100%'; });

    const foot = contentEl.createDiv('nx-event-foot');
    const spacer = foot.createDiv(); spacer.style.flex = '1';
    foot.createEl('button', { text: 'Add task', cls: 'mod-cta' }).onclick = () => this._save();
  }

  _newProjRow() {
    this.newProjWrap.empty();
    if (this.state.project !== '__new__') return;
    new Setting(this.newProjWrap).setName('New project name').addText(t => { t.setValue(this.state.newProject).onChange(v => this.state.newProject = v); });
  }

  async _save() {
    let project = this.state.project;
    if (project === '__new__') {
      project = (this.state.newProject || '').trim();
      if (!project) { new Notice('Nexus: enter a project name.'); return; }
      await tasks.createProject(this.plugin, project);
    }
    if (!this.state.title.trim()) { new Notice('Nexus: title required.'); return; }
    try {
      await tasks.createTask(this.plugin, project, {
        title: this.state.title.trim(), due: this.state.due, priority: this.state.priority,
        repeat: this.state.repeat, description: this.state.description,
      });
      new Notice('Task added.');
      if (this.onSave) this.onSave();
      this.close();
    } catch (e) { new Notice('Nexus: could not add task (' + (e && e.message || e) + ')'); }
  }

  onClose() { this.contentEl.empty(); }
}

module.exports = { NexusTaskModal };
