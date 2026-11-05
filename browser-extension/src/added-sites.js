// Sites the user added from the toolbar button (popup.js): no hand-picked markers, so this finds the
// page's parts by itself and marks them with data- attributes, which APP (build.mjs, ADDED_PAGE) points
// at:
//   [data-avatar-composer]  the chat box: the widest text box low on the page, with its frame; or the
//                           element the user picked ("Pick the chat box"), remembered per site
//   [data-avatar-stop]      the stop button by the chat box while the AI answers (by its label or name)
//   [data-avatar-answer]    where text is appearing while it answers (the reply being written)
// Your questions are read from the chat box as you send them (Enter, or a button by the box, and the
// box empties), kept per chat address in the extension's own storage, and given to the avatar through
// M.sentQuestions (30-avatar.js userQuestions).
// Runs inside the content script, after glue.js and before the mods (APP, M, GEN, alive in scope).
if (APP.added) {
  const HOST = location.hostname;
  const PICK_KEY = 'pick:' + HOST, SENT_KEY = 'sent:' + HOST;
  const MARK = { composer: 'data-avatar-composer', stop: 'data-avatar-stop', answer: 'data-avatar-answer' };
  const ours = e => !!e.closest?.('[id^="doubao-mods-"]');
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const setMark = (name, el) => {
    for (const e of document.querySelectorAll(`[${name}]`)) if (e !== el) e.removeAttribute(name);
    if (el && !el.hasAttribute(name)) el.setAttribute(name, '');
  };
  const store = {
    get: k => alive() ? chrome.storage.local.get(k).then(r => r[k]).catch(() => undefined) : Promise.resolve(undefined),
    set: (k, v) => { if (alive()) chrome.storage.local.set({ [k]: v }).catch(() => {}); },
    remove: k => { if (alive()) chrome.storage.local.remove(k).catch(() => {}); },
  };

  // ---- The chat box ----
  const TEXT_INPUT = 'textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"]';
  let pick = null;            // the user's choice (a selector), if any
  let input = null, frame = null;
  function findInput() {
    let best = null, bestScore = 0;
    for (const e of document.querySelectorAll(TEXT_INPUT)) {
      if (ours(e) || !vis(e) || e.closest('[aria-hidden="true"]') || e.readOnly || e.disabled) continue;
      if (e.parentElement?.closest(TEXT_INPUT)) continue;              // inside another editor
      const r = e.getBoundingClientRect();
      if (r.width < 200 || r.bottom < innerHeight * 0.25) continue;   // a search field at the top, a small note box
      const score = r.width * (r.top > innerHeight * 0.45 ? 2 : 1);   // the chat box sits low (or in the middle of a new chat)
      if (score > bestScore) { best = e; bestScore = score; }
    }
    return best;
  }
  // Its visible frame: the ancestors that are only a little bigger than the text field itself.
  function frameOf(e) {
    const r = e.getBoundingClientRect();
    let best = e;
    for (let p = e.parentElement, i = 0; p && p !== document.body && i < 8; p = p.parentElement, i++) {
      const q = p.getBoundingClientRect();
      if (q.width > r.width + 180 || q.height > r.height + 260 || q.width > innerWidth * 0.92) break;
      best = p;
    }
    return best;
  }
  function locate() {
    if (pick) {
      let el = null;
      try { el = [...document.querySelectorAll(pick)].find(vis) || null; } catch {}
      if (el) { frame = el; input = el.matches(TEXT_INPUT) ? el : el.querySelector(TEXT_INPUT) || el; return; }
    }
    if (input?.isConnected && vis(input) && frame?.isConnected) return;
    input = findInput();
    frame = input && frameOf(input);
  }

  // ---- While it answers: its stop button, and where the reply is being written ----
  const STOP_WORDS = /^(stop|停止|中止|终止|結束|stopp|arrêter|detener|parar|остановить|중지|cancel)\b|stop (generating|response|responding|answering|streaming)|停止(生成|回答|输出|响应)/i;
  const STOP_NAMES = /stop|break_button|abort/i;
  function findStop() {
    if (!frame) return null;
    const scope = frame.parentElement?.parentElement || frame;
    for (const e of scope.querySelectorAll('button, [role="button"], [class*="stop" i], [data-testid*="stop" i], [data-testid*="break" i]')) {
      if (ours(e) || !vis(e)) continue;
      const label = (e.getAttribute('aria-label') || e.getAttribute('title') || (e.matches('button, [role="button"]') ? e.textContent : '') || '').trim();
      const names = `${typeof e.className === 'string' ? e.className : ''} ${e.getAttribute('data-testid') || ''} ${e.id}`;
      if ((label && label.length <= 30 && STOP_WORDS.test(label)) || STOP_NAMES.test(names)) return e;
    }
    return null;
  }
  let answering = false, lastSent = '';
  const watcher = new MutationObserver(list => {
    if (!answering) return;
    for (const m of list) {
      const node = m.type === 'characterData' ? m.target : [...m.addedNodes].find(n => n.textContent?.trim());
      let el = node && (node.nodeType === 1 ? node : node.parentElement);
      if (!el || ours(el) || frame?.contains(el) || !el.textContent.trim()) continue;
      // Your own question appearing in the chat isn't the reply.
      if (lastSent && el.textContent.trim().length <= lastSent.length + 20 && el.textContent.includes(lastSent.slice(0, 40))) continue;
      while (el.parentElement && el.parentElement !== document.body && el.getBoundingClientRect().width < 260) el = el.parentElement;
      setMark(MARK.answer, el);
      return;
    }
  });
  watcher.observe(document.body, { subtree: true, childList: true, characterData: true });

  // ---- Your questions, as you send them ----
  // Per chat address. A new chat often gets its address only after the first question, so a question
  // sent just before the address changes moves with it.
  let sent = {};            // path -> [question, ...]
  let path = location.pathname + location.search, sentAt = 0;
  store.get(SENT_KEY).then(v => { if (v && typeof v === 'object') sent = { ...v, ...sent }; });
  const textOf = e => (e ? ('value' in e && e.tagName === 'TEXTAREA' ? e.value : e.innerText) : '').trim();
  function noteRoute() {
    const now = location.pathname + location.search;
    if (now === path) return;
    if (Date.now() - sentAt < 8000 && sent[path]?.length && !sent[now]) { sent[now] = sent[path]; delete sent[path]; save(); }
    path = now;
  }
  function save() {
    const keys = Object.keys(sent);
    for (const k of keys.slice(0, Math.max(0, keys.length - 40))) delete sent[k];   // the last 40 chats
    store.set(SENT_KEY, sent);
  }
  function maybeSent(text) {
    // Sent if the box empties (or no longer starts with it) shortly after.
    if (!text) return;
    for (const ms of [250, 700, 1500]) setTimeout(() => {
      if (M.generation !== GEN || text === null) return;
      const now = textOf(input);
      if (now && now.startsWith(text.slice(0, 20))) return;
      noteRoute();
      (sent[path] ||= []).push(text.slice(0, 300));
      if (sent[path].length > 12) sent[path].splice(0, sent[path].length - 12);
      lastSent = text; sentAt = Date.now(); text = null;
      save();
    }, ms);
  }
  const onKey = e => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;   // 229: a Chinese/Japanese input method is still composing
    if (!input || !(e.target === input || input.contains(e.target) || frame?.contains(e.target))) return;
    maybeSent(textOf(input));
  };
  const onClick = e => {
    if (!frame || ours(e.target)) return;
    const b = e.target.closest?.('button, [role="button"]');
    if (!b || !(frame.contains(b) || frame.parentElement?.contains(b)) || b.hasAttribute(MARK.stop)) return;
    maybeSent(textOf(input));
  };
  addEventListener('keydown', onKey, true);
  addEventListener('click', onClick, true);
  M.sentQuestions = () => { noteRoute(); return (sent[path] || []).slice(); };

  // ---- "Pick the chat box" (from the toolbar button) ----
  let picker = null;
  function selectorFor(el) {
    const ok = s => { try { return document.querySelector(s) === el; } catch { return false; } };
    const attr = (e, a) => e.getAttribute(a) && `${e.tagName.toLowerCase()}[${a}="${CSS.escape(e.getAttribute(a))}"]`;
    if (el.id && !/\d{3,}|[:]/.test(el.id) && ok('#' + CSS.escape(el.id))) return '#' + CSS.escape(el.id);
    for (const a of ['data-testid', 'data-test-id', 'data-test', 'aria-label', 'name', 'placeholder']) { const s = attr(el, a); if (s && ok(s)) return s; }
    // A short path of tags and readable class names (no generated ones with digits).
    const part = e => e.tagName.toLowerCase() + [...e.classList].filter(c => !/\d/.test(c) && c.length <= 32).slice(0, 3).map(c => '.' + CSS.escape(c)).join('');
    let s = part(el);
    for (let p = el.parentElement; p && p !== document.body && !ok(s); p = p.parentElement) s = part(p) + ' > ' + s;
    if (ok(s)) return s;
    const nth = e => `${e.tagName.toLowerCase()}:nth-of-type(${[...e.parentElement.children].filter(x => x.tagName === e.tagName).indexOf(e) + 1})`;
    s = nth(el);
    for (let p = el.parentElement; p && p !== document.documentElement && !ok(s); p = p.parentElement) s = (p === document.body ? 'body' : nth(p)) + ' > ' + s;
    return s;
  }
  function startPicker() {
    if (picker) return;
    const zh = LANG === 'zh';
    const hint = document.createElement('div'), box = document.createElement('div');
    hint.id = 'doubao-mods-picker-hint'; box.id = 'doubao-mods-picker-box';
    hint.textContent = zh ? '点一下聊天输入框（按 Esc 取消）' : 'Click the chat box (Esc to cancel)';
    hint.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:8px 14px;border-radius:10px;background:#5a49cf;color:#fff;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25);pointer-events:none';
    box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #7c5cff;border-radius:10px;background:rgba(124,92,255,.08);display:none';
    document.body.append(hint, box);
    let target = null;
    const move = e => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || ours(el)) return;
      // The text field's frame when pointing inside one; otherwise the element itself.
      const field = el.closest(TEXT_INPUT) || el.querySelector?.(TEXT_INPUT);
      target = field ? frameOf(field) : el;
      const r = target.getBoundingClientRect();
      Object.assign(box.style, { display: 'block', left: r.left - 3 + 'px', top: r.top - 3 + 'px', width: r.width + 6 + 'px', height: r.height + 6 + 'px' });
    };
    const done = () => {
      removeEventListener('mousemove', move, true); removeEventListener('click', click, true); removeEventListener('keydown', key, true);
      hint.remove(); box.remove(); picker = null;
    };
    const click = e => {
      e.preventDefault(); e.stopPropagation();
      if (target) { pick = selectorFor(target); store.set(PICK_KEY, pick); input = frame = null; locate(); }
      done();
    };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); done(); } };
    addEventListener('mousemove', move, true); addEventListener('click', click, true); addEventListener('keydown', key, true);
    picker = { done };
  }
  const onMessage = msg => {
    if (msg?.to !== 'page') return;
    if (msg.type === 'pick') startPicker();
    if (msg.type === 'unpick') { pick = null; store.remove(PICK_KEY); input = frame = null; locate(); }
  };
  if (alive()) chrome.runtime.onMessage.addListener(onMessage);
  store.get(PICK_KEY).then(v => { if (typeof v === 'string') { pick = v; input = frame = null; locate(); } });

  // ---- Keep the marks current (pages re-render) ----
  function refresh() {
    if (M.generation !== GEN) return;
    locate();
    setMark(MARK.composer, frame);
    const stop = findStop();
    setMark(MARK.stop, stop);
    if (stop && !answering) setMark(MARK.answer, null);   // a new answer: forget the previous one's spot
    answering = !!stop;
  }
  refresh();
  const timer = setInterval(refresh, 350);
  M.cleanups.push(() => {
    clearInterval(timer);
    watcher.disconnect();
    removeEventListener('keydown', onKey, true);
    removeEventListener('click', onClick, true);
    picker?.done();
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch {}
    for (const name of Object.values(MARK)) for (const e of document.querySelectorAll(`[${name}]`)) e.removeAttribute(name);
    delete M.sentQuestions;
  });
}
