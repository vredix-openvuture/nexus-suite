'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · reusable settings inputs
 *  Autocomplete, multi-row, property-rule rows/groups, icon field.
 * ========================================================================== */

const { Menu, Setting, setIcon } = require('obsidian');
const { NexusIconPickerModal } = require('../modals/pickers.js');

/* Live suggestion list under an input. suggestFn() returns all candidates,
   filtered by the current input value. Pick via click/arrows/Enter. */
function nxAutocomplete(inputEl, suggestFn, onPick) {
  let dd = null, items = [], sel = -1;
  const close = () => { if (dd) { dd.remove(); dd = null; } sel = -1; };
  // Inline styles → works regardless of whether styles.css is loaded.
  const place = () => {
    if (!dd) { dd = document.body.createDiv('nx-ac-dropdown'); }
    const r = inputEl.getBoundingClientRect();
    // Under the field by default — but on a phone with the keyboard up there
    // is usually no room down there, and a list hanging off the bottom edge
    // can't be scrolled into view. Flip above the field instead, and cap the
    // height at whatever space that side actually has.
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const flip = below < 132 && above > below;
    const cap = Math.max(96, Math.min(240, flip ? above : below));
    dd.style.cssText =
      'position:fixed !important;z-index:999999;max-height:' + cap + 'px;overflow-y:auto;' +
      'background:var(--background-secondary,#2a2a2a);border:1px solid var(--background-modifier-border,#444);' +
      'border-radius:8px;box-shadow:0 6px 22px rgba(0,0,0,.4);padding:4px;' +
      'left:' + r.left + 'px;width:' + r.width + 'px;' +
      (flip ? 'bottom:' + (window.innerHeight - r.top + 3) + 'px;'
            : 'top:' + (r.bottom + 3) + 'px;');
  };
  const mkItem = (text, i, clickable) => {
    const el = dd.createDiv('nx-ac-item');
    el.textContent = text;
    el.style.cssText = 'padding:5px 9px;border-radius:6px;font-size:.88em;color:var(--text-normal,#ddd);' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' + (clickable ? 'cursor:pointer;' : 'opacity:.7;');
    if (i === sel) el.style.background = 'color-mix(in srgb, var(--interactive-accent) 28%, transparent)';
    return el;
  };
  const paint = () => {
    place(); dd.empty();
    items.forEach((s, i) => {
      const el = mkItem(s, i, true);
      el.addEventListener('mouseenter', () => { el.style.background = 'var(--background-modifier-hover,#3a3a3a)'; });
      el.addEventListener('mouseleave', () => { el.style.background = (i === sel) ? 'color-mix(in srgb, var(--interactive-accent) 28%, transparent)' : 'transparent'; });
      el.addEventListener('mousedown', (e) => { e.preventDefault(); inputEl.value = s; onPick(s); close(); });
    });
  };
  const open = () => {
    const q = inputEl.value.trim().toLowerCase();
    if (!q) { close(); return; }                         // only from the first character
    const all = (suggestFn() || []);
    let list = all.filter(s => s.toLowerCase().includes(q));
    const cnt = list.length;
    if (list.length === 1 && list[0].toLowerCase() === q) list = [];
    items = list.slice(0, 20);
    if (sel >= items.length) sel = items.length - 1;
    if (!items.length) {                                 // feedback instead of silence
      place(); dd.empty();
      mkItem(cnt ? '✓ ' + cnt + ' matches' : 'no matches', -1, false);
      return;
    }
    paint();
  };
  inputEl.addEventListener('input', () => { sel = -1; open(); });
  inputEl.addEventListener('focus', () => { sel = -1; open(); });
  inputEl.addEventListener('blur', () => setTimeout(close, 150));
  inputEl.addEventListener('keydown', (e) => {
    if (!dd) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); }
    else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); inputEl.value = items[sel]; onPick(items[sel]); close(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
}

function nxMultiRow(parent, name, desc, initial, sepChar, placeholder, onChange, suggestFn) {
  new Setting(parent).setName(name).setDesc(desc || '').setClass('nx-multirow-head');
  const wrap = parent.createDiv('nx-multirow');
  const commit = () => {
    const vals = Array.from(wrap.querySelectorAll('.nx-multirow-input'))
      .map(i => i.value.trim()).filter(Boolean);
    onChange(vals.join(sepChar + ' '));
  };
  function ensureEmpty() {
    const inputs = Array.from(wrap.querySelectorAll('.nx-multirow-input'));
    const last = inputs[inputs.length - 1];
    if (!last || last.value.trim() !== '') addRow('');
  }
  function addRow(val) {
    const row = wrap.createDiv('nx-multirow-row');
    const inp = row.createEl('input', { cls: 'nx-multirow-input', attr: { type: 'text', placeholder: placeholder || '' } });
    inp.value = val || '';
    const del = row.createDiv('nx-multirow-del');
    setIcon(del, 'x');
    del.setAttribute('aria-label', 'Remove row');
    del.onclick = () => {
      if (wrap.querySelectorAll('.nx-multirow-row').length <= 1) { inp.value = ''; commit(); return; }
      row.remove(); commit(); ensureEmpty();
    };
    inp.addEventListener('input', () => { commit(); ensureEmpty(); });
    if (suggestFn) nxAutocomplete(inp, suggestFn, () => { commit(); ensureEmpty(); });
    // Enter = confirm this row and jump to the next one (creating it if needed),
    // instead of just sitting there — runs after nxAutocomplete's own Enter
    // handling (which fills in a selected suggestion), so picking a suggestion
    // and advancing can happen in the same keystroke.
    inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      commit(); ensureEmpty();
      const inputs = Array.from(wrap.querySelectorAll('.nx-multirow-input'));
      const next = inputs[inputs.indexOf(inp) + 1];
      if (next) next.focus();
    });
    return inp;
  }
  String(initial || '').split(sepChar).map(s => s.trim()).filter(Boolean).forEach(addRow);
  addRow('');
  return wrap;
}

/* Old props strings ("key: v; key2: v2") → structured rules (all AND). */

/* Old props strings ("key: v; key2: v2") → structured rules (all AND). */
function nxPropsToRules(str) {
  return String(str || '').split(/[;\n]+/).map(s => s.trim()).filter(Boolean).map(seg => {
    const ci = seg.indexOf(':');
    return ci < 0
      ? { key: seg.trim(), value: '', conn: 'and' }
      : { key: seg.slice(0, ci).trim(), value: seg.slice(ci + 1).trim(), conn: 'and' };
  });
}

/* Structured property filter: per row [property] [value], with an AND/OR
   toggle in between. A new empty row appears automatically. onChange receives
   the cleaned-up rule array. */

/* Structured property filter: per row [property] [value], with an AND/OR
   toggle in between. A new empty row appears automatically. onChange receives
   the cleaned-up rule array. */
function nxPropRows(parent, name, desc, rules, onChange) {
  new Setting(parent).setName(name).setDesc(desc || '').setClass('nx-multirow-head');
  const wrap = parent.createDiv('nx-proprows');
  const data = (Array.isArray(rules) ? rules : []).map(r => ({ key: r.key || '', value: r.value || '', conn: r.conn || 'and' }));
  data.push({ key: '', value: '', conn: 'and' });   // empty row at the end

  const commit = () => onChange(
    data.filter(r => String(r.key).trim() || String(r.value).trim())
        .map(r => ({ key: String(r.key).trim(), value: String(r.value).trim(), conn: r.conn || 'and' }))
  );

  const rebuild = (focus) => {
    wrap.empty();
    data.forEach((r, i) => {
      const row = wrap.createDiv('nx-proprow');
      const k = row.createEl('input', { cls: 'nx-proprow-key', attr: { type: 'text', placeholder: 'Property (e.g. status)' } });
      const v = row.createEl('input', { cls: 'nx-proprow-val', attr: { type: 'text', placeholder: 'Value (empty = exists; "a, b" = OR)' } });
      k.value = r.key; v.value = r.value;
      const del = row.createDiv('nx-proprow-del'); setIcon(del, 'x'); del.setAttribute('aria-label', 'Remove row');
      const onInput = (field, inp) => {
        r[field] = inp.value;
        const wasLast = (i === data.length - 1);
        commit();
        if (wasLast && (r.key || r.value)) { data.push({ key: '', value: '', conn: 'and' }); rebuild({ i, field, pos: inp.selectionStart }); }
      };
      k.addEventListener('input', () => onInput('key', k));
      v.addEventListener('input', () => onInput('value', v));
      del.onclick = () => { if (data.length > 1) data.splice(i, 1); else { r.key = ''; r.value = ''; } commit(); rebuild(); };
      // Connector to the next row (not after the last)
      if (i < data.length - 1) {
        const conn = wrap.createDiv('nx-propconn');
        ['and', 'or'].forEach(val => {
          const b = conn.createEl('button', { cls: 'nx-propconn-btn' + (r.conn === val ? ' is-active' : ''), text: val === 'and' ? 'AND' : 'OR' });
          b.onclick = () => { r.conn = val; commit(); rebuild(); };
        });
      }
      if (focus && focus.i === i) {
        const inp = focus.field === 'key' ? k : v;
        inp.focus(); try { inp.setSelectionRange(focus.pos, focus.pos); } catch (_) {}
      }
    });
  };
  rebuild();
  return wrap;
}

/* Flat rules → groups (split at 'or' connectors). */

/* Flat rules → groups (split at 'or' connectors). */
function nxPropRulesToGroups(rules) {
  const groups = []; let cur = [];
  (rules || []).forEach(r => {
    cur.push({ key: r.key || '', value: r.value || '' });
    if ((r.conn || 'and').toLowerCase() === 'or') { groups.push(cur); cur = []; }
  });
  if (cur.length) groups.push(cur);
  return groups;
}

/* Grouped property filter: group boxes (AND inside), OR between them, plus
   "+ OR group". Property & value fields with live suggestions (autocomplete). */

/* Grouped property filter: group boxes (AND inside), OR between them, plus
   "+ OR group". Property & value fields with live suggestions (autocomplete). */
function nxPropGroups(plugin, parent, name, desc, groups, onChange) {
  new Setting(parent).setName(name).setDesc(desc || '').setClass('nx-multirow-head');
  const host = parent.createDiv('nx-propgroups');
  const data = (Array.isArray(groups) && groups.length ? groups : [[]])
    .map(g => (Array.isArray(g) ? g : []).map(c => ({ key: c.key || '', value: c.value || '' })));

  const commit = () => onChange(
    data.map(g => g.filter(c => String(c.key).trim() || String(c.value).trim())
                   .map(c => ({ key: String(c.key).trim(), value: String(c.value).trim() })))
        .filter(g => g.length)
  );

  const rebuild = (focus) => {
    host.empty();
    data.forEach((group, gi) => {
      if (gi > 0) host.createDiv({ cls: 'nx-propgroup-or', text: 'OR' });
      const box = host.createDiv('nx-propgroup');
      if (!group.length || (group[group.length - 1].key || group[group.length - 1].value)) group.push({ key: '', value: '' });
      group.forEach((c, ci) => {
        if (ci > 0) box.createDiv({ cls: 'nx-propgroup-and', text: 'and' });
        const row = box.createDiv('nx-proprow');
        const k = row.createEl('input', { cls: 'nx-proprow-key', attr: { type: 'text', placeholder: 'Property' } });
        const v = row.createEl('input', { cls: 'nx-proprow-val', attr: { type: 'text', placeholder: 'Value (empty = exists; "a, b" = OR)' } });
        k.value = c.key; v.value = c.value;
        const del = row.createDiv('nx-proprow-del'); setIcon(del, 'x'); del.setAttribute('aria-label', 'Remove row');
        const onInput = (field, inp) => {
          c[field] = inp.value;
          const wasLast = (ci === group.length - 1);
          commit();
          if (wasLast && (c.key || c.value)) { group.push({ key: '', value: '' }); rebuild({ gi, ci, field, pos: inp.selectionStart }); }
        };
        k.addEventListener('input', () => onInput('key', k));
        v.addEventListener('input', () => onInput('value', v));
        del.onclick = () => { group.splice(ci, 1); if (!group.length && data.length > 1) data.splice(gi, 1); commit(); rebuild(); };
        nxAutocomplete(k, () => plugin._allPropKeys(), (val) => { c.key = val; commit(); });
        nxAutocomplete(v, () => plugin._propValues(String(c.key).trim()), (val) => { c.value = val; commit(); });
        if (focus && focus.gi === gi && focus.ci === ci) { const inp = focus.field === 'key' ? k : v; inp.focus(); try { inp.setSelectionRange(focus.pos, focus.pos); } catch (_) {} }
      });
    });
    const add = host.createEl('button', { cls: 'nx-propgroup-add', text: '+ OR group' });
    add.onclick = () => { data.push([{ key: '', value: '' }]); commit(); rebuild(); };
  };
  rebuild();
  return host;
}

/* Icon picker: the preview button opens a searchable popup grid. */

/* Icon picker: the preview button opens a searchable popup grid. */
function nxIconField(app, parent, name, desc, getVal, onChange, def) {
  const setting = new Setting(parent).setName(name).setDesc(desc || '');
  let cur = getVal() || def || '';
  const btn = setting.controlEl.createDiv('nx-iconfield-btn');
  const paint = () => {
    btn.empty();
    setIcon(btn.createSpan('nx-iconfield-icon'), cur || def || 'help-circle');
    btn.createSpan({ cls: 'nx-iconfield-name', text: cur || '(no icon)' });
  };
  paint();
  btn.onclick = () => new NexusIconPickerModal(app, cur, (picked) => { cur = picked; onChange(picked); paint(); }).open();
  return setting;
}

/* Card action menu rendered as a centered modal WINDOW (like the other config
   modals), while mirroring Obsidian's Menu API (addItem → setTitle/setIcon/
   setChecked/setDisabled/setWarning/onClick, addSeparator, showAtMouseEvent/
   showAtPosition) so it stays a drop-in replacement for `new Menu()`. Position
   args are ignored — the window is centered with a backdrop + close button. */

/* ── Descriptions → tooltips ─────────────────────────────────────────────────
   A settings page used to explain itself in a paragraph under every single row,
   which turned each tab into a wall of text you had to read past to find the
   switch you came for. This folds every description away behind a small ⓘ next
   to the name it belongs to: hover shows Obsidian's own tooltip, and a click
   unfolds the text in place — the tablet has no hover, so a tooltip alone would
   simply hide the explanation there.

   It runs over the finished DOM instead of at 126 call sites, so pages written
   later are covered without anyone remembering to do it.

   `root` = the container a settings tab just rendered into. */
function nxFoldDescriptions(root) {
  if (!root) return;

  const hint = (host, list) => {
    const text = list.map(el => (el.textContent || '').trim()).filter(Boolean).join('\n\n');
    if (!host || !text) { list.forEach(el => { if (!(el.textContent || '').trim()) el.remove(); }); return; }
    list.forEach(el => el.addClass('nx-folded'));
    const btn = host.createSpan({ cls: 'nx-hint' });
    setIcon(btn, 'info');
    btn.setAttribute('aria-label', text);
    btn.tabIndex = 0;
    const toggle = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const open = !list[0].hasClass('is-open');
      list.forEach(el => el.toggleClass('is-open', open));
      btn.toggleClass('is-open', open);
    };
    btn.addEventListener('click', toggle);
    btn.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') toggle(ev); });
  };

  // 1. one row, one description
  root.querySelectorAll('.setting-item').forEach(item => {
    const desc = item.querySelector(':scope > .setting-item-info > .setting-item-description');
    if (!desc || desc.hasClass('nx-folded')) return;
    hint(item.querySelector(':scope > .setting-item-info > .setting-item-name'), [desc]);
  });

  // 2. section intros: the heading above them carries the icon (an h3 inside it
  //    keeps the icon on the title's line instead of below it)
  root.querySelectorAll('.nx-cardcfg-sec, .nx-settings-head').forEach(head => {
    const list = [];
    let n = head.nextElementSibling;
    while (n && n.matches('p.setting-item-description')) { list.push(n); n = n.nextElementSibling; }
    if (list.length) hint(head.querySelector('h3') || head, list);
  });

  // 3. a paragraph that explains the row above it rather than a section
  root.querySelectorAll('p.setting-item-description').forEach(p => {
    if (p.hasClass('nx-folded')) return;
    const prev = p.previousElementSibling;
    if (prev && prev.hasClass('setting-item')) {
      hint(prev.querySelector('.setting-item-name'), [p]);
    }
  });
}

module.exports = { nxAutocomplete, nxFoldDescriptions, nxMultiRow, nxPropsToRules, nxPropRows, nxPropRulesToGroups, nxPropGroups, nxIconField };
