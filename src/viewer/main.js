import { PdfView } from '../shared/pdfview.js';

const $ = (s) => document.querySelector(s);
const LS_POS = 'viewer-pos';
let version = 0;
let saveTimer = 0;

function theme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try {
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  } catch {
    /* ignore */
  }
}
let dark = true;
try {
  dark = localStorage.getItem('theme') !== 'light';
} catch {
  /* ignore */
}
theme(dark);
$('#btn-theme').onclick = () => {
  dark = !dark;
  theme(dark);
};

const sel = $('#zoom-select');
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
for (const [v, l] of ZOOMS) {
  const o = document.createElement('option');
  o.value = String(v);
  o.textContent = l;
  sel.append(o);
}

function savePos() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_POS, JSON.stringify(pv.getPosition()));
    } catch {
      /* ignore */
    }
  }, 250);
}

const pv = new PdfView($('#pdf-scroll'), {
  onPageChange: (p, n) => {
    if (document.activeElement !== $('#pg-input')) $('#pg-input').value = p;
    $('#pg-total').textContent = '/ ' + n;
  },
  onScroll: savePos,
  onZoom: (z, pct) => {
    const key = String(z);
    if (![...sel.options].some((o) => o.value === key)) {
      for (const o of [...sel.options]) if (o.dataset.custom) o.remove();
      const o = document.createElement('option');
      o.value = key;
      o.dataset.custom = '1';
      o.textContent = Math.round(pct * 100) + '%';
      sel.append(o);
    }
    sel.value = key;
    savePos();
  },
  onDblClick: async (page, x, y) => {
    try {
      const r = await fetch(`/api/synctex/edit?page=${page}&x=${x}&y=${y}`).then((res) =>
        res.ok ? res.json() : Promise.reject(new Error('no location')),
      );
      await fetch('/api/goto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(r),
      });
    } catch {
      /* ignore */
    }
  },
});

sel.onchange = () =>
  pv.setZoom(
    sel.value === 'fit-width' || sel.value === 'fit-page' ? sel.value : parseFloat(sel.value),
  );
$('#zoom-in').onclick = () => pv.zoomBy(1.2);
$('#zoom-out').onclick = () => pv.zoomBy(1 / 1.2);
$('#pg-prev').onclick = () => pv.goToPage(pv.currentPage - 1);
$('#pg-next').onclick = () => pv.goToPage(pv.currentPage + 1);
$('#pg-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    pv.goToPage(parseInt(e.target.value, 10) || 1);
    e.target.blur();
  }
});
$('#btn-download').onclick = () => {
  const a = document.createElement('a');
  a.href = `/pdf?v=${version}&download=1`;
  document.body.append(a);
  a.click();
  a.remove();
};
$('#btn-print').onclick = () => {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  f.src = `/pdf?v=${version}`;
  f.onload = () => {
    try {
      f.contentWindow.focus();
      f.contentWindow.print();
    } catch (e) {
      window.open(f.src);
    }
    setTimeout(() => f.remove(), 60000);
  };
  document.body.append(f);
};

let first = true;
async function reload(v) {
  if (!v || v === version) return;
  let anchor;
  if (first) {
    try {
      const p = JSON.parse(localStorage.getItem(LS_POS) || 'null');
      if (p) {
        anchor = { page: p.page || 0, frac: p.frac || 0, left: 0 };
        if (p.zoom !== undefined) {
          pv.zoom = p.zoom;
        }
      }
    } catch {
      /* ignore */
    }
  }
  const ok = await pv.load('/pdf?v=' + v, anchor ? { anchor } : undefined);
  if (ok) {
    version = v;
    first = false;
    $('#placeholder').style.display = 'none';
    if (anchor) pv.setZoom(pv.zoom);
  }
}

async function title() {
  try {
    const s = await fetch('/api/settings').then((r) => r.json());
    document.title =
      s.mainFile
        .split('/')
        .pop()
        .replace(/\.tex$/i, '') + '.pdf — LaTeX';
  } catch {
    document.title = 'PDF — LaTeX';
  }
}

async function status() {
  const st = await fetch('/api/status').then((r) => r.json());
  return st.version;
}

(async () => {
  title();
  try {
    await reload(await status());
  } catch (e) {
    console.error(e);
  }
  const es = new EventSource('/api/events');
  es.addEventListener('compiled', async () => {
    try {
      await reload(await status());
    } catch (e) {
      console.error(e);
    }
  });
  es.addEventListener('goto', () => {});
})();
