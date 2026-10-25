// Shared singletons / tiny event bus.
const listeners = new Map();
export const bus = {
  on(ev, fn) {
    (listeners.get(ev) || listeners.set(ev, []).get(ev)).push(fn);
  },
  emit(ev, data) {
    for (const fn of listeners.get(ev) || []) {
      try {
        fn(data);
      } catch (e) {
        console.error(ev, e);
      }
    }
  },
};
// filled in by modules at init: view, tabs functions, etc.
export const app = { settings: null, issues: [], dark: true };
