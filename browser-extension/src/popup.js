// The toolbar button's popup: add the avatar to the website in the current tab (any AI chat site),
// pick its chat box if she found the wrong one, or remove her from it. Built-in sites need nothing.
// Adding asks Chrome for access to that one site (optional_host_permissions), then background.js
// registers the content script for it; she appears at once, without reloading the page.
const zh = (navigator.language || '').toLowerCase().startsWith('zh');
const T = zh ? {
  open: '先打开一个 AI 聊天网站，再点这个按钮。',
  builtIn: s => `她已经在 <span class="site">${s}</span> 上了（内置支持）。右键点她可以换风格和设置。`,
  added: s => `你已把她添加到 <span class="site">${s}</span>。`,
  addedPicked: s => `你已把她添加到 <span class="site">${s}</span>，输入框是你选的。`,
  notAdded: s => `要在 <span class="site">${s}</span> 上显示头像吗？`,
  add: '添加到这个网站', pick: '选择聊天输入框', unpick: '改回自动找输入框', remove: '从这个网站移除',
  addNote: 'Chrome 会询问是否允许访问这个网站。她会自动找到聊天输入框；找错了就点“选择聊天输入框”。',
  pickNote: '点完按钮后，在网页上点一下聊天输入框。',
  denied: '没有获得访问这个网站的许可。',
} : {
  open: 'Open an AI chat website first, then click this button.',
  builtIn: s => `She's already on <span class="site">${s}</span> (built in). Right-click her for styles and options.`,
  added: s => `You added her to <span class="site">${s}</span>.`,
  addedPicked: s => `You added her to <span class="site">${s}</span>, with the chat box you picked.`,
  notAdded: s => `Show the avatar on <span class="site">${s}</span>?`,
  add: 'Add to this site', pick: 'Pick the chat box', unpick: 'Find the chat box automatically', remove: 'Remove from this site',
  addNote: 'Chrome asks to allow access to this site. She finds the chat box by herself; if she picks the wrong one, use "Pick the chat box".',
  pickNote: 'After clicking, click the chat box on the page.',
  denied: 'Access to this site wasn\'t allowed.',
};
const $ = id => document.getElementById(id);
const bg = msg => chrome.runtime.sendMessage({ to: 'background', ...msg });

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let url = null;
  try { url = new URL(tab?.url || ''); } catch {}
  if (!url || !/^https?:$/.test(url.protocol)) { $('status').textContent = T.open; return; }
  const origin = url.origin, host = url.hostname;
  const builtIn = chrome.runtime.getManifest().content_scripts.some(c => c.matches.some(m => new URL(m.replace('/*', '/')).hostname === host));
  const { sites = [] } = await bg({ type: 'sites' });
  const added = sites.includes(origin);
  const picked = added && !!(await chrome.storage.local.get('pick:' + host))['pick:' + host];

  if (builtIn) { $('status').innerHTML = T.builtIn(host); return; }
  if (!added) {
    $('status').innerHTML = T.notAdded(host);
    $('note').textContent = T.addNote;
    $('add').textContent = T.add; $('add').hidden = false;
    $('add').onclick = async () => {
      // Must be asked from this click (a user gesture). Chrome's prompt usually closes this popup, so
      // background.js does the rest when the access is given (permissions.onAdded).
      const ok = await chrome.permissions.request({ origins: [origin + '/*'] });
      if (!ok) { $('note').textContent = T.denied; return; }
      window.close();
    };
    return;
  }
  $('status').innerHTML = picked ? T.addedPicked(host) : T.added(host);
  $('note').textContent = T.pickNote;
  $('pick').textContent = T.pick; $('pick').hidden = false;
  $('pick').onclick = async () => { await chrome.tabs.sendMessage(tab.id, { to: 'page', type: 'pick' }).catch(() => {}); window.close(); };
  if (picked) {
    $('unpick').textContent = T.unpick; $('unpick').hidden = false;
    $('unpick').onclick = async () => { await chrome.tabs.sendMessage(tab.id, { to: 'page', type: 'unpick' }).catch(() => {}); window.close(); };
  }
  $('remove').textContent = T.remove; $('remove').hidden = false;
  $('remove').onclick = async () => {
    await bg({ type: 'remove-site', origin, tabId: tab.id });   // also takes the site's access back
    window.close();
  };
})();
