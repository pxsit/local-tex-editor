import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

const GUTTER = 10; // px gap around pages
const CSS_UNITS = 96 / 72;
const KEEP_PAGES = 10; // free canvases further than this from the current page

const nextFrame = () =>
  new Promise((res) => {
    let done = false;
    const fin = () => {
      if (!done) {
        done = true;
        res();
      }
    };
    requestAnimationFrame(fin);
    setTimeout(fin, 120); // rAF may be paused in background tabs
  });

export class PdfView {
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;
    this.doc = null;
    this.wrapper = null;
    this.pages = []; // {el, proxy, ptW, ptH, w, h, canvas, key, task}
    this.zoom = opts.zoom || 'fit-width';
    this.scale = 1;
    this.gen = 0;
    this.currentPage = 1;
    this.numPages = 0;
    this.io = null;
    this._scrollRaf = 0;
    container.classList.add('pdf-scroll');

    container.addEventListener(
      'scroll',
      () => {
        if (this._scrollRaf) return;
        this._scrollRaf = requestAnimationFrame(() => {
          this._scrollRaf = 0;
          this._onScroll();
        });
      },
      { passive: true },
    );
    container.addEventListener('dblclick', (e) => this._dbl(e));
    container.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const cur = this.scale / CSS_UNITS;
        this.setZoom(Math.min(4, Math.max(0.25, cur * (e.deltaY < 0 ? 1.1 : 1 / 1.1))));
      },
      { passive: false },
    );
    let t = 0;
    this.ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (typeof this.zoom === 'string') this._applyZoom(false);
      }, 150);
    });
    this.ro.observe(container);
  }

  // ---------- geometry helpers
  _computeScale(firstW, firstH) {
    const cw = this.container.clientWidth || 600;
    const ch = this.container.clientHeight || 800;
    if (this.zoom === 'fit-width') return Math.max(0.1, (cw - 2 * GUTTER - 2) / firstW);
    if (this.zoom === 'fit-page')
      return Math.max(0.1, Math.min((cw - 2 * GUTTER) / firstW, (ch - 2 * GUTTER) / firstH));
    return this.zoom * CSS_UNITS;
  }

  captureAnchor() {
    const c = this.container;
    const st = c.scrollTop;
    const pages = this.pages;
    if (!pages.length) return { page: 0, frac: 0, left: c.scrollLeft };
    let idx = 0;
    for (let i = 0; i < pages.length; i++) {
      if (pages[i].el.offsetTop <= st + 1) idx = i;
      else break;
    }
    const el = pages[idx].el;
    return { page: idx, frac: (st - el.offsetTop) / el.offsetHeight, left: c.scrollLeft };
  }

  _targetTop(anchor, pages) {
    const p = pages[Math.min(Math.max(anchor.page, 0), pages.length - 1)];
    if (!p) return 0;
    return p.el.offsetTop + anchor.frac * p.el.offsetHeight;
  }

  _buildWrapper(proxies, scale) {
    const wrapper = document.createElement('div');
    wrapper.className = 'pdf-pages';
    const pages = proxies.map((proxy) => {
      const base = proxy.getViewport({ scale: 1 });
      // whole CSS pixels, so the canvas maps 1:1 onto device pixels (no resampling blur)
      const w = Math.round(base.width * scale);
      const h = Math.round(base.height * (w / base.width));
      const el = document.createElement('div');
      el.className = 'page';
      el.style.width = w + 'px';
      el.style.height = h + 'px';
      wrapper.appendChild(el);
      return {
        el,
        proxy,
        ptW: base.width,
        ptH: base.height,
        w,
        h,
        canvas: null,
        key: null,
        task: null,
        links: false,
      };
    });
    return { wrapper, pages };
  }

  // ---------- rendering
  async _renderPage(p, _idx, _gen) {
    const dpr = window.devicePixelRatio || 1;
    const key = p.w + 'x' + p.h + '@' + dpr;
    if (p.key === key && p.canvas) return;
    if (p.task) {
      try {
        p.task.cancel();
      } catch {
        /* ignore */
      }
      p.task = null;
    }
    const cw = Math.round(p.w * dpr);
    const vp = p.proxy.getViewport({ scale: cw / p.ptW });
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = Math.round(p.h * dpr);
    const task = p.proxy.render({
      canvas,
      canvasContext: canvas.getContext('2d'),
      viewport: vp,
    });
    p.task = task;
    try {
      await task.promise;
    } catch (e) {
      if (e && e.name === 'RenderingCancelledException') return;
      console.error('render failed', e);
      return;
    }
    if (p.task === task) p.task = null;
    if (!this.pages.includes(p) && !(this._pending && this._pending.includes(p))) return;
    if (p.canvas) p.canvas.remove();
    p.el.appendChild(canvas);
    p.canvas = canvas;
    p.key = key;
    this._addLinks(p);
  }

  // clickable link annotations (table of contents, \ref, \url ...)
  async _addLinks(p) {
    if (p.links) return;
    p.links = true;
    let annots;
    try {
      annots = await p.proxy.getAnnotations({ intent: 'display' });
    } catch (e) {
      console.warn('annotations failed', e);
      return;
    }
    const base = p.proxy.getViewport({ scale: 1 });
    for (const a of annots) {
      if (a.subtype !== 'Link' || !a.rect) continue;
      const url = a.url || a.unsafeUrl;
      if (!a.dest && !url) continue;
      // PDF user space (origin bottom-left) -> top-left page coordinates (unrotated pages)
      const [vx0, , , vy1] = base.viewBox || [0, 0, base.width, base.height];
      const x1 = a.rect[0] - vx0,
        x2 = a.rect[2] - vx0;
      const y1 = vy1 - a.rect[3],
        y2 = vy1 - a.rect[1];
      const el = document.createElement('a');
      el.className = 'pdf-link';
      el.style.left = (Math.min(x1, x2) / base.width) * 100 + '%';
      el.style.top = (Math.min(y1, y2) / base.height) * 100 + '%';
      el.style.width = (Math.abs(x2 - x1) / base.width) * 100 + '%';
      el.style.height = (Math.abs(y2 - y1) / base.height) * 100 + '%';
      el.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (url) {
          if (/^https?:/i.test(url)) window.open(url, '_blank', 'noopener');
          return;
        }
        this._gotoDest(a.dest);
      });
      p.el.appendChild(el);
    }
  }

  async _gotoDest(dest) {
    const doc = this.doc;
    if (!doc) return;
    try {
      const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
      if (!d) return;
      const idx = typeof d[0] === 'object' ? await doc.getPageIndex(d[0]) : d[0];
      const page = this.pages[idx];
      if (!page) return;
      let yTop = 0;
      const kind = d[1] && d[1].name;
      if (kind === 'XYZ') yTop = d[3] == null ? 0 : page.ptH - d[3];
      else if (kind === 'FitH' || kind === 'FitBH') yTop = d[2] == null ? 0 : page.ptH - d[2];
      this.container.scrollTop = Math.max(0, page.el.offsetTop + yTop * this.scale - 30);
      this._renderVisible();
    } catch (e) {
      console.warn('link goto failed', e);
    }
  }

  _renderRange(pages, from, to, gen) {
    const jobs = [];
    for (let i = Math.max(0, from); i <= Math.min(pages.length - 1, to); i++)
      jobs.push(this._renderPage(pages[i], i, gen));
    return Promise.all(jobs);
  }

  _visibleRange(pages, top, extra = 1) {
    const h = this.container.clientHeight || 800;
    let first = 0,
      last = pages.length - 1;
    for (let i = 0; i < pages.length; i++) {
      const el = pages[i].el;
      if (el.offsetTop + el.offsetHeight >= top) {
        first = i;
        break;
      }
    }
    for (let i = first; i < pages.length; i++) {
      if (pages[i].el.offsetTop > top + h * (1 + extra)) {
        last = i - 1;
        break;
      }
    }
    return [first, Math.max(first, last)];
  }

  _renderVisible() {
    if (!this.pages.length) return;
    const top = this.container.scrollTop;
    const [a, b] = this._visibleRange(this.pages, top);
    this._renderRange(this.pages, a - 1, b, this.gen);
  }

  _setupObserver() {
    if (this.io) this.io.disconnect();
    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const idx = this.pages.findIndex((p) => p.el === e.target);
          if (idx >= 0) this._renderPage(this.pages[idx], idx, this.gen);
        }
      },
      { root: this.container, rootMargin: '100% 0px 100% 0px' },
    );
    for (const p of this.pages) this.io.observe(p.el);
  }

  _onScroll() {
    const c = this.container;
    if (!this.pages.length) return;
    const probe = c.scrollTop + c.clientHeight / 3;
    let idx = 0;
    for (let i = 0; i < this.pages.length; i++) {
      if (this.pages[i].el.offsetTop <= probe) idx = i;
      else break;
    }
    if (idx + 1 !== this.currentPage) {
      this.currentPage = idx + 1;
      if (this.opts.onPageChange) this.opts.onPageChange(this.currentPage, this.numPages);
    }
    if (this.opts.onScroll) this.opts.onScroll();
    // free far-away canvases
    for (let i = 0; i < this.pages.length; i++) {
      const p = this.pages[i];
      if (p.canvas && Math.abs(i - idx) > KEEP_PAGES) {
        p.canvas.width = 0;
        p.canvas.remove();
        p.canvas = null;
        p.key = null;
      }
    }
  }

  // ---------- public API
  async load(url, { anchor: forcedAnchor } = {}) {
    const gen = ++this.gen;
    let doc;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = await r.arrayBuffer();
      if (gen !== this.gen) return false;
      doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      if (gen !== this.gen) {
        doc.destroy();
        return false;
      }
      const proxies = await Promise.all(
        Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)),
      );
      if (gen !== this.gen) {
        doc.destroy();
        return false;
      }

      const first = proxies[0].getViewport({ scale: 1 });
      const scale = this._computeScale(first.width, first.height);
      const { wrapper, pages } = this._buildWrapper(proxies, scale);
      wrapper.style.cssText = 'position:absolute;visibility:hidden;top:0;left:0;width:100%;';
      this.container.appendChild(wrapper);
      const saveScale = this.scale;
      let anchor = forcedAnchor || this.captureAnchor();
      const target0 = this._targetTop(anchor, pages);

      // render pages that will be visible after the swap, off-screen
      this._pending = pages;
      this.scale = scale; // _renderPage reads this.scale
      const [a, b] = this._visibleRange(pages, target0);
      try {
        await this._renderRange(pages, a - 1, b, gen);
      } finally {
        this.scale = saveScale;
        this._pending = null;
      }
      if (gen !== this.gen) {
        wrapper.remove();
        doc.destroy();
        return false;
      }
      await nextFrame();
      if (gen !== this.gen) {
        wrapper.remove();
        doc.destroy();
        return false;
      }

      // ---- atomic swap (no awaits)
      if (!forcedAnchor) anchor = this.captureAnchor(); // user may have scrolled meanwhile
      const oldDoc = this.doc;
      const oldWrapper = this.wrapper;
      for (const p of this.pages) {
        if (p.task) {
          try {
            p.task.cancel();
          } catch {
            /* ignore */
          }
        }
      }
      wrapper.style.cssText = '';
      if (oldWrapper) oldWrapper.remove();
      this.wrapper = wrapper;
      this.pages = pages;
      this.doc = doc;
      this.scale = scale;
      this.numPages = doc.numPages;
      const c = this.container;
      c.scrollTop = this._targetTop(anchor, pages);
      c.scrollLeft = anchor.left;
      // ----
      if (oldDoc) oldDoc.destroy();
      this._setupObserver();
      this._renderVisible();
      this._onScroll();
      this.currentPage = Math.min(this.currentPage, this.numPages) || 1;
      if (this.opts.onLoad) this.opts.onLoad(this.numPages);
      if (this.opts.onPageChange) this.opts.onPageChange(this.currentPage, this.numPages);
      return true;
    } catch (e) {
      console.error('PdfView.load failed (keeping previous view)', e);
      if (doc && doc !== this.doc) {
        try {
          doc.destroy();
        } catch {
          /* ignore */
        }
      }
      for (const w of this.container.querySelectorAll('.pdf-pages'))
        if (w !== this.wrapper) w.remove();
      return false;
    }
  }

  setZoom(z) {
    this.zoom = z;
    this._applyZoom(true);
    if (this.opts.onZoom) this.opts.onZoom(this.zoom, this.scale / CSS_UNITS);
  }

  _applyZoom(force) {
    if (!this.pages.length) return;
    const first = this.pages[0];
    const scale = this._computeScale(first.ptW, first.ptH);
    if (!force && Math.abs(scale - this.scale) < 0.001) return;
    const anchor = this.captureAnchor();
    this.scale = scale;
    for (const p of this.pages) {
      p.w = Math.round(p.ptW * scale);
      p.h = Math.round(p.ptH * (p.w / p.ptW));
      p.el.style.width = p.w + 'px';
      p.el.style.height = p.h + 'px';
      // keep the stretched old bitmap until re-rendered
    }
    this.container.scrollTop = this._targetTop(anchor, this.pages);
    this.container.scrollLeft = anchor.left;
    this._renderVisible();
    if (this.opts.onZoom) this.opts.onZoom(this.zoom, this.scale / CSS_UNITS);
  }

  zoomBy(f) {
    this.setZoom(Math.min(4, Math.max(0.25, (this.scale / CSS_UNITS) * f)));
  }

  goToPage(n) {
    if (!this.pages.length) return;
    n = Math.min(Math.max(1, Math.round(n)), this.numPages);
    this.container.scrollTop = this.pages[n - 1].el.offsetTop - GUTTER;
    this._renderVisible();
  }

  scrollToBox(page, x, y, w, h, flash = true) {
    const p = this.pages[page - 1];
    if (!p) return;
    const s = this.scale;
    const c = this.container;
    const top = p.el.offsetTop + y * s;
    c.scrollTop = Math.max(0, top - c.clientHeight / 3);
    const left = p.el.offsetLeft + x * s;
    if (left < c.scrollLeft || left > c.scrollLeft + c.clientWidth - 40)
      c.scrollLeft = Math.max(0, left - c.clientWidth / 3);
    this._renderVisible();
    if (flash) {
      const f = document.createElement('div');
      f.className = 'sync-flash';
      f.style.cssText = `left:${x * s - 2}px;top:${y * s - 2}px;width:${Math.max(w * s, 20) + 4}px;height:${Math.max(h * s, 8) + 4}px`;
      p.el.appendChild(f);
      setTimeout(() => f.remove(), 1700);
    }
  }

  _dbl(e) {
    if (!this.opts.onDblClick) return;
    const pageEl = e.target.closest && e.target.closest('.page');
    if (!pageEl) return;
    const idx = this.pages.findIndex((p) => p.el === pageEl);
    if (idx < 0) return;
    const r = pageEl.getBoundingClientRect();
    this.opts.onDblClick(
      idx + 1,
      (e.clientX - r.left) / this.scale,
      (e.clientY - r.top) / this.scale,
    );
  }

  // for position memory (viewer)
  getPosition() {
    const a = this.captureAnchor();
    return { page: a.page, frac: a.frac, zoom: this.zoom };
  }
}
