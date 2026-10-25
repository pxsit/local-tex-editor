# LaTeX Editor — Implementation Plan

A local, single-project, Overleaf-style LaTeX editor for one user on one Windows PC.
Read this whole file before writing code. Every decision here was agreed with the user;
don't change behaviour without a reason, and list any deviation in your final report.

## 0. Environment facts (already verified)

- Windows 11, user `Administrator`. App root: `C:\Users\Administrator\Documents\latex-editor\` (this folder).
- **Project files live in `contents\`** (currently empty — the user wants it left empty; do NOT add a starter `main.tex` there).
- Node v26, npm. `npm install` already done. Installed: `express@5`, `multer@2`, `esbuild@0.25`,
  `pdfjs-dist@5.7.284`, `@codemirror/{state,view,commands,language,legacy-modes,autocomplete,search,lint}`, `@lezer/highlight`.
- MiKTeX 26.5 in `C:\Program Files\MiKTeX\miktex\bin\x64\`: `xelatex`, `pdflatex`, `lualatex`, `bibtex`, `biber`, `synctex.exe`.
- **No Perl → `latexmk` does not work.** The server orchestrates passes itself.
- PDF.js 5.x render API: `page.render({ canvas, viewport, transform? })` (`canvasContext` still accepted). Check `node_modules/pdfjs-dist/types/src/display/api.d.ts` when unsure.
- Startup folder: `C:\Users\Administrator\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup`.

## 1. Requirements summary

- Server on **`127.0.0.1:8170` only**, no login. Shell-escape stays off.
- **Look:** dark theme by default, with a light/dark toggle. The PDF pane has a grey background with white pages.
- **Layout (left → right):** icon rail | sidebar | editor column | PDF column, with draggable resizers between them.
- **Top bar (slim, no menus):**
  - project label and main-file name
  - save status ("Saving…" / "All changes saved")
  - engine dropdown (XeLaTeX default, pdfLaTeX, LuaLaTeX)
  - Auto-compile switch (default ON)
  - **Recompile** button with spinner and "Compiling…"
  - **Open in new window** (↗)
  - **Download PDF**
  - theme toggle
- **Icon rail:** two icons, Files and Search. Clicking the active icon collapses or expands the sidebar.
- **Files sidebar:** two accordion sections, **File tree** and **File outline**.
  - Only one is expanded at a time. The other stays as a collapsed header row, as in Overleaf.
  - Remember which one was open (localStorage).
- **Editor:**
  - CodeMirror 6 with tabs (one tab per open file, × and middle-click close, dirty dot).
  - Open tabs and the active tab are remembered in localStorage.
  - The toolbar sits above the editor.
  - Code mode only (no Visual mode, no spellcheck).
- **Autosave** 1000 ms after the last keystroke, plus Ctrl+S to flush immediately. No file watcher for external edits.
- **Auto-compile:** about 1500 ms after a successful save. A new compile request kills a running one and restarts with the latest files.
- **While compiling,** the old PDF stays visible. The new PDF renders off-screen and is swapped in seamlessly at the **same page + same relative offset in that page**.
- **On failure:**
  - If no new PDF is produced, the last PDF stays.
  - If a PDF is produced despite errors, show it (Overleaf behaviour).
  - Either way, show the error count badge, the log panel, and lint markers in the editor.
- **SyncTeX** both directions.
  - Double-click in the PDF jumps to the source.
  - An editor command or button scrolls the PDF to the cursor and flashes a highlight there.
- **Pop-out viewer** (`/viewer`): a full-window PDF.js page with zoom, page navigation, download and print.
  - It live-reloads after each compile (SSE) and keeps its scroll position.
- **Autostart** at Windows login (hidden, no console) plus `start.bat`.

## 2. File layout

```
latex-editor/
  server.js            express app, routes, SSE, host check, startup
  lib/paths.js         CONTENTS_DIR, BUILD_DIR, safeResolve(rel), isHidden(rel), text-ext list
  lib/files.js         tree, read/write (atomic), mkdir, rename/move, delete, upload, search/replace
  lib/compile.js       compile orchestrator (passes, cancel, versioning)
  lib/logparse.js      LaTeX log -> issues[]
  lib/synctex.js       forward/inverse via synctex.exe
  lib/outline.js       outline + labels + bib keys + \newcommand scan
  lib/settings.js      settings.json load/save (mainFile, engine, autoCompile)
  build.js             esbuild bundling + copy pdf.worker
  src/app/main.js      entry for index.html
  src/app/api.js       fetch helpers
  src/app/events.js    SSE client (EventSource('/api/events'))
  src/app/editor.js    CodeMirror setup: language, theme, folding, keymaps, lint
  src/app/complete.js  autocomplete sources + command/env lists
  src/app/tabs.js      tab bar + per-file EditorState + autosave
  src/app/toolbar.js   formatting toolbar, symbol picker, table grid picker
  src/app/tree.js      file tree, context menu, DnD, upload
  src/app/outline.js   outline panel
  src/app/search.js    project search/replace panel
  src/app/logpanel.js  compile log panel
  src/app/layout.js    resizers, rail, accordion, theme
  src/shared/pdfview.js  PdfView class (used by app AND viewer)
  src/viewer/main.js   entry for viewer.html
  public/index.html, public/viewer.html, public/style.css
  public/app.js, public/viewer.js, public/pdf.worker.min.mjs   (build output, committed)
  settings.json        (created at runtime)
  launcher.vbs, start.bat, install-autostart.ps1, uninstall-autostart.ps1
  README.md
  contents/            user's LaTeX project (keep empty)
  contents/.build/     compile output (hidden from tree, created on demand)
```

The built bundles live in `public/`, so starting the server never needs a build step.
`node build.js` runs esbuild with `bundle:true, format:'esm', minify:true, sourcemap:true, target:'es2022'`.
It builds `src/app/main.js → public/app.js` and `src/viewer/main.js → public/viewer.js`,
and copies `node_modules/pdfjs-dist/build/pdf.worker.min.mjs → public/`.
In the bundles, set `GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'`.

## 3. Server

### 3.1 Basics

- `CONTENTS_DIR = process.env.CONTENTS_DIR || path.join(__dirname,'contents')`. **Use the env override for all testing** so `contents\` stays empty.
- `listen(8170, '127.0.0.1')`. On `EADDRINUSE`, log "already running" and `process.exit(0)`. This keeps a second launch harmless.
- **DNS-rebinding guard:** middleware rejects with 403 any request whose `Host` header is not `localhost:8170` or `127.0.0.1:8170`.
  For non-GET requests, also reject when an `Origin` header is present and isn't `http://localhost:8170` or `http://127.0.0.1:8170`.
- Log to stdout and append to `server.log`. The launcher redirects output there anyway.
- **TeX binaries:** resolve each one via PATH. If that fails, fall back to `C:\Program Files\MiKTeX\miktex\bin\x64\<exe>`. Autostart processes may have a thin PATH.
- **`safeResolve(rel)`:**
  - Normalize `/` and `\`.
  - Reject absolute paths, `..` escapes, and anything under `.build`.
  - Return the absolute path.
  - Use it on every route that takes a path.
- `GET /api/ping` returns `{ok:true}`. `start.bat` uses it.

### 3.2 Files API (all paths relative to CONTENTS_DIR, `/` separators)

- **`GET /api/tree`** returns `[{name, path, type:'dir'|'file', children?}]`.
  - Skip `.build` and dotfiles.
  - Sort directories first, then case-insensitive.
- **`GET /api/file?path=`** returns the text (utf8) when the file has a text extension; otherwise 415.
  - Text extensions: `tex bib sty cls bst bbx cbx lbx dtx ins cfg def clo txt md csv json lua py cpp c h hpp js ts java tikz asy gnuplot dat log`.
- **`PUT /api/file?path=`** with a text/plain body (express.text, limit 50mb) writes the file.
  - Write to `file.tmp-<rand>` and then `fs.rename` over the target, so the file is never half-written.
  - Create parent directories as needed.
- **`POST /api/file-beacon?path=`** does the same as PUT. It's used by `navigator.sendBeacon` on `pagehide` to flush unsaved text.
- **`POST /api/new-file {path}`** creates an empty file. It fails with 409 if the file exists.
- **`POST /api/mkdir {path}`** creates a folder.
- **`POST /api/rename {from, to}`** renames or moves an entry. It fails with 409 if the target exists. Moving into a folder means `to = folder/name`.
  - If the renamed file is the main file, update `settings.mainFile`.
- **`DELETE /api/entry?path=`** runs `fs.rm(recursive)`. The client confirms first.
- **`POST /api/upload?dir=`** takes multer memory storage with field `files` (multiple) and writes each file into `dir`.
  - Uploading a folder via `webkitdirectory` is optional; preserve `webkitRelativePath` if you support it.
- **`GET /raw/*path`** serves a project file (images and PDFs for preview), using `res.sendFile` after `safeResolve`.
- **`GET /api/search?q=&regex=0|1&case=0|1&word=0|1`** searches every text file.
  - Returns `[{path, matches:[{line, col, len, text}]}]`.
  - Cap at 2000 matches. Trim line text to 200 characters around the match.
- **`POST /api/replace {q, regex, case, word, replacement, paths?}`** replaces across all text files, or only the given `paths`.
  - Returns `{files:n, replacements:n}`.
  - Regex mode supports `$1`. Always use the `g` flag; add `i` when case is off.

### 3.3 Settings

- **`settings.json`** sits in the app root, not in contents: `{ "mainFile": "main.tex", "engine": "xelatex", "autoCompile": true }`.
- **`GET /api/settings`** returns the settings and **`PUT /api/settings`** merges, saves and returns them.
- The engine whitelist is `xelatex | pdflatex | lualatex`.

### 3.4 Compile (`lib/compile.js`)

**State**

The state is `{ running: {proc, cancelled, promise} | null, version: int, lastResult }`.

- `version` starts from the mtime of `.build/output.pdf` when that file exists, else 0.
- Expose `version` in `GET /api/status`, along with `{version, compiling, lastResult}`.

**Request**

`POST /api/compile` handles a compile request.

- If a compile is running, mark it cancelled, kill its process tree with `taskkill /PID <pid> /T /F`, and await its end.
- Then start a new one. The response is sent when that run finishes.
  - A finished run returns `{status:'success'|'error'|'failed'|'cancelled', version, issues, durationMs}`.
  - `failed` means no PDF was produced. `error` means a PDF was produced but the log has errors.
- If the run is cancelled, its request gets `{status:'cancelled'}`.
- **`POST /api/compile/cancel`** cancels the running compile.

**Run steps**

The working directory for every step is `CONTENTS_DIR`, and `OUT = .build`.

1. Check that the main file exists. If it doesn't, return `failed` with the issue "Main document `<name>` not found. Create it or right-click a .tex file → Set as main document."
2. Mirror every sub-directory of contents into `.build`. `\include{chapters/x}` writes `.build/chapters/x.aux` and fails if that folder is missing.
3. Spawn the engine directly, with no shell:
   `<engine> -synctex=1 -interaction=nonstopmode -file-line-error -max-print-line=10000 -enable-installer -output-directory=.build <mainFile>`.
   - `-enable-installer` lets MiKTeX install missing packages. `-max-print-line=10000` is a MiKTeX option that stops 79-column log wrapping; confirm it is accepted. If it isn't, set env `max_print_line=10000`.
   - Pass `-no-shell-escape`.
   - Before each engine run, snapshot the `.aux` hash; compare with the hash after the run.
4. **Bibliography:**
   - Run **biber** when `.build/<job>.bcf` exists and the log contains `Please (re)run Biber` or the `.bcf` changed.
     Command: `biber --input-directory=<CONTENTS_DIR> --output-directory=.build <job>`, with cwd CONTENTS_DIR.
   - Otherwise run **bibtex** when `.build/<job>.aux` contains `\bibdata`.
     Command: `bibtex <job>` with cwd `.build`, env `BIBINPUTS=<CONTENTS_DIR>;` and `BSTINPUTS=<CONTENTS_DIR>;`. MiKTeX bibtex also accepts `-include-directory=<CONTENTS_DIR>`; use it as well.
   - **Skip the bib step** when the citation keys in the aux, the `.bib` files' mtimes, and the bcf hash are all unchanged since the last successful bib run. Cache these in memory. This keeps auto-compile fast.
   - When the bib tool ran, rerun the engine.
5. **Rerun the engine** while either of these holds, up to **3 engine runs total**:
   - the log contains `Rerun to get`, `Label(s) may have changed`, `Please rerun LaTeX`, or `Rerun LaTeX`;
   - the `.aux` hash changed in a run that wasn't the first after a clean build.
   - **Optimisation:** if the first run's aux equals the previous compile's final aux and no bib step was needed, stop after one run.
6. Between steps, check `cancelled`, and stop immediately if set.
7. **Result:**
   - If `.build/<job>.pdf` exists with an mtime ≥ the compile start time, copy it to `.build/output.pdf`, copy `<job>.synctex.gz` to `.build/output.synctex.gz`, and run `version++`.
     The copy means a cancelled or failed later run never corrupts the PDF being shown. synctex matches the `.synctex.gz` to the PDF by basename, so keep both names as `output.*`.
   - Parse the final log with logparse into `issues`.
   - Save the combined raw logs of all steps for `/api/log`, with each step's command line as a header.
   - Broadcast SSE `compiled {version, status, errors, warnings}`.
   - Broadcast `compile-start` when a run begins.
8. `<job>` is the main file's basename without `.tex`.
   - If the main file is in a subfolder, still run from CONTENTS_DIR, pass the relative path, and use `-output-directory=.build`. The output then lands in `.build/<job>.*`.

**Other routes**

- **`GET /pdf`** serves `.build/output.pdf` with `Cache-Control: no-store`, and 404 if there is none.
  Clients add `?v=<version>` to the URL.
- **`GET /api/log`** returns the raw log text.

### 3.5 Log parser (`lib/logparse.js`)

The parser returns `[{severity:'error'|'warning'|'typesetting', file, line, message, context}]`.
`file` is relative to contents, or null. `line` can be null.

**Errors**

- File-line errors look like `^(.+?\.\w+):(\d+): (.*)$`, where the path is `./x.tex` or absolute. Normalize the path to relative.
- Take `context` from the next 1–3 lines, such as the `l.12 ...` line.
- `^! (.*)` lines without a file-line prefix are errors too.
  - Attribute them to the current file using the paren stack below.
  - Take the line number from a following `l.(\d+)` line.

**Warnings**

- Warnings match `^(LaTeX|Package \S+|Class \S+) Warning: (.*)` and continue onto the following lines that start with `(pkgname)` padding.
- Take the line number from `on input line (\d+)`.

**Typesetting**

- These are `^(Overfull|Underfull) \\[hv]box .*?(?:at lines? (\d+)(?:--\d+)?)?`.

**Current file (paren stack)**

- Scan characters.
  - `(` followed by a path-like token (`./…`, `C:/…`, or anything ending in `.tex|.sty|.cls|.cfg|.def|.bbl|.aux|.clo|.fd|.ldf`) pushes that path.
  - Any other `(` pushes null.
  - `)` pops.
- The current file is the top non-null entry. It's a heuristic; keep it robust and never throw.
- Only report a `file` when it resolves inside CONTENTS_DIR. System `.sty` files give file=null.

**Housekeeping**

- Deduplicate identical issues.
- Add a test file `lib/logparse.test.js`, using `node --test`, with 3–4 small sample logs.

### 3.6 SyncTeX (`lib/synctex.js`)

- **Forward:** `GET /api/synctex/view?file=<rel>&line=<n>&col=<c>`.
  - Run `synctex view -i <line>:<col>:<input> -o <abs .build/output.pdf>`.
  - Try `<input>` as the absolute path first, then as `./<rel>`, then as `<rel>`. Stop at the first that gives results.
  - Parse the blocks of `Page:`, `x:`, `y:`, `h:`, `v:`, `W:`, `H:`.
  - Return `[{page, h, v, W, H}]`. Units are PDF big points with the origin at the top-left of the page; `v` is the baseline and the box spans `v-H … v`.
- **Inverse:** `GET /api/synctex/edit?page=<p>&x=<x>&y=<y>`, with x and y in PDF points from the top-left.
  - Run `synctex edit -o <p>:<x>:<y>:<abs output.pdf>`.
  - Parse `Input:`, `Line:` and `Column:`.
  - Convert `Input` to a path relative to contents: normalize slashes, collapse `/./`, and strip the CONTENTS_DIR prefix (case-insensitive on Windows). Return `{file, line}`, or 404.
- Run `synctex.exe` with `execFile` (no shell) and a 5 s timeout.

### 3.7 Outline and completion data (`lib/outline.js`)

**`GET /api/outline`** follows the document from the main file.

- Strip `%` comments, but not `\%`.
- Walk the text in order.
  - `\input{x}`, `\include{x}`, `\subfile{x}`, `\import{dir}{x}` and `\subimport` are resolved relative to CONTENTS_DIR. Try `x`, then `x.tex`, and recurse. Guard against cycles and cap the depth at 20.
  - Sectioning commands are `\part`, `\chapter`, `\section`, `\subsection`, `\subsubsection`, `\paragraph` and `\subparagraph`, optionally starred, with an optional `[short]` argument and a `{title}` that may contain nested braces.
  - Levels run from part=0 to subparagraph=6.
- Return a flat list in document order: `[{level, title, file, line}]`.
- Clean up titles: drop `\textbf{…}`-style wrappers to their inner text and collapse whitespace.

**`GET /api/completions`** returns:

- `labels`: `\label{x}` in all .tex files, as `[{name, file, line}]`;
- `bibkeys`: `@type{key,` in all .bib files, as `[{key, title?}]` (grab the `title = {…}` when it's easy);
- `commands`: names defined with `\newcommand`, `\renewcommand`, `\DeclareMathOperator`, `\def\x` or `\NewDocumentCommand`, each with its argument count when known.

### 3.8 SSE

- **`GET /api/events`** is a text/event-stream. Keep a set of clients and send a heartbeat comment every 25 s.
- Events: `compile-start`, `compiled`, and `goto {file,line}`. `goto` is sent by `POST /api/goto`; the pop-out viewer calls it after an inverse sync so the main window jumps.

## 4. Frontend: main app (`public/index.html` + `src/app/*`)

### 4.1 Layout and theme

- Use CSS variables on `:root[data-theme="dark"]` and `:root[data-theme="light"]`, with dark as the default.
  - Dark palette: Overleaf-ish. Panels `#1b222c` and `#222b36`, borders `#2f3a47`, text `#cdd6e0`, accent green `#138a36` (Overleaf green), selection `#264f78`.
  - Save the theme to localStorage.
- The layout is a CSS grid filling the viewport: top bar 40px, then a row of rail 44px | sidebar | resizer 6px | editor | resizer 6px | pdf.
  - **Resizers:** use pointer events with `setPointerCapture`. Clamp the sidebar to 160–600px and each other pane to at least 250px. Save the sizes to localStorage. A double-click on the PDF resizer resets it to 50/50.
  - Show an overlay while dragging so the canvases don't swallow events.
- **Rail:** Files and Search icons as inline SVG, with the active one highlighted. Clicking the active icon toggles the sidebar collapse.
- **Accordion (Files view):** headers are `▸ File tree` and `▸ File outline`.
  - Clicking a collapsed header expands it and collapses the other. Clicking the expanded header does nothing.
  - The expanded section takes all remaining height and scrolls internally.
  - The File tree header has small icon buttons on the right: new file, new folder, upload. They're visible only when that section is expanded.
- **Top bar contents:**
  - left: the label "LaTeX Project" and `· main: <mainFile>`;
  - centre-right: the save status, the engine `<select>`, an "Auto-compile" switch, a green **Recompile** button (Ctrl+Enter; shows a spinner and "Compiling…" while running; a click while compiling restarts), an ↗ "Open in new window" button, a ⬇ Download PDF button, and a ☀/☾ theme toggle.
  - Changing the engine or auto-compile setting PUTs `/api/settings`.

### 4.2 Editor (`editor.js`)

- **One `EditorView`, many `EditorState`s.** Keep a map `path → EditorState` and call `view.setState()` when switching tabs. This keeps each file's undo history.
  Remember scroll and selection per tab in memory.
- **Language:** `StreamLanguage.define(stex)` from `@codemirror/legacy-modes/mode/stex`.
- **Highlighting:** a custom `HighlightStyle` per theme.
  - Dark: commands (`keyword` / `tag`) `#7fb4ff`, braces `#d4d4d4`, comments `#6a9955` italic, math (`string` / `atom`) `#ce9178`, environment names after `\begin` and `\end` (`atom` / `variableName`) `#e5c07b`.
  - Light: equivalents that read well on white.
  - Inspect which tags stex emits and map them sensibly.
- **Theme switching:** put the theme and highlight style in a `Compartment`, so the toggle reconfigures every state. Reconfigure the stored states lazily when a tab is shown.
- **Extensions:**
  - lineNumbers, highlightActiveLineGutter, highlightActiveLine
  - history, drawSelection, dropCursor, indentOnInput, bracketMatching
  - `closeBrackets()`, with the language data `closeBrackets: { brackets: ["(", "[", "{", "$"] }` provided via `EditorState.languageData.of(...)`
  - `autocompletion({ override: [latexCompletions] })`
  - foldGutter with a custom `foldService`
  - `lintGutter()`
  - `EditorView.lineWrapping`
  - `search` and `searchKeymap` (Ctrl+F in-file)
  - `keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, ...searchKeymap, indentWithTab])`
  - the custom keys below
- **Custom keys:**
  - `Mod-s`: flush the save now.
  - `Mod-Enter`: compile.
  - `Mod-b` and `Mod-i`: bold and italic, the same as the toolbar.
  - `Mod-/`: toggle `% ` comments on the selected lines.
  - `Mod-Alt-ArrowRight` (and a ⟶ button on the PDF resizer): forward SyncTeX.
- **Fold service** `(state, lineStart, lineEnd) => range | null`:
  - A line containing `\begin{env}` (not inside a `%` comment) folds to the matching `\end{env}`. Count nesting of the same env name and scan at most 20000 lines.
    The fold runs from the end of the `\begin` line to the start of the `\end` line.
  - A line starting with a sectioning command folds until just before the next sectioning command of the same or a higher level, `\end{document}`, or the end of the file.
  - Fold the `\documentclass` → `\begin{document}` preamble too.
- **Lint markers:** after each compile, for every open file, `setDiagnostics(state, issuesForFile)` maps each issue to the whole line.
  - Severity mapping: error → error, warning → warning, typesetting → info.
  - Keep the issues so that files opened later get their markers too.
- **Cursor tracking:** on selection change, tell the outline which file and line are current. Debounce this by 100 ms.

### 4.3 Autocomplete (`complete.js`)

The completion source looks at the text before the cursor.

1. **Labels:** `/\\(?:ref|eqref|pageref|autoref|cref|Cref|nameref|vref)\{([^}]*)$/` completes labels from `/api/completions`. `from` is the start of the brace contents.
2. **Citations:** `/\\\w*cite\w*\*?(?:\[[^\]]*\])*\{([^}]*)$/` completes bib keys. `from` is after the last comma, so `\cite{a,b|` works. Show the title as `detail`.
3. **Environments:** `/\\(?:begin|end)\{([a-zA-Z*]*)$/` completes environment names.
   - Choosing one after `\begin{` inserts `name}` plus a newline, a tab-indented empty line with the cursor on it, a newline and `\end{name}`.
   - If the next character is `}` (auto-closed), consume it.
   - Use a custom `apply` function, or `snippetCompletion` with `${}`.
   - The list: `document equation equation* align align* gather multline split cases itemize enumerate description figure table tabular tabularx center flushleft flushright minipage verbatim lstlisting minted abstract quote quotation theorem lemma proof definition corollary remark example frame block columns column tikzpicture array matrix pmatrix bmatrix vmatrix subfigure thebibliography appendix`, plus any `\newenvironment` names found in the project.
4. **Commands:** `/\\([a-zA-Z]*)$/` completes commands.
   - Include a built-in list of about 200 common commands as `snippetCompletion`s with argument placeholders: `\frac{#{}}{#{}}`, `\section{#{}}`, `\textbf{#{}}`, `\includegraphics[width=#{0.8\linewidth}]{#{}}`, `\usepackage{#{}}`, `\label{#{}}`, `\ref{#{}}`, `\cite{#{}}`, `\sqrt{#{}}`, `\sum_{#{}}^{#{}}`, Greek letters, arrows, `\mathbb{#{}}`, `\mathcal{#{}}`, `\left( #{} \right)`, `\item`, `\hline`, and so on.
   - Add the commands found by `/api/completions`, with placeholders from their argument count.
   - Typing `\` must open the popup. Set `activateOnTyping` and make the source return results with `validFor: /^[a-zA-Z]*$/`.

- **Refresh:** reload the completion data after each successful save, debounced by 3 s, and at startup.

### 4.4 Tabs and autosave (`tabs.js`)

- **Tab bar:** each tab shows a file-type icon, the file name (the path as a tooltip), a dirty dot or ×, and closes on middle-click.
  - The active tab is highlighted. Tabs scroll horizontally on overflow.
  - Drag-reordering is a nice-to-have.
- **Opening a file:**
  - Opening an already-open path activates its tab.
  - Text files load via `/api/file`.
  - Images (png, jpg, jpeg, gif, svg, webp, bmp) open in a preview tab that shows `<img src="/raw/...">` centred, replacing the editor and toolbar.
  - `.pdf` opens in a preview tab with `<iframe src="/raw/...">`.
  - Other binaries show "This file can't be edited here."
- **Autosave:**
  - Each doc change marks the tab dirty and resets a 1000 ms timer for that path.
  - When the timer fires, PUT the content. Only one save is in flight per path; if the content changed during a save, save again afterwards.
  - The status shows "Saving…", then "All changes saved", or a red "Save failed — retrying" with retries after 3 s.
- **After each successful save:**
  - refresh the outline and completion data (debounced);
  - if auto-compile is on, reset a shared 1500 ms compile timer, and compile when it fires.
- **Compile requests:** `requestCompile()` first flushes all dirty tabs (awaiting their saves), then POSTs `/api/compile`.
  - Responses with `cancelled` are ignored.
  - Typing during a compile therefore saves (1 s), schedules a compile (1.5 s), and that request kills the running compile on the server.
- **On `pagehide`:** `navigator.sendBeacon('/api/file-beacon?path=..', text)` for every dirty tab.
- **Persistence:** keep the open tabs and the active path in localStorage and reopen them at load. Skip files that no longer exist.
- **Tree changes:** when the tree renames or deletes a file that's open, update or close its tab.
- **Jumping:** `openAt(path, line, col?)` opens the file, places the cursor, and scrolls it to the centre. It's used by the outline, log, search and SyncTeX.

### 4.5 Toolbar (`toolbar.js`)

The toolbar is a row of icon buttons in this order, with Overleaf-like grouping and separators:

1. **Undo / Redo.**
2. **Section dropdown** with Normal text, Section, Subsection, Subsubsection, Paragraph and Subparagraph.
   - It replaces or strips the sectioning command wrapping the current line.
   - It shows the current line's level.
3. **Bold `\textbf{}` / Italic `\textit{}`.** These toggle: wrap the selection, unwrap if it's already wrapped, or insert an empty pair with the cursor inside.
4. **Ω symbol picker:** a popover with tabs for Greek, Operators, Relations, Arrows and Misc.
   - Each tab is a grid of buttons showing the Unicode glyph with the LaTeX command as a tooltip.
   - Clicking inserts the command plus a trailing space when the next character is a letter.
5. **`\ref`:** inserts `\ref{}` and calls `startCompletion`.
6. **`\cite`:** inserts `\cite{}` and calls `startCompletion`.
7. **Insert figure:** inserts this snippet.
   ```
   \begin{figure}[h]
       \centering
       \includegraphics[width=0.8\linewidth]{}
       \caption{}
       \label{fig:}
   \end{figure}
   ```
   The cursor goes inside `includegraphics{}`.
8. **Insert table:** a hover-grid size picker, up to 10×10 like Overleaf. It inserts a `table` environment with `\centering`, a `tabular` with `{|c|c|...|}`, `\hline` rows, `\caption{}` and `\label{tab:}`.
9. **Bulleted list / Numbered list:** wrap the selected lines in `itemize` or `enumerate` and prefix each with `\item `. With an empty selection, insert an empty list with one `\item `.

Buttons are disabled when the active tab isn't a text editor. Use inline SVG icons, roughly 16px.

### 4.6 File tree (`tree.js`)

- **Rendering:** a recursive tree with expand carets for folders and type icons for files.
  - The main file gets a small marker; Overleaf shows a home or bold style.
  - The active file is highlighted.
  - Remember which folders are expanded (localStorage).
- **Context menu** (right-click), with these entries:
  - New file…, New folder… and Upload… (inside the clicked folder, or root);
  - Rename (inline input; Enter commits, Esc cancels);
  - Delete (`confirm()`);
  - **Set as main document** (`.tex` only);
  - Download (`/raw/...` with the download attribute).
- **Drag and drop:**
  - Dragging a tree entry onto a folder moves it, and dragging it onto the root area moves it to root.
  - OS files dropped onto a folder or root upload there.
  - Highlight drop targets.
- **New file:** an inline input in the tree. `.tex` is the default when no extension is typed. The file opens on create.
- **Refresh:** reload `/api/tree` after every operation the client performs. No watcher.

### 4.7 Outline (`outline.js`)

- **Data:** fetch `/api/outline` (refreshed after saves) and nest the flat list by level. Each item becomes a child of the nearest previous item with a lower level.
- **Rendering:** as in the user's screenshot. Each node is indented, with a vertical guide line for depth. Nodes with children get a ▾/▸ caret. Remember the collapse state by `title|file|line`.
- **Click** → `openAt(file, line)`.
- **Current-section highlight:** given the active file and cursor line,
  - take the last item in document order with `file === activeFile && line <= cursorLine`;
  - if there isn't one, take the last item before the first item of `activeFile`, which means the file was included under that item;
  - highlight it and scroll it into view (`block:'nearest'`).
- **Empty state:** "No sections found." When the main file is missing, show a hint.

### 4.8 Search panel (`search.js`)

- **Inputs:** a query box with toggles **Aa** (match case), **ab** (whole word) and **.\*** (regex), plus a replace box and a "Replace all" button.
- **Searching:** search 300 ms after typing stops. Results are grouped by file and collapsible, with a match count. Each line preview has the match highlighted.
  - Click → `openAt(path, line, col)` and select the match.
- **Replace all:**
  1. Confirm "Replace N matches in M files?".
  2. Flush dirty tabs.
  3. POST `/api/replace`.
  4. Reload every open tab from disk: replace the doc with a transaction, keeping undo history.
  5. Search again.

### 4.9 Log panel (`logpanel.js`)

- **Placement:** a "Logs" toggle button in the PDF pane toolbar, with badges for the error count (red) and warning count (amber).
  - The panel overlays the PDF pane, as in Overleaf, and has a close button.
- **Content:** entries grouped as Errors, then Warnings, then Typesetting.
  - Each entry is a card with the severity colour, the message, `file:line`, and the collapsible context.
  - Click → `openAt`.
- **Raw logs:** a "Raw logs" button expands a `<pre>` with `/api/log`.
- **Auto-open:** open the panel automatically when a compile ends with `failed`, but not on mere warnings, and not with `error` when a PDF was produced. In that case just pulse the badge.

### 4.10 PDF pane

- **Toolbar:**
  - page indicator "3 / 12" with an editable page number;
  - zoom −/+ and a select with Fit width, Fit page, 50–400%;
  - the Logs toggle.
- **Body:** a `PdfView`. Before any PDF exists, show the placeholder "Click Recompile (Ctrl+Enter) to see a preview".
- **Version updates:**
  - At load, call `/api/status`; if `version > 0`, load `/pdf?v=<version>`.
  - On the SSE `compiled` event (or the compile response) with a new version, call `pdfView.load('/pdf?v=' + version)`, which does the seamless swap.
  - This keeps several open tabs in sync too.
- **Inverse SyncTeX:** double-click a page and convert the click to PDF points: `x = (clientX - canvasRect.left) / scale`, `y = (clientY - canvasRect.top) / scale`.
  Here `scale` is the PDF.js viewport scale, not counting the device pixel ratio. Then call `/api/synctex/edit` and `openAt`.
- **Forward SyncTeX:** scroll the PDF so the first box `(h, v-H, W, H)` sits about 1/3 from the top. Overlay a translucent yellow rectangle that fades out over 1.5 s.

## 5. `src/shared/pdfview.js`: PdfView (the critical part)

The API:

```
new PdfView(scrollContainer, { onPageChange, onDblClick(page, x, y) })
  .load(url) -> Promise   // seamless replace
  .setZoom('fit-width' | 'fit-page' | number)
  .goToPage(n), .scrollToBox(page, x, y, w, h, flash=true)
  .currentPage, .numPages
```

### Structure

- The scroll container (`overflow:auto`) holds one `.pdf-pages` wrapper.
- Each page is a `div.page` sized to its viewport, with a white background and a shadow, centred, with a 10px gap. It contains a `<canvas>`.
- Render lazily: an `IntersectionObserver` with a `rootMargin` of about one viewport height renders pages near the view.
- Canvas backing size is `viewport × devicePixelRatio`, and CSS size is the viewport size.
- Cancel the render task when a page re-renders. Free canvases far outside the view: drop the backing store by setting width to 0 for pages more than 10 away.

### Seamless `load(url)`

1. Fetch the bytes yourself: `fetch(url, {cache:'no-store'})` → `arrayBuffer` → `getDocument({data})`.
   Always load the newest request. If a newer `load` starts mid-way, abort the older one using a generation counter.
2. **Capture the anchor from the current document:**
   - Find the page `p` whose box contains `scrollTop + 1`.
   - `frac = (scrollTop - page.offsetTop) / page.offsetHeight`.
   - Also capture `scrollLeft`.
   - With no current document, the anchor is page 1, frac 0.
3. **Build the new wrapper off-screen.**
   - Get all page viewports at the current zoom: `await Promise.all(pages.map(getPage))`. For fit modes, compute the scale from the container width or height and the first page's size.
   - Create every `div.page` at its final size.
   - Place the wrapper inside the scroll container with `position:absolute; visibility:hidden; top:0; left:0; width:100%`, so its layout is computed with the same width.
4. **Render the pages that will be visible** after the swap: the anchor page and the pages covering one viewport height below it. Await those renders. Rendering into a hidden element is fine for canvases.
5. **Swap in a single synchronous block,** with no await in between:
   - remove the old wrapper;
   - make the new wrapper static and visible;
   - set `scrollTop = newPage[p].offsetTop + frac * newPage[p].offsetHeight`, clamping `p` to `numPages`;
   - set `scrollLeft`.
   - Do it inside `requestAnimationFrame` so the browser paints only the final state.
6. Destroy the old `PDFDocumentProxy` and start lazy rendering for the remaining pages.
7. **Never blank the view.** If loading fails, keep the old view and log the error.

With identical layouts the result is pixel-identical, so the PDF doesn't appear to jump.

### Zoom

- Changing zoom keeps the same page and fraction anchor, then re-renders the visible pages.
- Fit-width also re-fits on container resize, using a `ResizeObserver` debounced by 150 ms.
- Ctrl+wheel zooms.

## 6. Pop-out viewer (`public/viewer.html` + `src/viewer/main.js`)

- **Opening it:** the ↗ button calls `window.open('/viewer', 'latex-pdf-viewer', 'popup,width=900,height=1000')`. The fixed name means a second click focuses the same window. Route `/viewer` to `viewer.html`.
- **Layout:** the viewer takes the full window with a top toolbar and a `PdfView` body.
  - Toolbar: page n/m, prev/next, zoom −/+, the zoom select, Download, Print and a theme toggle.
  - **Print:** a hidden iframe with `src=/pdf?v=..`; on load, call `iframe.contentWindow.print()`.
  - **Download:** `<a href="/pdf?v=..&download=1">`. The server sets `Content-Disposition: attachment; filename="<job>.pdf"` when `download=1`. The main app's Download button uses the same URL.
- **Live reload:** on start, read `/api/status` and load the PDF. On the SSE `compiled` event with a new version, `load()` again (the seamless swap).
- **Scroll memory:** save the page, fraction and zoom to localStorage (key `viewer-pos`) on scroll, debounced, and restore them on first load. Reopening the window then resumes where you were.
- **Inverse SyncTeX:** double-click → `/api/synctex/edit` → `POST /api/goto {file,line}`. The server broadcasts SSE `goto`, and the main window's handler calls `openAt` and `window.focus()`.
- The document title is `"<job>.pdf — LaTeX"`.

## 7. Autostart and start scripts

- **`launcher.vbs`** starts the server with no window:
  ```vbs
  Set sh = CreateObject("WScript.Shell")
  dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
  sh.CurrentDirectory = dir
  sh.Run "cmd /c node server.js >> server.log 2>&1", 0, False
  ```
- **`start.bat`:**
  1. `cd /d "%~dp0"`.
  2. Use PowerShell `Invoke-WebRequest http://127.0.0.1:8170/api/ping -UseBasicParsing -TimeoutSec 1` (or `curl.exe -s`) to see whether the server is up.
  3. If it isn't, run `wscript "%~dp0launcher.vbs"` and poll the ping for up to 15 s.
  4. Then `start "" http://localhost:8170`.
- **`install-autostart.ps1`** creates `LaTeX Editor.lnk` in the Startup folder. The shortcut's target is `wscript.exe`, its argument is the full path of `launcher.vbs`, and its working directory is the app root. Use the `WScript.Shell` COM object's `CreateShortcut`.
  **`uninstall-autostart.ps1`** removes it.
- **When you finish:**
  - **run `install-autostart.ps1`** (the user asked for autostart);
  - start the server via `launcher.vbs` so it's running now;
  - check that `http://localhost:8170` responds.
- **README.md** (short) covers how to start the app, the autostart scripts, where files live, the keyboard shortcuts, and how to rebuild (`node build.js`).

## 8. Testing checklist (do all of these; don't claim done without evidence)

Use a scratch project via `CONTENTS_DIR` (for example a folder under your scratchpad or `%TEMP%`). Make it a multi-file XeLaTeX doc:

- `main.tex` with `fontspec`, `\setmainfont{Times New Roman}`, `\include{chapters/one}`, `\input{chapters/two}`, labels and refs, `\cite` with `biblatex` + biber **and** a variant with natbib + bibtex, and an image;
- `refs.bib`;
- `chapters/one.tex`;
- `chapters/two.tex`.

**Never write test files into `contents\`.**

1. Run `node --test lib/` and see it pass.
2. Compile succeeds, the PDF appears, refs and citations resolve (no `??`), and a second compile with no changes runs a single pass.
3. Introduce an error (`\badcommand` in `chapters/two.tex`). Check the log panel shows the right file and line, a click jumps there, and the editor shows a lint marker.
4. Delete `\end{document}` so no PDF is produced. Check the old PDF stays and the log opens.
5. **Auto-compile:** type, and check that a save then a compile happen and the PDF updates. Type during a compile and check the server log shows the kill and restart.
6. **Seamless swap:** scroll to page 2, halfway down. Edit text on page 1 without changing the layout. Check `scrollTop` is unchanged after the reload and the page doesn't flash blank. Verify with the browser pane via `javascript_tool`, reading `scrollTop` before and after.
7. **SyncTeX:** check both directions, including a file in `chapters/`.
8. **Pop-out:** check it opens, updates on recompile, keeps its position, and that double-click jumps in the main window.
9. **Outline:** check nesting across included files, click-to-jump, and the current-section highlight.
10. **Autocomplete:** check `\sec` → `\section{}`, `\begin{ali` → an align block, `\ref{` → labels, and `\cite{` → keys.
11. **Folding:** check `\begin…\end` and sections fold.
12. **Tree:** create, rename, move by drag, delete, upload, and Set as main.
13. **Search and replace across files.**
14. **Theme toggle, resizers, and the accordion** (only one section open at a time).
15. **Host guard:** `curl -H "Host: evil.com" http://127.0.0.1:8170/api/tree` returns 403.
16. **Light check of the pdfLaTeX and LuaLaTeX** engines.

Finally, stop your test server, leave `contents\` empty, install autostart, start the real server, and confirm `http://localhost:8170` loads.

## 9. Final report

Include:

- what was built;
- what was tested and how;
- anything not working or skipped;
- any deviations from this plan.
