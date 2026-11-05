// How a conversation gets its topic: the one rule every app uses, written once.
//   - the desktop apps and the Claude / Kimi overlays (classifier.mjs, used by watcher.mjs)
//   - the DeepSeek Harness plugin (its helper loads classifier.mjs)
//   - the browser extension (browser-extension/build.mjs copies this file next to offscreen.js)
//   - the avatar in every page, for its keyword fallback (avatar-bundle.mjs embeds this file)
// No imports, so it runs in Node, in an extension page and inside an app's page alike.
//
// The topic comes from the local AI model. The keyword lists (topics.mjs zh/en) are used only when
// the model isn't available (still loading, failed to load, or out of reach). A topic of null means
// "no topic": she wears her everyday look.
//
// A question without a topic is one of two kinds (topics.mjs):
//   - a follow-up ("再详细一点", "thanks", "哈哈"): the expert stays, the questions before decide
//   - everyday small talk ("今天天气怎么样", "你是谁", "现在几点"): the everyday look, at once

export const MAX_QUESTIONS = 6;     // the newest questions of a conversation that are read
export const MAX_CHARS = 500;       // of each question
// How clear a new question must be to switch topic on its own (see pickTopicWith).
export const CONTEXT_SURE = 0.03;
// How clearly a question must be everyday small talk (its lead over the runner-up) to count as small
// talk. Real small talk wins by 0.2-0.4 ("出门要带伞吗" 0.24, "现在几点了" 0.31); a topic question that
// only sounds a bit like it wins by a hair ("插座摸着有点烫" 0.004, "柠檬树一直掉果" 0.011). Below it,
// the everyday examples are ignored and the question is read exactly as without them.
// Tuned with tools/topic-stress/check.mjs.
export const EVERYDAY_SURE = 0.05;
// Small talk right after a topic question keeps the expert only when the small talk itself comes this
// close to her topic: weather that is about the topic ("会冻坏吗" after succulents, 0.24; "how cold will
// it be?" on a trip, 0.13) stays; plain small talk ("明天会下雨吗" after a recipe, 0.50; "出门要带伞吗"
// after code, 0.26) sends her away. Where the two overlap, leaving is the safer mistake.
// Tuned with tools/topic-stress/pair-check.mjs.
export const EVERYDAY_TOPIC_GAP = 0.25;
// The everyday examples' label in the example bank (classifier.mjs, browser-extension/build.mjs).
// Not a topic: a question closest to them has no topic and asks for the everyday look.
export const EVERYDAY = '~everyday';
// Slash commands ("/compact", "/skill ...") aren't questions.
export const isCommand = text => /^\/[a-z][\w:-]*(\s|$)/i.test(String(text).trim());

export const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// A question's vector against the example questions' vectors (bank: [{ outfit, vec }], outfit null for
// the follow-up examples, EVERYDAY for the everyday ones): each group scores the average of its two
// closest examples, best first.
// bonusOf(outfit): an optional extra per topic (classifier.mjs's keyword bonus for some models).
export function rankTopics(q, bank, bonusOf = () => 0) {
  const per = new Map();
  for (const { outfit, vec } of bank) {
    const arr = per.get(outfit) || [];
    arr.push(dot(q, vec));
    per.set(outfit, arr);
  }
  return [...per].map(([outfit, s]) => {
    s.sort((a, b) => b - a);
    return { outfit, score: (s[0] + (s[1] ?? s[0])) / 2 + bonusOf(outfit) };
  }).sort((a, b) => b.score - a.score);
}

// rankTopics' list as a classify() answer: { outfit, score, margin, scores } with outfit null for no
// topic, plus everyday: true when the everyday examples came first by at least everydaySure. margin: the
// lead over the runner-up. scores: every group's score (the follow-up group under 'none', the everyday
// one under 'everyday'). When the everyday examples come first by less, they are left out and the rest
// decides, so a topic question with a weather word in it keeps its topic.
export function resultOf(ranked, everydaySure = EVERYDAY_SURE) {
  const scores = Object.fromEntries(ranked.map(r => [r.outfit === EVERYDAY ? 'everyday' : r.outfit ?? 'none', r.score]));
  const lead = ranked[0].score - (ranked[1]?.score ?? 0);
  if (ranked[0].outfit === EVERYDAY && lead >= everydaySure)
    return { outfit: null, everyday: true, score: ranked[0].score, margin: lead, scores };
  const [best, second] = ranked.filter(r => r.outfit !== EVERYDAY);
  return { outfit: best.outfit, score: best.score, margin: best.score - (second?.score ?? 0), scores };
}

// The topic for a conversation: its questions (oldest first) and the topic showing now. classifier:
// { classify(text) -> { outfit, score, margin, everyday? } }. Returns { outfit, score } (outfit null:
// no topic, the everyday look; everyday: true when small talk asked for it).
// Everyday small talk: a newest question that is clearly small talk ("明天会下雨吗" after a recipe)
// sends the expert away at once. A follow-up of small talk ("那后天呢" after the weather) stays with
// the everyday look: looking back stops at the small talk instead of reaching the recipe before it.
// Context: a short follow-up ("每天练多久", "需要存款证明吗") can look like a different topic on its
// own. So when the newest question alone is unsure, it is also read together with the one before it;
// if that pair still means the current topic (or the newest alone has no topic), the pair decides. A
// newest question that is clearly about something else (its lead over the runner-up topic is at least
// CONTEXT_SURE) always wins: before that check, a clear new topic right after another topic's question
// was followed only 47% of the time ("how to draw a smiley face" after writing questions kept the
// writer); now 91%, conversations 92.6% -> 91.6% (tools/topic-stress/ctx-tune.mjs).
// Otherwise newest question first; a follow-up with no topic ("thanks", "more detail") falls back to
// the question before it.
export async function pickTopicWith(classifier, questions, current) {
  const resp = { outfit: null };
  const qs = (Array.isArray(questions) ? questions : []).map(String).slice(-MAX_QUESTIONS);
  const smallTalk = r => !!r.everyday;   // only clear small talk is marked everyday (resultOf)
  // Small talk on its own (r: qs[i] classified), but maybe not in context: "明天降温到零下，会冻坏吗"
  // right after a question about succulents is still gardening. It counts as the current expert's topic
  // only if the question itself is near her topic (within EVERYDAY_TOPIC_GAP of small talk) and, read
  // together with the question before, clearly means her topic. The pair alone can't decide: a long
  // topic question outweighs a short one ("红烧肉怎么做才不腻\n明天会下雨吗" reads as cooking).
  const inContext = async (i, r) => {
    if (!current || i < 1 || !r.scores || r.scores.everyday - (r.scores[current] ?? -1) >= EVERYDAY_TOPIC_GAP) return null;
    const pair = await classifier.classify(qs[i - 1] + '\n' + qs[i]);
    return pair.outfit === current && pair.margin >= CONTEXT_SURE ? pair : null;
  };
  if (qs.length >= 2) {
    const alone = await classifier.classify(qs.at(-1));
    if (smallTalk(alone)) {
      const pair = await inContext(qs.length - 1, alone);
      return pair ? { outfit: current, score: +pair.score.toFixed(3) } : { outfit: null, everyday: true };
    }
    let pick = alone;
    const sure = alone.outfit && alone.margin >= CONTEXT_SURE;
    // The pair can only matter when the newest question alone doesn't already say "the current
    // topic"; otherwise the second run is skipped (same answer, half the work).
    if (alone.outfit !== current && !sure) {
      const pair = await classifier.classify(qs.at(-2) + '\n' + qs.at(-1));
      if (!alone.outfit || (pair.outfit && pair.outfit === current)) pick = pair.outfit ? pair : alone;
    }
    if (pick.outfit) { resp.outfit = pick.outfit; resp.score = +pick.score.toFixed(3); }
  }
  if (!resp.outfit) for (let i = qs.length - 1; i >= 0; i--) {
    const r = await classifier.classify(qs[i]);
    if (r.outfit) { resp.outfit = r.outfit; resp.score = +r.score.toFixed(3); break; }
    if (smallTalk(r)) {
      // The conversation turned to small talk here, unless it was about her topic ("那要搬进屋吗" after
      // "明天降温到零下，会冻坏吗" about succulents is still gardening).
      const pair = await inContext(i, r);
      if (pair) { resp.outfit = current; resp.score = +pair.score.toFixed(3); } else resp.everyday = true;
      break;
    }
  }
  return resp;
}

// ---- Keywords: only when the model isn't available ----------------------------------------------
// topics: [{ outfit, zh: [...], en: [...] }]. The topic with the most keyword hits in the text, or null.
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = w => new RegExp(`(^|[^a-z])${escapeRe(w)}(?![a-z])`, 'i');
const matchersOf = new WeakMap();
function matchers(topics) {
  let m = matchersOf.get(topics);
  if (!m) {
    // English words must not be glued to other letters ("art" shouldn't match "start").
    m = topics.map(t => ({ topic: t, zh: t.zh || [], en: (t.en || []).map(wordRe) }));
    matchersOf.set(topics, m);
  }
  return m;
}
export function keywordTopic(topics, text) {
  const lower = String(text).toLowerCase();
  let best = null, bestScore = 0;
  for (const t of matchers(topics)) {
    const score = t.zh.filter(w => lower.includes(w)).length + t.en.filter(re => re.test(lower)).length;
    if (score > bestScore) { best = t.topic; bestScore = score; }
  }
  return best;
}
// Everyday small talk by keywords (the model's EVERYDAY examples, as words): weather, greetings, the
// time, questions about the assistant. Only counts when no topic's keyword matches.
const EVERYDAY_ZH = ['天气', '下雨', '下雪', '带伞', '气温', '降温', '升温', '几度', '冷不冷', '热不热', '刮风', '雾霾',
  '空气质量', '你好', '您好', '早上好', '早安', '晚上好', '晚安', '你是谁', '你叫什么', '几点了', '星期几', '几号', '无聊', '笑话'];
const EVERYDAY_EN = ['weather', 'forecast', 'rain', 'raining', 'snow', 'snowing', 'umbrella', 'temperature', 'sunny', 'windy',
  'hello', 'hi', 'hey', 'good morning', 'good night', 'who are you', 'your name', 'what time', 'what day', 'bored', 'joke'].map(wordRe);
export const keywordEveryday = text => {
  const lower = String(text).toLowerCase();
  return EVERYDAY_ZH.some(w => lower.includes(w)) || EVERYDAY_EN.some(re => re.test(lower));
};
// Newest question first; a follow-up without a topic falls back to the question before it, but not past
// everyday small talk (then null: the everyday look).
export function keywordTopicOf(topics, questions) {
  const qs = (questions || []).slice(-MAX_QUESTIONS);
  for (let i = qs.length - 1; i >= 0; i--) {
    const t = keywordTopic(topics, qs[i]);
    if (t) return t;
    if (keywordEveryday(qs[i])) return null;
  }
  return null;
}
