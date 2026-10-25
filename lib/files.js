const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { CONTENTS_DIR, safeResolve, toRel, isText, httpErr } = require('./paths');
const settings = require('./settings');

async function tree(dirAbs = CONTENTS_DIR) {
  const ents = await fsp.readdir(dirAbs, { withFileTypes: true });
  const out = [];
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dirAbs, e.name);
    const node = { name: e.name, path: toRel(abs), type: e.isDirectory() ? 'dir' : 'file' };
    if (e.isDirectory()) node.children = await tree(abs);
    out.push(node);
  }
  out.sort((a, b) =>
    a.type === b.type
      ? a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      : a.type === 'dir'
        ? -1
        : 1,
  );
  return out;
}

async function readText(rel) {
  const abs = safeResolve(rel);
  if (!isText(rel)) throw httpErr(415, 'not a text file');
  try {
    return await fsp.readFile(abs, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') throw httpErr(404, 'not found');
    throw e;
  }
}

async function writeAtomic(abs, data) {
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const tmp = abs + '.tmp-' + crypto.randomBytes(4).toString('hex');
  await fsp.writeFile(tmp, data);
  // On Windows a rename over a file that TeX currently has open fails (EPERM/EBUSY).
  // The running compile is stale anyway once a source changes, so cancel it and retry.
  let cancelled = false;
  let cancelledFile;
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(tmp, abs);
      // With auto-compile on, the client schedules the next compile itself; otherwise restart the
      // one we killed (same target document) so a manual Recompile isn't silently dropped.
      if (cancelled && !settings.load().autoCompile)
        require('./compile')
          .requestCompile(cancelledFile)
          .catch(() => {});
      return;
    } catch (e) {
      const busy = e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES';
      if (!busy || attempt >= 25) {
        await fsp.rm(tmp, { force: true });
        throw e;
      }
      if (!cancelled && require('./compile').state.running) {
        cancelled = true;
        cancelledFile = require('./compile').state.running.file;
        await require('./compile').cancelRunning();
      }
      await new Promise((r) => setTimeout(r, 80));
    }
  }
}

async function writeText(rel, text) {
  const abs = safeResolve(rel);
  if (!rel || rel.endsWith('/')) throw httpErr(400, 'bad path');
  await writeAtomic(abs, text);
}

async function exists(abs) {
  try {
    await fsp.access(abs);
    return true;
  } catch {
    return false;
  }
}

async function newFile(rel) {
  const abs = safeResolve(rel);
  if (await exists(abs)) throw httpErr(409, 'already exists');
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, '');
}

async function mkdir(rel) {
  const abs = safeResolve(rel);
  if (await exists(abs)) throw httpErr(409, 'already exists');
  await fsp.mkdir(abs, { recursive: true });
}

async function rename(from, to) {
  const a = safeResolve(from),
    b = safeResolve(to);
  if (!(await exists(a))) throw httpErr(404, 'source not found');
  // on Windows a case-only rename (Main.tex -> main.tex) "exists" because it is the same entry
  const caseOnly = a !== b && a.toLowerCase() === b.toLowerCase();
  if (!caseOnly && (await exists(b))) throw httpErr(409, 'target exists');
  if ((b + path.sep).startsWith(a + path.sep)) throw httpErr(400, 'cannot move into itself');
  await fsp.mkdir(path.dirname(b), { recursive: true });
  await fsp.rename(a, b);
  const s = settings.load();
  const f = from.replace(/\\/g, '/'),
    t = to.replace(/\\/g, '/');
  if (s.mainFile === f) settings.update({ mainFile: t });
  else if (s.mainFile.startsWith(f + '/'))
    settings.update({ mainFile: t + s.mainFile.slice(f.length) });
}

async function remove(rel) {
  const abs = safeResolve(rel);
  if (abs === CONTENTS_DIR) throw httpErr(400, 'cannot delete root');
  await fsp.rm(abs, { recursive: true, force: true });
}

async function upload(dir, files) {
  const base = safeResolve(dir || '');
  const written = [];
  for (const f of files) {
    // preserve relative sub-path if client sent one (webkitdirectory)
    const name = String(f.originalname || '').replace(/\\/g, '/');
    const target = path.resolve(base, name);
    const r = path.relative(base, target);
    if (r.startsWith('..') || path.isAbsolute(r) || !r) continue;
    const rel = toRel(target);
    safeResolve(rel);
    await writeAtomic(target, f.buffer);
    written.push(rel);
  }
  return written;
}

async function allTextFiles(dirAbs = CONTENTS_DIR, acc = []) {
  const ents = await fsp.readdir(dirAbs, { withFileTypes: true });
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dirAbs, e.name);
    if (e.isDirectory()) await allTextFiles(abs, acc);
    else if (isText(e.name)) acc.push(toRel(abs));
  }
  return acc;
}

function buildRegex({ q, regex, case: cs, word }, forceG = true) {
  let src = regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // \b needs a word char next to it, so `\section` would never match; only guard word-char edges
  if (word) {
    const pre = regex || /^\w/.test(q) ? '(?<!\\w)' : '';
    const post = regex || /\w$/.test(q) ? '(?!\\w)' : '';
    src = pre + '(?:' + src + ')' + post;
  }
  return new RegExp(src, (forceG ? 'g' : '') + (cs ? '' : 'i') + 'm');
}

async function search(opts) {
  if (!opts.q) return [];
  let re;
  try {
    re = buildRegex(opts);
  } catch (e) {
    throw httpErr(400, 'bad regex: ' + e.message);
  }
  const results = [];
  let total = 0;
  for (const rel of await allTextFiles()) {
    if (total >= 2000) break;
    let text;
    try {
      text = await fsp.readFile(safeResolve(rel), 'utf8');
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    const matches = [];
    for (let i = 0; i < lines.length && total < 2000; i++) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(lines[i])) && total < 2000) {
        if (m[0].length === 0) {
          re.lastIndex++;
          continue;
        }
        const start = Math.max(0, m.index - 80);
        const end = Math.min(lines[i].length, m.index + m[0].length + 120);
        matches.push({
          line: i + 1,
          col: m.index + 1,
          len: m[0].length,
          text: lines[i].slice(start, end),
          off: m.index - start,
        });
        total++;
      }
    }
    if (matches.length) results.push({ path: rel, matches });
  }
  return results;
}

async function replace(opts) {
  if (!opts.q) return { files: 0, replacements: 0 };
  let re;
  try {
    re = buildRegex(opts);
  } catch (e) {
    throw httpErr(400, 'bad regex: ' + e.message);
  }
  const paths = Array.isArray(opts.paths) && opts.paths.length ? opts.paths : await allTextFiles();
  let files = 0,
    replacements = 0;
  const rep = opts.regex ? String(opts.replacement ?? '') : null;
  for (const rel of paths) {
    if (!isText(rel)) continue;
    const abs = safeResolve(rel);
    let text;
    try {
      text = await fsp.readFile(abs, 'utf8');
    } catch {
      continue;
    }
    let n = 0;
    const replaceLine = (line) =>
      line.replace(re, (...args) => {
        n++;
        if (!opts.regex) return String(opts.replacement ?? '');
        const m = args.slice(
          0,
          args.findIndex((a) => typeof a === 'number'),
        );
        return rep.replace(/\$(\$|&|\d{1,2})/g, (_, t) =>
          t === '$' ? '$' : t === '&' ? m[0] : (m[+t] ?? ''),
        );
      });
    // replace line by line, like search, so CRLF endings are never part of a match
    const out = text
      .split(/(\r?\n)/)
      .map((part, i) => (i % 2 ? part : replaceLine(part)))
      .join('');
    if (n > 0) {
      await writeAtomic(abs, out);
      files++;
      replacements += n;
    }
  }
  return { files, replacements };
}

module.exports = {
  tree,
  readText,
  writeText,
  newFile,
  mkdir,
  rename,
  remove,
  upload,
  search,
  replace,
  allTextFiles,
  exists,
};
