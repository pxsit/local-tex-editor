const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { CONTENTS_DIR, BUILD_DIR, safeResolve } = require('./paths');
const { findBin } = require('./bins');
const { parseLog } = require('./logparse');
const settings = require('./settings');

const OUT_PDF = path.join(BUILD_DIR, 'output.pdf');
const OUT_SYNCTEX = path.join(BUILD_DIR, 'output.synctex.gz');
const MAX_ENGINE_RUNS = 3;
const STEP_TIMEOUT_MS = 5 * 60 * 1000;

const events = new EventEmitter();
const state = { running: null, version: 0, lastResult: null, log: '' };
const bibCache = new Map(); // job -> signature of its last successful bib run

try {
  state.version = Math.floor(fs.statSync(OUT_PDF).mtimeMs);
} catch {
  /* none yet */
}

function log(...a) {
  events.emit('log', a.join(' '));
}

function killTree(proc) {
  if (!proc || proc.exitCode !== null || !proc.pid) return;
  try {
    spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } catch {
    try {
      proc.kill();
    } catch {
      /* gone */
    }
  }
}

function status() {
  return { version: state.version, compiling: !!state.running, lastResult: state.lastResult };
}

async function cancelRunning() {
  const r = state.running;
  if (!r) return false;
  r.cancelled = true;
  log('compile: cancelling running compile (kill pid ' + (r.proc && r.proc.pid) + ')');
  killTree(r.proc);
  try {
    await r.promise;
  } catch {
    /* ignore */
  }
  return true;
}

async function requestCompile(file) {
  while (state.running) await cancelRunning();
  const run = { cancelled: false, proc: null, promise: null, file };
  state.running = run;
  events.emit('compile-start', {});
  run.promise = doCompile(run, file).then(
    (res) => {
      if (state.running === run) state.running = null;
      return res;
    },
    (err) => {
      if (state.running === run) state.running = null;
      return {
        status: 'failed',
        version: state.version,
        issues: [
          {
            severity: 'error',
            file: null,
            line: null,
            message: 'Internal error: ' + err.message,
            context: '',
          },
        ],
        durationMs: 0,
      };
    },
  );
  const res = await run.promise;
  if (res.status === 'cancelled') {
    if (!state.running) events.emit('idle', {});
  } else {
    state.lastResult = res;
    events.emit('compiled', {
      version: res.version,
      status: res.status,
      errors: res.issues.filter((i) => i.severity === 'error').length,
      warnings: res.issues.filter((i) => i.severity === 'warning').length,
    });
  }
  return res;
}

function runProc(run, cmd, args, opts, header) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = '';
    const proc = spawn(cmd, args, {
      ...opts,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    run.proc = proc;
    state.log += '\n===== ' + header + ' =====\n';
    const timer = setTimeout(() => killTree(proc), STEP_TIMEOUT_MS);
    proc.stdout.on('data', (d) => {
      out += d;
    });
    proc.stderr.on('data', (d) => {
      out += d;
    });
    proc.on('error', (e) => {
      out += '\nspawn error: ' + e.message;
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (run.proc === proc) run.proc = null;
      resolve({ code, out, ms: Date.now() - started });
    });
  });
}

async function mirrorDirs(dirAbs = CONTENTS_DIR) {
  const ents = await fsp.readdir(dirAbs, { withFileTypes: true });
  for (const e of ents) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const abs = path.join(dirAbs, e.name);
    await fsp.mkdir(path.join(BUILD_DIR, path.relative(CONTENTS_DIR, abs)), {
      recursive: true,
    });
    await mirrorDirs(abs);
  }
}

async function auxFiles(dir = BUILD_DIR, acc = []) {
  let ents;
  try {
    ents = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await auxFiles(p, acc);
    else if (e.name.endsWith('.aux')) acc.push(p);
  }
  return acc;
}

async function auxHash() {
  const h = crypto.createHash('md5');
  const fl = (await auxFiles()).sort();
  for (const f of fl) {
    try {
      h.update(f).update(await fsp.readFile(f));
    } catch {
      /* skip */
    }
  }
  return h.digest('hex');
}

async function readOpt(p, enc = 'latin1') {
  try {
    return await fsp.readFile(p, enc);
  } catch {
    return null;
  }
}

async function bibSignature(job, kind) {
  const h = crypto.createHash('md5');
  if (kind === 'biber') {
    h.update((await readOpt(path.join(BUILD_DIR, job + '.bcf'))) || '');
  } else {
    const aux = (await readOpt(path.join(BUILD_DIR, job + '.aux'))) || '';
    const keys = new Set();
    for (const m of aux.matchAll(/\\citation\{([^}]*)\}/g))
      m[1].split(',').forEach((k) => keys.add(k.trim()));
    const other = [...aux.matchAll(/\\(bibdata|bibstyle)\{([^}]*)\}/g)].map((m) => m[0]);
    h.update([...keys].sort().join(',')).update(other.join('|'));
  }
  // .bib mtimes
  const bibs = [];
  for (const f of await listBibs()) {
    try {
      bibs.push(f + ':' + Math.floor(fs.statSync(f).mtimeMs));
    } catch {
      /* skip */
    }
  }
  h.update(bibs.sort().join('|'));
  return h.digest('hex');
}

async function listBibs(dir = CONTENTS_DIR, acc = []) {
  let ents;
  try {
    ents = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await listBibs(p, acc);
    else if (e.name.toLowerCase().endsWith('.bib')) acc.push(p);
  }
  return acc;
}

const RERUN_RE = /Rerun to get|Label\(s\) may have changed|Please rerun LaTeX|Rerun LaTeX/i;

async function doCompile(run, file) {
  const t0 = Date.now();
  state.log = '';
  const cfg = settings.load();
  const mainRel = file || cfg.mainFile;
  const finish = (status, issues) => ({
    status,
    version: state.version,
    issues: issues || [],
    durationMs: Date.now() - t0,
  });

  let mainAbs;
  try {
    mainAbs = safeResolve(mainRel);
  } catch {
    mainAbs = null;
  }
  if (!mainAbs || !fs.existsSync(mainAbs)) {
    state.log = `Main document ${mainRel} not found.`;
    return finish('failed', [
      {
        severity: 'error',
        file: null,
        line: null,
        message: `Main document "${mainRel}" not found. Create it or right-click a .tex file → Set as main document.`,
        context: '',
      },
    ]);
  }
  const job = path.basename(mainRel).replace(/\.tex$/i, '');
  const engine = cfg.engine;
  await fsp.mkdir(BUILD_DIR, { recursive: true });
  await mirrorDirs();
  await fsp.rm(path.join(BUILD_DIR, job + '.pdf'), { force: true });

  const engineArgs = [
    '-synctex=1',
    '-interaction=nonstopmode',
    '-file-line-error',
    ...(engine === 'lualatex' ? [] : ['-max-print-line=10000']),
    '-enable-installer',
    '-no-shell-escape',
    '-output-directory=.build',
    mainRel,
  ];
  const cwdOpt = { cwd: CONTENTS_DIR, env: { ...process.env, max_print_line: '10000' } };

  let engineRuns = 0;
  let bibRan = false;
  let lastLog = '';
  let prevAux = await auxHash();

  while (engineRuns < MAX_ENGINE_RUNS) {
    if (run.cancelled) return finish('cancelled');
    const res = await runProc(
      run,
      findBin(engine),
      engineArgs,
      cwdOpt,
      `${engine} ${engineArgs.join(' ')}`,
    );
    if (run.cancelled) return finish('cancelled');
    engineRuns++;
    let logTxt = null;
    try {
      if (fs.statSync(path.join(BUILD_DIR, job + '.log')).mtimeMs >= t0 - 1000)
        logTxt = await readOpt(path.join(BUILD_DIR, job + '.log'), 'utf8'); // TeX engines write UTF-8 logs
    } catch {
      /* none */
    }
    lastLog = logTxt || res.out;
    state.log += lastLog.replace(/\r?\n/g, '\n') + '\n';
    const aux = await auxHash();
    const auxChanged = aux !== prevAux;
    prevAux = aux;

    // bibliography (pointless after a fatal error: aux/bcf are incomplete)
    let ranBibNow = false;
    const fatal = /Emergency stop|Fatal error occurred|No pages of output/.test(lastLog);
    if (fatal) break;
    if (!run.cancelled) {
      const bcfPath = path.join(BUILD_DIR, job + '.bcf');
      const bblPath = path.join(BUILD_DIR, job + '.bbl');
      const hasBcf = fs.existsSync(bcfPath);
      const auxTxt = (await readOpt(path.join(BUILD_DIR, job + '.aux'))) || '';
      const kind = hasBcf ? 'biber' : /\\bibdata\{/.test(auxTxt) ? 'bibtex' : null;
      if (kind) {
        const sig = await bibSignature(job, kind);
        const needed = sig !== bibCache.get(job) || !fs.existsSync(bblPath);
        if (needed) {
          let r;
          if (kind === 'biber') {
            r = await runProc(
              run,
              findBin('biber'),
              ['--input-directory=' + CONTENTS_DIR, '--output-directory=.build', '.build/' + job],
              cwdOpt,
              `biber --input-directory=${CONTENTS_DIR} --output-directory=.build .build/${job}`,
            );
          } else {
            r = await runProc(
              run,
              findBin('bibtex'),
              ['-include-directory=' + CONTENTS_DIR, job],
              {
                cwd: BUILD_DIR,
                env: {
                  ...process.env,
                  BIBINPUTS: CONTENTS_DIR + ';',
                  BSTINPUTS: CONTENTS_DIR + ';',
                },
              },
              `bibtex -include-directory=${CONTENTS_DIR} ${job}`,
            );
          }
          state.log += r.out.replace(/\r?\n/g, '\n') + '\n';
          if (run.cancelled) return finish('cancelled');
          if (r.code === 0 || fs.existsSync(bblPath))
            bibCache.set(job, await bibSignature(job, kind));
          ranBibNow = true;
          bibRan = true;
        }
      }
    }

    // a changed aux (including the first one on a clean build) means TOC/refs may be stale
    const needRerun = ranBibNow || RERUN_RE.test(lastLog) || auxChanged;
    if (!needRerun) break;
    if (engineRuns >= MAX_ENGINE_RUNS) break;
  }
  if (run.cancelled) return finish('cancelled');

  // result
  const jobPdf = path.join(BUILD_DIR, job + '.pdf');
  let produced = false;
  try {
    produced = fs.statSync(jobPdf).mtimeMs >= t0 - 1000;
  } catch {
    /* no pdf */
  }
  if (produced) {
    await fsp.copyFile(jobPdf, OUT_PDF);
    try {
      await fsp.copyFile(path.join(BUILD_DIR, job + '.synctex.gz'), OUT_SYNCTEX);
    } catch {
      /* none */
    }
    state.version = Math.max(state.version + 1, 1);
  }
  const issues = parseLog(lastLog, CONTENTS_DIR);
  const hasErr = issues.some((i) => i.severity === 'error');
  if (!produced && !hasErr) {
    issues.unshift({
      severity: 'error',
      file: null,
      line: null,
      message: 'No PDF was produced. See the raw log.',
      context: '',
    });
  }
  log(`compile: ${engine} runs=${engineRuns} bib=${bibRan} pdf=${produced} ${Date.now() - t0}ms`);
  return finish(produced ? (hasErr ? 'error' : 'success') : 'failed', issues);
}

module.exports = { requestCompile, cancelRunning, status, events, state, OUT_PDF };
