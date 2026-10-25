const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { CONTENTS_DIR, BUILD_DIR, httpErr } = require('./paths');
const { findBin } = require('./bins');

const OUT_PDF = () => path.join(BUILD_DIR, 'output.pdf');

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(
      findBin('synctex'),
      args,
      { timeout: 5000, windowsHide: true, cwd: CONTENTS_DIR, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) return reject(err);
        resolve(String(stdout || ''));
      },
    );
  });
}

function parseBlocks(out) {
  const res = [];
  let cur = null;
  for (const line of out.split(/\r?\n/)) {
    const m = /^(Page|x|y|h|v|W|H|Input|Line|Column):(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1];
    if (k === 'Page' || (k === 'Input' && cur && cur.Input !== undefined)) {
      cur = {};
      res.push(cur);
    }
    if (!cur) {
      cur = {};
      res.push(cur);
    }
    cur[k] = m[2].trim();
  }
  return res;
}

async function forward(file, line, col) {
  if (!fs.existsSync(OUT_PDF())) throw httpErr(404, 'no pdf');
  const abs = path.join(CONTENTS_DIR, file);
  const tries = [abs, './' + file, file];
  for (const input of tries) {
    let out;
    try {
      out = await run(['view', '-i', `${line}:${col || 0}:${input}`, '-o', OUT_PDF()]);
    } catch {
      continue;
    }
    const blocks = parseBlocks(out).filter((b) => b.Page !== undefined && b.h !== undefined);
    if (blocks.length) {
      return blocks.map((b) => ({ page: +b.Page, h: +b.h, v: +b.v, W: +b.W, H: +b.H }));
    }
  }
  return [];
}

function relFromInput(input) {
  let p = input.replace(/\\/g, '/').replace(/\/\.\//g, '/');
  if (p.startsWith('./')) p = p.slice(2);
  const root = CONTENTS_DIR.replace(/\\/g, '/').replace(/\/+$/, '');
  if (p.toLowerCase().startsWith(root.toLowerCase() + '/')) p = p.slice(root.length + 1);
  return p;
}

async function inverse(page, x, y) {
  if (!fs.existsSync(OUT_PDF())) throw httpErr(404, 'no pdf');
  let out;
  try {
    out = await run(['edit', '-o', `${page}:${x}:${y}:${OUT_PDF()}`]);
  } catch {
    throw httpErr(404, 'synctex failed');
  }
  const b = parseBlocks(out).find((r) => r.Input !== undefined && r.Line !== undefined);
  if (!b) throw httpErr(404, 'no source location');
  const f = relFromInput(b.Input);
  if (f.startsWith('.build/') || /^[A-Za-z]:|^\//.test(f)) throw httpErr(404, 'no source location');
  return { file: f, line: Math.max(1, +b.Line) };
}

module.exports = { forward, inverse };
