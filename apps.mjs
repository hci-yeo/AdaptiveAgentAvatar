// The desktop apps the mods support. Each is a Chromium-based app started with a DevTools port
// (launch.mjs, which the Start files run). One background watcher (watcher.mjs --watch) serves them all.
//
// `page` is passed to the mods as APP, so they know where things are in that app's window:
//   pane          the chat column the avatar stands in (null: the first ancestor of the composer
//                 that is much taller than it)
//   avoid         side panels the avatar must stay clear of: her area starts right of any visible
//                 one that sits left of the composer (optional)
//   composer      the message input box (the first visible match is used)
//   natural       where the box's free space is measured from: 'parent' of the composer, or the
//                 composer 'self' (with shift 'margin' the avatar takes its own margin back out first)
//   shift         how room is made for the avatar on narrow windows: 'margin' or 'padding' (left)
//   shrink        with shift 'margin': also narrow the composer by that much (a full-width box would
//                 otherwise run off the window's right edge; optional)
//   zIndex        the avatar's layer (default 20, under the app's menus); higher where the app's chat
//                 box area sits on a higher layer and would cover her (optional)
//   userMessages  your own messages in the open chat (visible ones are used)
//   answering     shown only while the AI is answering (the composer's stop button)
//   answers       the AI's replies; once the newest one starts growing, she goes from "thinking"
//                 to "writing"
//   ownSites      the app's own websites (hosts). The avatar never runs on any other website its window
//                 or tab goes to (千问 is a browser too; Qwen signs in through Google, Apple, GitHub).
//                 Its own app pages (doubao://, app://, chrome://newtab ...) always count as its own.

// The send button's label while the AI answers, in every language Codex ships (its own
// composer.submitButtonTooltip.stop strings, Codex 26.1027). Matched exactly: "Stop dictation", "Stop
// voice chat" and "Stop all" (background agents) also start with "Stop" and aren't an answer.
const STOP_LABELS = ['Stop', '停止', '중지', 'Stopp', 'Stoppa', 'Stoppen', 'Arrêter', 'Detener', 'Parar', 'Interrompi',
  'Zatrzymaj', 'Zastavit', 'Zastaviť', 'Zaustavi', 'Ustavi', 'Leállítás', 'Oprește', 'Pysäytä', 'Stöðva', 'Sustabdyti',
  'Apturēt', 'Peata', 'Atura', 'Durdur', 'Ngừng', 'Berhenti', 'Hentikan', 'Itigil', 'Simamisha', 'Jooji', 'Ndalo',
  'Διακοπή', 'Остановить', 'Зупинити', 'Запри', 'Заустави', 'Зогсоох', 'Спиране', 'Тоқтату', 'Դադարեցնել', 'გაჩერება',
  'إيقاف', 'توقف', 'روکیں', 'थांबवा', 'रोकें', 'বন্ধ করুন', 'ਰੋਕੋ', 'બંધ કરો', 'நிறுத்து', 'నిలిపివేయి', 'ನಿಲ್ಲಿಸಿ',
  'നിർത്തുക', 'หยุด', 'ရပ်ရန်', 'አቁም'];
const stopButtonIn = scope => STOP_LABELS.map(l => `${scope} button[aria-label="${l}"]`).join(', ');

// Cursor 3's Agent panel (the "Cursor Agents" window, and the agent pane in its editor windows). Its
// class names are mostly generated (glass-…, ui-…); these use its data- attributes and the few
// readable class names. Messages: data-message-kind is "human", "assistant" (the answer's text) or
// "thinking" (the "Thought 9s" line).
// Each selector lists the Agents window first, then the classic IDE window's chat (.composer-bar, in
// the side panel or an editor tab). Both mark their messages with data-message-kind.
const CURSOR_PAGE = {
  pane: '[data-component="agent-panel"], .composer-bar',
  avoid: 'nav[data-component="workspace-sidebar"]',
  composer: '.agent-prompt-input-root, .composer-bar .composer-input-blur-wrapper',
  natural: 'self',
  shift: 'padding',
  narrow: 'above',   // the IDE's side-panel chat is usually under 520px wide
  userMessages: '[data-message-kind="human"]',
  // The submit button (a microphone while the box is empty) becomes "Stop generation" while it
  // answers: data-state="stop", a stop-circle icon (seen in a live run; any language: the state, not
  // the label).
  // The IDE chat's panel says data-composer-status="generating" while it answers.
  answering: '.agent-prompt-input-root .ui-prompt-input-submit-button:is([data-state="stop"], :has([data-icon-name="stop-circle"])), .composer-bar[data-composer-status="generating"]',
  answers: '[data-message-kind="assistant"]',
  ownSites: [],
};

export const APPS = {
  doubao: {
    name: 'Doubao',
    port: Number(process.env.DOUBAO_CDP_PORT || 9222),
    // The chat UI shows up as doubao://doubao-chat/... or, after some navigations, chrome://doubao-chat/...
    isTarget: t => t.type === 'page' && /^(doubao|chrome):\/\/doubao-chat\//.test(t.url),
    page: {
      pane: '#chat-route-main > main',
      composer: '#chat-route-main > main [data-testid="chat_input"]',
      natural: 'parent',
      shift: 'margin',
      userMessages: '#chat-route-main [data-testid="send_message"] [data-testid="message_text_content"]',
      // The send button turns into this stop button from sending until the answer is complete.
      answering: '#chat-route-main [data-testid="chat_input_local_break_button"]',
      answers: '#chat-route-main [data-testid="receive_message"]',
      ownSites: [],
    },
  },
  codex: {
    name: 'Codex',
    port: Number(process.env.CODEX_CDP_PORT || 9333),
    // The main window only; Codex also has an avatar-overlay and detached windows (?initialRoute=...).
    isTarget: t => t.type === 'page' && /^app:\/\/-\/index\.html(#.*)?$/.test(t.url),
    page: {
      pane: null,
      avoid: 'nav[aria-label="Home"], nav[aria-label="App navigation"]', // the two left sidebars
      // Codex mode (and some ChatGPT chats) use the first; other ChatGPT chats ("Ask ChatGPT") the second.
      composer: '[data-codex-composer-root], form[data-chatgpt-composer]',
      natural: 'self',
      shift: 'padding',
      userMessages: '[data-user-message-bubble]',
      // The Send button becomes "Stop" while it answers (Codex has no test ids), in any of its languages.
      answering: `${stopButtonIn('[data-codex-composer-root]')}, ${stopButtonIn('form[data-chatgpt-composer]')}`,
      // The reply's block. Both kinds of page mark the reply only with a hidden 1 px screen-reader
      // heading (data-conversation-role="assistant"), so: in ChatGPT chats, the search unit that holds
      // such a heading; in Codex threads, the turn's final-assistant block.
      answers: '[data-chatgpt-search-unit-key]:has([data-conversation-role="assistant"]), [data-local-conversation-final-assistant="true"]',
      ownSites: [],
    },
  },
  yuanbao: {
    name: 'Yuanbao',
    // Tencent Yuanbao (元宝) uses WebView2, not Electron: launch.mjs turns its DevTools port on
    // through the WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS environment variable.
    port: Number(process.env.YUANBAO_CDP_PORT || 9444),
    // The main window only: Yuanbao also has hidden spare windows (window-pool.html), the page behind
    // its taskbar thumbnail (taskbar-preview), and its mini window (/chatlite) and quick-ask pop-ups
    // (/launchbox...), which have the same chat box. So /chat (or a page under it) or /launch, exactly.
    isTarget: t => t.type === 'page' && /^https:\/\/tencent\.yuanbao\/(chat(\/[^?#]*)?|launch(\.html)?)(?=[?#]|$)/.test(t.url),
    page: {
      pane: '[data-input-split-panel-root]', // messages + input, right of the sidebar
      composer: '[data-new-input-card]',
      natural: 'self',
      shift: 'margin',
      shrink: true,   // its box is full width (w-full): pushed right, it must narrow too
      // Its class names are hashed per build, so these use data- attributes and ids where it has them.
      // Not in the deep-research side panel (#chatDeepSearchAgentContent), which also marks its items
      // data-speaker="ai": the chat itself only.
      userMessages: '[data-speaker="human"]:not(#chatDeepSearchAgentContent *) .hyc-content-text',
      // The send button gets a "sendStop" class while it answers.
      answering: '#yuanbao-send-btn[class*="sendStop"], #yuanbao-send-btn[aria-label*="停止"]',
      answers: '[data-speaker="ai"]:not(#chatDeepSearchAgentContent):not(#chatDeepSearchAgentContent *)',
      ownSites: ['tencent.yuanbao'],
    },
  },
  qwen: {
    name: 'Qwen',
    // Alibaba's Qwen app (Electron, v1.0.x). Its window is a small local page that holds the website
    // chat.qwen.ai in a <webview>, so the chat is a target of type "webview", not "page".
    port: Number(process.env.QWEN_CDP_PORT || 9666),
    isTarget: t => t.type === 'webview' && /^https:\/\/chat\.qwen\.ai\//.test(t.url),
    page: {
      pane: 'main.main-content',
      composer: '.message-input-container',
      natural: 'self',
      shift: 'margin',
      shrink: true,   // pushed right, it narrows too, so its send button stays inside the window
      // Its class names are readable (not hashed). The message ones come from its stylesheets and were
      // not yet seen in a live chat (sending needs a signed-in account).
      userMessages: '.chat-user-message',
      // The send button turns into a stop button while it answers.
      answering: '.message-input-container .stop-button, .message-input-container .icon-stop',
      answers: '.chat-response-message',
      ownSites: ['chat.qwen.ai'],
    },
  },
  cursor: {
    name: 'Cursor',
    // Cursor (Anysphere's code editor, v3.19; Electron, a VS Code fork). Every window is one page,
    // workbench.html; the AI chat (the Agent panel) is part of that page, not a separate one.
    port: Number(process.env.CURSOR_CDP_PORT || 9555),
    isTarget: t => t.type === 'page' && /^vscode-file:\/\/vscode-app\/.*\/workbench\/workbench\.html/.test(t.url),
    page: CURSOR_PAGE,
  },
  qianwen: {
    name: 'Qianwen',
    // Alibaba's Chinese 千问 app (v5.1; its own Chromium 144 build, like Doubao, and an AI browser too).
    // The chat is the website www.qianwen.com/chat, shown in the main window's "new tab": that page's
    // DevTools address stays chrome://newtab/ even while it shows a chat, so both are accepted.
    port: Number(process.env.QIANWEN_CDP_PORT || 9888),
    isTarget: t => t.type === 'page' && /^(chrome:\/\/newtab\/|https:\/\/www\.qianwen\.com\/chat)/.test(t.url),
    // Two pages share one document, switched by the sidebar's 日常 (daily chat) / 工作 (work) tabs: the
    // hidden one stays laid out underneath (its box still has a size), so every selector skips anything
    // inside an inactive page ([data-surface-pane-active="false"]). 日常's chat area is
    // #qianwen-main-area; 工作's is the "workbench:main" page (URL /chat/workbench).
    page: {
      // The chat column first: #qianwen-main-area also holds the right-hand panel (canvas, documents,
      // research) once it opens. The avatar uses the nearest of these around the chat box.
      pane: '#qianwen-layout-left-panel:not([data-surface-pane-active="false"] *), '
        + '#qianwen-main-area:not([data-surface-pane-active="false"] *), '
        + '[data-surface-pane="workbench:main"][data-surface-pane-active="true"]:not([data-surface-pane-active="false"] *)',
      composer: '[data-chat-input-shell]:not([data-surface-pane-active="false"] *)',
      natural: 'parent',   // [data-qw-chat-input-position]: not moved by the box's own margin
      shift: 'margin',
      shrink: true,   // its box is full width: pushed right, it must narrow too, or it runs off the window
      // The white panel behind its box is on layer 999: at 999 too she stands in front of it (she's added
      // to the page after it), while its menus and pop-ups (added later, layers 900-999) still open over her.
      zIndex: 999,
      // Checked in a live (guest) 日常 chat: your question's text card, the answer's wrapper, and the
      // send button, which reads 停止回答 ("stop answering") while it answers. (工作's own task view was
      // not tried: a task there can act on the PC.)
      userMessages: '[data-chat-question-wrap]:not([data-surface-pane-active="false"] *) .question-text-card',
      answering: '[data-chat-input-shell]:not([data-surface-pane-active="false"] *) button[aria-label="停止回答"], '
        + '[data-chat-input-shell]:not([data-surface-pane-active="false"] *) button[aria-label^="Stop" i]',
      answers: '[data-chat-answers-wrap]:not([data-surface-pane-active="false"] *)',
      ownSites: ['www.qianwen.com'],
    },
  },
};
