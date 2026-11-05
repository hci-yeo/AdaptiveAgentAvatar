// Service worker. The topic model runs in an offscreen page (service workers can't keep a large
// model in memory for long), created on first use and kept for the browser session. Pages ask
// here; this passes the question on and returns the answer. Nothing leaves the PC.

const OFFSCREEN = 'offscreen.html';
let creating = null;

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  creating ||= chrome.offscreen.createDocument({
    url: OFFSCREEN,
    reasons: ['WORKERS'],
    justification: 'Runs the small local AI model that picks the avatar for the topic of your question.',
  }).finally(() => { creating = null; });
  await creating;
}

// ---- Sites the user added (toolbar button, popup.js) ----
// Kept in chrome.storage.local as `sites` (origins like "https://chat.example.com"). Each needs the
// site's permission, which the popup asks for; the content script is then registered for all of them
// at once (it finds the chat box by itself there: added-sites.js).
// The added sites ARE the sites the extension has been given access to, beyond the built-in ones: the
// popup closes as soon as Chrome's "Allow?" prompt takes the focus, so nothing after the prompt may
// depend on it. permissions.onAdded registers the site and shows her in its open tabs; taking the
// access back (popup "Remove", or chrome://extensions > Site access) removes it. Chrome keeps
// registered scripts across restarts; this re-registers anyway at start-up and after an update.
const SCRIPT_ID = 'added-sites';
const getSites = async () => (await chrome.storage.local.get('sites')).sites || [];
// "https://host/*" patterns the extension was given beyond its built-in sites (no wildcard hosts).
async function grantedPatterns() {
  const builtIn = new Set(chrome.runtime.getManifest().content_scripts.flatMap(c => c.matches));
  const { origins = [] } = await chrome.permissions.getAll();
  return origins.filter(p => /^https?:\/\/[^/*]+\/\*$/.test(p) && !builtIn.has(p));
}

async function syncSites() {
  const patterns = await grantedPatterns();
  const sites = patterns.map(p => p.slice(0, -2));
  await chrome.storage.local.set({ sites });
  await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }).catch(() => {});
  if (patterns.length) {
    await chrome.scripting.registerContentScripts([{
      id: SCRIPT_ID, matches: patterns, js: ['content.js'], runAt: 'document_idle', persistAcrossSessions: true,
    }]);
  }
  return sites;
}

const showIn = tabId => chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }).catch(() => {});

async function addSite(origin, tabId) {
  await syncSites();
  // Show her in the open tab now, without a reload.
  if (tabId != null) await showIn(tabId);
}

// Access just given (from the popup, which may be closed by now): register, and show her in the open tabs.
chrome.permissions.onAdded.addListener(async ({ origins = [] }) => {
  await syncSites().catch(() => {});
  const added = new Set(await grantedPatterns());
  for (const p of origins.filter(o => added.has(o))) for (const tab of await chrome.tabs.query({ url: p }).catch(() => [])) await showIn(tab.id);
});

async function removeSite(origin, tabId) {
  await chrome.permissions.remove({ origins: [origin + '/*'] }).catch(() => {});
  // Take her out of the open tab (the same clean-up a new run of the avatar does first).
  if (tabId != null) await chrome.scripting.executeScript({ target: { tabId }, func: () => {
    const M = window.__doubaoMods;
    if (M) { for (const fn of M.cleanups.splice(0)) { try { fn(); } catch {} } M.generation = (M.generation || 0) + 1; }
    for (const el of document.querySelectorAll('[id^="doubao-mods-"]')) el.remove();
  } }).catch(() => {});
  const host = new URL(origin).hostname;
  await chrome.storage.local.remove(['pick:' + host, 'sent:' + host]);
  await syncSites();
}

chrome.permissions.onRemoved.addListener(() => syncSites().catch(() => {}));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.to !== 'background') return;
  if (msg.type === 'warm-up') { ensureOffscreen().catch(() => {}); return; }
  // Adding and removing sites: only from the extension's own pages (the popup), never from a website.
  const fromUs = !sender.tab && sender.url?.startsWith(chrome.runtime.getURL(''));
  if (/^(sites|add-site|remove-site)$/.test(msg.type) && !fromUs) return;
  if (msg.type === 'sites') { syncSites().then(sites => sendResponse({ sites }), () => sendResponse({ sites: [] })); return true; }
  if (msg.type === 'add-site' && /^https?:\/\/[^/]+$/.test(msg.origin)) {
    addSite(msg.origin, msg.tabId).then(() => sendResponse({ ok: true }), e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === 'remove-site' && typeof msg.origin === 'string') {
    removeSite(msg.origin, msg.tabId).then(() => sendResponse({ ok: true }), e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === 'topic') {
    ensureOffscreen()
      .then(() => chrome.runtime.sendMessage({ to: 'offscreen', type: 'classify', questions: msg.questions, current: msg.current }))
      .then(r => sendResponse(r || { ready: false }), () => sendResponse({ ready: false }));
    return true; // answering asynchronously
  }
});

// Start loading the model early, so the first question is answered by it rather than by keywords.
chrome.runtime.onStartup.addListener(() => { ensureOffscreen().catch(() => {}); syncSites().catch(() => {}); });
chrome.runtime.onInstalled.addListener(({ reason }) => {
  ensureOffscreen().catch(() => {});
  syncSites().catch(() => {});
  // First install only: a short page saying what this is (and that it is unofficial).
  if (reason === 'install') chrome.tabs.create({ url: 'welcome.html' }).catch(() => {});
});
