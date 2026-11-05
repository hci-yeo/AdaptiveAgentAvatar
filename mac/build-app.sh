#!/bin/bash
# Builds dist/AI Avatar.app: the avatar as one double-clickable macOS app (menu-bar only, no Dock icon,
# no Node.js or Terminal needed). Run on a Mac, in a folder where `bash mac/start.sh --install` has run
# once (so node_modules and the pet program's Electron are in place):
#   bash mac/build-app.sh            -> dist/AI Avatar.app (and dist/AI-Avatar-mac.zip)
#
# How the app works:
#   - Contents/Resources/ai-avatar is this folder's avatar (code, pictures, clips, topic model, its
#     libraries, Electron). An app can't write inside itself (downloaded apps even run from a read-only
#     place at first), and the avatar keeps its log and settings next to its code. So on first launch,
#     and after each update, the app copies ai-avatar to ~/Library/Application Support/AI Avatar/app
#     and runs her menu-bar icon (pet/tray.js) from there. Her log and settings there are kept.
#   - Node scripts run on that Electron (ELECTRON_RUN_AS_NODE, launch.mjs NODE): nothing to install.
#   - The bundled Electron is renamed "AI Avatar" (what Activity Monitor, notifications and permission
#     prompts show) and the app is signed for this Mac only ("ad-hoc"). Without an Apple Developer
#     signature, friends open it the first time with right-click -> Open.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="$PWD"
ELECTRON_APP="$SRC/pet/node_modules/electron/dist/Electron.app"
[ -d "$ELECTRON_APP" ] || { echo "Electron is missing: run 'bash mac/start.sh --install' first."; exit 1; }
[ -d "$SRC/node_modules/@huggingface/transformers" ] || { echo "The AI library is missing: run 'npm install' first."; exit 1; }

OUT="$SRC/dist"
APP="$OUT/AI Avatar.app"
RES="$APP/Contents/Resources/ai-avatar"
VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo 0)-$(date +%Y%m%d%H%M%S)"
rm -rf "$APP" "$OUT/AI-Avatar-mac.zip"
mkdir -p "$APP/Contents/MacOS" "$RES"

echo "Copying the avatar..."
# Only what she needs to run: no logs or settings, no Windows or developer files.
# (rsync takes the first rule that matches: the excludes come first.)
rsync -a \
  --exclude='mods-log*' --exclude='/pet/build/' --exclude='/pet/tray-log.txt' --exclude='.DS_Store' \
  `# the backup topic model (EmbeddingGemma is the one used; without it she uses keywords, nothing downloads)` \
  --exclude='/models/local/multilingual-e5-small-zh-en/' --exclude='/node_modules/@types/' \
  --include='/*.mjs' --include='/package.json' --include='/LICENSE*' \
  --include='/licenses/***' --include='/mods/***' --include='/node_modules/***' \
  --include='/models/' --include='/models/local/***' --include='/pet/***' \
  --exclude='*' \
  "$SRC/" "$RES/"
echo "$VERSION" > "$RES/.version"

echo "Naming her Electron \"AI Avatar\"..."
E="$RES/pet/node_modules/electron/dist/Electron.app"
for key in CFBundleName CFBundleDisplayName; do
  plutil -replace "$key" -string "AI Avatar" "$E/Contents/Info.plist"
done
plutil -replace CFBundleIdentifier -string "online.adaptive-avatar.engine" "$E/Contents/Info.plist"
plutil -replace LSUIElement -bool true "$E/Contents/Info.plist"   # menu bar only, no Dock icon

echo "Making the icon..."
ICONSET="$(mktemp -d)/AppIcon.iconset"; mkdir -p "$ICONSET"
FACE="$(mktemp -d)/face.png"
# Her everyday portrait, the top square (her face), as the icon.
sips -s format png "$SRC/mods/assets/expert-casual.webp" --out "$FACE" >/dev/null
W=$(sips -g pixelWidth "$FACE" | awk '/pixelWidth/{print $2}')
H=$(sips -g pixelHeight "$FACE" | awk '/pixelHeight/{print $2}')
# As wide as her middle part (550 of the 768 px height), centred: the pictures are wider than that
# since Nov 2026 (hands and props), and a square as wide as the picture zoomed her out.
S=$(( H * 550 / 768 )); [ "$S" -gt "$W" ] && S=$W
sips -c "$S" "$S" --cropOffset 0 $(( (W - S) / 2 )) "$FACE" >/dev/null
for s in 16 32 128 256 512; do
  sips -z $s $s "$FACE" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$FACE" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
mkdir -p "$APP/Contents/Resources"
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
cp "$APP/Contents/Resources/AppIcon.icns" "$E/Contents/Resources/electron.icns"

cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>AI Avatar</string>
  <key>CFBundleDisplayName</key><string>AI Avatar</string>
  <key>CFBundleIdentifier</key><string>online.adaptive-avatar.app</string>
  <key>CFBundleExecutable</key><string>AI Avatar</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION%%-*}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
EOF

# The app's own program: a tiny compiled starter that runs Resources/launch.sh (macOS won't open an
# app whose main program is a script: error -10669).
STUB="$(mktemp -d)/stub.c"
cat > "$STUB" <<'EOF'
#include <mach-o/dyld.h>
#include <libgen.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
int main(void) {
  char exe[PATH_MAX], real[PATH_MAX], script[PATH_MAX + 64];
  uint32_t size = sizeof exe;
  if (_NSGetExecutablePath(exe, &size) != 0 || !realpath(exe, real)) return 1;
  snprintf(script, sizeof script, "%s/../Resources/launch.sh", dirname(real));
  execl("/bin/bash", "bash", script, (char *)NULL);
  return 1;
}
EOF
clang -O2 -arch arm64 -arch x86_64 -mmacosx-version-min=12.0 -o "$APP/Contents/MacOS/AI Avatar" "$STUB"

cat > "$APP/Contents/Resources/launch.sh" <<'EOF'
#!/bin/bash
# AI Avatar: copy her into Application Support on first launch (and after an update), then start her
# menu-bar icon from there. (See mac/build-app.sh.)
BUNDLED="$(cd "$(dirname "$0")/ai-avatar" && pwd)"
HOME_DIR="$HOME/Library/Application Support/AI Avatar/app"
if ! cmp -s "$BUNDLED/.version" "$HOME_DIR/.version" 2>/dev/null; then
  mkdir -p "$HOME_DIR"
  # Her log and settings in the old copy are kept (excluded files aren't deleted).
  rsync -a --delete --exclude='mods-log*' --exclude='.pet.json' --exclude='.mods-off' --exclude='.watcher.*' \
    --exclude='.tray.stop' --exclude='.no-chatbox' --exclude='.app-path' --exclude='pet/build/' --exclude='pet/tray-log.txt' \
    "$BUNDLED/" "$HOME_DIR/"
  # A download is marked "from the internet" on every file; the copy is her own, so clear that.
  xattr -dr com.apple.quarantine "$HOME_DIR" 2>/dev/null || true
fi
# Where this app is, for her menu's "Uninstall" (it moves the app to the Trash).
(cd "$BUNDLED/../../.." && pwd) > "$HOME_DIR/.app-path"
# Started as its own app (open), not run in place of this one: run here, macOS gave her menu-bar icon
# no room (it stayed hidden). -n: a new copy even while her pet window (also this Electron) is open; a
# second menu-bar icon closes itself and shows the first one's menu.
exec open -n -a "$HOME_DIR/pet/node_modules/electron/dist/Electron.app" --args "$HOME_DIR/pet/tray.js"
EOF
chmod +x "$APP/Contents/Resources/launch.sh"

echo "Signing (for this Mac only)..."
codesign --force --deep --sign - "$E" >/dev/null 2>&1
codesign --force --deep --sign - "$APP" >/dev/null 2>&1
codesign --verify --deep "$APP" && echo "Signature OK."

echo "Zipping..."
# The zip unpacks to an "AI Avatar" folder: the app, and how to open it the first time (it isn't signed
# by an Apple developer account, so a downloaded copy needs "Open Anyway" once).
PACK="$(mktemp -d)/AI Avatar"
mkdir -p "$PACK"
ditto "$APP" "$PACK/AI Avatar.app"
# (An English-only file name: ditto doesn't mark the zip's names as UTF-8, so Windows showed the
# Chinese part of the old name as gibberish. The text inside is in both languages.)
cat > "$PACK/How to open the first time.txt" <<'EOF'
AI Avatar for Mac (experimental)

1. Drag "AI Avatar" into your Applications folder.
2. Double-click it. The first time, macOS says it can't check the app, because it isn't
   signed by an Apple developer account:
     - click Done,
     - open System Settings > Privacy & Security,
     - scroll down to the line about AI Avatar and click "Open Anyway",
     - confirm with your Mac password.
   From then on it opens normally.
3. Her face appears in the menu bar at the top of the screen: click it to open an app with
   her (Codex is called "ChatGPT" on the Mac). To remove her: her menu > Uninstall AI Avatar...

Unofficial: not affiliated with any of the chat apps. It modifies the app's page on your Mac,
which the app's terms may not allow. Use at your own risk.


AI Avatar Mac 版（实验版）

1. 把“AI Avatar”拖到“应用程序”文件夹。
2. 双击打开。第一次打开时，macOS 会提示无法检查这个应用，因为它没有 Apple 开发者账号的签名：
     - 点“完成”，
     - 打开“系统设置 > 隐私与安全性”，
     - 向下滚动到有关 AI Avatar 的那一行，点“仍要打开”，
     - 输入你的 Mac 密码确认。
   之后就能正常打开了。
3. 她的头像会出现在屏幕顶部的菜单栏里：点它即可选择要打开的应用（Codex 在 Mac 上叫“ChatGPT”）。
   要移除她：她的菜单 > 卸载 AI Avatar…

非官方项目，与这些聊天应用均无关联。它会修改你 Mac 上应用的页面，应用的条款可能不允许这样做。使用风险自负。
EOF
(cd "$(dirname "$PACK")" && ditto -c -k --sequesterRsrc --keepParent "AI Avatar" "$OUT/AI-Avatar-mac.zip")
rm -rf "$(dirname "$PACK")"
du -sh "$APP" "$OUT/AI-Avatar-mac.zip"
echo "Done: $APP"
