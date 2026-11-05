// Claude and Kimi: their avatar is an overlay beside their window, so there's no page of theirs where
// the avatar could work out a topic. The watcher does it here instead, for each conversation, with the
// same rule as every app (topic-rule.mjs): the model's topic, the keywords only while the model isn't
// available (the watcher's pickTopic does that), and no topic means her everyday look.
import { MAX_QUESTIONS, isCommand } from './topic-rule.mjs';

export { isCommand };
// The same prompt reported twice (read off the window, and from the app itself) within this long counts once.
export const SAME_PROMPT_MS = 5000;

// One conversation: its newest questions and the topic showing. ask(text) adds a question and works out
// the topic; resolves to pickTopic's answer ({ outfit, score?, byKeywords? }), or null if it failed.
export function createConversation(pickTopic) {
  const c = { questions: [], topic: null };
  c.ask = async text => {
    c.questions = [...c.questions, text].slice(-MAX_QUESTIONS);
    const r = await pickTopic(c.questions, c.topic).catch(() => null);
    if (r) c.topic = r.outfit ?? null;
    return r;
  };
  return c;
}

// The chats read off Claude's or Kimi's window: one conversation per chat, so one chat's questions
// never decide another's topic. The window helper (pet\claude-dock.cs, ChatKey) says which chat is open
// ({"chat": key}) and tags each prompt with it. A key that can't be read ('?') is one shared chat, as
// before chats were told apart.
// A new chat has no address of its own until its first prompt is sent (claude.ai/new becomes
// claude.ai/chat/<id>; www.kimi.ai/ a chat address; a new Kimi task gets its title a little later):
// the conversation of prompts sent in a new chat moves to the chat opened right after it.
export const NEW_CHAT_MS = 5 * 60 * 1000;   // how long after its last prompt a new chat can still get its address
export function isNewChat(key) {
  if (/#new$/.test(key)) return true;   // Kimi's Work tab, no task open ("New task")
  // An address whose path has no id in it (claude.ai/new, www.kimi.ai/): ids have digits in them.
  try { const u = new URL(key); return /^https?:$/.test(u.protocol) && !/\d/.test(u.pathname); } catch { return false; }
}
export function createChats(pickTopic, max = 20) {
  const chats = new Map();   // key -> conversation, oldest first
  let open = null;           // the chat the window shows
  let fresh = null;          // { key, conv, at }: prompts sent in a new chat, waiting for its address
  const keep = (key, conv) => {
    chats.delete(key);
    chats.set(key, conv);
    if (chats.size > max) chats.delete(chats.keys().next().value);
    return conv;
  };
  const book = {
    // The window shows chat `key` now: its conversation, or null for a chat with no questions yet.
    opened(key) {
      if (!key || key === open) return chats.get(open) || (fresh && fresh.key === open ? fresh.conv : null);
      const was = open;
      open = key;
      if (isNewChat(key)) { fresh = null; return null; }   // a blank new chat
      // Right after prompts in a new chat: this is that chat, now with its address.
      if (fresh && fresh.key === was && !chats.has(key) && Date.now() - fresh.at < NEW_CHAT_MS) keep(key, fresh.conv);
      fresh = null;
      return chats.get(key) || null;
    },
    // The conversation a prompt sent in chat `key` belongs to.
    conversationFor(key) {
      key = key || open || '?';
      book.opened(key);   // a prompt can arrive before the switch to its chat is reported
      if (isNewChat(key)) {
        if (!fresh || fresh.key !== key) fresh = { key, conv: createConversation(pickTopic), at: 0 };
        fresh.at = Date.now();
        return fresh.conv;
      }
      return chats.get(key) || keep(key, createConversation(pickTopic));
    },
  };
  return book;
}

// For the log: what decided the topic (the question itself is never logged).
export const topicNote = r => (r ? `${r.outfit ?? 'none'}${r.byKeywords ? ' (keywords: model not available)' : ''}` : 'failed');
