# Adaptive Agent Avatar browser extension

The desktop avatar as a Chrome/Edge extension for AI chat websites: the same expert pictures, walk and idle clips, outfit styles, right-click menu, dragging, and reactions while the AI answers (thinking, writing, done). The topic model runs inside the extension, on your PC. No question text leaves the browser.

Sites: **ChatGPT** (chatgpt.com), **Claude** (claude.ai), **Doubao 豆包** (doubao.com), **Dola** (dola.com, the international Doubao), **Kimi** (kimi.com), **Qwen** (chat.qwen.ai), **Qianwen 千问** (qianwen.com) and **Yuanbao 元宝** (yuanbao.tencent.com).

It's built from the same files as the desktop version (`mods/30-avatar.js`, `mods/assets`, `mods/media`, `topics.mjs`, and the trimmed EmbeddingGemma from `models/local/embeddinggemma-300m-zh-en`), so a change there reaches the extension at the next build.

## Build

```
node browser-extension/build.mjs
```

Output:
- `browser-extension/build/chrome/`: the extension (~320 MB), to load unpacked
- `browser-extension/build/ai-avatar-chrome.zip`: the same, zipped (~270 MB), for the Chrome Web Store / Edge Add-ons

The first build fetches the AI engine's WebAssembly file (onnxruntime-web, the version transformers.js expects) into `browser-extension/vendor/`, and computes the example questions' vectors (also cached there; recomputed only when `topics.mjs` changes).

## Install (for yourself, developer mode)

1. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick `browser-extension\build\chrome`.
4. Open one of the sites. After a rebuild, click the extension's reload button.

Chrome and Edge only install extensions **without** developer mode from their stores. Installing a downloaded `.crx` file is blocked on Windows (except through company policy). So for other people, publish it:
- **Microsoft Edge Add-ons**: free developer account; works in China.
- **Chrome Web Store**: one-time US$5 developer fee; blocked in China.

Upload `ai-avatar-chrome.zip`. Store review takes a few days. Check the store's size limit when uploading; the zip is about 270 MB: 144 video clips (the three avatar styles) and the AI model (131 MB).

## Adding another AI site (no code change)

Anyone can put her on an AI chat site that isn't built in (Grok, Manus, Perplexity, a local Open WebUI...):

1. Open the site and click the extension's toolbar button (the avatar's face; pin it from the puzzle-piece menu).
2. Click **Add to this site**. Chrome asks to allow access to that one site; allow it. She appears at once.
3. If she stands by the wrong box: toolbar button → **Pick the chat box**, then click the chat box on the page. **Find the chat box automatically** undoes it.
4. **Remove from this site** takes her off and gives the access back (so does chrome://extensions → the extension → Site access).

How it works on such a site (`src/added-sites.js`, `src/popup.js`, `src/background.js`):
- **Access:** the manifest asks for no sites beyond the built-in ones up front; `optional_host_permissions` lets the popup ask for one site at a time. The added sites are simply the sites the extension has access to beyond the built-in ones: Chrome's prompt closes the popup, so `background.js` registers the content script when the access arrives (`permissions.onAdded`) and shows her in that site's open tabs, and re-registers at every start.
- **Finding the page's parts** (marked with data- attributes the avatar's settings point at):
  - chat box `[data-avatar-composer]`: the widest text box in the lower part of the page, with its frame; or the one picked, remembered per site;
  - stop button `[data-avatar-stop]`: by the chat box, labelled Stop / 停止 / 中止 ... or named *stop* / *break* / *abort*;
  - the reply `[data-avatar-answer]`: where text appears while the stop button shows.
- **Your questions** are read from the chat box as you send them (Enter, or a button by the box, and the box then empties; not while a Chinese/Japanese input method is composing), kept per chat address in the extension's storage (last 40 chats), so a reload or going back to that chat keeps her expert.
- **She never moves the chat box** there (`shift: 'none'`): unknown sites often centre it with automatic margins. Without room beside it she stands just above its left end.
- **Limits:** a chat opened from history that wasn't asked in on this computer starts with the everyday look until you ask something; with a stop button that has no recognisable label or name she still changes experts, but doesn't show the thought bubble.

Tested 2026-11-03 (Chrome for Testing 156): a local mock chat page end to end (two questions → chef, then astronaut; thinking → writing → done each time; the box stayed centred; the questions kept after a reload; picking the box; removing the site), and placement on grok.com and manus.im added through the toolbar button.

## How it works

| Part | Desktop apps | Extension |
|---|---|---|
| Puts the avatar in the page | watcher over DevTools | one content script for all sites (`content.js`, generated): it picks the site's settings from `src/sites.mjs` by the page's address, so the pictures inside it (~5.6 MB) ship once |
| Video clips | `window.__doubaoMedia` → watcher reads `mods/media` | same call → `src/glue.js` reads the extension's `media/` |
| Topic model | `window.__doubaoTopic` → watcher (Node, onnxruntime-node) | same call → `background.js` → `offscreen.js` (transformers.js + onnxruntime-web on the graphics card via WebGPU, or WebAssembly on the CPU; one copy for all tabs) |
| Pet mode | desktop pet program | not available (the menu item is hidden) |

- **Sites** and their selectors are in `src/sites.mjs`, like `apps.mjs` for the desktop apps. Doubao, Dola, Yuanbao, Qwen and Qianwen take their settings from `apps.mjs` (their desktop apps show the same websites), so a fix there reaches the extension at the next build; only Yuanbao's chat column differs on its website. Each site's `checked` line says how far it has been verified.

  | Site | Your messages | While it answers | Answers |
  |---|---|---|---|
  | ChatGPT | `[data-message-role="user"]`, text in `[data-user-message-copy]` (since 2026-11; older layouts kept as fallbacks) | `button[data-stop-generating]` | `[data-message-role="assistant"]` |
  | Claude | `[data-testid="user-message"]` | `chat-input-stop` button, or `[data-is-streaming="true"]` | `[data-testid="assistant-message"]` |
  | Doubao, Dola | `[data-testid="send_message"] [data-testid="message_text_content"]` | `chat_input_local_break_button` (always in the page, shown only while answering) | `[data-testid="receive_message"]` |
  | Kimi | `.chat-content-item-user .user-content` | `.send-button-container.stop` | `.chat-content-item-assistant` |
  | Qwen | `.chat-user-message` | `.stop-button`, `.icon-stop` | `.chat-response-message` |
  | Qianwen | `[data-chat-question-wrap] .question-text-card` | button "停止回答" | `[data-chat-answers-wrap]` |
  | Yuanbao | `[data-speaker="human"] .hyc-content-text` | `#yuanbao-send-btn` with a `sendStop` class | `[data-speaker="ai"]` |

  When ChatGPT renamed its message marker (November 2026: `[data-user-message-bubble]` became `[data-message-role="user"]`), the avatar silently stopped seeing questions, while the answer reactions still worked. If experts stop changing on one site, check its "your messages" marker first.
- **Example vectors:** the topic examples' vectors are computed at build time (`bank.json` + `bank.bin`), so the browser only runs your question through the model (speed: see Model below). Scores match the desktop version (e.g. "how to cook fried rice" → chef 0.845 vs 0.847).
- **Covered windows:** when the browser window is covered by other windows, Chrome reports the page as hidden. Like on desktop, she waits until it's visible before changing experts.
- **Model:** EmbeddingGemma 300M, 4-bit, vocabulary cut to Chinese + English (`models/local/embeddinggemma-300m-zh-en/onnx/model_web_q4.onnx`, 131 MB: the same file the desktop and the DeepSeek Harness plugin use), with the same follow-up (context) rule as the desktop version (see the main README, "Why EmbeddingGemma" and "How Gemma was made smaller"). The browser's engine has no GatherBlockQuantized, so the file looks words up with plain operations (same numbers). On the graphics card (WebGPU): ~25–30 ms per question, ~440 MB for the model page. On the CPU it uses several threads (the manifest turns on cross-origin isolation for the extension's own pages): ~60 ms with 8 threads, ~270 ms with 1 (long messages: it reads the first 300 characters, ~135 ms / ~680 ms); ~370–400 MB. A follow-up is read a second time together with the previous question only when that could change the answer (tested in Chrome for Testing 156, 2026-11-01).
- **Gemma licence:** the model folder inside the extension carries `NOTICE.txt` and `GEMMA_TERMS.txt` (Gemma Terms of Use and Prohibited Use Policy), as the Gemma terms require for redistribution. A store listing's terms or privacy page should also say that use is subject to the Gemma Prohibited Use Policy.
- **Permissions:** the extension asks for access to the sites above only, plus `offscreen` (the hidden page that runs the model), `storage` (added sites, picked chat boxes, questions sent there), `scripting` and `activeTab` (the toolbar button). Any other site only once you add it from the toolbar button, and Chrome asks you first. The clips are web-accessible with dynamic URLs, so sites can't use them to detect the extension.

Tested 2026-11-01 in Edge 156 and Chrome for Testing 156 on chatgpt.com (logged out): avatar placement, thinking → writing → done, expert walk on topic change (moon question → astronaut), and the model's answers for eight sample questions in English and Chinese.

Tested 2026-11-03 in Chrome for Testing 156, logged out, without sending anything to the sites: placement beside the chat box on ChatGPT, Dola, Kimi, Qwen, Qianwen and Yuanbao; and, with each site's own message markup added to the page, the expert walk on a new question (all of them, and a mock of Claude's chat page) and thinking → writing → done (all but Dola, whose stop button only appears through its own state; on Claude's mock, writing → done). Not yet tried: real chats while logged in, and doubao.com itself (region-locked from the test PC).
