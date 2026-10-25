import { PdfView } from '../shared/pdfview.js';
import { api } from './api.js';
import { bus } from './app.js';
import { $, h } from './dom.js';
import * as tabs from './tabs.js';
import { toast } from './layout.js';

let pv = null;
export let pdfVersion = 0;

const ZOOMS = [
  ['fit-width', 'Fit width'],
  ['fit-page', 'Fit page'],
  [0.5, '50%'],
  [0.75, '75%'],
  [1, '100%'],
  [1.25, '125%'],
  [1.5, '150%'],
  [2, '200%'],
  [3, '300%'],
  [4, '400%'],
];

export function getPdfView() {
  return pv;
}

export async function loadPdf(version) {
  if (!version) return;
  const ok = await pv.load('/pdf?v=' + version);
  if (ok) {
    pdfVersion = version;
    $('#pdf-placeholder').style.display = 'none';
  }
  return ok;
}

async function inverseSync(page, x, y) {
  try {
    const r = await api.synctexEdit(page, x, y);
    await tabs.openAt(r.file, r.line);
  } catch (e) {
    toast('No source location found here');
  }
}

export async function forwardSync() {
  const path = tabs.getActive();
  const view = tabs.getView();
  if (!path || !view || !tabs.isTextActive()) return;
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  try {
    await tabs.flushAll();
    const boxes = await api.synctexView(path, line.number, head - line.from);
    if (!boxes.length) {
      toast('No PDF location for this line (compile first?)');
      return;
    }
    const b = boxes[0];
    pv.scrollToBox(b.page, b.h, b.v - b.H, b.W, b.H, true);
  } catch (e) {
    toast('SyncTeX failed: ' + e.message);
  }
}

export function initPdfPane() {
  const sel = $('#zoom-select');
  for (const [v, l] of ZOOMS) sel.append(h('option', { value: String(v) }, l));
  sel.value = 'fit-width';

  pv = new PdfView($('#pdf-scroll'), {
    onPageChange: (p, n) => {
      const inp = $('#pg-input');
      if (document.activeElement !== inp) inp.value = p;
      $('#pg-total').textContent = '/ ' + n;
    },
    onZoom: (z, pct) => {
      const key = typeof z === 'string' ? z : String(z);
      if (![...sel.options].some((o) => o.value === key)) {
        for (const o of [...sel.options]) if (o.dataset.custom) o.remove();
        sel.append(h('option', { value: key, 'data-custom': '1' }, Math.round(pct * 100) + '%'));
      }
      sel.value = key;
    },
    onDblClick: inverseSync,
  });

  sel.onchange = () => {
    const v = sel.value;
    pv.setZoom(v === 'fit-width' || v === 'fit-page' ? v : parseFloat(v));
  };
  $('#zoom-in').onclick = () => pv.zoomBy(1.2);
  $('#zoom-out').onclick = () => pv.zoomBy(1 / 1.2);
  const pg = $('#pg-input');
  pg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      pv.goToPage(parseInt(pg.value, 10) || 1);
      pg.blur();
    }
  });
  pg.addEventListener('blur', () => {
    pg.value = pv.currentPage;
  });

  bus.on('forward-sync', forwardSync);
  $('#btn-forward').onclick = forwardSync;
}
