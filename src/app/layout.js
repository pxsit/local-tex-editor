import { app, bus } from './app.js';
import { $, ico } from './dom.js';
import { focusSearch } from './search.js';

const LS = (k, d) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v;
  } catch {
    return d;
  }
};
const LSset = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

const RAIL_W = 44,
  RZ_W = 6,
  MIN_PANE = 250;
let sbW = +LS('sb-w', 260);
let pdfW = +LS('pdf-w', 0);
let sbCollapsed = LS('sb-collapsed', '0') === '1';
let view = LS('rail-view', 'files');

export function applyTheme(dark) {
  app.dark = dark;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  LSset('theme', dark ? 'dark' : 'light');
  const b = $('#btn-theme');
  b.innerHTML = ico(dark ? 'sun' : 'moon', 16);
  b.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
  bus.emit('theme', dark);
}

let toastTimer = 0;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

function effectiveSb() {
  return sbCollapsed ? 0 : sbW;
}

function clampAll() {
  const total = document.documentElement.clientWidth;
  sbW = Math.min(600, Math.max(160, sbW));
  const maxPdf = total - RAIL_W - effectiveSb() - (sbCollapsed ? RZ_W : 2 * RZ_W) - MIN_PANE;
  if (!pdfW) pdfW = Math.round((total - RAIL_W - effectiveSb() - 2 * RZ_W) / 2);
  pdfW = Math.max(MIN_PANE, Math.min(pdfW, Math.max(MIN_PANE, maxPdf)));
}

function apply() {
  clampAll();
  const app_ = $('#app');
  app_.style.setProperty('--sb-w', effectiveSb() + 'px');
  app_.style.setProperty('--pdf-w', pdfW + 'px');
  app_.classList.toggle('sb-collapsed', sbCollapsed);
  bus.emit('layout');
}

function setView(v) {
  view = v;
  LSset('rail-view', v);
  $('#view-files').style.display = v === 'files' ? '' : 'none';
  $('#view-search').style.display = v === 'search' ? '' : 'none';
  for (const b of document.querySelectorAll('#rail button'))
    b.classList.toggle('active', b.dataset.view === v && !sbCollapsed);
}

function setCollapsed(c) {
  sbCollapsed = c;
  LSset('sb-collapsed', c ? '1' : '0');
  apply();
  setView(view);
}

function drag(handle, onMove, onDbl) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    $('#drag-overlay').style.display = 'block';
    handle.classList.add('dragging');
    const move = (ev) => onMove(ev);
    const up = (ev) => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.classList.remove('dragging');
      $('#drag-overlay').style.display = 'none';
      LSset('sb-w', sbW);
      LSset('pdf-w', pdfW);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
  if (onDbl) handle.addEventListener('dblclick', onDbl);
}

export function initLayout() {
  // theme
  applyTheme(LS('theme', 'dark') !== 'light');
  $('#btn-theme').onclick = () => applyTheme(!app.dark);

  // rail
  document.querySelector('#rail').innerHTML = `
    <button data-view="files" title="Files">${ico('file', 20)}</button>
    <button data-view="search" title="Search (Ctrl+Shift+F)">${ico('search', 20)}</button>`;
  for (const b of document.querySelectorAll('#rail button')) {
    b.onclick = () => {
      const v = b.dataset.view;
      if (v === view && !sbCollapsed) {
        setCollapsed(true);
        return;
      }
      view = v;
      if (sbCollapsed) {
        sbCollapsed = false;
        LSset('sb-collapsed', '0');
        apply();
      }
      setView(v);
      if (v === 'search') focusSearch();
    };
  }
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        e.stopPropagation();
        view = 'search';
        if (sbCollapsed) {
          sbCollapsed = false;
          LSset('sb-collapsed', '0');
          apply();
        }
        setView('search');
        focusSearch();
      }
    },
    true,
  );

  $('#btn-close-sidebar').onclick = (e) => {
    e.stopPropagation();
    setCollapsed(true);
  };

  // accordion
  const open = LS('accordion', 'tree');
  const setAcc = (name) => {
    LSset('accordion', name);
    $('#sec-tree').classList.toggle('open', name === 'tree');
    $('#sec-outline').classList.toggle('open', name === 'outline');
  };
  setAcc(open === 'outline' ? 'outline' : 'tree');
  $('#sec-tree .acc-head').addEventListener('click', () => setAcc('tree'));
  $('#sec-outline .acc-head').addEventListener('click', () => setAcc('outline'));

  // resizers
  drag($('#rz1'), (e) => {
    sbW = e.clientX - RAIL_W;
    apply();
  });
  drag(
    $('#rz2'),
    (e) => {
      const total = document.documentElement.clientWidth;
      pdfW = total - e.clientX - RZ_W / 2;
      apply();
    },
    () => {
      pdfW = 0;
      apply();
      LSset('pdf-w', pdfW);
    },
  );

  window.addEventListener('resize', apply);
  apply();
  setView(view);
}
