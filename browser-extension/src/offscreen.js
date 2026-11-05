// The local AI topic model in the browser: the same model as the desktop apps (EmbeddingGemma 300M,
// 4-bit, run here by transformers.js on WebAssembly or WebGPU) and the same topic rule, scoring and
// limits (topic-rule.mjs, the very file every app uses; build.mjs copies it next to this one). The
// examples' vectors are computed at build time (bank.json + bank.bin), so only the question runs here.
import { AutoTokenizer, AutoModel, env } from './lib/transformers.min.js';
import { pickTopicWith, rankTopics, resultOf, MAX_CHARS } from './topic-rule.mjs';

env.allowRemoteModels = false;               // everything ships inside the extension
env.allowLocalModels = true;
env.localModelPath = chrome.runtime.getURL('models/');
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('lib/');
// Several CPU threads when the page is cross-origin isolated (the manifest turns that on); else one.
// Leave a core or two for the browser and the chat page.
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated
  ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 2)) : 1;
env.backends.onnx.wasm.proxy = false;

const ready = (async () => {
  const [meta, bin] = await Promise.all([
    fetch('bank.json').then(r => r.json()),
    fetch('bank.bin').then(r => r.arrayBuffer()),
  ]);
  const vecs = new Float32Array(bin);
  const dim = meta.dim;
  const bank = meta.labels.map((outfit, i) => ({ outfit, vec: vecs.subarray(i * dim, (i + 1) * dim) }));
  const tokenizer = await AutoTokenizer.from_pretrained(meta.model);
  // The graphics card (WebGPU) when the browser offers it: much faster than the one-thread CPU engine
  // extension pages get. Otherwise the CPU (WebAssembly).
  let model = null, device = 'wasm';
  if (navigator.gpu && await navigator.gpu.requestAdapter().catch(() => null)) {
    model = await AutoModel.from_pretrained(meta.model, { dtype: meta.dtype, model_file_name: meta.fileName, device: 'webgpu' })
      .then(m => { device = 'webgpu'; return m; }, e => { console.warn('[avatar] WebGPU unavailable, using the CPU:', e?.message); return null; });
  }
  model ||= await AutoModel.from_pretrained(meta.model, { dtype: meta.dtype, model_file_name: meta.fileName, device: 'wasm' });
  console.log(`[avatar] topic model ready on ${device} (CPU threads: ${env.backends.onnx.wasm.numThreads}, isolated: ${self.crossOriginIsolated})`);
  const embed = async text => {
    const inputs = await tokenizer([text], { truncation: true });
    const result = await model(inputs);
    const vec = result.sentence_embedding.normalize(2, -1);
    const data = Float32Array.from(vec.data);
    for (const t of [vec, ...Object.values(inputs), ...Object.values(result)]) t?.dispose?.();
    return data;
  };
  return { bank, embed, prefix: meta.prefix };
})();
ready.catch(e => console.error('[avatar] topic model failed to load:', e));

const cache = new Map();

async function classify(text) {
  text = String(text).trim().slice(0, MAX_CHARS);
  if (cache.has(text)) return cache.get(text);
  const { bank, embed, prefix } = await ready;
  // { outfit, score, margin, everyday? }: the same reading of the scores as every app (topic-rule.mjs)
  const result = resultOf(rankTopics(await embed(prefix + text), bank));
  if (cache.size > 500) cache.clear();
  cache.set(text, result);
  return result;
}

// The conversation's topic, by the rule every app uses (topic-rule.mjs pickTopicWith).
async function answer(questions, current) {
  const r = await pickTopicWith({ classify }, questions || [], current);
  return { ready: true, outfit: r.outfit, ...(r.score != null ? { score: r.score } : {}) };
}

let loaded = false;
ready.then(() => { loaded = true; }, () => {});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.to !== 'offscreen' || msg.type !== 'classify') return;
  // While the model is still loading, say so: the avatar then uses its keyword lists at once.
  if (!loaded) { sendResponse({ ready: false }); return; }
  answer(msg.questions, msg.current ?? null).then(sendResponse, () => sendResponse({ ready: false }));
  return true;
});
