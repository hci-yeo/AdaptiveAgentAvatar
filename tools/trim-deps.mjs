// Runs after `npm install` (package.json "postinstall"): deletes the parts of our dependencies this
// project never uses on this PC, cutting node_modules from ~470 MB to ~90 MB.
//  - ONNX Runtime builds for other operating systems / CPU types
//  - ONNX Runtime's GPU (DirectML) files: the topic model runs on the CPU
//  - onnxruntime-web: the browser build (Node uses onnxruntime-node)
//  - sharp's WebAssembly/other-platform image binaries (sharp itself must stay: transformers.js
//    imports it at startup, though we never process images)
import { rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NM = fileURLToPath(new URL('../node_modules/', import.meta.url));
const plat = process.platform, arch = process.arch;
const removed = [];
const remove = async p => { await rm(p, { recursive: true, force: true }); removed.push(p.slice(NM.length)); };
const dirs = async p => (await readdir(p, { withFileTypes: true }).catch(() => [])).filter(e => e.isDirectory()).map(e => e.name);

const bin = join(NM, 'onnxruntime-node', 'bin', 'napi-v6');
for (const p of await dirs(bin)) {
  if (p !== plat) { await remove(join(bin, p)); continue; }
  for (const a of await dirs(join(bin, p))) if (a !== arch) await remove(join(bin, p, a));
}
if (plat === 'win32') for (const f of ['DirectML.dll', 'dxcompiler.dll', 'dxil.dll']) {
  const file = join(bin, plat, arch, f);
  if ((await readdir(join(bin, plat, arch)).catch(() => [])).includes(f)) await remove(file);
}
await remove(join(NM, 'onnxruntime-web'));
for (const d of await dirs(join(NM, '@img'))) {
  if (d !== 'colour' && !d.includes(`${plat}-${arch}`)) await remove(join(NM, '@img', d));
}

console.log(`trim-deps: removed ${removed.length} unused folders/files (${removed.join(', ') || 'nothing'})`);
