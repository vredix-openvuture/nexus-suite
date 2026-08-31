/* Minimal stand-in for Obsidian's runtime, enough to drive _buildSketchBar in
   a real browser: the DOM is real, only the app shell is faked. */
class Plugin { constructor(app, manifest) { this.app = app; this.manifest = manifest; } }
class PluginSettingTab {}
class Setting {}
class Modal {}
class ItemView {}
class Notice { constructor(msg) { (window.__notices = window.__notices || []).push(msg); } }
class TFile {}
class TFolder {}
class TAbstractFile {}
class Component {}
class MarkdownView {}
class FuzzySuggestModal {}
class SuggestModal {}
class EditorSuggest {}
class Menu {}
class MenuItem {}
class ButtonComponent {}
class Platform {}
/* Enough of moment for the code under test: a fixed instant, so a timestamp
   written into frontmatter is a real string an assertion can check. */
const FIXED = '2026-01-02T03:04';
function moment() {
  return {
    format: (f) => (f && f.indexOf('T') < 0 ? FIXED.slice(0, 10) : FIXED),
    isValid: () => true,
    add() { return this; },
    from: () => 'a while ago',
    toISOString: () => FIXED + ':00.000Z',
  };
}
moment.locale = () => 'en';
const requestUrl = async () => ({ status: 200, text: '', json: {} });
const normalizePath = (p) => p;
const debounce = (fn) => fn;
const setTooltip = () => {};
const parseYaml = () => ({});
const stringifyYaml = () => '';
const addIcon = () => {};
const getIcon = () => null;
/* Icons are the one thing that must be observable: the tests assert on which
   icon a button got, so record it as a data attribute instead of drawing SVG. */
function setIcon(el, name) {
  el.dataset.icon = name;
  el.innerHTML = '<span class="svg-icon"></span>';
}
module.exports = {
  Plugin, PluginSettingTab, Setting, Modal, ItemView, Notice, TFile, TFolder,
  TAbstractFile, Component, MarkdownView, FuzzySuggestModal, SuggestModal, Menu,
  MenuItem, ButtonComponent, Platform, EditorSuggest, moment, requestUrl, normalizePath,
  debounce, setIcon, setTooltip, parseYaml, stringifyYaml, addIcon, getIcon,
  MarkdownRenderer: { render: async () => {}, renderMarkdown: async () => {} },
};
