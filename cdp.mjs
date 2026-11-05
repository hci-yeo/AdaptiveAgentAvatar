// Minimal Chrome DevTools Protocol client (Node 22+, no dependencies).
// The app must be started with its DevTools port open (see apps.mjs and launch-*.ps1).
import { APPS } from './apps.mjs';

export const PORT = APPS.doubao.port;

export async function listTargets(port = PORT) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
  return res.json();
}

export const isChatTarget = APPS.doubao.isTarget;

// Find an app's main chat window (default Doubao; pass 'codex' for Codex).
export async function findChatTarget(appId = 'doubao') {
  const app = APPS[appId];
  const t = (await listTargets(app.port)).find(app.isTarget);
  if (!t) throw new Error(`${app.name} chat page not found. Is ${app.name} running with --remote-debugging-port=${app.port}?`);
  return t;
}

// How long a request may take before it counts as lost (a page busy for longer than this is stuck).
const REQUEST_TIMEOUT_MS = 15000;

export function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1, closed = false;
    const pending = new Map();   // id -> { res, rej, timer }
    const listeners = new Set();
    const closeListeners = new Set();
    // Every request settles: answered, failed, timed out, or failed at once when the window goes away
    // (a request that never settled used to stall whatever waited on it, for as long as the watcher ran).
    const settle = (id, fn, value) => {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      clearTimeout(p.timer);
      p[fn](value);
    };
    ws.onclose = () => {
      closed = true;
      for (const id of [...pending.keys()]) settle(id, 'rej', new Error('DevTools connection closed'));
      for (const fn of closeListeners) fn();
    };
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        msg.error ? settle(msg.id, 'rej', new Error(msg.error.message)) : settle(msg.id, 'res', msg.result);
      } else if (msg.method) {
        for (const l of listeners) l(msg);
      }
    };
    ws.onerror = e => reject(e.error || new Error('WebSocket error'));
    ws.onopen = () => resolve({
      send(method, params = {}) {
        if (closed) return Promise.reject(new Error('DevTools connection closed'));
        const id = nextId++;
        return new Promise((res, rej) => {
          const timer = setTimeout(() => settle(id, 'rej', new Error(`${method} timed out`)), REQUEST_TIMEOUT_MS);
          pending.set(id, { res, rej, timer });
          try { ws.send(JSON.stringify({ id, method, params })); } catch (e) { settle(id, 'rej', e); }
        });
      },
      async eval(expression) {
        const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      },
      on(fn) { listeners.add(fn); },
      onClose(fn) { closeListeners.add(fn); },
      close() { ws.close(); },
    });
  });
}
