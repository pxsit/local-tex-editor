const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const P = require('./lib/paths');
const files = require('./lib/files');
const settings = require('./lib/settings');
const compile = require('./lib/compile');
const synctex = require('./lib/synctex');
const outline = require('./lib/outline');

const PORT = +process.env.PORT || 8170;
const HOST = '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}
compile.events.on('log', (m) => log(m));

const app = express();
app.disable('x-powered-by');

// DNS-rebinding / CSRF guard
app.use((req, res, next) => {
  if (!ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase()))
    return res.status(403).send('Forbidden host');
  if (
    req.method !== 'GET' &&
    req.method !== 'HEAD' &&
    req.headers.origin &&
    !ALLOWED_ORIGINS.has(req.headers.origin)
  ) {
    return res.status(403).send('Forbidden origin');
  }
  next();
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const json = express.json({ limit: '5mb' });
const text = express.text({ type: '*/*', limit: '50mb' });
// browsers send UTF-8 filenames without a charset parameter; busboy would decode them as latin1
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  defParamCharset: 'utf8',
});

app.get('/api/ping', (req, res) => res.json({ ok: true }));

// ---- files
app.get(
  '/api/tree',
  wrap(async (req, res) => res.json(await files.tree())),
);
app.get(
  '/api/file',
  wrap(async (req, res) => {
    res.type('text/plain; charset=utf-8').send(await files.readText(String(req.query.path || '')));
  }),
);
const putFile = wrap(async (req, res) => {
  const rel = String(req.query.path || '');
  await files.writeText(rel, typeof req.body === 'string' ? req.body : '');
  res.json({ ok: true });
});
app.put('/api/file', text, putFile);
app.post('/api/file-beacon', text, putFile);
app.post(
  '/api/new-file',
  json,
  wrap(async (req, res) => {
    await files.newFile(req.body.path);
    res.json({ ok: true });
  }),
);
app.post(
  '/api/mkdir',
  json,
  wrap(async (req, res) => {
    await files.mkdir(req.body.path);
    res.json({ ok: true });
  }),
);
app.post(
  '/api/rename',
  json,
  wrap(async (req, res) => {
    await files.rename(req.body.from, req.body.to);
    res.json({ ok: true, settings: settings.load() });
  }),
);
app.delete(
  '/api/entry',
  wrap(async (req, res) => {
    await files.remove(String(req.query.path || ''));
    res.json({ ok: true });
  }),
);
app.post(
  '/api/upload',
  upload.array('files'),
  wrap(async (req, res) => {
    const written = await files.upload(String(req.query.dir || ''), req.files || []);
    res.json({ ok: true, files: written });
  }),
);
app.get(
  '/raw/*path',
  wrap(async (req, res) => {
    const rel = [].concat(req.params.path).join('/');
    const abs = P.safeResolve(rel);
    if (req.query.download)
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${path.basename(abs).replace(/"/g, '')}"`,
      );
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(abs, { dotfiles: 'allow' }, (err) => {
      if (err && !res.headersSent)
        res.status(err.statusCode === 404 || err.code === 'ENOENT' ? 404 : 500).end();
    });
  }),
);

const flag = (v) => v === '1' || v === 1 || v === true || v === 'true';
app.get(
  '/api/search',
  wrap(async (req, res) => {
    res.json(
      await files.search({
        q: String(req.query.q || ''),
        regex: flag(req.query.regex),
        case: flag(req.query.case),
        word: flag(req.query.word),
      }),
    );
  }),
);
app.post(
  '/api/replace',
  json,
  wrap(async (req, res) => {
    const b = req.body || {};
    res.json(
      await files.replace({
        q: String(b.q || ''),
        regex: !!b.regex,
        case: !!b.case,
        word: !!b.word,
        replacement: String(b.replacement ?? ''),
        paths: b.paths,
      }),
    );
  }),
);

// ---- settings
app.get('/api/settings', (req, res) => res.json(settings.load()));
app.put('/api/settings', json, (req, res) => res.json(settings.update(req.body || {})));

// ---- compile
app.get('/api/status', (req, res) => res.json(compile.status()));
app.post(
  '/api/compile',
  json,
  wrap(async (req, res) => {
    let file = req.body && req.body.file;
    if (typeof file === 'string' && /\.tex$/i.test(file)) {
      P.safeResolve(file);
      file = P.norm(file);
    } else file = undefined;
    res.json(await compile.requestCompile(file));
  }),
);
app.post(
  '/api/compile/cancel',
  wrap(async (req, res) => {
    res.json({ cancelled: await compile.cancelRunning() });
  }),
);
app.get('/api/log', (req, res) =>
  res.type('text/plain; charset=utf-8').send(compile.state.log || ''),
);
app.get('/pdf', (req, res) => {
  if (!fs.existsSync(compile.OUT_PDF)) return res.status(404).send('No PDF yet');
  res.setHeader('Cache-Control', 'no-store');
  if (req.query.download) {
    const job = path.basename(settings.load().mainFile).replace(/\.tex$/i, '');
    res.setHeader('Content-Disposition', `attachment; filename="${job}.pdf"`);
  }
  res.type('application/pdf');
  res.sendFile(compile.OUT_PDF, { dotfiles: 'allow' });
});

// ---- synctex
app.get(
  '/api/synctex/view',
  wrap(async (req, res) => {
    const file = P.norm(String(req.query.file || ''));
    P.safeResolve(file);
    res.json(
      await synctex.forward(
        file,
        Math.max(1, +req.query.line || 1),
        Math.max(0, +req.query.col || 0),
      ),
    );
  }),
);
app.get(
  '/api/synctex/edit',
  wrap(async (req, res) => {
    res.json(
      await synctex.inverse(
        Math.max(1, parseInt(req.query.page, 10) || 1),
        +req.query.x || 0,
        +req.query.y || 0,
      ),
    );
  }),
);

// ---- outline / completions
app.get(
  '/api/outline',
  wrap(async (req, res) => res.json(await outline.outline())),
);
app.get(
  '/api/completions',
  wrap(async (req, res) => res.json(await outline.completions())),
);

// ---- SSE
const clients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
}
app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(': connected\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
});
setInterval(() => {
  for (const c of clients) c.write(': hb\n\n');
}, 25000).unref();
compile.events.on('compile-start', (d) => broadcast('compile-start', d));
compile.events.on('compiled', (d) => broadcast('compiled', d));
compile.events.on('idle', (d) => broadcast('compile-idle', d));
app.post('/api/goto', json, (req, res) => {
  const { file, line } = req.body || {};
  if (typeof file !== 'string') return res.status(400).json({ error: 'bad request' });
  broadcast('goto', { file, line: +line || 1 });
  res.json({ ok: true });
});

// ---- static
app.get('/viewer', (req, res) => res.sendFile(path.join(PUBLIC, 'viewer.html')));
app.use(
  express.static(PUBLIC, {
    index: 'index.html',
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }),
);

app.use((err, req, res, _next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) log('error', req.method, req.url, err.stack || err);
  if (res.headersSent) return res.end();
  res.status(status).json({ error: err.message });
});

const server = app.listen(PORT, HOST, () =>
  log(`LaTeX editor on http://localhost:${PORT} (contents: ${P.CONTENTS_DIR})`),
);
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    log('already running');
    process.exit(0);
  }
  throw e;
});
