const fsp = require('fs').promises;
const path = require('path');
const { safeResolve } = require('./paths');
const settings = require('./settings');
const files = require('./files');

const LEVELS = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

// Replace comment text with spaces (keeps offsets/line numbers intact).
function stripComments(text) {
  return text.replace(/(^|[^\\])((?:\\\\)*)%[^\n]*/g, (m, a, b) => {
    const keep = a + b;
    return keep + ' '.repeat(m.length - keep.length);
  });
}

function lineStarts(text) {
  const s = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') s.push(i + 1);
  return s;
}
function lineOf(starts, off) {
  let lo = 0,
    hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= off) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

// read balanced {...} starting at index i (text[i] === '{'); returns [content, endIndex]
function balanced(text, i) {
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return [text.slice(i + 1, j), j + 1];
    }
  }
  return [text.slice(i + 1), text.length];
}

function cleanTitle(t) {
  let prev;
  do {
    prev = t;
    t = t.replace(
      /\\(?:textbf|textit|emph|texttt|textsc|textrm|textsf|underline|mbox|text)\s*\{([^{}]*)\}/g,
      '$1',
    );
  } while (t !== prev);
  return t
    .replace(/\\(?:label|index)\{[^}]*\}/g, '')
    .replace(/\\\\/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveInput(name) {
  const cands = [name, name + '.tex'];
  for (const c of cands) {
    try {
      const abs = safeResolve(c);
      const st = await fsp.stat(abs);
      if (st.isFile()) return c.replace(/\\/g, '/');
    } catch {
      /* next */
    }
  }
  return null;
}

async function walk(rel, out, visiting, depth) {
  if (depth > 20 || visiting.has(rel)) return;
  let text;
  try {
    text = await fsp.readFile(safeResolve(rel), 'utf8');
  } catch {
    return;
  }
  visiting.add(rel);
  const clean = stripComments(text);
  const starts = lineStarts(clean);
  const re =
    /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?|\\(input|include|subfile|subimport|import)\b/g;
  let m;
  while ((m = re.exec(clean))) {
    let j = re.lastIndex;
    if (m[1]) {
      while (/\s/.test(clean[j] || '')) j++;
      if (clean[j] === '[') {
        const k = clean.indexOf(']', j);
        if (k > 0) j = k + 1;
      }
      while (/\s/.test(clean[j] || '')) j++;
      if (clean[j] !== '{') continue;
      const [title, end] = balanced(clean, j);
      out.push({
        level: LEVELS[m[1]],
        title: cleanTitle(title),
        file: rel,
        line: lineOf(starts, m.index),
      });
      re.lastIndex = end;
    } else {
      if (/^[A-Za-z]/.test(clean[j] || '')) continue;
      while (/\s/.test(clean[j] || '')) j++;
      let arg;
      if (clean[j] !== '{') continue;
      let [a, end] = balanced(clean, j);
      if (m[2] === 'import' || m[2] === 'subimport') {
        let k = end;
        while (/\s/.test(clean[k] || '')) k++;
        if (clean[k] === '{') {
          const [b, e2] = balanced(clean, k);
          a = a.replace(/\/?$/, '/') + b;
          end = e2;
        }
      }
      arg = a.trim();
      re.lastIndex = end;
      const f = await resolveInput(arg);
      if (f) await walk(f, out, visiting, depth + 1);
    }
  }
  visiting.delete(rel);
}

async function outline() {
  const main = settings.load().mainFile;
  const mainAbs = safeResolve(main);
  if (!(await files.exists(mainAbs))) return { items: [], mainMissing: true };
  const items = [];
  await walk(main, items, new Set(), 0);
  return { items, mainMissing: false };
}

async function completions() {
  const labels = [],
    bibkeys = [],
    commands = [],
    envs = [];
  const seenCmd = new Set(),
    seenEnv = new Set();
  for (const rel of await files.allTextFiles()) {
    const ext = path.extname(rel).toLowerCase();
    let text;
    try {
      text = await fsp.readFile(safeResolve(rel), 'utf8');
    } catch {
      continue;
    }
    if (ext === '.bib') {
      const re = /@(\w+)\s*\{\s*([^,\s{}]+)\s*,/g;
      let m;
      while ((m = re.exec(text))) {
        if (/^(string|comment|preamble)$/i.test(m[1])) continue;
        const after = text.slice(re.lastIndex, re.lastIndex + 1500);
        const next = after.search(/\n\s*@/);
        const body = next >= 0 ? after.slice(0, next) : after;
        const t = /title\s*=\s*[{"]+([^}"]*)/i.exec(body);
        bibkeys.push({
          key: m[2],
          title: t ? t[1].replace(/\s+/g, ' ').trim() : undefined,
        });
      }
    } else if (ext === '.tex' || ext === '.sty' || ext === '.cls') {
      const clean = stripComments(text);
      const starts = lineStarts(clean);
      let m;
      const rl = /\\label\{([^}]*)\}/g;
      while ((m = rl.exec(clean)))
        labels.push({ name: m[1], file: rel, line: lineOf(starts, m.index) });
      const rc =
        /\\(?:(?:re)?newcommand|providecommand|DeclareRobustCommand|NewDocumentCommand|DeclareDocumentCommand|DeclareMathOperator)\*?\s*\{?\s*\\([a-zA-Z@]+)\s*\}?(?:\s*\[(\d)\])?/g;
      while ((m = rc.exec(clean))) {
        if (seenCmd.has(m[1])) continue;
        seenCmd.add(m[1]);
        let args = m[2] ? +m[2] : 0;
        if (/NewDocumentCommand|DeclareDocumentCommand/.test(m[0])) {
          const spec = /\{([^{}]*)\}/.exec(clean.slice(rc.lastIndex, rc.lastIndex + 80));
          if (spec) args = (spec[1].match(/[mo]/g) || []).length;
        }
        commands.push({ name: m[1], args });
      }
      const rd = /\\def\\([a-zA-Z@]+)((?:#\d)*)/g;
      while ((m = rd.exec(clean))) {
        if (seenCmd.has(m[1])) continue;
        seenCmd.add(m[1]);
        commands.push({ name: m[1], args: m[2].length / 2 });
      }
      const re2 = /\\(?:re)?newenvironment\*?\s*\{([^}]*)\}/g;
      while ((m = re2.exec(clean)))
        if (!seenEnv.has(m[1])) {
          seenEnv.add(m[1]);
          envs.push(m[1]);
        }
    }
  }
  return { labels, bibkeys, commands, envs };
}

module.exports = { outline, completions };
