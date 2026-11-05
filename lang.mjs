// The language the avatar speaks on this PC: 'en' or 'zh'. It's chosen in the tray icon's menu
// (pet/tray.js, Language / 语言) and kept in the tray's settings folder; the tray saves Windows' display
// language there the first time it runs, so every part agrees from the start. Read by the background
// process (watcher.mjs: the avatar in each app and the desktop pet, re-applied when it changes), the
// Start files (launch.mjs) and pet mode's notices (pet-host.mjs).
// Where no tray runs (the browser extension, DeepSeek Harness, Android) the avatar's page uses its own
// display language instead (avatar-bundle.mjs).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { appDataDir } from './platform.mjs';

// (%APPDATA% on Windows, ~/Library/Application Support on macOS: the tray's own settings folder.)
export const LANG_FILE = join(appDataDir(), 'ai-avatar-tray', 'settings.json');

// Before the tray has saved anything: this PC's language.
const systemLang = () => (String(Intl.DateTimeFormat().resolvedOptions().locale).toLowerCase().startsWith('zh') ? 'zh' : 'en');

export function readLang() {
  try {
    const lang = JSON.parse(readFileSync(LANG_FILE, 'utf8')).lang;
    if (lang === 'en' || lang === 'zh') return lang;
  } catch {}
  return systemLang();
}

// The English or the Chinese text, for the current language.
export const tr = (en, zh) => (readLang() === 'zh' ? zh : en);
