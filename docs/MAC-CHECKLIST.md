# macOS port: first day on the Mac

Started 2026-11-03 on Windows, without a Mac. Nothing below has run on a Mac yet. This is the order to check things.

## What's already in place

| Part | File | Mac behaviour (untested) |
|---|---|---|
| Platform helpers | `platform.mjs` | finds `.app` bundles (by name in /Applications, or by bundle id via Spotlight), lists their processes (`pgrep -f`), quits them (AppleScript `quit app`), settings in `~/Library/Application Support`, watcher lock = Unix socket in /tmp (stale file cleared) |
| Starting apps | `launch.mjs` (`MAC_LAUNCH`) | `open -a <App.app> --args --remote-debugging-port=<port> --remote-allow-origins=...` |
| Watcher lock | `launch.mjs`, `watcher.mjs` | socket file `/tmp/ai-avatar-watcher-<id>.sock`; `prepareLock()` removes a leftover from a crash |
| Menu-bar icon | `pet/tray.js` | no Dock icon, notifications instead of balloons, "Open at login", Claude/Kimi hidden for now |
| Language/settings | `lang.mjs` | `~/Library/Application Support/ai-avatar-tray/settings.json` |
| Claude/Kimi overlay | `pet-host.mjs` | skipped on macOS (the Windows helper is PowerShell + UI Automation) |
| Start files | `*.command`, `mac/start.sh` | double-click versions of the `.bat` files |

Windows behaviour is unchanged. This was checked on 2026-11-03: app detection, process lists and the watcher lock all work as before.

## 1. Which apps exist on the Mac, and how are they built? (~30 min)

For each app (Doubao 豆包, Codex, Yuanbao 元宝, Qwen, Qianwen 千问, Claude, Kimi, DeepSeek Harness):

```bash
ls /Applications | grep -i -E "doubao|豆包|codex|yuanbao|元宝|qwen|千问|通义|claude|kimi|deepseek"
APP="/Applications/Doubao.app"   # each in turn
plutil -extract CFBundleIdentifier raw "$APP/Contents/Info.plist"
plutil -extract CFBundleExecutable raw "$APP/Contents/Info.plist"
ls "$APP/Contents/Frameworks" | grep -i -E "electron|chromium|cef|webview"
```

- If you see **Electron Framework**, **Chromium Embedded Framework** or similar, the app can take a debugging port, and the existing approach works.
- If you see **neither** (a native Mac app on WKWebView), there's no debugging port. That app needs the overlay approach (step 5).
- Put the real app names and bundle ids into `MAC_LAUNCH` in `launch.mjs`. The current ones are guesses.

## 2. Does each app accept the debugging port? (~15 min)

```bash
open -a "/Applications/Doubao.app" --args --remote-debugging-port=9228 --remote-allow-origins=http://127.0.0.1:9228
curl -s http://127.0.0.1:9228/json/list | head
```

A JSON list with the chat page means it works. If you see nothing, the app has blocked it (as Kimi does on Windows). The ports per app are in `apps.mjs`.

## 3. Run it (~1 h)

```bash
cd "<folder>"
chmod +x *.command mac/*.sh          # Windows can't set the "executable" bit
bash mac/start.sh --install          # npm installs, then the menu-bar icon
bash mac/start.sh doubao             # or double-click "Start Doubao with Mods.command"
```

Check each of these:
- The menu-bar icon shows and its menu works (open an app, turn her off, language, Open at login).
- She appears beside the chat box, switches experts by topic, and reacts while the AI answers.
- The topic model loads (`mods-log.txt`). `onnxruntime-node` ships Apple Silicon builds.
- Pet mode: a see-through window floating on the desktop, click-through around her, and drag. Check it on other Spaces and over full-screen apps.
- Closing an app from the menu: the "quit" request, then a force-quit if needed.
- Gatekeeper: downloaded `.command` files may be blocked the first time. Right-click → Open, or run `xattr -dr com.apple.quarantine <folder>`.

## 4. Package it for friends (~half a day)

- A zip with `node/bin/node` (Mac build) and `pet/node_modules` (Mac Electron), as the Windows zip ships `node\node.exe` and Electron.
- Without an Apple Developer account ($99/yr), friends must right-click → Open the first time. With one, sign and notarize.

## 5. Claude/Kimi overlay on macOS (~2–3 days, if wanted)

The Windows helper (`pet/claude-dock.cs`) finds the app's window and chat box through UI Automation. On macOS, the same job is a small Swift helper using the Accessibility API (`AXUIElement`). The user has to allow it once in System Settings → Privacy & Security → Accessibility. `pet-host.mjs` would start it in place of the PowerShell helper and read the same messages (window bounds, shown or hidden). Native Mac chat apps from step 1 would use this too.
