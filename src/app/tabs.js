import { EditorView } from '@codemirror/view';
import { api } from './api.js';
import { app, bus } from './app.js';
import { h, $, ico } from './dom.js';
import {
  createState,
  createView,
  themeComp,
  themeExt,
  diagnosticsTransaction,
  externalChange,
} from './editor.js';

const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp']);
const LS_TABS = 'tabs-open';
const LS_ACTIVE = 'tabs-active';

const docs = new Map(); // path -> doc record
let order = []; // open paths in tab order
let active = null;
let view = null;
let compileTimer = 0;

const bar = () => $('#tabbar');
const ext = (p) => (p.split('.').pop() || '').toLowerCase();

function kindOf(path) {
  const e = ext(path);
  if (IMG_EXT.has(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  return 'text';
}

// ---------- status
export function setStatus(text, cls = '') {
  const el = $('#save-status');
  el.textContent = text;
  el.className = cls;
}

// ---------- persistence
function persist() {
  try {
    localStorage.setItem(LS_TABS, JSON.stringify(order));
    localStorage.setItem(LS_ACTIVE, active || '');
  } catch {
    /* ignore */
  }
}

// ---------- text helpers
const curText = (d) =>
  d.path === active && view ? view.state.doc.toString() : d.state.doc.toString();
const handlers = {
  onChange(path) {
    const d = docs.get(path);
    if (!d) return;
    d.dirty = true;
    renderTabs();
    clearTimeout(d.timer);
    d.timer = setTimeout(() => saveNow(path), 1000);
    setStatus('Unsaved changes…', 'pending');
  },
  onCursor(path, state) {
    if (path !== active) return;
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => {
      const line = state.doc.lineAt(state.selection.main.head).number;
      bus.emit('cursor', { path, line });
    }, 100);
  },
  onSave: () => flushAll(),
  onCompile: () => requestCompile(),
  onForward: () => bus.emit('forward-sync'),
};
let cursorTimer = 0;

// ---------- saving
export function saveNow(path) {
  const d = docs.get(path);
  if (!d || d.kind !== 'text') return Promise.resolve();
  clearTimeout(d.timer);
  if (d.saving) return d.saving;
  if (!d.dirty) return Promise.resolve();
  d.saving = (async () => {
    try {
      for (;;) {
        const text = curText(d);
        setStatus('Saving…', 'pending');
        try {
          await api.putFile(path, text);
        } catch (e) {
          setStatus('Save failed — retrying', 'error');
          clearTimeout(d.timer);
          d.timer = setTimeout(() => saveNow(path), 3000);
          return;
        }
        d.savedText = text;
        if (curText(d) === text) {
          d.dirty = false;
          break;
        }
      }
      renderTabs();
      if (![...docs.values()].some((x) => x.dirty)) setStatus('All changes saved', 'ok');
      afterSave(path);
    } finally {
      d.saving = null;
    }
  })();
  return d.saving;
}

function afterSave(path) {
  bus.emit('saved', path);
  if (app.settings && app.settings.autoCompile) {
    clearTimeout(compileTimer);
    compileTimer = setTimeout(requestCompile, 1500);
  }
}

export async function flushAll() {
  const jobs = [];
  for (const d of docs.values())
    if (d.kind === 'text' && (d.dirty || d.saving)) jobs.push(saveNow(d.path));
  await Promise.all(jobs);
  // loop once more if edits landed while saving
  for (const d of docs.values())
    if (d.kind === 'text' && d.dirty && !d.saving) await saveNow(d.path);
}

export async function requestCompile() {
  clearTimeout(compileTimer);
  await flushAll();
  bus.emit('compile-requested');
  try {
    // compile the file in view if it is a standalone document; chapters pulled in with
    // \input/\include (no \documentclass) compile through the project's main file
    const text = isTextActive() && /\.tex$/i.test(active) ? getText(active) : null;
    const standalone = text && /^[^%\n]*\\documentclass/m.test(text);
    const res = await api.compile(standalone ? active : undefined);
    bus.emit('compile-response', res);
  } catch (e) {
    console.error('compile request failed', e);
    bus.emit('compile-response', {
      status: 'failed',
      issues: [
        {
          severity: 'error',
          file: null,
          line: null,
          message: 'Compile request failed: ' + e.message,
          context: '',
        },
      ],
      version: 0,
      durationMs: 0,
      local: true,
    });
  }
}

// ---------- view/tab management
function showMode(kind) {
  $('#editor-host').style.display = kind === 'text' ? '' : 'none';
  const pv = $('#preview');
  pv.style.display = kind === 'text' ? 'none' : '';
  bus.emit('editor-mode', kind);
}

function renderTabs() {
  const b = bar();
  if (!b) return;
  b.textContent = '';
  for (const p of order) {
    const d = docs.get(p);
    const name = p.split('/').pop();
    const tab = h(
      'div',
      {
        class: 'tab' + (p === active ? ' active' : '') + (d && d.dirty ? ' dirty' : ''),
        title: p,
        onclick: () => activate(p),
        onauxclick: (e) => {
          if (e.button === 1) {
            e.preventDefault();
            closeTab(p);
          }
        },
        onmousedown: (e) => {
          if (e.button === 1) e.preventDefault();
        },
      },
      h('span', {
        class: 'tab-ico',
        html: ico(kindOf(p) === 'text' ? 'file' : kindOf(p) === 'pdf' ? 'file' : 'image', 14),
      }),
      h('span', { class: 'tab-name' }, name),
      h('span', { class: 'tab-dot' }),
      h('button', {
        class: 'tab-x',
        title: 'Close',
        onclick: (e) => {
          e.stopPropagation();
          closeTab(p);
        },
        html: ico('x', 12),
      }),
    );
    // drag reorder
    tab.draggable = true;
    tab.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-tab', p);
      e.dataTransfer.effectAllowed = 'move';
    });
    tab.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-tab')) e.preventDefault();
    });
    tab.addEventListener('drop', (e) => {
      const from = e.dataTransfer.getData('application/x-tab');
      if (!from || from === p) return;
      e.preventDefault();
      order.splice(order.indexOf(from), 1);
      order.splice(order.indexOf(p), 0, from);
      persist();
      renderTabs();
    });
    b.append(tab);
  }
  const act = b.querySelector('.tab.active');
  if (act) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

async function loadDoc(path) {
  const kind = kindOf(path);
  const d = {
    path,
    kind,
    dirty: false,
    saving: null,
    again: false,
    timer: 0,
    savedText: '',
    state: null,
    scroll: 0,
    issues: [],
  };
  if (kind === 'text') {
    let text;
    try {
      text = await api.readFile(path);
    } catch (e) {
      if (e.status === 415) {
        d.kind = 'binary';
      } else throw e;
    }
    if (d.kind === 'text') {
      d.savedText = text;
      d.state = createState(path, text, handlers, app.dark);
      const issues = (app.issues || []).filter((i) => i.file === path);
      if (issues.length) d.state = d.state.update(diagnosticsTransaction(d.state, issues)).state;
    }
  }
  return d;
}

export async function openFile(path, { activateIt = true } = {}) {
  if (docs.has(path)) {
    if (activateIt) activate(path);
    return docs.get(path);
  }
  let d;
  try {
    d = await loadDoc(path);
  } catch (e) {
    console.warn('cannot open', path, e);
    return null;
  }
  docs.set(path, d);
  order.push(path);
  if (activateIt) await activate(path);
  else {
    renderTabs();
    persist();
  }
  return d;
}

export async function activate(path) {
  const d = docs.get(path);
  if (!d) return;
  // stash current
  const cur = active && docs.get(active);
  if (cur && cur.kind === 'text' && view) {
    cur.state = view.state;
    cur.scroll = view.scrollDOM.scrollTop;
  }
  active = path;
  bus.emit('active-changed', path);
  renderTabs();
  persist();
  const pv = $('#preview');
  if (d.kind === 'text') {
    if (!view) {
      view = createView($('#editor-host'));
      app.view = view;
    }
    // theme may have changed while the tab was in the background
    d.state = d.state.update({ effects: themeComp.reconfigure(themeExt(app.dark)) }).state;
    view.setState(d.state);
    view.scrollDOM.scrollTop = d.scroll || 0;
    showMode('text');
    view.focus();
    bus.emit('cursor', { path, line: d.state.doc.lineAt(d.state.selection.main.head).number });
  } else {
    pv.textContent = '';
    const url = '/raw/' + path.split('/').map(encodeURIComponent).join('/');
    if (d.kind === 'image') pv.append(h('img', { src: url + '?t=' + Date.now() }));
    else if (d.kind === 'pdf') pv.append(h('iframe', { src: url }));
    else pv.append(h('div', { class: 'cant-edit' }, "This file can't be edited here."));
    showMode(d.kind);
  }
}

export function closeTab(path) {
  const d = docs.get(path);
  if (!d) return;
  if (d.kind === 'text' && d.dirty) saveNow(path);
  const i = order.indexOf(path);
  order.splice(i, 1);
  docs.delete(path);
  if (active === path) {
    active = null;
    const next = order[i] || order[i - 1];
    if (next) activate(next);
    else {
      showMode('empty');
      $('#preview').textContent = '';
      $('#preview').style.display = '';
      $('#preview').append(
        h('div', { class: 'cant-edit' }, 'No file open. Pick one from the file tree.'),
      );
      bus.emit('active-changed', null);
    }
  }
  renderTabs();
  persist();
}

export function getActive() {
  return active;
}
export function getView() {
  return view;
}
export function isTextActive() {
  return !!(active && docs.get(active) && docs.get(active).kind === 'text');
}
export function openPaths() {
  return [...order];
}

export async function openAt(path, line, col) {
  const d = await openFile(path);
  if (!d || d.kind !== 'text') return;
  if (active !== path) await activate(path);
  const doc = view.state.doc;
  const ln = doc.line(Math.min(Math.max(1, line || 1), doc.lines));
  const from = ln.from + Math.min(Math.max(0, (col || 1) - 1), ln.length);
  view.dispatch({
    selection: { anchor: from },
    effects: EditorView.scrollIntoView(from, { y: 'center' }),
  });
  view.focus();
}

// select a range (search result)
export async function openRange(path, line, col, len) {
  await openAt(path, line, col);
  if (!view) return;
  const doc = view.state.doc;
  if (line > doc.lines) return;
  const ln = doc.line(line);
  const from = ln.from + Math.max(0, col - 1);
  view.dispatch({
    selection: { anchor: from, head: Math.min(from + len, ln.to) },
    effects: EditorView.scrollIntoView(from, { y: 'center' }),
  });
}

export function renamed(from, to) {
  const moves = [];
  for (const p of [...order]) {
    if (p === from || p.startsWith(from + '/')) moves.push([p, to + p.slice(from.length)]);
  }
  for (const [a, b] of moves) {
    const d = docs.get(a);
    d.path = b;
    docs.delete(a);
    docs.set(b, d);
    order[order.indexOf(a)] = b;
    if (active === a) active = b;
    // state closures capture the old path; rebuild the state with the new path
    if (d.kind === 'text') {
      d.state = createState(b, curText(d), handlers, app.dark);
      if (b === active && view) view.setState(d.state);
    }
  }
  renderTabs();
  persist();
}

export function removed(path) {
  for (const p of [...order])
    if (p === path || p.startsWith(path + '/')) {
      const d = docs.get(p);
      if (d) d.dirty = false;
      closeTab(p);
    }
}

export function applyTheme() {
  if (view && active) view.dispatch({ effects: themeComp.reconfigure(themeExt(app.dark)) });
  // other tabs are reconfigured lazily on activation
}

// Reload every open text file from disk (after replace-all); keeps undo history
export async function reloadAll() {
  for (const d of docs.values()) {
    if (d.kind !== 'text') continue;
    let text;
    try {
      text = await api.readFile(d.path);
    } catch {
      continue;
    }
    const state = d.path === active && view ? view.state : d.state;
    const old = state.doc.toString();
    if (old === text) continue;
    // minimal diff: common prefix/suffix
    let a = 0;
    while (a < old.length && a < text.length && old[a] === text[a]) a++;
    let b = 0;
    while (
      b < old.length - a &&
      b < text.length - a &&
      old[old.length - 1 - b] === text[text.length - 1 - b]
    )
      b++;
    const spec = {
      changes: { from: a, to: old.length - b, insert: text.slice(a, text.length - b) },
      annotations: externalChange.of(true),
    };
    if (d.path === active && view) view.dispatch(spec);
    else d.state = state.update(spec).state;
    d.dirty = false;
    d.savedText = text;
  }
  renderTabs();
}

// apply compile issues as lint markers
export function applyIssues(issues) {
  app.issues = issues;
  for (const d of docs.values()) {
    if (d.kind !== 'text') continue;
    const mine = issues.filter((i) => i.file === d.path);
    if (d.path === active && view) view.dispatch(diagnosticsTransaction(view.state, mine));
    else d.state = d.state.update(diagnosticsTransaction(d.state, mine)).state;
  }
}

export function getText(path) {
  const d = docs.get(path);
  return d && d.kind === 'text' ? curText(d) : null;
}

// ---------- startup
export async function restoreTabs() {
  let saved = [];
  let act = '';
  try {
    saved = JSON.parse(localStorage.getItem(LS_TABS) || '[]');
    act = localStorage.getItem(LS_ACTIVE) || '';
  } catch {
    /* ignore */
  }
  for (const p of saved) await openFile(p, { activateIt: false });
  if (act && docs.has(act)) await activate(act);
  else if (order.length) await activate(order[0]);
  else {
    showMode('empty');
    $('#preview').style.display = '';
    $('#preview').append(
      h('div', { class: 'cant-edit' }, 'No file open. Pick one from the file tree.'),
    );
  }
}

window.addEventListener('pagehide', () => {
  for (const d of docs.values()) {
    if (d.kind === 'text' && d.dirty)
      navigator.sendBeacon(
        '/api/file-beacon?path=' + encodeURIComponent(d.path),
        new Blob([curText(d)], { type: 'text/plain' }),
      );
  }
});
