import { undo, redo } from '@codemirror/commands';
import { startCompletion } from '@codemirror/autocomplete';
import { bus } from './app.js';
import { h, $, ico } from './dom.js';
import { getView, isTextActive } from './tabs.js';
import { wrapToggle } from './editor.js';

const SECTIONS = [
  ['Normal text', ''],
  ['Section', 'section'],
  ['Subsection', 'subsection'],
  ['Subsubsection', 'subsubsection'],
  ['Paragraph', 'paragraph'],
  ['Subparagraph', 'subparagraph'],
];
const SECT_LINE =
  /^(\s*)\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?(?:\[[^\]]*\])?\{(.*)\}\s*$/;

const GREEK =
  'α alpha,β beta,γ gamma,δ delta,ε epsilon,ε varepsilon,ζ zeta,η eta,θ theta,ϑ vartheta,ι iota,κ kappa,λ lambda,μ mu,ν nu,ξ xi,π pi,ϖ varpi,ρ rho,ϱ varrho,σ sigma,ς varsigma,τ tau,υ upsilon,φ phi,ϕ varphi,χ chi,ψ psi,ω omega,Γ Gamma,Δ Delta,Θ Theta,Λ Lambda,Ξ Xi,Π Pi,Σ Sigma,Υ Upsilon,Φ Phi,Ψ Psi,Ω Omega';
const OPS =
  '± pm,∓ mp,× times,÷ div,· cdot,∗ ast,⋆ star,∘ circ,∙ bullet,⊕ oplus,⊗ otimes,∪ cup,∩ cap,∖ setminus,∧ wedge,∨ vee,∑ sum,∏ prod,∫ int,∮ oint,√ sqrt,∂ partial,∇ nabla,∞ infty,ℏ hbar,ℓ ell';
const RELS =
  '≤ leq,≥ geq,≠ neq,≈ approx,≡ equiv,∼ sim,≃ simeq,≅ cong,∝ propto,≪ ll,≫ gg,⊂ subset,⊃ supset,⊆ subseteq,⊇ supseteq,∈ in,∉ notin,∋ ni,⊥ perp,∥ parallel';
const ARROWS =
  '← leftarrow,→ rightarrow,⇐ Leftarrow,⇒ Rightarrow,↔ leftrightarrow,⇔ Leftrightarrow,↦ mapsto,↑ uparrow,↓ downarrow,⟶ longrightarrow,↪ hookrightarrow,⟹ implies,⟺ iff';
const MISC =
  '∀ forall,∃ exists,∄ nexists,¬ neg,∅ emptyset,… ldots,⋯ cdots,⋮ vdots,⋱ ddots,∠ angle,∴ therefore,∵ because,ℜ Re,ℑ Im,ℵ aleph,′ prime,† dag,‡ ddag,§ S,¶ P,© copyright';
const SYMBOLS = { Greek: GREEK, Operators: OPS, Relations: RELS, Arrows: ARROWS, Misc: MISC };

let popover = null;
function closePopover() {
  if (popover) {
    popover.remove();
    popover = null;
  }
}
document.addEventListener('mousedown', (e) => {
  if (popover && !popover.contains(e.target) && !e.target.closest('[data-pop]')) closePopover();
});

function showPopover(anchor, content) {
  closePopover();
  popover = h('div', { class: 'popover' }, content);
  document.body.append(popover);
  const r = anchor.getBoundingClientRect();
  popover.style.left = Math.min(r.left, window.innerWidth - popover.offsetWidth - 8) + 'px';
  popover.style.top = r.bottom + 4 + 'px';
}

function insertText(v, text) {
  const r = v.state.selection.main;
  v.dispatch({
    changes: { from: r.from, to: r.to, insert: text },
    selection: { anchor: r.from + text.length },
  });
  v.focus();
}

function symbolPicker(anchor) {
  const grid = h('div', { class: 'sym-grid' });
  const tabs = h('div', { class: 'sym-tabs' });
  const fill = (name) => {
    grid.textContent = '';
    for (const item of SYMBOLS[name].split(',')) {
      const [glyph, cmd] = item.split(' ');
      grid.append(
        h(
          'button',
          {
            class: 'sym',
            title: '\\' + cmd,
            onclick: () => {
              const v = getView();
              const after = v.state.doc.sliceString(
                v.state.selection.main.to,
                v.state.selection.main.to + 1,
              );
              insertText(v, '\\' + cmd + (/[A-Za-z]/.test(after) ? ' ' : ''));
              closePopover();
            },
          },
          glyph,
        ),
      );
    }
    for (const b of tabs.children) b.classList.toggle('active', b.dataset.n === name);
  };
  for (const n of Object.keys(SYMBOLS))
    tabs.append(h('button', { 'data-n': n, onclick: () => fill(n) }, n));
  showPopover(anchor, [tabs, grid]);
  fill('Greek');
}

function tablePicker(anchor) {
  const label = h('div', { class: 'tbl-label' }, 'Insert table');
  const grid = h('div', { class: 'tbl-grid' });
  const cells = [];
  for (let r = 1; r <= 10; r++)
    for (let c = 1; c <= 10; c++) {
      const cell = h('div', {
        class: 'tbl-cell',
        onmouseenter: () => {
          label.textContent = `${c} × ${r}`;
          for (const x of cells) x.el.classList.toggle('on', x.r <= r && x.c <= c);
        },
        onclick: () => {
          insertTable(r, c);
          closePopover();
        },
      });
      cells.push({ el: cell, r, c });
      grid.append(cell);
    }
  showPopover(anchor, [grid, label]);
}

function insertTable(rows, cols) {
  const v = getView();
  const spec = '|' + 'c|'.repeat(cols);
  const row = Array(cols).fill('').join(' & ') + ' \\\\';
  const body = Array.from({ length: rows }, () => '        ' + row + '\n        \\hline').join(
    '\n',
  );
  const text = `\\begin{table}[h]\n    \\centering\n    \\begin{tabular}{${spec}}\n        \\hline\n${body}\n    \\end{tabular}\n    \\caption{}\n    \\label{tab:}\n\\end{table}`;
  const r = v.state.selection.main;
  const firstCell = text.indexOf('\n        \\hline\n') + '\n        \\hline\n'.length + 8;
  v.dispatch({
    changes: { from: r.from, to: r.to, insert: text },
    selection: { anchor: r.from + firstCell },
  });
  v.focus();
}

function insertFigure() {
  const v = getView();
  const text =
    '\\begin{figure}[h]\n    \\centering\n    \\includegraphics[width=0.8\\linewidth]{}\n    \\caption{}\n    \\label{fig:}\n\\end{figure}';
  const r = v.state.selection.main;
  v.dispatch({
    changes: { from: r.from, to: r.to, insert: text },
    selection: { anchor: r.from + text.indexOf('{}') + 1 },
  });
  v.focus();
}

function insertList(env) {
  const v = getView();
  const { state } = v;
  const r = state.selection.main;
  if (r.empty) {
    const text = `\\begin{${env}}\n    \\item \n\\end{${env}}`;
    v.dispatch({
      changes: { from: r.from, insert: text },
      selection: { anchor: r.from + text.indexOf('\\item ') + 6 },
    });
  } else {
    const a = state.doc.lineAt(r.from),
      b = state.doc.lineAt(r.to);
    const lines = [];
    for (let n = a.number; n <= b.number; n++)
      lines.push('    \\item ' + state.doc.line(n).text.trim());
    const text = `\\begin{${env}}\n${lines.join('\n')}\n\\end{${env}}`;
    v.dispatch({
      changes: { from: a.from, to: b.to, insert: text },
      selection: { anchor: a.from + text.length },
    });
  }
  v.focus();
}

function insertCmdAndComplete(cmd) {
  const v = getView();
  const r = v.state.selection.main;
  const text = `\\${cmd}{}`;
  v.dispatch({
    changes: { from: r.from, to: r.to, insert: text },
    selection: { anchor: r.from + text.length - 1 },
  });
  v.focus();
  startCompletion(v);
}

function applySection(kind) {
  const v = getView();
  const { state } = v;
  const line = state.doc.lineAt(state.selection.main.head);
  const m = SECT_LINE.exec(line.text);
  let text;
  if (m) text = kind ? `${m[1]}\\${kind}{${m[3]}}` : `${m[1]}${m[3]}`;
  else if (kind) {
    const ind = /^\s*/.exec(line.text)[0];
    text = `${ind}\\${kind}{${line.text.trim()}}`;
  } else return;
  v.dispatch({
    changes: { from: line.from, to: line.to, insert: text },
    selection: { anchor: line.from + text.length - (kind ? 1 : 0) },
  });
  v.focus();
}

export function initToolbar() {
  const root = $('#toolbar');
  const btns = [];
  const btn = (icon, title, fn, extra = {}) => {
    const b = h(
      'button',
      {
        class: 'tb',
        title,
        'data-pop': extra.pop ? '1' : null,
        onmousedown: (e) => e.preventDefault(),
        onclick: (e) => fn(e.currentTarget),
      },
      '',
    );
    if (icon.startsWith('<')) b.innerHTML = icon;
    else if (icon.length > 3 || /^[a-z]+$/.test(icon)) b.innerHTML = ico(icon);
    else b.textContent = icon;
    if (extra.cls) b.classList.add(extra.cls);
    btns.push(b);
    return b;
  };
  const sep = () => h('span', { class: 'tb-sep' });

  const sel = h(
    'select',
    {
      class: 'tb-select',
      title: 'Section level',
      onchange: (e) => {
        applySection(e.target.value);
      },
    },
    SECTIONS.map(([l, v]) => h('option', { value: v }, l)),
  );
  btns.push(sel);

  root.append(
    btn('undo', 'Undo (Ctrl+Z)', () => {
      undo(getView());
      getView().focus();
    }),
    btn('redo', 'Redo (Ctrl+Y)', () => {
      redo(getView());
      getView().focus();
    }),
    sep(),
    sel,
    sep(),
    btn('B', 'Bold (Ctrl+B)', () => wrapToggle(getView(), 'textbf'), { cls: 'tb-b' }),
    btn('I', 'Italic (Ctrl+I)', () => wrapToggle(getView(), 'textit'), { cls: 'tb-i' }),
    sep(),
    btn('Ω', 'Insert symbol', (el) => symbolPicker(el), { pop: true }),
    sep(),
    btn('ref', 'Insert \\ref', () => insertCmdAndComplete('ref')),
    btn('quote', 'Insert \\cite', () => insertCmdAndComplete('cite')),
    sep(),
    btn('image', 'Insert figure', insertFigure),
    btn('table', 'Insert table', (el) => tablePicker(el), { pop: true }),
    sep(),
    btn('ul', 'Bulleted list', () => insertList('itemize')),
    btn('ol', 'Numbered list', () => insertList('enumerate')),
  );

  const update = () => {
    const on = isTextActive();
    for (const b of btns) b.disabled = !on;
  };
  bus.on('editor-mode', update);
  bus.on('active-changed', update);
  update();

  // section dropdown reflects the current line
  bus.on('cursor', () => {
    const v = getView();
    if (!v || !isTextActive()) return;
    const line = v.state.doc.lineAt(v.state.selection.main.head);
    const m = SECT_LINE.exec(line.text);
    sel.value =
      m && ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'].includes(m[2])
        ? m[2]
        : '';
  });
}
