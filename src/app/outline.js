import { api } from './api.js';
import { bus } from './app.js';
import { h, $ } from './dom.js';
import * as tabs from './tabs.js';

const LS = 'outline-collapsed';
let collapsed = new Set();
try {
  collapsed = new Set(JSON.parse(localStorage.getItem(LS) || '[]'));
} catch {
  /* ignore */
}
let items = [];
let mainMissing = false;
let cur = { path: null, line: 1 };
let timer = 0;
const key = (it) => `${it.title}|${it.file}|${it.line}`;

function nest(flat) {
  const root = { level: -1, children: [] };
  const stack = [root];
  for (const it of flat) {
    const node = { ...it, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= it.level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return root.children;
}

function currentItem() {
  if (!cur.path) return null;
  let found = null;
  for (const it of items) if (it.file === cur.path && it.line <= cur.line) found = it;
  if (found) return found;
  const firstIdx = items.findIndex((it) => it.file === cur.path);
  if (firstIdx > 0) return items[firstIdx - 1];
  // file included before any section of its own: last item preceding it can't be known; fall back to none
  return null;
}

function render() {
  const host = $('#outline');
  host.textContent = '';
  if (mainMissing) {
    host.append(
      h(
        'div',
        { class: 'tree-empty' },
        'The main document was not found. Create it or set another .tex file as main.',
      ),
    );
    return;
  }
  if (!items.length) {
    host.append(h('div', { class: 'tree-empty' }, 'No sections found.'));
    return;
  }
  const curIt = currentItem();
  const curKey = curIt && key(curIt);
  const draw = (nodes, depth, into) => {
    for (const n of nodes) {
      const k = key(n);
      const row = h('div', {
        class: 'ol-row' + (k === curKey ? ' current' : ''),
        style: { paddingLeft: 10 + depth * 24 + 'px' },
        title: `${n.file}:${n.line}`,
      });
      for (let i = 0; i < depth; i++)
        row.append(h('span', { class: 'ol-guide', style: { left: 17 + i * 24 + 'px' } }));
      const caret = h('span', {
        class:
          'tree-caret' + (n.children.length ? (collapsed.has(k) ? ' c-closed' : ' c-open') : ''),
      });
      caret.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!n.children.length) return;
        collapsed.has(k) ? collapsed.delete(k) : collapsed.add(k);
        try {
          localStorage.setItem(LS, JSON.stringify([...collapsed]));
        } catch {
          /* ignore */
        }
        render();
      });
      row.append(caret, h('span', { class: 'ol-title' }, n.title || '(untitled)'));
      row.addEventListener('click', () => tabs.openAt(n.file, n.line));
      into.append(row);
      if (n.children.length && !collapsed.has(k)) draw(n.children, depth + 1, into);
    }
  };
  draw(nest(items), 0, host);
  const el = host.querySelector('.ol-row.current');
  if (el) el.scrollIntoView({ block: 'nearest' });
}

export async function refreshOutline() {
  try {
    const r = await api.outline();
    items = r.items || [];
    mainMissing = !!r.mainMissing;
  } catch {
    return;
  }
  render();
}

export function initOutline() {
  bus.on('saved', () => {
    clearTimeout(timer);
    timer = setTimeout(refreshOutline, 400);
  });
  bus.on('tree-changed', refreshOutline);
  bus.on('settings-changed', refreshOutline);
  bus.on('cursor', (c) => {
    cur = c;
    render();
  });
  bus.on('active-changed', (p) => {
    cur = { path: p, line: 1 };
    render();
  });
  return refreshOutline();
}
