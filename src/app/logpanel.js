import { api } from './api.js';
import { h, $ } from './dom.js';
import * as tabs from './tabs.js';

let issues = [];
let rawOpen = false;

export function setIssues(list) {
  issues = list || [];
  const e = issues.filter((i) => i.severity === 'error').length;
  const w = issues.filter((i) => i.severity === 'warning').length;
  const be = $('#badge-err'),
    bw = $('#badge-warn');
  be.textContent = e;
  be.style.display = e ? '' : 'none';
  bw.textContent = w;
  bw.style.display = w ? '' : 'none';
  draw();
}

export function pulseBadge() {
  const b = $('#btn-logs');
  b.classList.remove('pulse');
  void b.offsetWidth;
  b.classList.add('pulse');
}

export function isOpen() {
  return $('#logpanel').classList.contains('open');
}
export function open() {
  $('#logpanel').classList.add('open');
  $('#btn-logs').classList.add('on');
  if (rawOpen) loadRaw();
}
export function close() {
  $('#logpanel').classList.remove('open');
  $('#btn-logs').classList.remove('on');
}
export function toggle() {
  isOpen() ? close() : open();
}

async function loadRaw() {
  $('#log-raw').textContent = await api.log();
}

function draw() {
  const body = $('#log-body');
  body.textContent = '';
  if (!issues.length) {
    body.append(h('div', { class: 'log-empty' }, 'No errors or warnings.'));
    return;
  }
  const groups = [
    ['error', 'Errors'],
    ['warning', 'Warnings'],
    ['typesetting', 'Typesetting'],
  ];
  for (const [sev, title] of groups) {
    const list = issues.filter((i) => i.severity === sev);
    if (!list.length) continue;
    body.append(h('div', { class: 'log-group-title' }, `${title} (${list.length})`));
    for (const it of list) {
      const loc = it.file ? `${it.file}${it.line ? ':' + it.line : ''}` : '';
      const card = h(
        'div',
        {
          class: 'log-card ' + sev + (it.file ? ' clickable' : ''),
          onclick: () => {
            if (it.file) tabs.openAt(it.file, it.line || 1);
          },
        },
        h('div', { class: 'log-msg' }, it.message),
        loc ? h('div', { class: 'log-loc' }, loc) : null,
      );
      if (it.context) {
        const ctx = h('pre', { class: 'log-ctx', style: { display: 'none' } }, it.context);
        card.append(
          h(
            'button',
            {
              class: 'log-more',
              onclick: (e) => {
                e.stopPropagation();
                ctx.style.display = ctx.style.display === 'none' ? '' : 'none';
              },
            },
            'details',
          ),
          ctx,
        );
      }
      body.append(card);
    }
  }
}

export function initLogPanel() {
  $('#btn-logs').onclick = toggle;
  $('#log-close').onclick = close;
  $('#log-raw-btn').onclick = () => {
    rawOpen = !rawOpen;
    $('#log-raw').style.display = rawOpen ? '' : 'none';
    $('#log-raw-btn').classList.toggle('on', rawOpen);
    if (rawOpen) loadRaw();
  };
  setIssues([]);
}

export function refreshRaw() {
  if (rawOpen && isOpen()) loadRaw();
}
