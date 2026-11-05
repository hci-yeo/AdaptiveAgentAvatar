// Websites the browser extension supports, and where things are on each page. `page` has the same
// meaning as in ../../apps.mjs (it is passed to the avatar as APP); `matches` are Chrome match patterns.
// Selectors use the sites' data-* attributes where they have them: generated class names change often.
//
// Doubao, Yuanbao, Qwen and Qianwen: their desktop apps show these same websites, so the page settings
// come from apps.mjs (a fix there reaches the extension at the next build), with the website's own
// differences on top. `checked` says what was seen on the website itself, and how.
import { APPS } from '../../apps.mjs';

const { ownSites, ...doubaoPage } = APPS.doubao.page;
const { ownSites: _y, ...yuanbaoPage } = APPS.yuanbao.page;
const { ownSites: _q, ...qwenPage } = APPS.qwen.page;
const { ownSites: _w, ...qianwenPage } = APPS.qianwen.page;

export const SITES = {
  chatgpt: {
    name: 'ChatGPT',
    matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
    checked: 'live, logged out (2026-11-03): chat box, answers and stop button; your messages against its scripts',
    page: {
      pane: 'main[data-slot="conversation"]',          // the chat column, right of the sidebar
      avoid: 'aside[aria-label="Sidebar"]',
      composer: [
        'form[data-announcement-thinking]',            // the 2026 composer (logged in and out)
        'form[data-type="unified-composer"]',          // older layouts
        'form[data-chatgpt-composer]',
      ].join(', '),
      natural: 'self',
      shift: 'margin',
      // Each of your messages once (the avatar reads its text). Since 2026-11 every message is
      // [data-message-role="user" | "assistant"], with your text in [data-user-message-copy].
      userMessages: [
        '[data-message-role="user"] [data-user-message-copy]',
        '[data-message-role="user"]:not(:has([data-user-message-copy]))',
        '[data-user-message-bubble]:not([data-message-role="user"] *)',                  // older layouts
        '[data-message-author-role="user"]:not([data-message-role]):not(:has([data-user-message-bubble], [data-message-role="user"]))',
      ].join(', '),
      // The send button turns into "Stop generating" while it answers.
      answering: [
        'button[data-stop-generating]',
        'button[data-testid="stop-button"]',
        'button[data-composer-submit][aria-label^="Stop" i]',
      ].join(', '),
      answers: '[data-message-role="assistant"], [data-message-author-role="assistant"]',
    },
  },

  doubao: {
    name: 'Doubao',
    matches: ['https://www.doubao.com/*'],
    checked: 'not on doubao.com itself (region-locked from the test PC); the same page as Dola, which was checked',
    page: doubaoPage,
  },

  // Dola: ByteDance's international Doubao. The same chat page (same test ids, same layout).
  dola: {
    name: 'Dola',
    matches: ['https://www.dola.com/*'],
    checked: 'live, logged out (2026-11-03): chat box and column; messages and stop button against its scripts',
    page: doubaoPage,
  },

  yuanbao: {
    name: 'Yuanbao',
    matches: ['https://yuanbao.tencent.com/*'],
    checked: 'live, logged out (2026-11-03): chat box and column; messages and stop button against its scripts',
    page: {
      ...yuanbaoPage,
      // The website has no [data-input-split-panel-root] (the desktop app's chat column); its column is
      // .agent-dialogue__content (readable class names, right of the sidebar).
      pane: '[data-input-split-panel-root], .agent-dialogue__content',
    },
  },

  qwen: {
    name: 'Qwen',
    matches: ['https://chat.qwen.ai/*'],
    checked: 'live, logged out (2026-11-03): chat box and column; messages and stop button against its scripts',
    page: qwenPage,
  },

  qianwen: {
    name: 'Qianwen',
    matches: ['https://www.qianwen.com/*'],
    checked: 'live, logged out (2026-11-03): chat box and column; messages checked in a guest chat in the desktop app',
    page: qianwenPage,
  },

  kimi: {
    name: 'Kimi',
    matches: ['https://www.kimi.com/*', 'https://kimi.com/*', 'https://kimi.moonshot.cn/*'],
    checked: 'live, logged out (2026-11-03): chat box and column; messages and stop button against its scripts',
    page: {
      pane: '#chat-container',                          // right of the sidebar
      avoid: 'aside.next-sidebar',
      composer: '[data-testid="chat-editor"], .chat-editor',
      natural: 'self',
      shift: 'margin',
      // Its class names are readable (a Vue app). Your text is in .user-content inside your message.
      userMessages: '.chat-content-item-user .user-content, .chat-content-item-user:not(:has(.user-content))',
      // The send button gets the class "stop" while it answers.
      answering: '.send-button-container.stop',
      answers: '.chat-content-item-assistant',
    },
  },

  claude: {
    name: 'Claude',
    matches: ['https://claude.ai/*'],
    checked: 'not live (needs a login): all markers found in its scripts (2026-11-03)',
    page: {
      pane: null,                                       // the first ancestor of the chat box much taller than it
      composer: '[data-chat-input-container]',
      natural: 'self',
      shift: 'margin',
      // Outermost only: one of its layouts puts a [data-testid="user-message"] inside another.
      userMessages: '[data-testid="user-message"]:not([data-testid="user-message"] *)',
      // Its stop button ("Stop response"), or the answer itself while it streams.
      answering: [
        '[data-chat-input-container] [data-testid="chat-input-stop"]',
        '[data-chat-input-container] button[aria-label="Stop response"]',
        '[data-is-streaming="true"]',
      ].join(', '),
      answers: '[data-testid="assistant-message"], .font-claude-message',
    },
  },
};
