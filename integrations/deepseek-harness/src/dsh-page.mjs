// Where things are in DeepSeek Harness's window, for the shared avatar. `page` has the same meaning
// as in the Doubao project's apps.mjs (it is passed to the avatar as APP). DSH's class names are
// hashed per build, so these use its data- attributes (found in its app.asar, DSH 0.2.x):
//   [data-conversation-region="chat"]   the conversation, right of the sidebar
//   [data-composer-card]                the message box you see (inside the composer seat)
//   [data-chat-flow-kind="user"]        your messages; [data-chat-running] the "Deep diving" row
//                                       while it answers; assistant-step rows the answer
// Rows inside a step's sub-process ([data-step-process-content]) are left out.

const FLOW = '[data-chat-flow]:not([data-step-process-content])'

export const DSH_PAGE = {
  id: 'dsh',
  pane: '[data-conversation-region="chat"]',
  composer: '[data-composer-card]',
  natural: 'self',
  // DSH centres its message box in a full-width bar, so a margin would move it by half and change
  // what's measured; she stands above the box instead when the gap beside it is too narrow.
  shift: 'none',
  userMessages: `${FLOW} [data-chat-flow-kind="user"]`,
  answering: `${FLOW} [data-chat-running]:not([data-holding])`,
  answers: `${FLOW} [data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"])`,
}
