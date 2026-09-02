'use strict';

/* ============================================================================
 *  NEXUS SUITE · lib · the block's text
 *  How a board is written down. `source: block` means the fence IS the board:
 *  config lines, then one section per column and one checklist line per card.
 *

 *      title: Roadmap
 *      ## Backlog
 *      - [ ] Rework the tab bar
 *      ## Doing @2
 *      - [ ] [[Kanban module|Kanban]] @2026-08-25 #plugin
 *      ## Done
 *      - [x] Ship the pinned tabs
 *
 *  Why the cards live INSIDE the fence and not in the note body: a board note
 *  would otherwise render its columns twice — once as the board, once as plain
 *  markdown — and every card would need a hidden marker to stay addressable.
 *  Inside the block the whole board is ONE hand-editable text: it survives
 *  without the plugin, travels with the file, and needs no state in data.json.
 *
 *  Anything the parser does not understand is KEPT and written back, so a
 *  rewrite (drag, rename, new card) can never eat a line someone typed. It is
 *  re-emitted with the other config lines, so its position can move; blank
 *  lines are the one thing that does not survive.
 *
 *  The parser reads BOTH sources' keys, because both sources are one block and
 *  one config object — but only the keys the block's own source can write back:
 *  a key consumed and not written is a line deleted from somebody's note.
 *
 *  What a block card can be DONE to is kanbanedit.js; the head, the columns and
 *  the drag are kanban.js.
 * ========================================================================== */

const RE_HEAD = /^\s{0,3}#{1,6}\s+(.*)$/;
const RE_CARD = /^\s*[-*]\s+\[([ xX])\]\s?(.*)$/;
const RE_LINK = /\[\[([^\]|#]+)(?:\|([^\]]*))?\]\]/;
const RE_DUE = /(?:^|\s)@(\d{4}-\d{2}-\d{2})(?=\s|$)/;
const RE_TAG = /(?:^|\s)#([\p{L}\d/_-]+)/gu;
const FOLDER_FLAGS = ['excerpt', 'tags', 'links', 'orphans', 'state', 'graph'];

/* A column's colour says what KIND of column it is, read off its own name —
   nobody should have to configure "Done is green".

   These are Obsidian's SEMANTIC colours, not palette slots: on a warm palette
   (the theme's own "Ember & Prussian" has orange in color2, color3 AND color11)
   every column came out the same coral and the board lost its meaning. The
   theme already colours task states from the same three vars, so blue/orange/
   green is what the rest of the vault says too. */
const KIND_SLOT = {
  open:  ['--text-muted', '#8a8a95'],
  doing: ['--color-blue', '#4a9eff'],
  wait:  ['--color-orange', '#e9973f'],
  done:  ['--color-green', '#44cf6e'],
};
/* One vocabulary for both sources — the folder board used to bring its own,
   which is how "Ausbessern" was a column kind on one board and nothing on the
   other. Four kinds, because a fifth colour on a strip of columns stops being
   information: "needs rework" is something the board is waiting on. */
function bucketKind(title) {
  const t = String(title || '').toLowerCase();
  if (/erled|fertig|done|closed|abgeschlossen|ship|gelernt/.test(t)) return 'done';
  if (/wart|wait|block|halt|paus|später|spaeter|later|review|prüf|pruef|ausbess|fix|wiederhol|repeat/.test(t)) return 'wait';
  if (/arbeit|doing|progress|aktiv|activ|wip|läuft|laeuft|running|lern/.test(t)) return 'doing';
  return 'open';
}
function kindVar(kind) {
  const s = KIND_SLOT[kind] || KIND_SLOT.open;
  return 'var(' + s[0] + ', ' + s[1] + ')';
}
const truthy = (v) => /^(true|yes|1|on)$/i.test(String(v).trim());

/* ---- parse ---------------------------------------------------------------- */

/* One checklist line → card. `rest` keeps whatever is left after the link, the
   due date and the tags have been lifted out, so a card can carry free text
   next to a note link ("[[Spec]] second pass"). */
function parseCard(line) {
  const m = String(line).match(RE_CARD);
  if (!m) return null;
  let rest = m[2];
  const link = rest.match(RE_LINK);
  if (link) rest = rest.replace(RE_LINK, ' ');
  const due = rest.match(RE_DUE);
  if (due) rest = rest.replace(RE_DUE, ' ');
  const tags = [];
  rest = rest.replace(RE_TAG, (all, t) => { tags.push(t); return ' '; });
  const text = rest.replace(/\s+/g, ' ').trim();
  return {
    done: m[1].toLowerCase() === 'x',
    link: link ? link[1].trim() : '',
    alias: link && link[2] ? link[2].trim() : '',
    text,
    /* Filled by the parser from the indented lines under the card, so a card
       can say more than fits on one line. Empty for a card that has none. */
    desc: '',
    due: due ? due[1] : '',
    tags,
  };
}
/* What the card is CALLED — its own text wins, otherwise the note it points at. */
function cardTitle(card) {
  return card.text || card.alias || card.link || '';
}
/* A card's own lines: the checklist line, then its description indented under
   it. Two spaces, because that is what an editor and a human both read as "this
   belongs to the line above". */
function cardLines(card) {
  const out = [cardLine(card)];
  String(card.desc || '').split('\n').forEach(l => { if (l.trim()) out.push('  ' + l.trim()); });
  return out;
}
function cardLine(card) {
  const bits = [];
  if (card.link) bits.push('[[' + card.link + (card.alias && card.alias !== card.link ? '|' + card.alias : '') + ']]');
  if (card.text) bits.push(card.text);
  if (card.due) bits.push('@' + card.due);
  (card.tags || []).forEach(t => bits.push('#' + t));
  return '- [' + (card.done ? 'x' : ' ') + '] ' + bits.join(' ');
}

function parseKanban(src, defaults) {
  const cfg = Object.assign({
    source: 'block', title: '', notes: '', template: '', compact: false,
    due: true, tags: true, counts: true,
    /* Only a folder board reads these; a block board carries them so the two
       are one config object and the renderer never has to ask which it has. */
    folder: '', statusProp: 'status', mode: '',
    sort: 'name', dir: 'asc', size: 'medium', props: '', height: 260,
    excerpt: true, links: true, orphans: true, state: true, graph: false,
  }, defaults || {}, { buckets: [], extra: [], given: {} });
  // Which keys this block even HAS depends on its source, and `source:` may be
  // written under them — so it is read once, up front. Everything a block board
  // does not know is kept in `extra` and written back untouched.
  cfg.source = readSource(src, cfg.source);
  const folder = cfg.source === 'folder';
  let cur = null;
  // The card an indented line would belong to, cleared by anything that is not
  // a card or one of its own lines — so a stray indent further down the column
  // is kept as it was rather than glued onto a card three lines above.
  let lastCard = null;
  const bucket = (title, limit) => { cur = { title, limit: limit || 0, cards: [], extra: [] }; cfg.buckets.push(cur); return cur; };
  String(src || '').split('\n').forEach(raw => {
    const line = raw.replace(/\s+$/, '');
    const head = line.match(RE_HEAD);
    if (head) {
      lastCard = null;
      let title = head[1].trim();
      let limit = 0;
      const lim = title.match(/\s+@(\d+)$/);
      if (lim) { limit = parseInt(lim[1], 10) || 0; title = title.slice(0, lim.index).trim(); }
      cfg.given.headings = true;
      bucket(title, limit);
      return;
    }
    const card = parseCard(line);
    if (card) {
      // A card before the first heading still belongs somewhere — give it a home
      // rather than dropping it on the floor.
      if (!cur) bucket('Backlog', 0);
      cur.cards.push(card);
      lastCard = card;
      return;
    }
    // An indented line under a card is that card's description. Checked after
    // parseCard, so an indented checklist line is still a card of its own.
    const cont = line.match(/^(?:\t+| {2,})(\S.*)$/);
    if (cont && lastCard) {
      lastCard.desc = lastCard.desc ? lastCard.desc + '\n' + cont[1].trim() : cont[1].trim();
      return;
    }
    if (!line.trim()) return;
    lastCard = null;
    if (cur) { cur.extra.push(line); return; }
    const i = line.indexOf(':');
    if (i < 0) { cfg.extra.push(line); return; }
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    const path = () => v.replace(/^\/|\/$/g, '');
    switch (k) {
      // Read above. On a block board there is nothing to write it back as, so
      // the line is kept as it was typed.
      case 'source': cfg.given.source = true; if (!folder) cfg.extra.push(line); break;
      case 'title': cfg.title = v; break;
      case 'notes': cfg.notes = path(); cfg.given.notes = 'notes'; break;
      // On a folder board this is the query; on a block board it is the other
      // spelling of `notes:`, and it keeps the spelling it was written in.
      case 'folder':
        if (folder) cfg.folder = path();
        else { cfg.notes = path(); cfg.given.notes = 'folder'; }
        break;
      case 'template': cfg.template = v; break;
      case 'compact': cfg.compact = truthy(v); break;
      case 'due': cfg.due = truthy(v); break;
      case 'tags': cfg.tags = truthy(v); break;
      case 'counts': cfg.counts = truthy(v); break;
      default:
        if (!folder || !folderKey(cfg, k, v, bucket)) cfg.extra.push(line);
        else if (k === 'states' || k === 'columns') cur = null;
        break;
    }
  });
  return cfg;
}

/* `source:` decides how the rest of the block is read, so it is looked up
   before anything else — and only above the first column, where config lives. */
function readSource(src, fallback) {
  let out = fallback || 'block';
  for (const raw of String(src || '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (RE_HEAD.test(line) || RE_CARD.test(line)) break;
    const m = line.match(/^source\s*:\s*(.*)$/i);
    if (m) out = /folder|vault|query|notes/i.test(m[1]) ? 'folder' : 'block';
  }
  return out;
}

/* The keys only a folder board has. A block board must NOT consume them: it
   cannot write them back, so reading them would delete the line. */
function folderKey(cfg, k, v, bucket) {
  const g = cfg.given;
  switch (k) {
    case 'status': case 'statusproperty': cfg.statusProp = v || 'status'; g.status = k; return true;
    case 'mode': case 'view':
      cfg.mode = /graph|web|map/i.test(v) ? 'graph'
        : /board|kanban|status|column/i.test(v) ? 'board' : 'grid';
      g.mode = k;
      return true;
    // "Offen, In Arbeit, Erledigt" — the same columns a folder board would
    // otherwise spell as `## Offen` headings, kept for boards written before
    // the two blocks became one.
    case 'states': case 'columns':
      v.split(',').map(x => x.trim()).filter(Boolean).forEach(label => bucket(label, 0));
      g.states = k;
      return true;
    case 'sort': cfg.sort = v.toLowerCase(); return true;
    case 'dir': case 'direction': cfg.dir = /desc/i.test(v) ? 'desc' : 'asc'; g.dir = k; return true;
    case 'size': cfg.size = /small|large/i.test(v) ? v.toLowerCase() : 'medium'; return true;
    case 'props': cfg.props = v; return true;
    case 'height': cfg.height = Math.max(120, parseInt(v, 10) || 260); return true;
    case 'show': {
      const on = new Set(v.split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
      FOLDER_FLAGS.forEach(f => { cfg[f] = on.has(f); });
      g.show = true;
      return true;
    }
    default:
      if (FOLDER_FLAGS.indexOf(k) < 0) return false;
      cfg[k] = truthy(v);
      return true;
  }
}

/* The board back into the block — in the SHAPE it arrived in. Every key here
   has two spellings or two forms, and a writer that picks its own favourite
   silently reshapes text somebody typed by hand: `states: A, B` becomes four
   headings, `statusproperty:` becomes `status:`, a `nexus-board` fence grows a
   `source: folder` line it never needed. `cfg.given` records what was actually
   written, and nothing is emitted that the block did not either say itself or
   genuinely need. */
function stringifyKanban(cfg) {
  const out = [];
  const g = cfg.given || {};
  const folder = cfg.source === 'folder';
  // The ```nexus-board``` and ```nexus-graph``` fences ARE the source, so they
  // only carry the line if they were written with it.
  if (folder && g.source) out.push('source: folder');
  // A folder board leads with its question, the way the old block did.
  if (folder && cfg.folder) out.push('folder: ' + cfg.folder);
  if (cfg.title) out.push('title: ' + cfg.title);
  // Columns as one line, the way `states:` writes them — only while they still
  // fit in one: a WIP limit has no spelling there.
  const asList = folder && g.states && !g.headings && !(cfg.buckets || []).some(b => b.limit);
  if (folder) {
    if (cfg.mode && g.mode) out.push(g.mode + ': ' + cfg.mode);
    if (cfg.statusProp && (g.status || cfg.statusProp !== 'status'))
      out.push((g.status || 'status') + ': ' + cfg.statusProp);
    if (asList) out.push(g.states + ': ' + cfg.buckets.map(b => b.title).join(', '));
    if (cfg.sort !== 'name') out.push('sort: ' + cfg.sort);
    if (cfg.dir !== 'asc') out.push((g.dir || 'dir') + ': ' + cfg.dir);
    if (cfg.size !== 'medium') out.push('size: ' + cfg.size);
    if (cfg.props) out.push('props: ' + cfg.props);
    if (g.show) {
      const on = FOLDER_FLAGS.filter(f => cfg[f]);
      out.push('show: ' + (on.length ? on.join(', ') : 'none'));
    } else {
      if (cfg.excerpt === false) out.push('excerpt: false');
      if (cfg.links === false) out.push('links: false');
      if (cfg.orphans === false) out.push('orphans: false');
      if (cfg.state === false) out.push('state: false');
      if (cfg.graph) out.push('graph: true');
    }
    if (cfg.height !== 260) out.push('height: ' + cfg.height);
  }
  if (cfg.notes) out.push((g.notes || 'notes') + ': ' + cfg.notes);
  if (cfg.template) out.push('template: ' + cfg.template);
  if (cfg.compact) out.push('compact: true');
  if (cfg.due === false) out.push('due: false');
  /* `tags` means two things depending on the source: on a block board it is the
     card's own tag chips, on a folder board it is one of the flags a `show:`
     line already lists. Emitting it here as well gave a folder board a stray
     `tags: false` it never had — the two always agreed, so it was invisible
     except as a line the user did not write. */
  if (cfg.tags === false && !g.show) out.push('tags: false');
  if (cfg.counts === false) out.push('counts: false');
  (cfg.extra || []).forEach(l => out.push(l));
  if (asList) return out.join('\n');
  (cfg.buckets || []).forEach(b => {
    out.push('## ' + b.title + (b.limit ? ' @' + b.limit : ''));
    (b.cards || []).forEach(c => cardLines(c).forEach(l => out.push(l)));
    (b.extra || []).forEach(l => out.push(l));
  });
  return out.join('\n');
}

module.exports = {
  parseKanban, stringifyKanban, cardLine, cardLines, cardTitle,
  bucketKind, kindVar, KIND_SLOT,
};
