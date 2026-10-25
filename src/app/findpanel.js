import {
  SearchQuery,
  setSearchQuery,
  getSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  selectMatches,
  closeSearchPanel,
} from '@codemirror/search';
import { h, svg } from './dom.js';

const UP =
  '<path d="M12 8l-6 6 1.4 1.4L12 10.8l4.6 4.6L18 14z" fill="currentColor" stroke="none"/>';
const DOWN =
  '<path d="M12 16l6-6-1.4-1.4L12 13.2 7.4 8.6 6 10z" fill="currentColor" stroke="none"/>';
const FIND_ALL =
  '<path d="M3 6h12M3 12h8M3 18h8" /><circle cx="17" cy="15" r="3.5"/><path d="M19.6 17.6L22 20"/>';
const CLOSE = '<path d="M18 6L6 18M6 6l12 12"/>';

// Overleaf-style find/replace bar docked at the bottom of the editor
export function createFindPanel(view) {
  let q = getSearchQuery(view.state);

  const searchInput = h('input', {
    class: 'ff-input',
    placeholder: 'Search for',
    'main-field': 'true',
    spellcheck: 'false',
    value: q.search,
  });
  const replaceInput = h('input', {
    class: 'ff-input',
    placeholder: 'Replace with',
    spellcheck: 'false',
    value: q.replace,
  });
  const toggles = {};
  const mkToggle = (key, label, title) => {
    const b = h(
      'button',
      {
        type: 'button',
        class: 'ff-tog' + (q[key] ? ' on' : ''),
        title,
        onclick: () => {
          b.classList.toggle('on');
          commit();
          searchInput.focus();
        },
      },
      label,
    );
    toggles[key] = b;
    return b;
  };

  function commit() {
    const nq = new SearchQuery({
      search: searchInput.value,
      replace: replaceInput.value,
      caseSensitive: toggles.caseSensitive.classList.contains('on'),
      regexp: toggles.regexp.classList.contains('on'),
      wholeWord: toggles.wholeWord.classList.contains('on'),
    });
    if (!nq.eq(q)) {
      q = nq;
      view.dispatch({ effects: setSearchQuery.of(q) });
    }
  }

  const iconBtn = (path, title, fn) =>
    h('button', { type: 'button', class: 'ff-icon', title, onclick: fn, html: svg(path, 18) });
  const textBtn = (label, fn) =>
    h('button', { type: 'button', class: 'ff-text', onclick: fn }, label);

  const keys = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      if (e.target === replaceInput) replaceNext(view);
      else (e.shiftKey ? findPrevious : findNext)(view);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSearchPanel(view);
      view.focus();
    }
  };
  searchInput.addEventListener('keydown', keys);
  replaceInput.addEventListener('keydown', keys);
  searchInput.addEventListener('input', commit);
  replaceInput.addEventListener('input', commit);

  const dom = h(
    'div',
    {
      class: 'ff-panel',
      onkeydown: (e) => {
        if (e.key === 'Escape') {
          closeSearchPanel(view);
          view.focus();
        }
      },
    },
    h(
      'div',
      { class: 'ff-row' },
      h(
        'div',
        { class: 'ff-field' },
        searchInput,
        mkToggle('caseSensitive', 'Aa', 'Match case'),
        mkToggle('regexp', '[.*]', 'Regular expression'),
        mkToggle('wholeWord', 'W', 'Whole word'),
      ),
      iconBtn(UP, 'Previous (Shift+Enter)', () => {
        commit();
        findPrevious(view);
      }),
      iconBtn(DOWN, 'Next (Enter)', () => {
        commit();
        findNext(view);
      }),
      iconBtn(FIND_ALL, 'Select all matches', () => {
        commit();
        selectMatches(view);
      }),
      h('span', { class: 'spacer' }),
      iconBtn(CLOSE, 'Close (Esc)', () => {
        closeSearchPanel(view);
        view.focus();
      }),
    ),
    h(
      'div',
      { class: 'ff-row' },
      h('div', { class: 'ff-field' }, replaceInput),
      textBtn('Replace', () => {
        commit();
        replaceNext(view);
      }),
      textBtn('Replace All', () => {
        commit();
        replaceAll(view);
      }),
    ),
  );

  return {
    dom,
    top: false,
    mount() {
      searchInput.focus();
      searchInput.select();
    },
    update(u) {
      for (const tr of u.transactions) {
        for (const e of tr.effects) {
          if (e.is(setSearchQuery) && !e.value.eq(q)) {
            q = e.value;
            searchInput.value = q.search;
            replaceInput.value = q.replace;
            toggles.caseSensitive.classList.toggle('on', q.caseSensitive);
            toggles.regexp.classList.toggle('on', q.regexp);
            toggles.wholeWord.classList.toggle('on', q.wholeWord);
          }
        }
      }
    },
  };
}
