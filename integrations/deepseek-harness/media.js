/**
 * Serves the experts' clips (./media/<id>_in.webm, <id>_out.webm and the idle
 * loop <id>_idle.webm, for every avatar style: chef, single_chef, fish_chef...)
 * to the page, straight from the AdaptiveAgentAvatar folder's mods/media. They
 * are too large to pack into client.js, so the page fetches them from here.
 *
 * Same scheme as the chat-background bundle: the files are published under a
 * few prefixes, because a desktop shell that serves its own /assets from disk
 * forwards only some surfaces; the page probes them in order and keeps the
 * first that answers `<prefix>/media/manifest.json`.
 */
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MEDIA_PREFIXES = ['/plugins/ai-avatar', '/assets/ai-avatar', '/api/ai-avatar']
// The clips are the AdaptiveAgentAvatar folder's own (mods/media), two levels up: no second copy.
const MEDIA_DIR = fileURLToPath(new URL('../../mods/media/', import.meta.url))
/** Only clip names, one safe path segment: a request can never leave the folder. */
const CLIP = /^[a-z][a-z_]*_(?:in|out|idle)\.webm$/

async function clips() {
  try {
    return (await readdir(MEDIA_DIR)).filter((name) => CLIP.test(name)).sort()
  } catch {
    return []
  }
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('not found')
}

/** One clip, with byte ranges so the video element can stream and restart it. */
async function serveClip(file, req, res) {
  let size
  try { size = (await stat(file)).size } catch { notFound(res); return }
  const headers = { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' }
  const match = /^bytes=(\d*)-(\d*)$/.exec(typeof req.headers.range === 'string' ? req.headers.range.trim() : '')
  const head = req.method === 'HEAD'
  if (match && (match[1] !== '' || match[2] !== '')) {
    const start = match[1] === '' ? Math.max(0, size - Number(match[2])) : Number(match[1])
    const end = match[1] === '' || match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' })
      res.end()
      return
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) })
    if (head) { res.end(); return }
    createReadStream(file, { start, end }).pipe(res)
    return
  }
  res.writeHead(200, { ...headers, 'Content-Length': String(size) })
  if (head) { res.end(); return }
  createReadStream(file).pipe(res)
}

/** The handler for one prefix: `<prefix>/media/manifest.json` or `<prefix>/media/<clip>`. */
export function mediaHandler(base) {
  return async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://x').pathname
    const rest = pathname.slice(base.length)
    if (rest === '/media/manifest.json') {
      const body = JSON.stringify({ base, clips: await clips() })
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': String(Buffer.byteLength(body)) })
      res.end(body)
      return
    }
    const name = rest.startsWith('/media/') ? rest.slice('/media/'.length) : ''
    if (!CLIP.test(name)) { notFound(res); return }
    await serveClip(join(MEDIA_DIR, name), req, res)
  }
}
