// In the desktop apps the background watcher answers the avatar's two requests over DevTools.
// In the browser, the extension answers them itself:
//   window.__doubaoTopic(json {id, questions}) -> the topic model (background.js -> offscreen.js)
//   window.__doubaoMedia(json {id, name})      -> a clip from the extension's media/ folder (as a Blob)
// Both reply through the avatar's own M.onTopic / M.onMedia, exactly as the watcher does.
// (No window.__doubaoPet: pet mode needs the desktop program, so its menu item stays hidden.)
const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } }; // false after the extension is updated

window.__doubaoTopic = json => {
  let req;
  try { req = JSON.parse(json); } catch { return; }
  if (!alive()) return M.onTopic?.({ id: req.id, ready: false });
  chrome.runtime.sendMessage({ to: 'background', type: 'topic', questions: req.questions, current: req.current ?? null })
    .then(r => M.onTopic?.({ id: req.id, ...(r || { ready: false }) }))
    .catch(() => M.onTopic?.({ id: req.id, ready: false }));
};

window.__doubaoMedia = async json => {
  let req;
  try { req = JSON.parse(json); } catch { return; }
  // The clip itself (the avatar shares this script's world, so no base64 round trip).
  let blob = null;
  try {
    if (alive() && MEDIA.includes(req.name)) blob = await (await fetch(chrome.runtime.getURL('media/' + req.name))).blob();
  } catch {}
  M.onMedia?.({ id: req.id, name: req.name, blob });
};

// Start loading the topic model now, so it's ready by the first question.
try { if (alive()) chrome.runtime.sendMessage({ to: 'background', type: 'warm-up' }).catch(() => {}); } catch {}
