const fs = require('fs');
const path = require('path');
const { ROOT } = require('./paths');

const FILE = path.resolve(ROOT, process.env.SETTINGS_FILE || 'settings.json');
const ENGINES = ['xelatex', 'pdflatex', 'lualatex'];
const DEFAULTS = { mainFile: 'main.tex', engine: 'xelatex', autoCompile: true };

let cur = null;

function load() {
  if (cur) return cur;
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    /* defaults */
  }
  cur = sanitize({ ...DEFAULTS, ...data });
  return cur;
}

function sanitize(s) {
  const out = { ...DEFAULTS };
  if (typeof s.mainFile === 'string' && s.mainFile.trim())
    out.mainFile = s.mainFile.replace(/\\/g, '/').replace(/^\/+/, '');
  if (ENGINES.includes(s.engine)) out.engine = s.engine;
  if (typeof s.autoCompile === 'boolean') out.autoCompile = s.autoCompile;
  return out;
}

function save() {
  fs.writeFileSync(FILE, JSON.stringify(cur, null, 2));
}

function update(patch) {
  cur = sanitize({ ...load(), ...patch });
  save();
  return cur;
}

module.exports = { load, update, ENGINES };
