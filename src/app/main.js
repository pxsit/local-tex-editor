import { api } from './api.js';
import { app, bus } from './app.js';
import { $ } from './dom.js';
import { startEvents } from './events.js';
import { initLayout } from './layout.js';
import { initTree } from './tree.js';
import { initOutline } from './outline.js';
import { initSearch } from './search.js';
import { initLogPanel, setIssues, open as openLog, pulseBadge, refreshRaw } from './logpanel.js';
import { initToolbar } from './toolbar.js';
import { initPdfPane, loadPdf, pdfVersion } from './pdfpane.js';
import * as tabs from './tabs.js';
import { refreshCompletions, refreshCompletionsSoon } from './complete.js';

let lastKey = '';

function setCompiling(on) {
  const b = $('#btn-recompile');
  b.classList.toggle('busy', on);
  $('#recompile-label').textContent = on ? 'Compiling…' : 'Recompile';
}

function updateProjectLabel() {
  $('#main-label').textContent = '· main: ' + app.settings.mainFile;
}

async function handleResult(res, version) {
  if (!res) {
    setCompiling(false);
    return;
  }
  const key = `${version}:${res.durationMs}:${res.status}`;
  if (key === lastKey) {
    setCompiling(false);
    return;
  }
  lastKey = key;
  setCompiling(false);
  const issues = res.issues || [];
  setIssues(issues);
  tabs.applyIssues(issues);
  refreshRaw();
  const errors = issues.filter((i) => i.severity === 'error').length;
  if (res.status === 'failed') openLog();
  else if (errors) pulseBadge();
  if (version && version !== pdfVersion) await loadPdf(version);
}

async function main() {
  initLayout();
  app.settings = await api.settings();
  updateProjectLabel();

  // top bar
  const engine = $('#engine-select');
  engine.value = app.settings.engine;
  engine.onchange = async () => {
    app.settings = await api.putSettings({ engine: engine.value });
  };
  const auto = $('#auto-compile');
  auto.checked = app.settings.autoCompile;
  auto.onchange = async () => {
    app.settings = await api.putSettings({ autoCompile: auto.checked });
  };
  $('#btn-recompile').onclick = () => tabs.requestCompile();
  $('#btn-popout').onclick = () => window.open(`/pdf?v=${pdfVersion || 0}`, '_blank');
  $('#btn-download').onclick = () => {
    const a = document.createElement('a');
    a.href = `/pdf?v=${pdfVersion || 0}&download=1`;
    document.body.append(a);
    a.click();
    a.remove();
  };
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      tabs.requestCompile();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      tabs.flushAll();
    }
  });

  bus.on('settings-changed', () => {
    updateProjectLabel();
  });
  bus.on('theme', () => tabs.applyTheme());

  // compile flow
  bus.on('compile-requested', () => setCompiling(true));
  bus.on('sse:compile-start', () => setCompiling(true));
  bus.on('sse:compiled', async () => {
    try {
      const st = await api.status();
      await handleResult(st.lastResult, st.version);
    } catch (e) {
      console.error(e);
    }
  });
  bus.on('compile-response', (res) => {
    if (res.status === 'cancelled') return;
    handleResult(res, res.version);
  });
  bus.on('sse:compile-idle', () => setCompiling(false));
  bus.on('sse:goto', ({ file, line }) => {
    tabs.openAt(file, line);
    window.focus();
  });
  bus.on('saved', () => refreshCompletionsSoon());
  bus.on('tree-changed', () => refreshCompletionsSoon());

  initToolbar();
  initPdfPane();
  initLogPanel();
  initSearch();
  await Promise.all([initTree(), refreshCompletions()]);
  await tabs.restoreTabs();
  await initOutline();
  startEvents();

  try {
    const st = await api.status();
    setCompiling(st.compiling);
    if (st.lastResult) {
      lastKey = `${st.version}:${st.lastResult.durationMs}:${st.lastResult.status}`;
      setIssues(st.lastResult.issues);
      tabs.applyIssues(st.lastResult.issues);
    }
    if (st.version > 0) await loadPdf(st.version);
  } catch (e) {
    console.error(e);
  }
  window.__app = { app, tabs, bus };
}

main().catch((e) => {
  console.error(e);
  document.body.prepend(
    Object.assign(document.createElement('pre'), { textContent: 'Startup error: ' + e.stack }),
  );
});
