const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const CONTENTS_DIR = path.resolve(process.env.CONTENTS_DIR || path.join(ROOT, 'contents'));
const BUILD_DIR = path.join(CONTENTS_DIR, '.build');
const TEXT_EXT = new Set(
  'tex bib sty cls bst bbx cbx lbx dtx ins cfg def clo txt md csv json lua py cpp c h hpp js ts java tikz asy gnuplot dat log'.split(
    ' ',
  ),
);

fs.mkdirSync(CONTENTS_DIR, { recursive: true });

function norm(rel) {
  return String(rel || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
}

// Returns absolute path or throws an Error with .status = 400
function safeResolve(rel) {
  const s = String(rel == null ? '' : rel);
  if (s.includes('\0')) throw httpErr(400, 'bad path');
  if (/^[a-zA-Z]:/.test(s) || s.startsWith('/') || s.startsWith('\\'))
    throw httpErr(400, 'absolute paths not allowed');
  const n = norm(s);
  const abs = path.resolve(CONTENTS_DIR, n);
  const relBack = path.relative(CONTENTS_DIR, abs);
  if (relBack.startsWith('..') || path.isAbsolute(relBack))
    throw httpErr(400, 'path escapes project');
  const first = relBack.split(path.sep)[0];
  if (first === '.build') throw httpErr(400, 'reserved path');
  return abs;
}

function toRel(abs) {
  return path.relative(CONTENTS_DIR, abs).split(path.sep).join('/');
}

function isHidden(rel) {
  return norm(rel)
    .split('/')
    .some((p) => p.startsWith('.'));
}

function isText(rel) {
  const ext = path.extname(rel).slice(1).toLowerCase();
  return TEXT_EXT.has(ext);
}

function httpErr(status, msg) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

module.exports = {
  ROOT,
  CONTENTS_DIR,
  BUILD_DIR,
  TEXT_EXT,
  safeResolve,
  toRel,
  isHidden,
  isText,
  norm,
  httpErr,
};
