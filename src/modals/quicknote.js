'use strict';

/* ============================================================================
 *  NEXUS SUITE · modals · QuickNote
 *  Record, transcribe, write a note. One button, because the whole point is to
 *  catch a thought before deciding anything about it.
 * ========================================================================== */

const { Modal, Notice, setIcon } = require('obsidian');
const quicknote = require('../lib/quicknote.js');

function speechApi() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

class NexusQuickNoteModal extends Modal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.s = plugin.settings.quicknote || {};
    this.state = 'idle';        // idle | recording | working
    this.chunks = [];
    this.lines = [];
    this.startedAt = 0;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('nx-qn-modal');
    contentEl.empty();
    contentEl.createEl('h3', { text: 'Quick note' });
    this.status = contentEl.createDiv({ cls: 'nx-qn-status', text: 'Ready.' });

    this.button = contentEl.createEl('button', { cls: 'mod-cta nx-qn-record' });
    this.paintButton();
    this.button.onclick = () => (this.state === 'recording' ? this.stop() : this.start());

    this.preview = contentEl.createDiv('nx-qn-preview');
    this.preview.createSpan({ cls: 'nx-qn-hint', text: 'What you say lands here.' });

    const row = contentEl.createDiv('nx-qn-row');
    const asTask = row.createEl('label', { cls: 'nx-qn-check' });
    this.taskBox = asTask.createEl('input', { attr: { type: 'checkbox' } });
    this.taskBox.checked = !!this.s.asTask;
    asTask.createSpan({ text: 'Track the note as a task' });

    contentEl.createDiv({ cls: 'nx-qn-engine',
      text: this.s.engine === 'browser'
        ? 'Using the browser\'s recogniser — on most builds that sends the audio to its vendor.'
        : 'Using the program set in the settings. Nothing leaves this machine.' });
  }

  onClose() {
    this.abort();
    this.contentEl.empty();
  }

  paintButton() {
    this.button.empty();
    const icon = this.button.createSpan({ cls: 'nx-qn-ic' });
    setIcon(icon, this.state === 'recording' ? 'square' : 'mic');
    this.button.createSpan({ text: this.state === 'recording' ? 'Stop' : 'Record' });
    this.button.toggleClass('is-recording', this.state === 'recording');
    this.button.disabled = this.state === 'working';
  }
  say(text) { if (this.status) this.status.setText(text); }
  showLines(lines) {
    this.preview.empty();
    if (!lines.length) { this.preview.createSpan({ cls: 'nx-qn-hint', text: 'Nothing was heard.' }); return; }
    lines.forEach(line => this.preview.createDiv({ cls: 'nx-qn-line', text: line }));
  }

  /* ── Recording ─────────────────────────────────────────────────────────── */
  async start() {
    this.lines = [];
    this.chunks = [];
    try {
      if (this.s.engine === 'browser') await this.startBrowser();
      else await this.startRecorder();
      this.state = 'recording';
      this.startedAt = Date.now();
      this.paintButton();
      this.tick = window.setInterval(() => {
        this.say('Recording — ' + Math.round((Date.now() - this.startedAt) / 1000) + 's');
      }, 500);
    } catch (err) {
      new Notice('Nexus: ' + (err && err.message ? err.message : 'the microphone could not be opened.'));
    }
  }
  async startRecorder() {
    if (typeof MediaRecorder !== 'function') throw new Error('this device has no recorder');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.recorder = new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.recorder.start();
  }
  async startBrowser() {
    const Recognition = speechApi();
    if (!Recognition) throw new Error('this browser has no speech recogniser — switch to the local engine in the settings');
    const rec = new Recognition();
    rec.lang = this.s.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event) => {
      const finals = [];
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) finals.push(event.results[i][0].transcript);
      }
      this.lines = quicknote.cleanTranscript(finals.join('\n'));
      this.showLines(this.lines);
    };
    rec.onerror = (event) => new Notice('Nexus: the recogniser stopped — ' + (event.error || 'unknown'));
    this.recognition = rec;
    rec.start();
  }

  abort() {
    if (this.tick) { window.clearInterval(this.tick); this.tick = null; }
    if (this.recorder && this.recorder.state !== 'inactive') { try { this.recorder.stop(); } catch (e) {} }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    if (this.recognition) { try { this.recognition.stop(); } catch (e) {} this.recognition = null; }
  }

  async stop() {
    const seconds = (Date.now() - this.startedAt) / 1000;
    if (this.tick) { window.clearInterval(this.tick); this.tick = null; }
    this.state = 'working';
    this.paintButton();
    this.say('Working…');
    try {
      if (this.s.engine === 'browser') {
        if (this.recognition) { try { this.recognition.stop(); } catch (e) {} this.recognition = null; }
        // The recogniser has been handing over text all along; give the last
        // result a moment to arrive before the note is written.
        await new Promise(r => window.setTimeout(r, 400));
      } else {
        const blob = await this.stopRecorder();
        this.say('Transcribing…');
        this.lines = await this.plugin.transcribeAudio(blob);
        this.showLines(this.lines);
      }
      if (!this.lines.length) {
        this.say('Nothing was heard — nothing was written.');
        this.state = 'idle';
        this.paintButton();
        return;
      }
      const path = await this.plugin.writeQuickNote(this.lines, {
        seconds, engine: this.s.engine || 'local', task: this.taskBox.checked,
      });
      new Notice('Nexus: written to ' + path);
      this.close();
    } catch (err) {
      this.say('Failed.');
      new Notice('Nexus: ' + (err && err.message ? err.message : 'the note could not be made.'));
      this.state = 'idle';
      this.paintButton();
    } finally {
      this.abort();
    }
  }
  stopRecorder() {
    return new Promise((resolve, reject) => {
      if (!this.recorder) { reject(new Error('nothing was recorded')); return; }
      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.recorder.mimeType || 'audio/webm' });
        if (!blob.size) reject(new Error('the recording came out empty'));
        else resolve(blob);
      };
      try { this.recorder.stop(); } catch (e) { reject(e); }
    });
  }
}

module.exports = { NexusQuickNoteModal, speechApi };
