// The avatar runs here exactly as in the desktop pet window (mods/30-avatar.js, pet mode). On the
// desktop, pet/preload.js gives her window.petBridge; here this file does, talking to the Android app
// (AvatarService.kt) through its AndroidPet object. The app tells us:
//   __host.questions([...])   ChatGPT's questions, oldest first; we pick the topic (model or keywords)
//   __host.update({...})      phase ('idle' | 'thinking' | 'writing'), dark, where
//   __host.command({...})     a menu choice (from the menu window)
//   __host.openMenu()         she was tapped
'use strict';
(() => {
  const log = s => { try { AndroidPet.log(String(s)); } catch {} };
  const cbs = { state: [], command: [] };
  let petReady = false;
  const view = { outfit: null, phase: 'idle', dark: null, where: 'docked', free: false };
  let questions = [], asked = 0;

  const push = () => {
    if (!petReady) return;
    for (const cb of cbs.state) try { cb({ ...view }); } catch (e) { log('state: ' + e); }
  };

  window.petBridge = {
    hit() {},                       // the app knows where she is; her window lets every touch through
    drag() {},                      // dragging is done by the app's touch area over her
    menu: m => AndroidPet.menu(String(m?.html || ''), String(m?.css || '')),
    act: (type, value) => AndroidPet.act(String(type), JSON.stringify(value ?? null)),
    ready: () => { petReady = true; push(); AndroidPet.ready(); },
    onState: cb => cbs.state.push(cb),
    onCommand: cb => cbs.command.push(cb),
    onPointer: () => {},
  };

  // The topic for the questions so far: the model when it's loaded (the same rule as every app:
  // TOPIC_RULE.pickTopicWith), else the keyword lists.
  async function pick() {
    const n = ++asked, qs = questions.slice();
    const t0 = performance.now();
    let outfit = null, how = 'no questions', runs = 0;
    if (qs.length) {
      const model = window.__topicModel;
      if (model?.ready) {
        // The rule may run the model twice (the newest question alone, then with the one before it).
        const counted = { classify: text => { runs++; return model.classify(text); } };
        try { outfit = (await TOPIC_RULE.pickTopicWith(counted, qs, view.outfit)).outfit; how = 'model'; }
        catch (e) { log('model failed: ' + e); }
      }
      if (how !== 'model') { outfit = TOPIC_RULE.keywordTopicOf(TOPIC_KW, qs)?.outfit ?? null; how = 'keywords'; }
    }
    if (n !== asked) return;        // a newer question came in meanwhile
    const ms = Math.round(performance.now() - t0);
    log(`topic: ${outfit ?? 'everyday'} (${how}, ${ms} ms${runs ? `, ${runs} model run${runs > 1 ? 's' : ''}` : ''})`);
    // For the app's Performance section: how long picking the topic took on this phone.
    if (qs.length) try { AndroidPet.timing(JSON.stringify({ kind: 'topic', ms, how, runs })); } catch {}
    if (outfit !== view.outfit) { view.outfit = outfit; push(); }
  }

  window.__host = {
    questions: qs => {
      qs = (Array.isArray(qs) ? qs : []).map(String).filter(q => q.trim()).slice(-TOPIC_RULE.MAX_QUESTIONS);
      if (JSON.stringify(qs) === JSON.stringify(questions)) return;
      questions = qs;
      pick();
    },
    update: patch => {
      let changed = false;
      for (const [k, v] of Object.entries(patch || {})) if (k in view && view[k] !== v) { view[k] = v; changed = true; }
      if (changed) push();
    },
    command: c => { for (const cb of cbs.command) try { cb(c); } catch (e) { log('command: ' + e); } },
    openMenu: () => {
      const box = document.getElementById('doubao-mods-avatar');
      if (!box) return;
      const r = box.getBoundingClientRect();
      box.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 2 }));
    },
    modelReady: () => { if (questions.length) pick(); },
  };
})();
