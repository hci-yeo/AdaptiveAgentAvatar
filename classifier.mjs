// Local AI topic classifier: compares the meaning of a question with each topic's example
// questions (topics.mjs) using a multilingual embedding model that runs on the CPU (EmbeddingGemma by
// default, see MODELS). Bundled models ship in .\models; the others download once and then work offline.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat, mkdir, rename, open } from 'node:fs/promises';
import { pipeline, AutoTokenizer, AutoModel, env } from '@huggingface/transformers';
// The topic rule, the scoring and the limits are shared with every app (topic-rule.mjs).
import { pickTopicWith, CONTEXT_SURE, MAX_CHARS, rankTopics, resultOf, EVERYDAY } from './topic-rule.mjs';
export { pickTopicWith, CONTEXT_SURE };

const ROOT = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = join(ROOT, 'models');
// We download the files ourselves (see ensureModel) and load them from disk only.
env.localModelPath = MODELS_DIR;
env.allowRemoteModels = false;

// ModelScope is a China mirror and much faster from mainland China; Hugging Face is the fallback.
const SOURCES = [
  (id, f) => `https://www.modelscope.cn/models/${id}/resolve/master/${f}`,
  (id, f) => `https://huggingface.co/${id}/resolve/main/${f}`,
];
const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];

const sizeOf = p => stat(p).then(s => s.size, () => 0);

// Download one file with resume (Range) and retries, trying each source in turn.
async function download(id, file, log) {
  const dest = join(MODELS_DIR, id, file);
  if (await sizeOf(dest) > 0) return;
  await mkdir(dirname(dest), { recursive: true });
  const part = dest + '.part';
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = SOURCES[attempt % SOURCES.length](id, file);
    try {
      const have = await sizeOf(part);
      const res = await fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: AbortSignal.timeout(15 * 60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const append = have > 0 && res.status === 206;
      const total = Number(res.headers.get('content-length') || 0) + (append ? have : 0);
      const fh = await open(part, append ? 'a' : 'w');
      let got = append ? have : 0, lastLog = Date.now();
      try {
        for await (const chunk of res.body) {
          await fh.write(chunk);
          got += chunk.length;
          if (Date.now() - lastLog > 5000) { log(`  ${file}: ${(got / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB`); lastLog = Date.now(); }
        }
      } finally { await fh.close(); }
      if (total && got < total) throw new Error(`incomplete (${got}/${total})`);
      await rename(part, dest);
      return;
    } catch (e) {
      lastErr = e;
      log(`  ${file}: ${e.message} from ${new URL(url).host}, retrying`);
    }
  }
  throw new Error(`Could not download ${id}/${file}: ${lastErr?.message}`);
}

export async function ensureModel(id, log = console.log) {
  for (const f of MODEL_FILES) await download(id, f, log);
}

// Models we know how to use. `prefix` is what the model expects before a sentence.
// `keywordBonus` is the small boost a topic gets when its keywords appear (topics.mjs zh/en):
// enough to break a near-tie, too small to override a clear decision. It helped bge-small-zh
// (46 -> 48 of 57 in tools/topic-eval.mjs) but slightly hurt e5-small (54 -> 53), so it's off there.
// `bundled` models ship inside the project folder (built by tools/trim-vocab.py), so nothing downloads.
export const MODELS = {
  'bge-small-zh': { id: 'Xenova/bge-small-zh-v1.5', prefix: '', keywordBonus: 0.04 },   // ~25 MB, Chinese-focused
  'e5-small': { id: 'Xenova/multilingual-e5-small', prefix: 'query: ', keywordBonus: 0 }, // ~118 MB, ~100 languages
  // e5-small with its vocabulary cut down to Chinese + English: same answers, much less memory.
  'e5-small-zh-en': { id: 'local/multilingual-e5-small-zh-en', prefix: 'query: ', keywordBonus: 0, bundled: true },
  // Google's EmbeddingGemma (300M), 4-bit, with its vocabulary cut to Chinese + English
  // (262,144 -> 123,686 pieces; tools/gemma-keep.py + tools/trim-gemma.py): the default since the
  // stress test (tools/topic-stress/): 90% of 748 blind topic questions right vs 70% for e5-small,
  // 93% vs 81% in whole conversations, and the same scores as the untrimmed model. 131 MB file,
  // ~350-570 MB memory, 15-50 ms per question on the CPU. It comes with its own sentence head
  // (sentence_embedding output), so it runs through AutoModel instead of the pipeline.
  // One file for everything (desktop, browser extension, DeepSeek Harness plugin): model_web_q4.onnx
  // looks words up with plain operations every engine has (browsers lack GatherBlockQuantized), from
  // the same 4-bit table; same numbers and, on the desktop, the same speed as the GatherBlockQuantized file.
  // Licensed under the Gemma Terms of Use (NOTICE.txt and GEMMA_TERMS.txt in its folder).
  'gemma-300m': { id: 'local/embeddinggemma-300m-zh-en', prefix: 'task: classification | query: ', keywordBonus: 0,
    bundled: true, gemma: true, dtype: 'q4', modelFileName: 'model_web', file: 'onnx/model_web_q4.onnx' },
  // The untrimmed original (models/onnx-community/embeddinggemma-300m-ONNX), for comparison.
  'gemma-300m-full': { id: 'onnx-community/embeddinggemma-300m-ONNX', prefix: 'task: classification | query: ', keywordBonus: 0,
    bundled: true, gemma: true, dtype: 'q4', file: 'onnx/model_q4.onnx' },
};

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function keywordMatcher(t) {
  const en = (t.en || []).map(w => new RegExp(`(^|[^a-z])${escapeRe(w)}(?![a-z])`, 'i'));
  return lower => (t.zh || []).some(w => lower.includes(w)) || en.some(re => re.test(lower));
}

// Build a classifier. Returns { classify(text) -> { outfit, score, margin } | { outfit: null, ... } }.
//   noTopicExamples: follow-ups without a topic of their own (the expert stays; topics.mjs NO_TOPIC_EXAMPLES)
//   everydayExamples: everyday small talk (the everyday look; topics.mjs EVERYDAY_EXAMPLES); a question
//                     closest to them answers { outfit: null, everyday: true, ... }
//   minScore: below this similarity nothing matches well enough -> no topic
//   minMargin: best topic must beat the runner-up by this much -> otherwise too ambiguous
//   prefix, maxChars: override the model's prompt prefix / the question length read (for tests)
//   everydaySure: how clearly small talk must win (topic-rule.mjs EVERYDAY_SURE; for tests)
export async function createClassifier({ model = 'e5-small', topics, noTopicExamples = [], everydayExamples = [], everydaySure, minScore = 0, minMargin = 0, useKeywords = true, log = console.log, prefix, maxChars = MAX_CHARS } = {}) {
  const base = MODELS[model];
  if (!base) throw new Error(`Unknown model ${model}`);
  const spec = prefix === undefined ? base : { ...base, prefix };
  if (!spec.bundled) await ensureModel(spec.id, log);
  else if (!(await sizeOf(join(MODELS_DIR, spec.id, spec.file || 'onnx/model_quantized.onnx'))))
    throw new Error(`Bundled model ${spec.id} is missing from models\\`);

  let embed;
  if (spec.gemma) {
    const tokenizer = await AutoTokenizer.from_pretrained(spec.id);
    const net = await AutoModel.from_pretrained(spec.id, { dtype: spec.dtype, ...(spec.modelFileName ? { model_file_name: spec.modelFileName } : {}) });
    embed = async texts => {
      const out = [];
      for (let i = 0; i < texts.length; i += 16) {
        const inputs = await tokenizer(texts.slice(i, i + 16).map(t => spec.prefix + t), { padding: true, truncation: true });
        const result = await net(inputs);
        const vecs = result.sentence_embedding.normalize(2, -1);
        out.push(...vecs.tolist());
        for (const t of [vecs, ...Object.values(inputs), ...Object.values(result)]) t?.dispose?.(); // free native memory now
      }
      return out;
    };
  } else {
    const embedder = await pipeline('feature-extraction', spec.id, { dtype: 'q8' });
    embed = async texts => {
      const out = await embedder(texts.map(t => spec.prefix + t), { pooling: 'mean', normalize: true });
      return out.tolist();
    };
  }

  // Every example becomes a vector, labelled with its topic (null = a follow-up, EVERYDAY = small talk).
  const groups = [...topics.map(t => ({ outfit: t.outfit, examples: t.examples })), { outfit: null, examples: noTopicExamples },
    { outfit: EVERYDAY, examples: everydayExamples }];
  const bank = [];
  for (const g of groups) {
    if (!g.examples.length) continue;
    for (const vec of await embed(g.examples)) bank.push({ outfit: g.outfit, vec });
  }

  const hasKeyword = new Map(topics.map(t => [t.outfit, keywordMatcher(t)]));
  const bonus = useKeywords ? spec.keywordBonus : 0;

  const cache = new Map();
  async function classify(text) {
    text = text.trim().slice(0, maxChars);
    if (cache.has(text)) return cache.get(text);
    const lower = text.toLowerCase();
    const [q] = await embed([text]);
    // Each topic scores by its two closest examples (topic-rule.mjs, the same in every app).
    const ranked = rankTopics(q, bank, outfit => (outfit && hasKeyword.has(outfit) && bonus && hasKeyword.get(outfit)(lower) ? bonus : 0));
    // { outfit, score, margin, scores, everyday? } (topic-rule.mjs resultOf, the same in every app)
    let result = resultOf(ranked, everydaySure);
    if (result.outfit && (result.score < minScore || result.margin < minMargin))
      result = { ...result, outfit: null, nearest: result.outfit };
    if (cache.size > 500) cache.clear();
    cache.set(text, result);
    return result;
  }

  return { classify, model };
}
