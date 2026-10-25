const fs = require('fs');
const path = require('path');

const MIKTEX = 'C:\\Program Files\\MiKTeX\\miktex\\bin\\x64';
const cache = {};

function findBin(name) {
  if (cache[name]) return cache[name];
  const exe = name + '.exe';
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    const p = path.join(d, exe);
    try {
      if (fs.statSync(p).isFile()) return (cache[name] = p);
    } catch {
      /* next */
    }
  }
  const fb = path.join(MIKTEX, exe);
  return (cache[name] = fb);
}

module.exports = { findBin };
