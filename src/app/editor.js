import { EditorState, Compartment, StateField } from '@codemirror/state';
import {
  Decoration,
  ViewPlugin,
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightActiveLine,
  drawSelection,
  dropCursor,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  StreamLanguage,
  indentOnInput,
  bracketMatching,
  foldGutter,
  foldService,
  foldKeymap,
} from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import {
  closeBrackets,
  closeBracketsKeymap,
  autocompletion,
  completionKeymap,
} from '@codemirror/autocomplete';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import { latexCompletions } from './complete.js';
import { createFindPanel } from './findpanel.js';

// ---------- verbatim-like environments (lstlisting, verbatim, minted) in green
const BEGIN_RE = /\\begin\{(lstlisting|verbatim\*?|minted)\}/;
const END_RE = /\\end\{(lstlisting|verbatim\*?|minted)\}/;
// inclusive so text typed at either edge of a listing stays highlighted when the set is mapped
const listingMark = Decoration.mark({ class: 'cm-listing', inclusive: true });
function listingDecos(state) {
  const doc = state.doc;
  const ranges = [];
  let start = -1;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (start < 0) {
      if (BEGIN_RE.test(line.text) && !END_RE.test(line.text)) start = line.to + 1;
    } else if (END_RE.test(line.text)) {
      if (line.from - 1 > start) ranges.push(listingMark.range(start, line.from - 1));
      start = -1;
    }
  }
  if (start >= 0 && start < doc.length) ranges.push(listingMark.range(start, doc.length));
  return Decoration.set(ranges);
}
const LISTING_EDGE = /\\(?:begin|end)\{/;
// Only a change touching a \begin{..}/\end{..} line can move listing boundaries; otherwise map
// the existing ranges instead of rescanning the whole document on every keystroke.
function touchesListingEdge(tr) {
  let hit = false;
  tr.changes.iterChanges((fromA, toA, fromB, toB) => {
    if (hit) return;
    const a = tr.startState.doc;
    const b = tr.state.doc;
    const oldText = a.sliceString(a.lineAt(fromA).from, a.lineAt(toA).to);
    const newText = b.sliceString(b.lineAt(fromB).from, b.lineAt(toB).to);
    if (LISTING_EDGE.test(oldText) || LISTING_EDGE.test(newText)) hit = true;
  });
  return hit;
}
const listingField = StateField.define({
  create: listingDecos,
  update: (v, tr) => {
    if (!tr.docChanged) return v;
    return touchesListingEdge(tr) ? listingDecos(tr.state) : v.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---------- LaTeX highlighting (regex based, Dracula-like palette; see theme classes below)
const M_KW = Decoration.mark({ class: 'tx-kw' });
const M_CMD = Decoration.mark({ class: 'tx-cmd' });
const M_LEN = Decoration.mark({ class: 'tx-len' });
const M_OPT = Decoration.mark({ class: 'tx-opt' });
const M_COM = Decoration.mark({ class: 'tx-com' });
const KW_CMDS = new Set(['usepackage', 'RequirePackage', 'documentclass', 'LoadClass', '\\']);
const LEN_RE =
  /^(?:[a-zA-Z]*(?:width|height|depth|skip|sep|indent|offset|margin)|head[a-z]*|foot[a-z]*|parindent|parskip|baselineskip|linewidth|textwidth|textheight|columnwidth|paperwidth|paperheight)$/;

function texDecos(view) {
  const ranges = [];
  const doc = view.state.doc;
  const listing = view.state.field(listingField);
  const inListing = (pos) => {
    let hit = false;
    listing.between(pos, pos, () => {
      hit = true;
      return false;
    });
    return hit;
  };
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      pos = line.to + 1;
      if (inListing(line.from) && !BEGIN_RE.test(line.text) && !END_RE.test(line.text)) continue;
      const text = line.text;
      let end = text.length;
      const cm = /(^|[^\\])((?:\\\\)*)%/.exec(text);
      if (cm) {
        end = cm.index + cm[1].length + cm[2].length;
        ranges.push(M_COM.range(line.from + end, line.to));
      }
      const re = /\\([A-Za-z@]+\*?|\\|.)|\[/g;
      let m;
      let prevEnd = -1; // end index of previous command or closing brace/bracket
      while ((m = re.exec(text)) && m.index < end) {
        if (m[0] === '[') {
          if (prevEnd === m.index || /[}\]]/.test(text[m.index - 1] || '')) {
            const close = text.indexOf(']', m.index + 1);
            if (close > 0 && close < end) {
              if (close > m.index + 1)
                ranges.push(M_OPT.range(line.from + m.index + 1, line.from + close));
              prevEnd = close + 1;
              re.lastIndex = close + 1;
            }
          }
          continue;
        }
        const name = m[1].replace(/\*$/, '');
        const cls = KW_CMDS.has(name)
          ? M_KW
          : LEN_RE.test(name)
            ? M_LEN
            : /^[A-Za-z@]/.test(name)
              ? M_CMD
              : null;
        if (cls) ranges.push(cls.range(line.from + m.index, line.from + m.index + m[0].length));
        prevEnd = m.index + m[0].length;
      }
    }
  }
  return Decoration.set(ranges, true);
}
const texHighlight = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = texDecos(view);
    }
    update(u) {
      if (u.docChanged || u.viewportChanged) this.decorations = texDecos(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

export const themeComp = new Compartment();

// ---------- themes
const darkTheme = EditorView.theme(
  {
    '&': { backgroundColor: '#1b222c', color: '#f8f8f2' },
    '.tx-kw': { color: '#ff79c6' },
    '.tx-cmd': { color: '#8be9fd' },
    '.tx-len': { color: '#f1fa8c' },
    '.tx-opt': { color: '#ffb86c', fontStyle: 'italic' },
    '.tx-com': { color: '#6272a4' },
    '.cm-content': { caretColor: '#ffffff' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#ffffff' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: '#2d4a70' },
    '.cm-gutters': {
      backgroundColor: '#1b222c',
      color: '#6f7f95',
      border: 'none',
      borderRight: '1px solid #27313f',
    },
    '.cm-activeLine': { backgroundColor: '#ffffff0d' },
    '.cm-activeLineGutter': { backgroundColor: '#222b36', color: '#d8dee9' },
    '.cm-tooltip': {
      backgroundColor: '#222b36',
      border: '1px solid #27313f',
      color: '#d8dee9',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: '#2d4a70',
      color: '#fff',
    },
    '.cm-panels': { backgroundColor: '#222b36', color: '#d8dee9' },
    '.cm-searchMatch': { backgroundColor: '#614d1f' },
    '.cm-listing, .cm-listing span': { color: '#f1fa8c !important' },
    '.cm-foldPlaceholder': { backgroundColor: '#27313f', border: 'none', color: '#9fb0c3' },
  },
  { dark: true },
);

const lightTheme = EditorView.theme(
  {
    '&': { backgroundColor: '#ffffff', color: '#1f2933' },
    '.tx-kw': { color: '#c2185b' },
    '.tx-cmd': { color: '#00798c' },
    '.tx-len': { color: '#8a6d00' },
    '.tx-opt': { color: '#b35900', fontStyle: 'italic' },
    '.tx-com': { color: '#6a737d' },
    '.cm-gutters': {
      backgroundColor: '#f6f8fa',
      color: '#8795a5',
      border: 'none',
      borderRight: '1px solid #d8dee4',
    },
    '.cm-activeLine': { backgroundColor: '#eef4fb88' },
    '.cm-activeLineGutter': { backgroundColor: '#e8eef5' },
    '.cm-listing, .cm-listing span': { color: '#1a7f37 !important' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: '#b6d6fb' },
  },
  { dark: false },
);

export function themeExt(dark) {
  return dark ? [darkTheme] : [lightTheme];
}

// ---------- folding
const SECT_LEVEL = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};
const SECT_RE =
  /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?(?![a-zA-Z])/;

function stripComment(s) {
  const m = /(^|[^\\])((?:\\\\)*)%/.exec(s);
  return m ? s.slice(0, m.index + m[1].length + m[2].length) : s;
}

function foldLatex(state, lineStart) {
  const doc = state.doc;
  const line = doc.lineAt(lineStart);
  const code = stripComment(line.text);
  let m;
  if ((m = SECT_RE.exec(code))) {
    const lvl = SECT_LEVEL[m[1]];
    let endLine = doc.lines;
    for (let n = line.number + 1; n <= doc.lines; n++) {
      const c = stripComment(doc.line(n).text);
      const s = SECT_RE.exec(c);
      if ((s && SECT_LEVEL[s[1]] <= lvl) || /\\end\{document\}/.test(c)) {
        endLine = n - 1;
        break;
      }
    }
    while (endLine > line.number && doc.line(endLine).text.trim() === '') endLine--;
    if (endLine > line.number) return { from: line.to, to: doc.line(endLine).to };
    return null;
  }
  if (/\\documentclass/.test(code)) {
    for (let n = line.number + 1; n <= doc.lines; n++) {
      if (/\\begin\{document\}/.test(stripComment(doc.line(n).text))) {
        return n - 1 > line.number ? { from: line.to, to: doc.line(n - 1).to } : null;
      }
    }
    return null;
  }
  const bm = /\\begin\{([^}]+)\}/.exec(code);
  if (bm) {
    const env = bm[1];
    const re = /\\(begin|end)\{([^}]+)\}/g;
    let depth = 0;
    const limit = Math.min(doc.lines, line.number + 20000);
    for (let n = line.number; n <= limit; n++) {
      const text = stripComment(doc.line(n).text);
      re.lastIndex = n === line.number ? bm.index : 0;
      let x;
      while ((x = re.exec(text))) {
        if (x[2] !== env) continue;
        depth += x[1] === 'begin' ? 1 : -1;
        if (depth === 0) {
          if (n === line.number) return null;
          return { from: line.to, to: doc.line(n).from - 1 };
        }
      }
    }
  }
  return null;
}

// ---------- commands
function toggleComment(view) {
  const { state } = view;
  const lines = new Set();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) lines.add(n);
  }
  const arr = [...lines].map((n) => state.doc.line(n));
  const nonEmpty = arr.filter((l) => l.text.trim());
  const allCommented = nonEmpty.length > 0 && nonEmpty.every((l) => /^\s*%/.test(l.text));
  const changes = [];
  for (const l of arr) {
    if (!l.text.trim() && !allCommented) continue;
    if (allCommented) {
      const m = /^(\s*)% ?/.exec(l.text);
      if (m) changes.push({ from: l.from + m[1].length, to: l.from + m[0].length, insert: '' });
    } else {
      const ind = /^\s*/.exec(l.text)[0].length;
      changes.push({ from: l.from + ind, insert: '% ' });
    }
  }
  view.dispatch({ changes });
  return true;
}

export function wrapToggle(view, cmd) {
  const open = `\\${cmd}{`;
  const { state } = view;
  const r = state.selection.main;
  const doc = state.doc;
  if (r.empty) {
    view.dispatch({
      changes: { from: r.from, insert: open + '}' },
      selection: { anchor: r.from + open.length },
    });
  } else {
    const sel = doc.sliceString(r.from, r.to);
    const before = doc.sliceString(Math.max(0, r.from - open.length), r.from);
    const after = doc.sliceString(r.to, r.to + 1);
    if (sel.startsWith(open) && sel.endsWith('}')) {
      view.dispatch({
        changes: { from: r.from, to: r.to, insert: sel.slice(open.length, -1) },
        selection: { anchor: r.from, head: r.to - open.length - 1 },
      });
    } else if (before === open && after === '}') {
      view.dispatch({
        changes: [
          { from: r.from - open.length, to: r.from },
          { from: r.to, to: r.to + 1 },
        ],
        selection: { anchor: r.from - open.length, head: r.to - open.length },
      });
    } else {
      view.dispatch({
        changes: [
          { from: r.from, insert: open },
          { from: r.to, insert: '}' },
        ],
        selection: { anchor: r.from + open.length, head: r.to + open.length },
      });
    }
  }
  view.focus();
  return true;
}

// ---------- factory
// handlers: { onChange(path), onCursor(path), onSave(), onCompile(), onForward() }
export function createState(path, text, handlers, dark) {
  const listener = EditorView.updateListener.of((u) => {
    if (u.docChanged && !u.transactions.some((tr) => tr.annotation(externalChange)))
      handlers.onChange(path);
    if (u.selectionSet || u.docChanged) handlers.onCursor(path, u.state);
  });
  return EditorState.create({
    doc: text,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightSelectionMatches(),
      EditorState.tabSize.of(4),
      EditorState.languageData.of(() => [{ closeBrackets: { brackets: ['(', '[', '{', '$'] } }]),
      StreamLanguage.define(stex),
      autocompletion({ override: [latexCompletions], activateOnTyping: true }),
      foldService.of(foldLatex),
      listingField,
      texHighlight,
      foldGutter(),
      lintGutter(),
      EditorView.lineWrapping,
      search({ top: false, createPanel: createFindPanel }),
      keymap.of([
        {
          key: 'Mod-s',
          run: () => {
            handlers.onSave();
            return true;
          },
          preventDefault: true,
        },
        {
          key: 'Mod-Enter',
          run: () => {
            handlers.onCompile();
            return true;
          },
          preventDefault: true,
        },
        { key: 'Mod-b', run: (v) => wrapToggle(v, 'textbf'), preventDefault: true },
        { key: 'Mod-i', run: (v) => wrapToggle(v, 'textit'), preventDefault: true },
        { key: 'Mod-/', run: toggleComment, preventDefault: true },
        {
          key: 'Mod-Alt-ArrowRight',
          run: () => {
            handlers.onForward();
            return true;
          },
          preventDefault: true,
        },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      themeComp.of(themeExt(dark)),
      listener,
    ],
  });
}

import { Annotation } from '@codemirror/state';
export const externalChange = Annotation.define();

// Apply compile issues as diagnostics (whole line) to a state; returns new state
export function withDiagnostics(state, issues) {
  const doc = state.doc;
  const diags = [];
  for (const i of issues) {
    if (!i.line || i.line < 1 || i.line > doc.lines) continue;
    const ln = doc.line(i.line);
    diags.push({
      from: ln.from,
      to: Math.max(ln.to, ln.from),
      severity: i.severity === 'error' ? 'error' : i.severity === 'warning' ? 'warning' : 'info',
      message: i.message,
    });
  }
  return state.update(setDiagnostics(state, diags)).state;
}

export function diagnosticsTransaction(state, issues) {
  const doc = state.doc;
  const diags = [];
  for (const i of issues) {
    if (!i.line || i.line < 1 || i.line > doc.lines) continue;
    const ln = doc.line(i.line);
    diags.push({
      from: ln.from,
      to: ln.to,
      severity: i.severity === 'error' ? 'error' : i.severity === 'warning' ? 'warning' : 'info',
      message: i.message,
    });
  }
  return setDiagnostics(state, diags);
}

export function createView(parent) {
  return new EditorView({ parent });
}
