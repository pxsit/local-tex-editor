const path = require('path');

const PATHLIKE =
  /^(?:\.{1,2}[\\/]|[A-Za-z]:[\\/]|\/)|\.(?:tex|sty|cls|cfg|def|bbl|aux|clo|fd|ldf|bib|bst|toc|lof|lot|out|xml|bcf|sty)$/i;

// Build a function turning a path from the log into a path relative to contentsDir (or null)
function makeRel(contentsDir) {
  const root = contentsDir ? path.resolve(contentsDir) : null;
  return function rel(p) {
    if (!p || !root) return null;
    let q = p.replace(/\\/g, '/');
    let abs;
    if (/^[A-Za-z]:\//.test(q) || q.startsWith('/')) abs = path.resolve(q);
    else abs = path.resolve(root, q);
    const r = path.relative(root, abs);
    if (r.startsWith('..') || path.isAbsolute(r)) return null;
    const out = r.split(path.sep).join('/');
    if (out.split('/')[0] === '.build') return null;
    return out;
  };
}

// Track current file through "(" and ")" in a line. stack is mutated.
function scanParens(line, stack) {
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '(') {
      const rest = line.slice(i + 1);
      // token up to whitespace or paren
      const m = /^[^\s()]+/.exec(rest);
      const tok = m ? m[0] : '';
      if (tok && PATHLIKE.test(tok)) {
        stack.push(tok);
        i += tok.length;
      } else stack.push(null);
    } else if (c === ')') {
      if (stack.length) stack.pop();
    }
  }
}

function top(stack) {
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i]) return stack[i];
  return null;
}

function parseLog(text, contentsDir) {
  const issues = [];
  try {
    const rel = makeRel(contentsDir);
    const lines = String(text || '').split(/\r?\n/);
    const stack = [];
    const seen = new Set();
    const add = (it) => {
      const key = [it.severity, it.file, it.line, it.message].join('\u0000');
      if (seen.has(key)) return;
      seen.add(key);
      issues.push(it);
    };
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      let m;
      const curFile = () => rel(top(stack));
      // file-line-error
      if (
        (m = /^((?:[A-Za-z]:)?[^:\r\n]+?\.\w+):(\d+): (.*)$/.exec(ln)) &&
        !/^(?:LaTeX|Package|Class)/.test(ln)
      ) {
        const ctx = [];
        for (let k = 1; k <= 3 && i + k < lines.length; k++) {
          const l2 = lines[i + k];
          if (l2 === '') {
            if (ctx.length) break;
            else continue;
          }
          if (/^((?:[A-Za-z]:)?[^:\r\n]+?\.\w+):(\d+): /.test(l2)) break;
          ctx.push(l2);
        }
        add({
          severity: 'error',
          file: rel(m[1]),
          line: +m[2],
          message: m[3].trim(),
          context: ctx.join('\n'),
        });
        scanParens(ln, stack);
        continue;
      }
      if ((m = /^! (.*)$/.exec(ln))) {
        let line = null;
        const ctx = [];
        for (let k = 1; k <= 15 && i + k < lines.length; k++) {
          const l2 = lines[i + k];
          if (/^! /.test(l2)) break;
          const lm = /^l\.(\d+)/.exec(l2);
          if (lm) {
            line = +lm[1];
            ctx.push(l2);
            if (lines[i + k + 1] !== undefined && /^\s/.test(lines[i + k + 1]))
              ctx.push(lines[i + k + 1]);
            break;
          }
          if (l2 === '') continue;
          ctx.push(l2);
        }
        add({
          severity: 'error',
          file: curFile(),
          line,
          message: m[1].trim(),
          context: ctx.join('\n'),
        });
        continue;
      }
      if ((m = /^(LaTeX(?: Font)?|Package \S+|Class \S+) Warning: (.*)$/.exec(ln))) {
        let msg = m[2];
        let k = i + 1;
        const pad = m[1] === 'LaTeX' ? null : '(' + m[1].split(' ').pop() + ')';
        while (
          k < lines.length &&
          lines[k] !== '' &&
          ((pad && lines[k].startsWith(pad)) || (!pad && /^\s{2,}\S/.test(lines[k])))
        ) {
          msg += ' ' + lines[k].replace(pad || '', '').trim();
          k++;
        }
        const lm = /on input line (\d+)/.exec(msg);
        add({
          severity: 'warning',
          file: curFile(),
          line: lm ? +lm[1] : null,
          message: (m[1] + ': ' + msg).replace(/\s+/g, ' ').trim(),
          context: '',
        });
        for (let j = i; j < k; j++) scanParens(lines[j], stack);
        i = k - 1;
        continue;
      }
      if (
        (m = /^((?:Overfull|Underfull) \\[hv]box .*?)(?:at lines? (\d+)(?:--\d+)?)?\s*$/.exec(ln))
      ) {
        add({
          severity: 'typesetting',
          file: curFile(),
          line: m[2] ? +m[2] : null,
          message: m[1].trim(),
          context: '',
        });
        scanParens(ln, stack);
        continue;
      }
      scanParens(ln, stack);
    }
  } catch (e) {
    /* never throw */
  }
  return issues;
}

module.exports = { parseLog };
