import { api } from './api.js';
import { bus } from './app.js';
import { h, $ } from './dom.js';
import * as tabs from './tabs.js';

let opts = { case: false, word: false, regex: false };
let results = [];
let timer = 0;
const collapsedFiles = new Set();

function totals() {
  return { files: results.length, matches: results.reduce((n, r) => n + r.matches.length, 0) };
}

async function run() {
  const q = $('#search-q').value;
  const out = $('#search-results');
  if (!q) {
    results = [];
    out.textContent = '';
    $('#search-summary').textContent = '';
    return;
  }
  try {
    results = await api.search({ q, ...opts });
  } catch (e) {
    out.textContent = '';
    out.append(h('div', { class: 'tree-empty err' }, e.message));
    return;
  }
  draw();
}

function draw() {
  const out = $('#search-results');
  out.textContent = '';
  const t = totals();
  $('#search-summary').textContent = t.matches
    ? `${t.matches} match${t.matches === 1 ? '' : 'es'} in ${t.files} file${t.files === 1 ? '' : 's'}`
    : 'No results';
  for (const r of results) {
    const group = h('div', { class: 'sr-group' });
    const head = h(
      'div',
      {
        class: 'sr-head',
        onclick: () => {
          collapsedFiles.has(r.path) ? collapsedFiles.delete(r.path) : collapsedFiles.add(r.path);
          draw();
        },
      },
      h('span', {
        class: 'tree-caret ' + (collapsedFiles.has(r.path) ? 'c-closed' : 'c-open'),
      }),
      h('span', { class: 'sr-file' }, r.path),
      h('span', { class: 'sr-count' }, r.matches.length),
    );
    group.append(head);
    if (!collapsedFiles.has(r.path)) {
      for (const m of r.matches) {
        const text = m.text;
        const off = m.off ?? 0;
        group.append(
          h(
            'div',
            {
              class: 'sr-line',
              title: `${r.path}:${m.line}`,
              onclick: () => tabs.openRange(r.path, m.line, m.col, m.len),
            },
            h('span', { class: 'sr-ln' }, m.line),
            h(
              'span',
              { class: 'sr-text' },
              text.slice(0, off),
              h('mark', null, text.slice(off, off + m.len)),
              text.slice(off + m.len),
            ),
          ),
        );
      }
    }
    out.append(group);
  }
}

async function replaceAll() {
  const q = $('#search-q').value;
  if (!q) return;
  await run();
  const t = totals();
  if (!t.matches) return;
  if (!confirm(`Replace ${t.matches} matches in ${t.files} files?`)) return;
  await tabs.flushAll();
  try {
    const r = await api.replace({ q, ...opts, replacement: $('#search-r').value });
    await tabs.reloadAll();
    bus.emit('saved', null);
    $('#search-summary').textContent = `Replaced ${r.replacements} in ${r.files} file(s)`;
  } catch (e) {
    alert('Replace failed: ' + e.message);
  }
  const keep = $('#search-summary').textContent;
  await run();
  if (!results.length) $('#search-summary').textContent = keep;
}

export function initSearch() {
  const toggle = (id, key) => {
    const b = $(id);
    b.onclick = () => {
      opts[key] = !opts[key];
      b.classList.toggle('on', opts[key]);
      run();
    };
  };
  toggle('#sq-case', 'case');
  toggle('#sq-word', 'word');
  toggle('#sq-regex', 'regex');
  $('#search-q').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 300);
  });
  $('#search-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(timer);
      run();
    }
  });
  $('#search-replace-all').onclick = replaceAll;
  bus.on('tree-changed', () => {
    if ($('#search-q').value) run();
  });
}

export function focusSearch() {
  const q = $('#search-q');
  q.focus();
  q.select();
}
