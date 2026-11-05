// The Claude pet's side of the watcher: what Claude Code is doing, from its hooks (claude-hook.mjs),
// turned into the avatar's topic and phase for the docked Claude pet (pet-host.mjs).
//
// The hooks reach us through a Windows named pipe, \\.\pipe\adaptive-avatar-claude: local to this PC,
// not a network port, writable only by this user (and administrators). Each connection carries one
// small JSON message:
//   { type: 'prompt', session, text }   you sent a prompt (text is classified here, never logged)
//   { type: 'phase', session, phase }   'writing' (Claude is using tools) or 'idle' (turn over)
//   { type: 'mode', on }                switch the Claude pet on or off (claude-hook.mjs on|off)
//   { type: 'look', look }              the avatar style ('people', 'single', 'fish')
//   { type: 'hello' }                   a session started (nothing to do: the watcher is running)
//   { type: 'classify', texts }         topics for earlier prompts (oldest first), answered as
//                                       { outfits }: the in-chat mod's older replies. The pet is
//                                       left alone; nothing is logged but a count
// With reply: true, the answer comes back on the same connection as JSON: the avatar's state
// { outfit, phase, look }, after the prompt's topic has been worked out (claude-hook.mjs --ask).
// Several Claude sessions can run at once; the pet follows the one you last sent a prompt in.
//
// The window helper (pet\claude-dock.cs, through pet-host.mjs) also reports what it sees in Claude's
// window, in the Chat tab as well as the Code tab: a prompt you sent (session 'window'), the chat it was
// sent in, and whether the Stop button is showing (busy: thinking until it goes, then done). The
// window's prompts are kept per chat (docked-topics.mjs createChats), so one chat's questions don't
// decide another's topic. In the Code tab a prompt arrives both ways; the same text within a few
// seconds counts once, and the session that sent it second is followed too.
import net from 'node:net';
import { createConversation, createChats, isCommand, SAME_PROMPT_MS, topicNote } from './docked-topics.mjs';

export const PIPE = '\\\\.\\pipe\\adaptive-avatar-claude';
const APP = 'claude';
const MAX_MESSAGE = 64 * 1024;

export function createClaudeBridge({ host, pickTopic, log }) {
  const sessions = new Map();   // session id -> { questions: [], topic }
  const windowChats = createChats(pickTopic);   // the window's prompts, per chat open in it
  let active = null;
  const aliases = new Set();    // other sessions that sent the active session's last prompt too
  let last = { text: '', id: null, at: 0, done: Promise.resolve() };
  const following = id => id === active || aliases.has(id) || active === null;

  const sessionOf = id => {
    let s = sessions.get(id);
    if (!s) {
      s = createConversation(pickTopic);   // its questions and topic (docked-topics.mjs)
      sessions.set(id, s);
      if (sessions.size > 20) sessions.delete(sessions.keys().next().value);   // oldest
    }
    return s;
  };

  // Resolves once the topic is known. The same prompt again within seconds (the window helper and the
  // settings hooks can both report it) counts once.
  function onPrompt(id, text, chat) {
    // The same prompt can come twice: read off Claude's window (session 'window') and from Claude itself
    // (the hooks, the in-chat avatar mod). The same words within 5 s count once. Otherwise Claude's own
    // copy wins: the window's text can be off (a button that sends a prompt never types it in the box,
    // a pasted block shows shorter), so a window copy right after Claude's is dropped, and Claude's
    // copy right after a window copy is worked out again in its place.
    const words = text.replace(/\s+/g, ' ').trim(), age = Date.now() - last.at;
    const fromWindow = id === 'window', lastFromWindow = last.id === 'window';
    if ((words === last.text && age < SAME_PROMPT_MS) || (fromWindow && !lastFromWindow && last.id !== null && age < 3000)) {
      log(`Claude prompt counted once (again from ${id === 'window' ? 'the window' : 'Claude'}, ${text.length} characters)`);
      if (id !== active) aliases.add(id);
      return last.done;
    }
    const replacesWindowCopy = !fromWindow && lastFromWindow && age < 3000;
    aliases.clear();
    if (replacesWindowCopy) aliases.add('window');   // its Stop button still tells us about this turn
    last = { text: words, id, at: Date.now(), done: classify(id, text, chat) };
    return last.done;
  }

  // Topics for a list of prompts, oldest first, worked out like live ones, without touching the pet.
  async function classifyMany(texts) {
    const outfits = [], conv = createConversation(pickTopic);
    for (const t of texts.slice(-80)) {
      await conv.ask(String(t).slice(0, 600));
      outfits.push(conv.topic);
    }
    log(`Claude topics worked out for ${outfits.length} earlier prompts (in-chat avatar).`);
    return { outfits };
  }

  async function classify(id, text, chat) {
    const s = id === 'window' ? windowChats.conversationFor(chat) : sessionOf(id);
    active = id;
    host.setDockedState(APP, { outfit: s.topic, phase: 'thinking' });
    const t0 = performance.now();
    const r = await s.ask(text);   // the same rule as in every app (topic-rule.mjs)
    log(`Claude topic -> ${topicNote(r)} in ${Math.round(performance.now() - t0)} ms (from ${id === 'window' ? 'the window' : id.startsWith('chat-') ? 'the in-chat mod' : 'a hook'}, ${text.length} characters, ${s.questions.length} in this ${id === 'window' ? 'chat' : 'session'})`);   // the prompt itself is not logged
    // Unless you've sent a prompt elsewhere meanwhile (or opened another chat in the window).
    if (active === id && (id !== 'window' || windowChats.opened(windowChats.open) === s)) host.setDockedState(APP, { outfit: s.topic });
  }

  // A slash command (/avatar docked...) typed in the box isn't a question (isCommand, topic-rule.mjs).

  // Returns a promise when the answer has to wait (a prompt's topic).
  function onMessage(m) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'classify' && Array.isArray(m.texts)) return classifyMany(m.texts);
    const id = typeof m.session === 'string' ? m.session.slice(0, 80) : '';
    if (m.type === 'look' && typeof m.look === 'string') host.setDockedLook(APP, m.look);
    if (m.type === 'where' && typeof m.where === 'string') host.setWhere(APP, m.where);   // docked, chat or free
    // Claude adds notes of its own to some prompts (<system-reminder> blocks: linked sessions, file
    // changes...); classifying those made a recipe question come out as "no topic". Only your words count.
    const own = typeof m.text === 'string' ? m.text.replace(/<(system-reminder|command-[a-z-]+|local-command-[a-z-]+)>[\s\S]*?<\/\1>/g, ' ').trim() : '';
    if (m.type === 'prompt' && own && !isCommand(own)) return onPrompt(id, own.slice(0, 2000));
    if (m.type === 'phase' && ['writing', 'idle'].includes(m.phase) && following(id)) {
      if (active === null) active = id;
      host.setDockedState(APP, { phase: m.phase });
    }
    if (m.type === 'mode' && typeof m.on === 'boolean') host.setMode(m.app === 'kimi' ? 'kimi' : APP, m.on);   // (claude-hook.mjs on kimi)
  }

  // One message per connection, ended by a newline (or by the client closing). Windows named pipes
  // can't be half-closed, so a client that wants an answer sends its line and waits, open.
  // From the window helper: a prompt sent in Claude's window, another chat opened in it, or its Stop
  // button showing / gone.
  host.onDockEvent?.((app, m) => {
    if (app !== APP) return;
    if (typeof m.prompt === 'string') {
      if (m.prompt.trim() && !isCommand(m.prompt)) onPrompt('window', m.prompt.trim().slice(0, 2000), m.chat);
    } else if (typeof m.chat === 'string' && m.chat !== windowChats.open) {
      // Back in a chat whose questions the window gave her: its expert. (A chat the window knows
      // nothing of may be a Code session the hooks follow, so she's left as she is then.)
      const conv = windowChats.opened(m.chat);
      if (conv && active === 'window') host.setDockedState(APP, { outfit: conv.topic });
    }
    if (m.busy === true && (host.dockedState(APP)?.phase ?? 'idle') === 'idle') host.setDockedState(APP, { phase: 'thinking' });
    if (m.busy === false) host.setDockedState(APP, { phase: 'idle' });
  });

  const server = net.createServer(sock => {
    let buf = '', handled = false;
    sock.setEncoding('utf8');
    sock.setTimeout(8000, () => sock.destroy());
    const handle = async () => {
      if (handled) return;
      handled = true;
      let m = null, answer;
      try {
        m = JSON.parse(buf.split('\n')[0]);
        if (m?.type === 'classify') sock.setTimeout(120000, () => sock.destroy());   // many prompts take a while
        answer = await onMessage(m);
      } catch {}
      if (m?.reply && !sock.destroyed && Array.isArray(answer?.outfits)) sock.end(JSON.stringify({ outfits: answer.outfits }) + '\n');
      else if (m?.reply && !sock.destroyed) {
        const s = host.dockedState(APP) || {};
        sock.end(JSON.stringify({ outfit: s.outfit ?? null, phase: s.phase ?? 'idle', look: s.look ?? 'people', where: s.where ?? 'docked' }) + '\n');
      } else sock.end();
    };
    sock.on('data', d => { buf += d; if (buf.length > MAX_MESSAGE) return sock.destroy(); if (buf.includes('\n')) handle(); });
    sock.on('end', handle);
    sock.on('error', () => {});
  });
  server.on('error', e => log(`Claude pet: hook pipe unavailable (${e.code || e.message}).`));
  server.listen(PIPE);
  return { close: () => server.close() };
}
