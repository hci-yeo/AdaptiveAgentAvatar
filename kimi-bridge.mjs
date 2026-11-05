// The Kimi pet's side of the watcher. Kimi (the desktop app) refuses to start with a DevTools port or
// pipe, so, like the Claude desktop app, its pet is docked onto its window and fed by the window
// helper (pet\claude-dock.cs run for "kimi", through pet-host.mjs). The helper reads Kimi's window the
// way a screen reader does (Windows UI Automation) and reports:
//   { prompt: '...', chat }   a prompt you sent (the box emptied and Stop appeared, or, while Kimi
//                       answers, a whole question left the box at once: queued), with the chat it was
//                       sent in: its topic is worked out here by the same local model as in the other
//                       apps; the text is never logged
//   { chat: '...' }     another chat was opened (its address; on the Work tab, the open task's title)
//   { busy: true }      Stop is showing (Kimi is answering): she thinks
//   { busy: false }     Stop went away: the answer is done
// Unlike Claude there are no hooks or sessions. Each chat in Kimi's window keeps its own questions
// (docked-topics.mjs createChats), and opening a chat shows its expert (one with no questions yet:
// her everyday look).
import { createChats, isCommand, SAME_PROMPT_MS, topicNote } from './docked-topics.mjs';

const APP = 'kimi';

export function createKimiBridge({ host, pickTopic, log }) {
  const chats = createChats(pickTopic);
  let last = { text: '', at: 0 };

  async function onPrompt(text, chat) {
    const words = text.replace(/\s+/g, ' ').trim();
    if (words === last.text && Date.now() - last.at < SAME_PROMPT_MS) return;   // reported twice: count once
    last = { text: words, at: Date.now() };
    const conv = chats.conversationFor(chat);
    host.setDockedState(APP, { outfit: conv.topic, phase: 'thinking' });
    const t0 = performance.now();
    const r = await conv.ask(text);   // the same rule as in every app (topic-rule.mjs)
    log(`Kimi topic -> ${topicNote(r)} in ${Math.round(performance.now() - t0)} ms (${text.length} characters, ${conv.questions.length} in this chat)`);
    if (chats.opened(chats.open) === conv) host.setDockedState(APP, { outfit: conv.topic });   // unless another chat was opened meanwhile
  }

  // Slash commands ("/skill ...", Kimi's skills menu) aren't questions (isCommand, topic-rule.mjs).
  host.onDockEvent?.((app, m) => {
    if (app !== APP) return;
    if (typeof m.prompt === 'string') {
      if (m.prompt.trim() && !isCommand(m.prompt)) onPrompt(m.prompt.trim().slice(0, 2000), m.chat);
    } else if (typeof m.chat === 'string' && m.chat !== chats.open) {
      const conv = chats.opened(m.chat);
      host.setDockedState(APP, { outfit: conv ? conv.topic : null });   // that chat's expert
    }
    if (m.busy === true && (host.dockedState(APP)?.phase ?? 'idle') === 'idle') host.setDockedState(APP, { phase: 'thinking' });
    if (m.busy === false) host.setDockedState(APP, { phase: 'idle' });
  });
}
