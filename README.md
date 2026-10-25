# LaTeX Editor

A local, single-project, LaTeX editor. Server: `http://localhost:8170` (bound to localhost only).

## Start

- `start.bat` starts the server in the background if needed and opens the browser.
- Or `node server.js` in a console.
- Autostart at login: `powershell -ExecutionPolicy Bypass -File install-autostart.ps1` (remove with `uninstall-autostart.ps1`).
  It puts `LaTeX Editor.lnk` in the Startup folder; it runs `launcher.vbs` (hidden, output appended to `server.log`).

## Files

- Your project lives in `contents\` (compile output goes to `contents\.build\`, hidden in the tree).
- `settings.json` (app root): main file, engine, auto-compile.
- Env overrides for testing: `CONTENTS_DIR`, `SETTINGS_FILE`, `PORT`.
- No latexmk/Perl needed: the server runs XeLaTeX/pdfLaTeX/LuaLaTeX, biber/bibtex and the reruns itself.

## Shortcuts

Ctrl+S save now · Ctrl+Enter compile · Ctrl+B / Ctrl+I bold / italic · Ctrl+/ comment · Ctrl+F find in file ·
Ctrl+Shift+F project search · Ctrl+Alt+→ (or the arrow on the divider) jump to PDF position · double-click in the PDF jumps to source.

## Rebuild the frontend

`node build.js` (esbuild bundles `src/` into `public/app.js`, `public/viewer.js` and copies the PDF.js worker).
Tests: `node --test lib/`.
