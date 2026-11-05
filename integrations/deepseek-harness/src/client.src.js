// Client half of the AI avatar bundle: runs the shared avatar from the Doubao avatar project
// (mods/30-avatar.js and the other mods, with their pictures, clips and topics), the same one
// Doubao, Codex, Yuanbao, the desktop pet and the Chrome extension run. So she looks and behaves
// the same everywhere: size and corner, idle loop, walk-in / walk-out, the three avatar styles,
// her reactions while DSH answers, the right-click menu and the rainbow chat box.
//
// build.mjs fills in the __PLACEHOLDERS__ from that project (and DSH's page description,
// src/dsh-page.mjs). Change the avatar there, then rebuild here: node build.mjs.
//
// In the desktop apps a background watcher answers the avatar's three requests over DevTools. In
// DSH this file answers them through the Host half (index.js), on DSH's own server:
//   window.__doubaoTopic(json {id, questions, current}) -> the topic route (the local model)
//   window.__doubaoMedia(json {id, name})                -> a clip from the media route
//   window.__doubaoPet(json)                             -> the pet route (DSH's own desktop pet)
// They reply through the avatar's M.onTopic / M.onMedia / M.onPetMode, as the watcher does.
//
// DSH's own extras (reply tiles, "Inside" mode, the mode pill, its large portrait) were removed
// so every app matches; they're kept in backups/2026-11-01-own-avatar.
window.__ModuleLoader__.load({
  id: '@local/ai-avatar',
  factory() {
    // ASSETS, TOPICS, MEDIA, CLIP_TRIMS, APP, PET, TOPIC_RULE: the same as in every app (avatar-bundle.mjs).
    __CONSTANTS__

    const TOPIC_ROUTE = 'api/local.ai-avatar.topic'
    const PET_ROUTE = 'api/local.ai-avatar.pet'
    const MEDIA_BASES = ['/plugins/ai-avatar', '/assets/ai-avatar', '/api/ai-avatar']
    const mods = () => window.__doubaoMods

    // ---- Running the avatar -------------------------------------------------------------------
    // Same steps as the watcher's injection: undo the previous run, then apply. It runs again
    // when pet mode is switched (as the watcher re-injects then), with the new PET. null: remove.
    let pet = null
    function run(PET) {
      __PRELUDE__
      if (PET === null) return
      __APPLY__
    }

    // ---- Routes on DSH's server ---------------------------------------------------------------
    function post(route, body) {
      return fetch(new URL(route, document.baseURI).toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then((response) => (response.ok ? response.json() : null)).catch(() => null)
    }

    // ---- Topics ---------------------------------------------------------------------------------
    // The local model on DSH's server (index.js) picks the topic, in tens of milliseconds, on this PC,
    // with the same topic list and rule as the desktop apps' watcher: it gets the conversation's
    // questions and the expert showing now, so a follow-up ("how long should I practise?") keeps her.
    // As in every app: no topic is her everyday look; "not ready" (the model is loading, off, or failed
    // to load) lets her use her keyword lists for this question.
    const known = (outfit) => TOPICS.some((t) => t.outfit === outfit)
    window.__doubaoTopic = (json) => {
      let req
      try { req = JSON.parse(json) } catch { return }
      const questions = (Array.isArray(req.questions) ? req.questions : []).slice(-6).map((q) => String(q).slice(0, 2000))
      const current = typeof req.current === 'string' ? req.current : null
      post(TOPIC_ROUTE, { method: 'local', questions, current }).then((r) => {
        if (!r?.ok) { mods()?.onTopic?.({ id: req.id, ready: false }); return }
        mods()?.onTopic?.({ id: req.id, ready: true, outfit: r.outfit && known(r.outfit) ? r.outfit : null })
      })
    }

    // ---- Clips ------------------------------------------------------------------------------------
    // The Host half serves them under one of a few prefixes (see media.js); the first that answers
    // is kept. The avatar gets the clip itself (it shares this page's JavaScript).
    let mediaBase = null
    async function findMedia() {
      if (mediaBase !== null) return mediaBase
      for (const base of MEDIA_BASES) {
        try {
          const response = await fetch(`${base}/media/manifest.json`, { cache: 'no-store' })
          if (response.ok && Array.isArray((await response.json())?.clips)) return (mediaBase = base)
        } catch { /* try the next */ }
      }
      return null
    }
    window.__doubaoMedia = async (json) => {
      let req
      try { req = JSON.parse(json) } catch { return }
      let blob = null
      try {
        const base = MEDIA.includes(req.name) ? await findMedia() : null
        const response = base && await fetch(`${base}/media/${req.name}`)
        if (response?.ok) blob = await response.blob()
      } catch { /* she fades instead of walking */ }
      mods()?.onMedia?.({ id: req.id, name: req.name, blob })
    }

    // ---- Pet mode -----------------------------------------------------------------------------
    // DSH's own desktop pet (pet.js in the Host half runs the Doubao project's pet program). Off by
    // default; right-click her > Float on the desktop, and the pet's menu brings her back. While
    // it's on, the avatar here hides and tells the pet only her topic, style and the answer phase.
    function applyPet(info) {
      if (!info || typeof info.on !== 'boolean') return
      for (const notice of Array.isArray(info.notices) ? info.notices : []) mods()?.onPetMode?.(notice)
      const next = { on: info.on, available: info.available === true }
      if (pet && next.on === pet.on && next.available === pet.available) return
      pet = next
      run(pet)
    }
    window.__doubaoPet = (json) => {
      let msg
      try { msg = JSON.parse(json) } catch { return }
      if (msg.type === 'state') {
        post(PET_ROUTE, { type: 'state', outfit: msg.outfit ?? null, phase: msg.phase, look: msg.look ?? null, ring: msg.ring ?? null })
      } else if (msg.type === 'mode') {
        post(PET_ROUTE, { type: 'mode', on: msg.on === true }).then((info) => {
          if (info && info.ok === false && info.error) mods()?.onPetMode?.({ error: info.error })
          applyPet(info)
        })
      } else if (msg.type === 'setup') {
        // Electron is installed once, in the Doubao project's pet/ folder, from any of its avatars.
        mods()?.onPetMode?.({ error: 'Pet mode needs a one-time setup: switch it on once from the Doubao, Codex or Yuanbao avatar.' })
      }
    }

    return {
      inject: [],
      apply(ctx) {
        // Start with pet mode as it was (one quick question to the Host half); if that fails, she
        // starts in the window with pet mode unavailable.
        let alive = true
        post(PET_ROUTE, { type: 'info' }).then((info) => {
          if (!alive) return
          if (info && typeof info.on === 'boolean') applyPet(info)
          else { pet = { on: false, available: false }; run(pet) }
        })
        // While she's on the desktop: did the pet's own menu bring her back, or change a setting?
        const timer = setInterval(() => {
          if (pet?.on) post(PET_ROUTE, { type: 'info' }).then((info) => { if (alive) applyPet(info) })
        }, 3000)
        findMedia()
        ctx.effect(() => () => {
          alive = false
          clearInterval(timer)
          run(null)
          for (const name of ['__doubaoTopic', '__doubaoMedia', '__doubaoPet']) delete window[name]
        })
      },
    }
  },
})
