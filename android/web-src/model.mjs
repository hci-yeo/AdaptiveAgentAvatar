// The local AI topic model on the phone: the same model and rule as the desktop apps and the browser
// extension (EmbeddingGemma 300M, 4-bit, run by transformers.js on WebAssembly). The example
// questions' vectors are computed at build time (bank.json + bank.bin), so only your question runs here.
// Until it has loaded (a few seconds), glue.js uses the keyword lists.
import { AutoTokenizer, AutoModel, env } from './lib/transformers.min.js';

const log = s => { try { AndroidPet.log(String(s)); } catch {} };
const here = path => new URL(path, location.href).href;

// Everything ships inside the app, served at https://appassets.androidplatform.net/web/models/ (the
// app answers that address itself; it has no internet access and refuses every other address).
// transformers.js 4.3 never looks for "local" models at an https:// address, so the app's address is
// set as the "remote" model host instead.
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.remoteHost = here('models/');
env.remotePathTemplate = '{model}/';
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = here('lib/');
// Several threads when the page is cross-origin isolated (the app sends those headers); leave a few
// cores for ChatGPT and the phone.
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated
  ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 2)) : 1;
env.backends.onnx.wasm.proxy = false;

async function load() {
  const t0 = performance.now();
  const [meta, bin] = await Promise.all([
    fetch('bank.json').then(r => r.json()),
    fetch('bank.bin').then(r => r.arrayBuffer()),
  ]);
  const vecs = new Float32Array(bin);
  const dim = meta.dim;
  const bank = meta.labels.map((outfit, i) => ({ outfit, vec: vecs.subarray(i * dim, (i + 1) * dim) }));
  const tokenizer = await AutoTokenizer.from_pretrained(meta.model);
  const model = await AutoModel.from_pretrained(meta.model, { dtype: meta.dtype, model_file_name: meta.fileName, device: 'wasm' });
  const embed = async text => {
    const inputs = await tokenizer([text], { truncation: true });
    const result = await model(inputs);
    const vec = result.sentence_embedding.normalize(2, -1);
    const data = Float32Array.from(vec.data);
    for (const t of [vec, ...Object.values(inputs), ...Object.values(result)]) t?.dispose?.();
    return data;
  };
  const cache = new Map();
  const classify = async text => {
    text = String(text).trim().slice(0, TOPIC_RULE.MAX_CHARS);
    if (cache.has(text)) return cache.get(text);
    const t = performance.now();
    // The same result as every app's (topic-rule.mjs resultOf): outfit null for small talk (everyday: true).
    const r = TOPIC_RULE.resultOf(TOPIC_RULE.rankTopics(await embed(meta.prefix + text), bank));
    log(`model: ${r.outfit ?? 'none'} ${r.score.toFixed(3)} in ${Math.round(performance.now() - t)} ms`);
    if (cache.size > 300) cache.clear();
    cache.set(text, r);
    return r;
  };
  await classify('hello');   // the first run is the slow one: do it now, not on your first question
  window.__topicModel = { ready: true, classify };
  const ms = Math.round(performance.now() - t0), threads = env.backends.onnx.wasm.numThreads;
  log(`topic model ready in ${ms} ms (threads: ${threads}, isolated: ${self.crossOriginIsolated})`);
  try { AndroidPet.timing(JSON.stringify({ kind: 'load', ms, threads })); } catch {}
  window.__host?.modelReady();
}

// Let her appear first: loading the model keeps the phone busy for a few seconds.
setTimeout(() => load().catch(e => {
  log('topic model failed to load, using keywords: ' + (e?.stack || e));
  try { AndroidPet.timing(JSON.stringify({ kind: 'load-failed', error: String(e?.message || e).slice(0, 200) })); } catch {}
}), 2500);
