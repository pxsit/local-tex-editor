import { snippetCompletion } from '@codemirror/autocomplete';
import { api } from './api.js';

export const data = { labels: [], bibkeys: [], commands: [], envs: [] };

let timer = 0;
export async function refreshCompletions() {
  try {
    Object.assign(data, await api.completions());
  } catch {
    /* keep old */
  }
}
export function refreshCompletionsSoon() {
  clearTimeout(timer);
  timer = setTimeout(refreshCompletions, 3000);
}

const BASE_ENVS =
  'document equation equation* align align* gather multline split cases itemize enumerate description figure table tabular tabularx center flushleft flushright minipage verbatim lstlisting minted abstract quote quotation theorem lemma proof definition corollary remark example frame block columns column tikzpicture array matrix pmatrix bmatrix vmatrix subfigure thebibliography appendix'.split(
    ' ',
  );

// [template, detail]
const CMDS = [
  ['\\documentclass[#{}]{#{article}}', 'class'],
  ['\\usepackage{#{}}', 'package'],
  ['\\begin{#{}}', 'environment'],
  ['\\end{#{}}', 'environment'],
  ['\\part{#{}}'],
  ['\\chapter{#{}}'],
  ['\\section{#{}}'],
  ['\\subsection{#{}}'],
  ['\\subsubsection{#{}}'],
  ['\\paragraph{#{}}'],
  ['\\subparagraph{#{}}'],
  ['\\section*{#{}}'],
  ['\\subsection*{#{}}'],
  ['\\title{#{}}'],
  ['\\author{#{}}'],
  ['\\date{#{}}'],
  ['\\maketitle'],
  ['\\tableofcontents'],
  ['\\listoffigures'],
  ['\\listoftables'],
  ['\\textbf{#{}}'],
  ['\\textit{#{}}'],
  ['\\emph{#{}}'],
  ['\\texttt{#{}}'],
  ['\\textsc{#{}}'],
  ['\\textsf{#{}}'],
  ['\\textrm{#{}}'],
  ['\\underline{#{}}'],
  ['\\text{#{}}'],
  ['\\mathbf{#{}}'],
  ['\\mathit{#{}}'],
  ['\\mathrm{#{}}'],
  ['\\mathbb{#{}}'],
  ['\\mathcal{#{}}'],
  ['\\mathfrak{#{}}'],
  ['\\mathsf{#{}}'],
  ['\\mathtt{#{}}'],
  ['\\boldsymbol{#{}}'],
  ['\\label{#{}}'],
  ['\\ref{#{}}'],
  ['\\eqref{#{}}'],
  ['\\pageref{#{}}'],
  ['\\autoref{#{}}'],
  ['\\cref{#{}}'],
  ['\\Cref{#{}}'],
  ['\\nameref{#{}}'],
  ['\\cite{#{}}'],
  ['\\citep{#{}}'],
  ['\\citet{#{}}'],
  ['\\parencite{#{}}'],
  ['\\textcite{#{}}'],
  ['\\footcite{#{}}'],
  ['\\footnote{#{}}'],
  ['\\bibliography{#{}}'],
  ['\\bibliographystyle{#{}}'],
  ['\\printbibliography'],
  ['\\addbibresource{#{}}'],
  ['\\includegraphics[width=#{0.8\\linewidth}]{#{}}'],
  ['\\caption{#{}}'],
  ['\\centering'],
  ['\\input{#{}}'],
  ['\\include{#{}}'],
  ['\\includeonly{#{}}'],
  ['\\subfile{#{}}'],
  ['\\frac{#{}}{#{}}'],
  ['\\dfrac{#{}}{#{}}'],
  ['\\tfrac{#{}}{#{}}'],
  ['\\sqrt{#{}}'],
  ['\\sqrt[#{n}]{#{}}'],
  ['\\sum_{#{}}^{#{}}'],
  ['\\prod_{#{}}^{#{}}'],
  ['\\int_{#{}}^{#{}}'],
  ['\\oint'],
  ['\\lim_{#{}}'],
  ['\\left( #{} \\right)'],
  ['\\left[ #{} \\right]'],
  ['\\left\\{ #{} \\right\\}'],
  ['\\left| #{} \\right|'],
  ['\\big'],
  ['\\Big'],
  ['\\bigg'],
  ['\\Bigg'],
  ['\\overline{#{}}'],
  ['\\hat{#{}}'],
  ['\\bar{#{}}'],
  ['\\vec{#{}}'],
  ['\\dot{#{}}'],
  ['\\ddot{#{}}'],
  ['\\tilde{#{}}'],
  ['\\widehat{#{}}'],
  ['\\widetilde{#{}}'],
  ['\\overbrace{#{}}^{#{}}'],
  ['\\underbrace{#{}}_{#{}}'],
  ['\\binom{#{}}{#{}}'],
  ['\\operatorname{#{}}'],
  ['\\stackrel{#{}}{#{}}'],
  ['\\xrightarrow{#{}}'],
  ['\\substack{#{}}'],
  ['\\item'],
  ['\\hline'],
  ['\\cline{#{}}'],
  ['\\multicolumn{#{}}{#{}}{#{}}'],
  ['\\multirow{#{}}{#{}}{#{}}'],
  ['\\toprule'],
  ['\\midrule'],
  ['\\bottomrule'],
  ['\\newcommand{\\#{name}}[#{1}]{#{}}'],
  ['\\renewcommand{\\#{name}}[#{1}]{#{}}'],
  ['\\newenvironment{#{}}{#{}}{#{}}'],
  ['\\newtheorem{#{}}{#{}}'],
  ['\\DeclareMathOperator{\\#{name}}{#{}}'],
  ['\\def\\#{name}{#{}}'],
  ['\\setlength{#{}}{#{}}'],
  ['\\setcounter{#{}}{#{}}'],
  ['\\hspace{#{}}'],
  ['\\vspace{#{}}'],
  ['\\hspace*{#{}}'],
  ['\\vspace*{#{}}'],
  ['\\newpage'],
  ['\\clearpage'],
  ['\\pagebreak'],
  ['\\linebreak'],
  ['\\noindent'],
  ['\\indent'],
  ['\\par'],
  ['\\quad'],
  ['\\qquad'],
  ['\\hfill'],
  ['\\vfill'],
  ['\\smallskip'],
  ['\\medskip'],
  ['\\bigskip'],
  ['\\tiny'],
  ['\\scriptsize'],
  ['\\footnotesize'],
  ['\\small'],
  ['\\normalsize'],
  ['\\large'],
  ['\\Large'],
  ['\\LARGE'],
  ['\\huge'],
  ['\\Huge'],
  ['\\url{#{}}'],
  ['\\href{#{}}{#{}}'],
  ['\\hyperref[#{}]{#{}}'],
  ['\\color{#{}}'],
  ['\\textcolor{#{}}{#{}}'],
  ['\\colorbox{#{}}{#{}}'],
  ['\\fbox{#{}}'],
  ['\\mbox{#{}}'],
  ['\\parbox{#{}}{#{}}'],
  ['\\raisebox{#{}}{#{}}'],
  ['\\makebox[#{}]{#{}}'],
  ['\\alpha'],
  ['\\beta'],
  ['\\gamma'],
  ['\\delta'],
  ['\\epsilon'],
  ['\\varepsilon'],
  ['\\zeta'],
  ['\\eta'],
  ['\\theta'],
  ['\\vartheta'],
  ['\\iota'],
  ['\\kappa'],
  ['\\lambda'],
  ['\\mu'],
  ['\\nu'],
  ['\\xi'],
  ['\\pi'],
  ['\\varpi'],
  ['\\rho'],
  ['\\varrho'],
  ['\\sigma'],
  ['\\varsigma'],
  ['\\tau'],
  ['\\upsilon'],
  ['\\phi'],
  ['\\varphi'],
  ['\\chi'],
  ['\\psi'],
  ['\\omega'],
  ['\\Gamma'],
  ['\\Delta'],
  ['\\Theta'],
  ['\\Lambda'],
  ['\\Xi'],
  ['\\Pi'],
  ['\\Sigma'],
  ['\\Upsilon'],
  ['\\Phi'],
  ['\\Psi'],
  ['\\Omega'],
  ['\\leftarrow'],
  ['\\rightarrow'],
  ['\\Leftarrow'],
  ['\\Rightarrow'],
  ['\\leftrightarrow'],
  ['\\Leftrightarrow'],
  ['\\mapsto'],
  ['\\to'],
  ['\\gets'],
  ['\\uparrow'],
  ['\\downarrow'],
  ['\\implies'],
  ['\\iff'],
  ['\\longrightarrow'],
  ['\\hookrightarrow'],
  ['\\leq'],
  ['\\geq'],
  ['\\neq'],
  ['\\approx'],
  ['\\equiv'],
  ['\\sim'],
  ['\\simeq'],
  ['\\cong'],
  ['\\propto'],
  ['\\ll'],
  ['\\gg'],
  ['\\subset'],
  ['\\supset'],
  ['\\subseteq'],
  ['\\supseteq'],
  ['\\in'],
  ['\\notin'],
  ['\\ni'],
  ['\\cup'],
  ['\\cap'],
  ['\\setminus'],
  ['\\emptyset'],
  ['\\varnothing'],
  ['\\times'],
  ['\\cdot'],
  ['\\cdots'],
  ['\\ldots'],
  ['\\vdots'],
  ['\\ddots'],
  ['\\pm'],
  ['\\mp'],
  ['\\div'],
  ['\\ast'],
  ['\\star'],
  ['\\circ'],
  ['\\bullet'],
  ['\\oplus'],
  ['\\otimes'],
  ['\\infty'],
  ['\\partial'],
  ['\\nabla'],
  ['\\forall'],
  ['\\exists'],
  ['\\nexists'],
  ['\\neg'],
  ['\\land'],
  ['\\lor'],
  ['\\wedge'],
  ['\\vee'],
  ['\\angle'],
  ['\\perp'],
  ['\\parallel'],
  ['\\therefore'],
  ['\\because'],
  ['\\hbar'],
  ['\\ell'],
  ['\\Re'],
  ['\\Im'],
  ['\\aleph'],
  ['\\prime'],
  ['\\sin'],
  ['\\cos'],
  ['\\tan'],
  ['\\cot'],
  ['\\sec'],
  ['\\csc'],
  ['\\arcsin'],
  ['\\arccos'],
  ['\\arctan'],
  ['\\sinh'],
  ['\\cosh'],
  ['\\tanh'],
  ['\\log'],
  ['\\ln'],
  ['\\exp'],
  ['\\max'],
  ['\\min'],
  ['\\sup'],
  ['\\inf'],
  ['\\det'],
  ['\\gcd'],
  ['\\deg'],
  ['\\dim'],
  ['\\ker'],
  ['\\arg'],
  ['\\LaTeX'],
  ['\\TeX'],
  ['\\today'],
  ['\\textbackslash'],
  ['\\textasciitilde'],
  ['\\dots'],
  ['\\copyright'],
  ['\\S'],
  ['\\P'],
  ['\\dag'],
  ['\\ddag'],
  ['\\linewidth'],
  ['\\textwidth'],
  ['\\columnwidth'],
  ['\\textheight'],
  ['\\paperwidth'],
  ['\\baselineskip'],
  ['\\parindent'],
  ['\\parskip'],
  ['\\setmainfont{#{}}'],
  ['\\setsansfont{#{}}'],
  ['\\setmonofont{#{}}'],
  ['\\newfontfamily\\#{name}{#{}}'],
  ['\\fontsize{#{}}{#{}}\\selectfont'],
  ['\\geometry{#{}}'],
  ['\\pagestyle{#{}}'],
  ['\\thispagestyle{#{}}'],
  ['\\pagenumbering{#{}}'],
  ['\\twocolumn'],
  ['\\onecolumn'],
  ['\\appendix'],
  ['\\lstinputlisting{#{}}'],
  ['\\lstset{#{}}'],
  ['\\tikz{#{}}'],
  ['\\node at (#{0,0}) {#{}};'],
  ['\\draw (#{0,0}) -- (#{1,1});'],
].map(([tpl, detail]) => {
  const label = /^\\[A-Za-z@]+\*?/.exec(tpl)[0];
  return { tpl, label, detail };
});

const cmdCompletions = CMDS.map((c) =>
  c.tpl === c.label
    ? {
        label: c.label,
        type: 'keyword',
        detail: c.detail,
        boost: c.label === '\\sec' ? -50 : 0,
      }
    : snippetCompletion(c.tpl, {
        label: c.label,
        type: 'function',
        detail: c.detail || c.tpl.slice(c.label.length),
      }),
);

function userCommands() {
  return data.commands.map((c) => {
    if (!c.args) return { label: '\\' + c.name, type: 'function', detail: 'user' };
    return snippetCompletion('\\' + c.name + '{#{}}'.repeat(c.args), {
      label: '\\' + c.name,
      type: 'function',
      detail: 'user',
    });
  });
}

function envApply(isBegin) {
  return (view, completion, from, to) => {
    const name = completion.label;
    const doc = view.state.doc;
    const after = doc.sliceString(to, to + 1);
    const end = after === '}' ? to + 1 : to;
    if (!isBegin) {
      view.dispatch({
        changes: { from, to: end, insert: name + '}' },
        selection: { anchor: from + name.length + 1 },
        userEvent: 'input.complete',
      });
      return;
    }
    const line = doc.lineAt(from);
    const indent = /^\s*/.exec(line.text)[0];
    const body = name + '}\n' + indent + '\t';
    const insert = body + '\n' + indent + '\\end{' + name + '}';
    view.dispatch({
      changes: { from, to: end, insert },
      selection: { anchor: from + body.length },
      userEvent: 'input.complete',
    });
  };
}

export function latexCompletions(context) {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  let m;
  if ((m = /\\(?:ref|eqref|pageref|autoref|cref|Cref|nameref|vref)\{([^}]*)$/.exec(before))) {
    return {
      from: context.pos - m[1].length,
      options: data.labels.map((l) => ({
        label: l.name,
        type: 'constant',
        detail: l.file + ':' + l.line,
      })),
      validFor: /^[^}]*$/,
    };
  }
  if ((m = /\\\w*cite\w*\*?(?:\[[^\]]*\])*\{([^}]*)$/.exec(before))) {
    const last = m[1].slice(m[1].lastIndexOf(',') + 1);
    const typed = last.trimStart().length;
    return {
      from: context.pos - typed,
      options: data.bibkeys.map((b) => ({ label: b.key, type: 'text', detail: b.title })),
      validFor: /^[^,}]*$/,
    };
  }
  if ((m = /\\(begin|end)\{([a-zA-Z*]*)$/.exec(before))) {
    const names = [...new Set([...BASE_ENVS, ...data.envs])];
    return {
      from: context.pos - m[2].length,
      options: names.map((n) => ({
        label: n,
        type: 'class',
        apply: envApply(m[1] === 'begin'),
      })),
      validFor: /^[a-zA-Z*]*$/,
    };
  }
  if ((m = /\\[a-zA-Z]*$/.exec(before))) {
    return {
      from: context.pos - m[0].length,
      options: [...cmdCompletions, ...userCommands()],
      validFor: /^\\[a-zA-Z]*$/,
    };
  }
  return null;
}
