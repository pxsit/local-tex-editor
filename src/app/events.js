import { bus } from './app.js';

export function startEvents() {
  const es = new EventSource('/api/events');
  for (const ev of ['compile-start', 'compiled', 'compile-idle', 'goto']) {
    es.addEventListener(ev, (e) => {
      try {
        bus.emit('sse:' + ev, JSON.parse(e.data));
      } catch (err) {
        console.error(err);
      }
    });
  }
  es.onopen = () => bus.emit('sse:open');
  return es;
}
