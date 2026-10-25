async function j(res) {
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).error || msg;
    } catch {
      /* ignore */
    }
    const e = new Error(msg);
    e.status = res.status;
    throw e;
  }
  return res.json();
}
const q = (o) => new URLSearchParams(o).toString();
const jsonOpts = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  tree: () => fetch('/api/tree').then(j),
  async readFile(path) {
    const r = await fetch('/api/file?' + q({ path }));
    if (!r.ok) {
      const e = new Error(r.statusText);
      e.status = r.status;
      throw e;
    }
    return r.text();
  },
  async putFile(path, text) {
    const r = await fetch('/api/file?' + q({ path }), {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: text,
    });
    return j(r);
  },
  newFile: (path) => fetch('/api/new-file', jsonOpts('POST', { path })).then(j),
  mkdir: (path) => fetch('/api/mkdir', jsonOpts('POST', { path })).then(j),
  rename: (from, to) => fetch('/api/rename', jsonOpts('POST', { from, to })).then(j),
  remove: (path) => fetch('/api/entry?' + q({ path }), { method: 'DELETE' }).then(j),
  upload(dir, files) {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.webkitRelativePath || f.name);
    return fetch('/api/upload?' + q({ dir }), { method: 'POST', body: fd }).then(j);
  },
  settings: () => fetch('/api/settings').then(j),
  putSettings: (s) => fetch('/api/settings', jsonOpts('PUT', s)).then(j),
  status: () => fetch('/api/status').then(j),
  compile: (file) => fetch('/api/compile', jsonOpts('POST', { file })).then(j),
  log: () => fetch('/api/log').then((r) => r.text()),
  outline: () => fetch('/api/outline').then(j),
  completions: () => fetch('/api/completions').then(j),
  search: (o) =>
    fetch(
      '/api/search?' +
        q({ q: o.q, regex: o.regex ? 1 : 0, case: o.case ? 1 : 0, word: o.word ? 1 : 0 }),
    ).then(j),
  replace: (o) => fetch('/api/replace', jsonOpts('POST', o)).then(j),
  synctexView: (file, line, col) => fetch('/api/synctex/view?' + q({ file, line, col })).then(j),
  synctexEdit: (page, x, y) => fetch('/api/synctex/edit?' + q({ page, x, y })).then(j),
  goto: (file, line) => fetch('/api/goto', jsonOpts('POST', { file, line })).then(j),
};
