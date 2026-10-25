const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { parseLog } = require('./logparse');

const C = path.resolve('C:/proj');

test('file-line-error with context', () => {
  const log = `This is XeTeX
(./main.tex (./chapters/two.tex
./chapters/two.tex:5: Undefined control sequence.
l.5 \\badcommand
               hello
)`;
  const r = parseLog(log, C);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].severity, 'error');
  assert.strictEqual(r[0].file, 'chapters/two.tex');
  assert.strictEqual(r[0].line, 5);
  assert.match(r[0].message, /Undefined control sequence/);
  assert.match(r[0].context, /badcommand/);
});

test('bang error attributed through paren stack', () => {
  const log = `(./main.tex (./chapters/one.tex
! Missing $ inserted.
<inserted text>
                $
l.12 x_
        1 y
)`;
  const r = parseLog(log, C);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].file, 'chapters/one.tex');
  assert.strictEqual(r[0].line, 12);
});

test('warnings, multiline continuation and system files', () => {
  const log = `(./main.tex (C:/Program Files/MiKTeX/tex/latex/base/article.cls
LaTeX Font Warning: Font shape undefined on input line 7.
Package hyperref Warning: Token not allowed in a PDF string
(hyperref)                removing math shift on input line 9.
LaTeX Warning: Reference \`foo' on page 1 undefined on input line 20.
)
Overfull \\hbox (12.0pt too wide) in paragraph at lines 30--31
)`;
  const r = parseLog(log, C);
  const w = r.filter((x) => x.severity === 'warning');
  assert.strictEqual(w.length, 3);
  assert.ok(w.some((x) => x.line === 9 && /removing math shift/.test(x.message)));
  const ref = w.find((x) => /foo/.test(x.message));
  assert.strictEqual(ref.line, 20);
  assert.strictEqual(ref.file, null); // inside a system class file
  const t = r.find((x) => x.severity === 'typesetting');
  assert.strictEqual(t.line, 30);
  assert.strictEqual(t.file, 'main.tex');
});

test('dedupe and never throw on garbage', () => {
  const log = `./main.tex:3: Oops.\n./main.tex:3: Oops.\n)))((((\n`;
  const r = parseLog(log, C);
  assert.strictEqual(r.length, 1);
  assert.doesNotThrow(() => parseLog(null, C));
  assert.doesNotThrow(() => parseLog('\u0000\u0001(((', undefined));
});
