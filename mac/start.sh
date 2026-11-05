#!/bin/bash
# macOS: what the Windows .bat files do, shared by the .command files (Install.command and scripts/).
#   mac/start.sh <doubao|codex|yuanbao|qwen|qianwen|cursor>   open that app with the avatar
#   mac/start.sh --install                             first-time setup, then the menu-bar icon
#   mac/start.sh --off                                 turn the avatar off everywhere
# Needs Node.js 22 or newer (https://nodejs.org, or: brew install node).
cd "$(dirname "$0")/.." || exit 1

# Node: shipped in this folder, or installed per user in ~/.local/node (no admin needed), or Homebrew's.
# (Double-clicked files and the menu-bar icon don't see the Terminal's PATH.)
for d in "$PWD/node/bin" "$HOME/.local/node/bin" /opt/homebrew/bin /usr/local/bin; do
  [ -x "$d/node" ] && PATH="$d:$PATH"
done
export PATH

if ! node -e "process.exit(parseInt(process.versions.node) >= 22 ? 0 : 1)" >/dev/null 2>&1; then
  echo "Node.js 22 or newer is needed but was not found."
  echo "Opening https://nodejs.org - install the LTS version, then double-click this file again."
  open "https://nodejs.org/"
  read -r -p "Press Return to close." _
  exit 1
fi

# First run: the AI topic library (one time).
if [ ! -d "node_modules/@huggingface/transformers" ]; then
  echo "First run: installing the AI topic library, this takes about a minute..."
  npm install --no-fund --no-audit --loglevel=error || echo "Could not install it. The avatar still works; she will use simple keyword matching."
fi

# First run: the menu-bar icon and pet mode run on Electron, installed once into the pet folder.
ELECTRON="pet/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [ ! -x "$ELECTRON" ]; then
  echo "First run: installing the menu-bar icon program (Electron, about 250 MB), this takes a minute or two..."
  (cd pet && npm install --no-fund --no-audit --loglevel=error) || echo "Could not install it. The avatar still works, without the menu-bar icon."
fi

case "$1" in
  --install)
    if [ -x "$ELECTRON" ]; then
      nohup "$ELECTRON" "$PWD/pet/tray.js" >/dev/null 2>&1 &
      echo "Done. Her icon is in the menu bar (top right): click it to open a chat app with her."
    fi
    ;;
  --off)
    node watcher.mjs --off
    ;;
  *)
    node launch.mjs "$1"
    status=$?
    # 2: you chose not to restart the app.
    if [ $status -ne 0 ] && [ $status -ne 2 ]; then read -r -p "Press Return to close." _; fi
    exit $status
    ;;
esac
