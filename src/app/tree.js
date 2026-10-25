import { api } from './api.js';
import { app, bus } from './app.js';
import { h, $, ico } from './dom.js';
import * as tabs from './tabs.js';

const LS_OPEN = 'tree-open';
let open = new Set();
try {
  open = new Set(JSON.parse(localStorage.getItem(LS_OPEN) || '[]'));
} catch {
  /* ignore */
}
let treeData = [];
let menu = null;
let uploadDir = '';
let activePath = null;

const saveOpen = () => {
  try {
    localStorage.setItem(LS_OPEN, JSON.stringify([...open]));
  } catch {
    /* ignore */
  }
};
const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const join = (d, n) => (d ? d + '/' + n : n);
const rawUrl = (p, dl) =>
  '/raw/' + p.split('/').map(encodeURIComponent).join('/') + (dl ? '?download=1' : '');

export async function refreshTree() {
  try {
    treeData = await api.tree();
  } catch (e) {
    console.error(e);
    return;
  }
  render();
}

function closeMenu() {
  if (menu) {
    menu.remove();
    menu = null;
  }
}
document.addEventListener('mousedown', (e) => {
  if (menu && !menu.contains(e.target)) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu();
});

function showMenu(x, y, items) {
  closeMenu();
  menu = h(
    'div',
    { class: 'ctx-menu' },
    items.filter(Boolean).map((it) =>
      it === '-'
        ? h('div', { class: 'ctx-sep' })
        : h(
            'div',
            {
              class: 'ctx-item',
              onclick: () => {
                closeMenu();
                it.run();
              },
            },
            it.label,
          ),
    ),
  );
  document.body.append(menu);
  menu.style.left = Math.min(x, window.innerWidth - menu.offsetWidth - 4) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - menu.offsetHeight - 4) + 'px';
}

function icon(node) {
  if (node.type === 'dir') return ico('folder', 14);
  const e = node.name.split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(e)) return ico('image', 14);
  return ico('file', 14);
}

function inlineInput(initial, onCommit, onCancel) {
  const input = h('input', { class: 'tree-input', value: initial, spellcheck: 'false' });
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    onCommit(input.value.trim());
  };
  const cancel = () => {
    if (done) return;
    done = true;
    onCancel();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') cancel();
    e.stopPropagation();
  });
  input.addEventListener('blur', commit);
  setTimeout(() => {
    input.focus();
    const dot = initial.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, 0);
  return input;
}

function renderNodes(nodes, depth, into) {
  for (const n of nodes) {
    const row = h('div', {
      class: 'tree-row' + (n.path === activePath ? ' active' : ''),
      style: { paddingLeft: 10 + depth * 14 + 'px' },
      'data-path': n.path,
      'data-type': n.type,
      draggable: 'true',
    });
    for (let i = 0; i < depth; i++)
      row.append(h('span', { class: 'tree-guide', style: { left: 17 + i * 14 + 'px' } }));
    const caret = h('span', {
      class: 'tree-caret' + (n.type === 'dir' ? (open.has(n.path) ? ' c-open' : ' c-closed') : ''),
    });
    row.append(
      caret,
      h('span', { class: 'tree-ico', html: icon(n) }),
      h('span', { class: 'tree-name' }, n.name),
    );
    if (n.type === 'file' && n.path === app.settings.mainFile)
      row.append(h('span', { class: 'tree-main', title: 'Main document', html: ico('home', 12) }));
    row.addEventListener('click', () => {
      if (n.type === 'dir') {
        open.has(n.path) ? open.delete(n.path) : open.add(n.path);
        saveOpen();
        render();
      } else tabs.openFile(n.path);
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      ctxFor(e, n);
    });
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-tree-path', n.path);
      e.dataTransfer.effectAllowed = 'move';
    });
    if (n.type === 'dir') attachDrop(row, n.path);
    into.append(row);
    if (n.type === 'dir' && open.has(n.path)) renderNodes(n.children || [], depth + 1, into);
  }
}

function attachDrop(el, dir) {
  el.addEventListener('dragover', (e) => {
    const t = e.dataTransfer.types;
    if (t.includes('application/x-tree-path') || t.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('drop');
    }
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop'));
  el.addEventListener('drop', async (e) => {
    el.classList.remove('drop');
    e.preventDefault();
    e.stopPropagation();
    const from = e.dataTransfer.getData('application/x-tree-path');
    if (from) await moveTo(from, dir);
    else if (e.dataTransfer.files.length) await doUpload(dir, [...e.dataTransfer.files]);
  });
}

async function moveTo(from, dir) {
  const name = from.split('/').pop();
  const to = join(dir, name);
  if (to === from || parentOf(from) === dir) return;
  if (dir === from || dir.startsWith(from + '/')) return;
  try {
    const r = await api.rename(from, to);
    app.settings = r.settings || app.settings;
    tabs.renamed(from, to);
    if (dir) open.add(dir);
    saveOpen();
    bus.emit('settings-changed');
  } catch (e) {
    alert('Move failed: ' + e.message);
  }
  refreshTree();
  bus.emit('tree-changed');
}

async function doUpload(dir, files) {
  try {
    await api.upload(dir, files);
    if (dir) open.add(dir);
    saveOpen();
  } catch (e) {
    alert('Upload failed: ' + e.message);
  }
  refreshTree();
  bus.emit('tree-changed');
}

function ctxFor(e, n) {
  const dir = !n ? '' : n.type === 'dir' ? n.path : parentOf(n.path);
  const items = [
    { label: 'New file…', run: () => startNew('file', dir) },
    { label: 'New folder…', run: () => startNew('dir', dir) },
    { label: 'Upload…', run: () => pickUpload(dir) },
  ];
  if (n) {
    items.push(
      '-',
      { label: 'Rename', run: () => startRename(n) },
      { label: 'Delete', run: () => doDelete(n) },
    );
    if (n.type === 'file' && n.name.endsWith('.tex'))
      items.push({ label: 'Set as main document', run: () => setMain(n.path) });
    if (n.type === 'file')
      items.push({
        label: 'Download',
        run: () => {
          const a = h('a', { href: rawUrl(n.path, true), download: n.name });
          document.body.append(a);
          a.click();
          a.remove();
        },
      });
  }
  showMenu(e.clientX, e.clientY, items);
}

async function setMain(path) {
  app.settings = await api.putSettings({ mainFile: path });
  bus.emit('settings-changed');
  render();
  bus.emit('tree-changed');
}

async function doDelete(n) {
  if (
    !confirm(
      `Delete ${n.type === 'dir' ? 'folder' : 'file'} "${n.path}"${n.type === 'dir' ? ' and everything in it' : ''}?`,
    )
  )
    return;
  try {
    await api.remove(n.path);
    tabs.removed(n.path);
  } catch (e) {
    alert('Delete failed: ' + e.message);
  }
  refreshTree();
  bus.emit('tree-changed');
}

function startRename(n) {
  const row = document.querySelector(`.tree-row[data-path="${CSS.escape(n.path)}"]`);
  if (!row) return;
  const nameEl = row.querySelector('.tree-name');
  const input = inlineInput(
    n.name,
    async (val) => {
      if (!val || val === n.name) {
        render();
        return;
      }
      const to = join(parentOf(n.path), val);
      try {
        const r = await api.rename(n.path, to);
        app.settings = r.settings || app.settings;
        tabs.renamed(n.path, to);
        bus.emit('settings-changed');
      } catch (e) {
        alert('Rename failed: ' + e.message);
      }
      refreshTree();
      bus.emit('tree-changed');
    },
    render,
  );
  nameEl.replaceWith(input);
}

function startNew(kind, dir) {
  if (dir) {
    open.add(dir);
    saveOpen();
  }
  render();
  const host = $('#tree');
  const depth = dir ? dir.split('/').length : 0;
  const row = h('div', { class: 'tree-row', style: { paddingLeft: 10 + depth * 14 + 'px' } });
  const input = inlineInput(
    '',
    async (val) => {
      row.remove();
      if (!val) return;
      let name = val;
      if (kind === 'file' && !/\.[A-Za-z0-9]+$/.test(name)) name += '.tex';
      const path = join(dir, name);
      try {
        if (kind === 'file') {
          await api.newFile(path);
          await refreshTree();
          await tabs.openFile(path);
        } else {
          await api.mkdir(path);
          open.add(path);
          saveOpen();
          await refreshTree();
        }
      } catch (e) {
        alert('Create failed: ' + e.message);
      }
      bus.emit('tree-changed');
    },
    () => row.remove(),
  );
  row.append(
    h('span', { class: 'tree-caret' }),
    h('span', { class: 'tree-ico', html: ico(kind === 'dir' ? 'folder' : 'file', 14) }),
    input,
  );
  // insert as first child of dir
  const anchor = dir ? host.querySelector(`.tree-row[data-path="${CSS.escape(dir)}"]`) : null;
  if (anchor) anchor.after(row);
  else host.prepend(row);
  setTimeout(() => input.focus(), 0);
}

function pickUpload(dir) {
  uploadDir = dir;
  const inp = $('#upload-input');
  inp.value = '';
  inp.click();
}

function render() {
  const host = $('#tree');
  host.textContent = '';
  renderNodes(treeData, 0, host);
  if (!treeData.length)
    host.append(
      h(
        'div',
        { class: 'tree-empty' },
        'Empty project. Use the icons above to create or upload files.',
      ),
    );
}

export function initTree() {
  const host = $('#tree');
  host.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    ctxFor(e, null);
  });
  attachDrop(host, '');
  $('#btn-new-file').onclick = (e) => {
    e.stopPropagation();
    startNew('file', '');
  };
  $('#btn-new-folder').onclick = (e) => {
    e.stopPropagation();
    startNew('dir', '');
  };
  $('#btn-upload').onclick = (e) => {
    e.stopPropagation();
    pickUpload('');
  };
  $('#upload-input').addEventListener('change', (e) => {
    const fl = [...e.target.files];
    if (fl.length) doUpload(uploadDir, fl);
  });
  bus.on('active-changed', (p) => {
    activePath = p;
    render();
  });
  bus.on('settings-changed', render);
  return refreshTree();
}
