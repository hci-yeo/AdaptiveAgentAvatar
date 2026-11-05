// Avatar mod: an expert standing in the corner left of the chat input. When the topic of your
// questions changes, the current expert walks out and the matching one walks in
// (food -> chef, coding -> programmer, space -> astronaut, ...).
//
// While the AI answers she reacts: a glow and a thought cloud (thinking, then writing), and a nod
// with sparkles when it's done (see "Reacting while the AI answers").
//
// Right-click her to pick an expert or a style (a plain click does nothing; that used to bring in
// the next expert).
//
// Where she stands: bottom left by default. Right-click her to pick another corner, or drag her
// anywhere; the choice is remembered per app (localStorage).
// Or in the AI's replies (right-click > In the AI's replies): see "In the AI's replies" below.
//
// Pet mode (off by default; right-click > "Float on the desktop"): she moves out of the app into a
// small see-through window on the desktop (pet/, run by the watcher). This same file runs there too,
// with APP.id 'pet'. Meanwhile the in-app copy hides and passes on only which topic and whether the
// AI is answering (window.__doubaoPet), never chat text.
//
// Topic detection: asks the local AI model running in the background watcher (classifier.mjs)
// through window.__doubaoTopic. If that isn't available or doesn't answer in time, it falls back
// to the keyword lists. Topics, experts and keywords live in topics.mjs (injected as TOPICS).
//
// Pictures: mods/assets/expert-<name>.webp (embedded, ASSETS). Walk clips: mods/media/<name>_in.webm
// and <name>_out.webm, too big to embed, so they're requested one at a time from the watcher through
// window.__doubaoMedia (names listed in MEDIA), as is her idle loop while standing (<name>_idle.webm,
// blinking and breathing). All are built from ..\16avatars by tools/make-experts-birefnet.py.

const EVERYDAY_BASE = 'casual';   // who stands there for new chats and off-topic messages
const PLAYBACK_RATE = 1.6;   // walk speed: the clips are 4 s each

// Her words in English or Chinese: LANG (avatar-bundle.mjs) is the tray's choice on the desktop, else
// the page's own display language. tr(english, chinese).
const ZH = typeof LANG !== 'undefined' && LANG === 'zh';
const tr = (en, zh) => (ZH ? zh : en);
// App names in Chinese, where the app has one (the pet's name tag and menu).
const APP_ZH = { Doubao: '豆包', Yuanbao: '元宝', Qianwen: '千问' };
// Expert names in Chinese (her menu's faces), by expert id without the style prefix.
const EXPERT_ZH = { casual: '日常', programmer: '程序员', chef: '厨师', doctor: '医生', writer: '作家', artist: '画家',
  scientist: '科学家', teacher: '老师', business: '商务', lawyer: '律师', athlete: '运动员', musician: '音乐人',
  explorer: '探险家', traveler: '探险家', astronaut: '宇航员', engineer: '工程师', gamer: '玩家', gardener: '园艺师' };

// Two avatar styles (right-click menu, remembered per app):
//  - people: a different person for each topic, who walks out and in (..\16avatars)
//  - single: one person who changes outfits; she spins and fades away, and comes back in the new
//    outfit (..\single_agent; built with --change --prefix single_: the leaving clip is the change
//    video forward, the arriving one the same video backward)
//  - fish: Whale Girl (大肥鱼), a cute chibi fish girl who changes outfits the same way (..ish; built the same way with
//    --prefix fish_ and a wider --crop). She's shown whole, head to tail, so her clips are wider and
//    get no edge fades (whole: true): those only hide the people's waist cut-off and crop edges.
// Expert ids carry the style's prefix ('chef' / 'single_chef'), so both sets of pictures and clips
// sit side by side and a change of style is just a change of expert.
const LOOKS = {
  people: { prefix: '', label: tr('Different people', '不同的人') },
  single: { prefix: 'single_', label: tr('One person, changing outfits', '同一个人换装'), name: ['Mandy', '小曼'] },
  fish: { prefix: 'fish_', label: tr('Whale Girl, changing outfits', '大肥鱼换装'), name: ['Whale Girl', '大肥鱼'], whole: true },
};
// Her name, on a small plate under her (and in a reply's tag). The one-person and Whale Girl styles
// are one character in every outfit (name above); each expert of "different people" has her own,
// chosen to suit her look: [English, Chinese], by expert id without the style prefix.
const PEOPLE_NAMES = {
  casual: ['Yoyo', '悠悠'], chef: ['Lucía', '露西亚'], doctor: ['Priya', '普丽娅'], teacher: ['Wendy', '文文'],
  programmer: ['Ada', '艾达'], artist: ['Xiaohui', '小绘'], scientist: ['Amara', '阿玛拉'], business: ['Jiayi', '佳怡'],
  lawyer: ['Claire', '克莱尔'], athlete: ['Zola', '佐拉'], musician: ['Melody', '音音'], explorer: ['Marisol', '玛丽索'],
  traveler: ['Marisol', '玛丽索'], astronaut: ['Stella', '星遥'], engineer: ['Noor', '努尔'], gamer: ['Momo', '桃桃'],
  gardener: ['Daisy', '黛西'],
};
const LOOK_KEY = `doubao-mods-avatar-look:${APP.id}`;
let look = 'people';
try { const saved = localStorage.getItem(LOOK_KEY); if (LOOKS[saved]) look = saved; } catch {}
// The topic comes from the local AI model; the keyword lists are used only when it isn't available:
// it says it's still loading or couldn't load (ready: false), the app has no model at all, or no answer
// comes back within this long (the connection to it is gone). A slow answer is waited for.
const AI_NO_REPLY_MS = 15000;

// ---------------------------------------------------------------------------------------------
// Keyword fallback, only while the AI model isn't available: topic-rule.mjs (TOPIC_RULE), the same
// in every app. Newest question first; a follow-up without a topic falls back to the one before it.
// ---------------------------------------------------------------------------------------------

const keywordTopic = text => TOPIC_RULE.keywordTopic(TOPICS, text);
const keywordTopicOf = questions => TOPIC_RULE.keywordTopicOf(TOPICS, questions);

// Where things are differs per app (apps.mjs, injected as APP). Some apps keep hidden copies of
// their UI (e.g. Codex's other tabs), so only visible elements count.
const isVisible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
// A selector list's parts ("a, b:not(c, d)" -> ["a", "b:not(c, d)"]): commas inside brackets stay.
function splitSelectors(list) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { parts.push(list.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(list.slice(start).trim());
  return parts.filter(Boolean);
}
const firstVisible = sel => [...document.querySelectorAll(sel)].find(isVisible) || null;

// The user's own messages in the open chat, oldest first. A site with no known message markers (one
// added by the user in the browser extension) supplies them itself instead: M.sentQuestions(), the
// questions as they were sent from its chat box.
function userQuestions() {
  if (typeof M.sentQuestions === 'function') return M.sentQuestions();
  if (!APP.userMessages) return [];
  return [...document.querySelectorAll(APP.userMessages)].filter(isVisible)
    .map(e => e.innerText.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------------------------
// Experts
// ---------------------------------------------------------------------------------------------

// Portrait (menu faces), or her standing picture where there's no portrait (the single set).
const stillOf = expert => ASSETS[`expert-${expert}.webp`] || ASSETS[`expert-${expert}-stand.webp`] || null;
const standOf = expert => ASSETS[`expert-${expert}-stand.webp`] || null;     // last frame of her walk-in
const lookAvailable = k => !!LOOKS[k] && !!stillOf(LOOKS[k].prefix + EVERYDAY_BASE);
if (!lookAvailable(look)) look = 'people';
let PREFIX = LOOKS[look].prefix;
let EVERYDAY = PREFIX + EVERYDAY_BASE;
if (!stillOf(EVERYDAY)) return;
// 'single_chef' -> 'chef'
// Whole-body characters (head to tail in view): no edge fades on their pictures and clips.
// A whole-body character is drawn this much bigger than her box (in a frame centred at its bottom):
// her clips are wider than the box, so fitted to it she'd look small next to the people.
const WHOLE_SCALE = 1.69;   // 1.3 x 1.3
// The people's pictures and clips are cut wider than her box (672 px wide instead of 512, so hands
// and props aren't cut off). Her box keeps the old shape, so her size and every layout stay the same;
// the extra strip on each side hangs outside the box (their pictures are drawn in a frame this much
// wider than the box, centred on it).
const WIDE = 672 / 512;
// Where a picture sits in a w x h box: object-fit contain, at the bottom (and scaled up if whole).
function picRect(w, h, nw, nh, whole) {
  const k = whole ? WHOLE_SCALE : 1, s = Math.min(w * (whole ? WHOLE_SCALE : WIDE) / nw, h * k / nh), dw = nw * s, dh = nh * s;
  return { dx: (w - dw) / 2, dy: h - dh, dw, dh };
}
const isWhole = id => Object.values(LOOKS).some(l => l.whole && !!id?.startsWith(l.prefix));
const baseOf = id => { for (const l of Object.values(LOOKS)) if (l.prefix && id?.startsWith(l.prefix)) return id.slice(l.prefix.length); return id; };
// Her own name: 'chef' -> 'Lucía', 'single_chef' -> 'Mandy' (in the menu's language), '' if none.
// (nameOf, further down, is her job: 'Chef'.)
const personName = id => {
  const n = Object.values(LOOKS).find(l => l.prefix && id?.startsWith(l.prefix))?.name || PEOPLE_NAMES[baseOf(id)];
  return n ? tr(n[0], n[1]) : '';
};
const topicByOutfit = outfit => TOPICS.find(t => t.outfit === outfit) || null;
// The expert for a topic in the current style, or null if there's no artwork for them (then the
// everyday look + emoji).
const expertOf = topic => {
  if (!topic) return null;
  const id = PREFIX + (topic.expert || topic.outfit);
  return stillOf(id) ? id : null;
};

// Click-to-cycle list: the everyday look plus every expert some topic uses.
const makeLineup = () => [EVERYDAY, ...new Set(TOPICS.map(expertOf).filter(e => e && e !== EVERYDAY))];
let lineup = makeLineup();

const M = window.__doubaoMods;
let timer, bubbleTimer, aiTimer;
// Who is standing there and which question she was picked for, kept on the page across mod reloads
// (e.g. after editing a mod file), so a reload doesn't reset her to the everyday look and walk
// the wrong expert out next time.
const kept = M.avatar || (M.avatar = {});
const START = kept.shown && stillOf(kept.shown) ? kept.shown : EVERYDAY;

// IN_PET: this copy runs in the desktop pet window. petOn: in an app window, the pet is showing, so
// this copy stays hidden and passes her state on. (PET comes from the watcher; older payloads lack it.)
const IN_PET = APP.id === 'pet';
const PET_INFO = typeof PET !== 'undefined' ? PET : { on: false, available: false };
const petOn = !IN_PET && !!PET_INFO.on;
// Hidden in this app (right-click > Hide the avatar in this app; the tray icon or Alt+Shift+H brings
// her back). Per app, kept in the page. Only her: the rainbow chat box has its own switch.
const HIDE_KEY = `doubao-mods-avatar-hidden:${APP.id}`;
let hiddenHere = false;
if (!IN_PET) try { hiddenHere = localStorage.getItem(HIDE_KEY) === '1'; } catch {}

// Registered straight away (not just returned at the end), so even if something below throws,
// the next reload still removes this avatar.
function cleanup() {
  clearInterval(timer);
  clearTimeout(bubbleTimer);
  clearTimeout(aiTimer);
  clearTimeout(doneTimer);
  // Each step on its own: if setup crashed partway, later things may not exist yet.
  for (const step of [
    () => clearTimeout(leaveTimer),
    () => removeEventListener('resize', place),
    () => closeMenu(),
    () => video.pause(),
    () => idle.pause(),
    () => document.removeEventListener('visibilitychange', onVisibility),
    () => { for (const e of STIR_EVENTS) removeEventListener(e, stirred, { capture: true }); },
    () => insideWatch.disconnect(),
    () => setFollowScroller(null),
    () => removeEventListener('keydown', onFollowKey, true),
    () => removeEventListener('pointerdown', onFollowPointer, true),
    () => removeEventListener('keydown', onHideKey, true),
    () => removeEventListener('keydown', onSendKey, true),
    () => removeEventListener('click', onSendClick, true),
    () => showBtn.remove(),
    () => clearPanels(),
    () => box.remove(),
    () => style.remove(),
    () => document.documentElement.style.removeProperty('--doubao-avatar-room'),
    () => { clearTimeout(slideTimer); document.documentElement.removeAttribute('data-doubao-mods-sliding'); },
    () => document.documentElement.style.removeProperty('--doubao-avatar-scale'),
    () => { for (const p of clips.values()) p.then(u => u && URL.revokeObjectURL(u)); },
  ]) { try { step(); } catch {} }
  if (M.generation === GEN) { delete M.onTopic; delete M.onMedia; delete M.keywordTopic; delete M.onPetMode; delete M.debugCelebrate; delete M.debugInside; delete M.avatarHidden; delete M.setAvatarHidden; }
}
M.cleanups.push(cleanup);

const style = document.createElement('style');
style.id = 'doubao-mods-avatar-style';
style.textContent = `
  #doubao-mods-avatar {
    /* Low, so the app's own menus and popups show above her; an app whose chat box sits on a higher
       layer says so (APP.zIndex: Qianwen's white panel behind its box is at 999). */
    position: fixed; z-index: ${Number(APP.zIndex) || 20}; display: none; cursor: grab; user-select: none;
    transform-origin: 50% 100%;
    /* Breathing, same as the DSH avatar: a slow 7 s rise of 3 px with a hint of growth. */
    animation: doubao-avatar-breathe 7s ease-in-out infinite;
    /* Keep her on her own GPU layer so the tiny rise moves in sub-pixel steps instead of jumping
       a whole pixel now and then (that looked like stuttering). */
    will-change: transform;
    backface-visibility: hidden;
  }
  /* Picture and walk clip are stacked; transparent backgrounds, waist cut-off faded out. The last 3 px
     are fully clear: the breathing moves her by fractions of a pixel, and at larger sizes the idle
     loop's bottom row showed as a thin dark line at her box's bottom edge. */
  #doubao-mods-avatar img, #doubao-mods-avatar video, #doubao-mods-avatar canvas {
    /* WIDE times the box's width, centred on it (see WIDE) */
    position: absolute; top: 0; left: ${-(WIDE - 1) * 50}%; width: ${WIDE * 100}%; height: 100%;
    max-width: none; max-height: none;   /* Doubao's page caps img/video at max-width: 100% */
    object-fit: contain; object-position: bottom; display: block; pointer-events: none;
    -webkit-mask-image: linear-gradient(to top, transparent 0, transparent 3px, #000 22%);
    mask-image: linear-gradient(to top, transparent 0, transparent 3px, #000 22%);
    /* outside the mask is clear, not the mask again: drawn a fraction of a pixel bigger while she
       breathes, the clip used to show one opaque row past her bottom edge (a thin dark line) */
    -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  }
  /* Chrome shrinks pictures with a soft, high-quality filter (softer still on the breathing GPU
     layer), while video is scaled crisply, so the standing picture looked blurrier than the clip it
     was cut from. This scaling mode matches the video's sharpness (measured: 211 -> 652, video 636). */
  #doubao-mods-avatar img, #doubao-mods-avatar canvas { image-rendering: -webkit-optimize-contrast; }
  #doubao-mods-avatar img { transition: transform .25s ease, opacity .25s ease; }
  #doubao-mods-avatar video, #doubao-mods-avatar canvas { opacity: 0; transition: transform .25s ease; }
  /* Walk clips are cropped to the middle of the original video, so a walking expert crosses the
     clip's left/right edge. Fade those edges too. The standing picture made from a clip's last
     frame (img.stand) gets the same fades, so swapping between them is invisible. */
  #doubao-mods-avatar video, #doubao-mods-avatar canvas, #doubao-mods-avatar img.stand {
    -webkit-mask-image: linear-gradient(to top, transparent 0, transparent 3px, #000 22%),
      linear-gradient(to right, transparent 0, #000 9%, #000 91%, transparent 100%);
    mask-image: linear-gradient(to top, transparent 0, transparent 3px, #000 22%),
      linear-gradient(to right, transparent 0, #000 9%, #000 91%, transparent 100%);
    -webkit-mask-composite: source-in;
    mask-composite: intersect;
    -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  }
  /* Whole-body characters (the fish girl) have nothing cut off to hide. */
  #doubao-mods-avatar img.whole, #doubao-mods-avatar video.whole, #doubao-mods-avatar canvas.whole {
    -webkit-mask-image: none; mask-image: none;
    /* drawn WHOLE_SCALE times bigger, still standing on the box's bottom edge (see picRect) */
    inset: auto; left: ${-(WHOLE_SCALE - 1) * 50}%; bottom: 0; width: ${WHOLE_SCALE * 100}%; height: ${WHOLE_SCALE * 100}%;
    transform-origin: 50% 100%;
  }
  #doubao-mods-avatar:hover img, #doubao-mods-avatar:hover video, #doubao-mods-avatar:hover canvas { transform: translateY(-4px) scale(1.03); }

  /* Frosted glass, shared by the topic label, the thought capsule and its beads: see-through white
     with a hairline edge and a soft shadow, and deep violet ink; a smoky version on dark themes. */
  #doubao-mods-avatar {
    --glass: linear-gradient(180deg, rgba(255,255,255,.88), rgba(249,247,255,.74));
    --glass-edge: rgba(96,78,190,.13);
    --glass-shine: rgba(255,255,255,.95);
    --glass-shadow: 0 10px 24px -12px rgba(38,28,92,.42), 0 2px 6px -2px rgba(38,28,92,.14);
    --ink: #5a49cf; --ink-soft: #b9a8ee; --text: #2d2842;
  }
  /* Dark themes: lit violet glass. A grey pill sank into a near-black page, so this one is lighter
     than the page, with a bright rim and a soft violet glow around it, and near-white ink. */
  #doubao-mods-avatar.on-dark {
    --glass: linear-gradient(180deg, rgba(92,80,150,.92), rgba(62,53,108,.9));
    --glass-edge: rgba(196,182,255,.42);
    --glass-shine: rgba(255,255,255,.24);
    --glass-shadow: 0 0 16px -2px rgba(138,110,255,.45), 0 8px 20px -10px rgba(0,0,0,.75);
    --ink: #f1edff; --ink-soft: #b7a8ff; --text: #faf8ff;
  }
  #doubao-mods-avatar :is(.bubble, .name, .think > *) {
    background: var(--glass);
    -webkit-backdrop-filter: blur(12px) saturate(160%); backdrop-filter: blur(12px) saturate(160%);
    box-shadow: var(--glass-shadow), 0 0 0 .5px var(--glass-edge), inset 0 1px 0 var(--glass-shine);
  }

  /* The topic label when a new expert arrives: a small glass pill over her head, rising in softly.
     Sized to her like her name plate (--avatar-w), so its spacing is in em. */
  #doubao-mods-avatar .bubble {
    position: absolute; left: 50%; top: -.52em; transform: translate(-50%, calc(-100% + .43em));
    padding: .43em 1.04em .43em .87em; border-radius: 999px; white-space: nowrap;
    font: 500 calc(11.5px * var(--avatar-w, 170) / 170)/1.3 system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
    letter-spacing: .02em; color: var(--text); opacity: 0; pointer-events: none;
    transition: opacity .4s ease, transform .5s cubic-bezier(.2,.8,.2,1);
  }
  /* a single glass bead under it instead of a pointed tail */
  #doubao-mods-avatar .bubble::after {
    content: ''; position: absolute; left: 50%; bottom: -.7em; width: .43em; height: .43em; margin-left: -.22em;
    border-radius: 50%; background: var(--glass); box-shadow: var(--glass-shadow), 0 0 0 .5px var(--glass-edge);
  }
  #doubao-mods-avatar .bubble.show { opacity: 1; transform: translate(-50%, -100%); }

  /* Emoji badge for topics that don't have an expert's artwork */
  #doubao-mods-avatar .pin {
    position: absolute; right: 6%; top: 8%; width: 30px; height: 30px; border-radius: 50%;
    display: none; align-items: center; justify-content: center; font-size: 17px;
    background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.18);
  }
  #doubao-mods-avatar .pin.show { display: flex; }
  /* Her name: the same glass pill as the topic label (the shared glass rule above, same text and
     padding), across her waist where her picture fades out. It fades out as the current expert walks
     away and back in with the next one's name as she walks in (.away). Sized to her: --avatar-w is
     her width in px (show()), 170 at Normal size.
     It sits 2em up because the glass shadow reaches ~22 px below the pill: lower, it ran past her box,
     and the pet window (whose bottom edge is 6 px under her) cut it off in a hard grey line. */
  #doubao-mods-avatar .name {
    position: absolute; left: 50%; bottom: 2em; transform: translateX(-50%); z-index: 2;
    padding: .43em 1em; border-radius: 999px; white-space: nowrap; pointer-events: none;
    font: 500 calc(11.5px * var(--avatar-w, 170) / 170)/1.3 system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
    letter-spacing: .02em; color: var(--text);
    transition: opacity .35s ease;
  }
  #doubao-mods-avatar .name:empty { display: none; }
  #doubao-mods-avatar .name.away { opacity: 0; transition-duration: .2s; }
  /* Idle loop (blinking, breathing) over her standing picture. It cuts in on the identical frame
     (no fade), and has its own breathing, so the page's breathing pauses meanwhile (paused, not
     removed: no jump). */
  #doubao-mods-avatar video.idle { transition: transform .25s ease; }
  #doubao-mods-avatar.idling { animation-play-state: paused; }
  #doubao-mods-avatar.dragging { cursor: grabbing; animation: none; }
  #doubao-mods-avatar.awaiting { visibility: hidden; }   /* pet window: until its app says who she is */
  #doubao-mods-avatar.dragging img { transform: scale(1.04); }

  /* In the AI's replies: a small scene at each reply's bottom left, in room kept free for it */
  /* Sized by her Size setting (--doubao-avatar-scale, 1 = normal) */
  [data-doubao-mods-room] { position: relative !important; padding-bottom: calc(182px * var(--doubao-avatar-scale, 1) + 14px) !important; }
  [data-doubao-mods-grow] { height: auto !important; }
  .doubao-mods-inside {
    --hue: 330;
    position: absolute; left: 0; bottom: 10px; box-sizing: border-box; float: none;
    width: calc(140px * var(--doubao-avatar-scale, 1)); height: calc(182px * var(--doubao-avatar-scale, 1)); margin: 0; padding: 0;
    border-radius: 18px; user-select: none; cursor: default;
    background: radial-gradient(120% 85% at 50% 100%, hsl(var(--hue) 85% 89%), hsl(var(--hue) 75% 96.5%) 72%);
    box-shadow: inset 0 0 0 1px hsl(var(--hue) 50% 45% / .12), 0 6px 18px -12px hsl(var(--hue) 50% 30% / .45);
    transition: background .6s ease;
  }
  .doubao-mods-inside.dark {
    background: radial-gradient(120% 85% at 50% 100%, hsl(var(--hue) 45% 30%), hsl(var(--hue) 35% 15%) 75%);
    box-shadow: inset 0 0 0 1px hsl(var(--hue) 60% 75% / .16), 0 6px 18px -12px rgba(0,0,0,.7);
  }
  .doubao-mods-inside:not(.live) { overflow: hidden; }
  .doubao-mods-inside > img {
    position: absolute; top: 0; left: ${-(WIDE - 1) * 50}%; width: ${WIDE * 100}%; height: 100%; max-width: none; margin: 0;
    object-fit: contain; object-position: bottom; pointer-events: none; border-radius: 0;
    -webkit-mask-image: linear-gradient(to top, transparent 0, #000 20%);
    mask-image: linear-gradient(to top, transparent 0, #000 20%);
  }
  .doubao-mods-inside > img.whole {
    -webkit-mask-image: none; mask-image: none;
    inset: auto; left: ${-(WHOLE_SCALE - 1) * 50}%; bottom: 0; width: ${WHOLE_SCALE * 100}%; height: ${WHOLE_SCALE * 100}%;
  }
  .doubao-mods-inside.live > img { visibility: hidden; }   /* the live avatar stands there instead */
  .doubao-mods-inside > .tag {
    position: absolute; left: 8px; bottom: 8px; z-index: 21; max-width: calc(100% - 16px);
    padding: 2px 8px; border-radius: 999px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    font: 500 10.5px/1.5 system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
    color: hsl(var(--hue) 45% 28%); background: hsl(var(--hue) 60% 98% / .82); pointer-events: none;
    box-shadow: 0 0 0 .5px hsl(var(--hue) 40% 40% / .18);
  }
  .doubao-mods-inside.dark > .tag { color: hsl(var(--hue) 70% 90%); background: hsl(var(--hue) 30% 10% / .62); box-shadow: 0 0 0 .5px hsl(var(--hue) 60% 80% / .2); }
  .doubao-mods-inside > .tag:empty { display: none; }
  #doubao-mods-avatar.inside { position: absolute; z-index: 1; }
  /* In a reply the scene's tag names the topic and her, so no label over her head, emoji badge or
     name plate there */
  #doubao-mods-avatar.inside .bubble, #doubao-mods-avatar.inside .pin, #doubao-mods-avatar.inside .name { display: none; }

  /* While she's hidden in this app: the small face button by the chat box that brings her back */
  #doubao-mods-avatar-show {
    position: fixed; z-index: 21; display: none; box-sizing: border-box;
    width: 28px; height: 28px; padding: 0; margin: 0; border: none; border-radius: 50%; cursor: pointer;
    background: #f4f2fb no-repeat 50% 24% / 290% auto;   /* zoomed on her head, like the menu's faces */
    box-shadow: 0 0 0 2px rgba(124, 92, 255, .55), 0 4px 12px -4px rgba(40, 30, 90, .45);
    opacity: .55; transition: opacity .2s ease, transform .2s ease;
  }
  #doubao-mods-avatar-show:hover, #doubao-mods-avatar-show:focus-visible { opacity: 1; transform: scale(1.12); }

  /* Right-click menu: who she is, and where she stands */
  #doubao-mods-avatar-menu {
    position: fixed; z-index: 2147483646; min-width: 270px; padding: 6px;
    max-height: calc(100vh - 16px); overflow-y: auto; box-sizing: border-box;
    background: #fff; color: #222; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.2);
    font: 13px/1.3 system-ui, sans-serif; user-select: none;
  }
  #doubao-mods-avatar-menu .title { padding: 4px 10px 6px; color: #888; font-size: 12px; }
  #doubao-mods-avatar-menu .item { padding: 7px 10px; border-radius: 6px; cursor: pointer; display: flex; gap: 8px; }
  #doubao-mods-avatar-menu .item:hover { background: #f0eefc; }
  #doubao-mods-avatar-menu .item .tick { width: 14px; color: #7c5cff; }
  #doubao-mods-avatar-menu .title.section { border-top: 1px solid #eee; margin-top: 4px; padding-top: 8px; }
  #doubao-mods-avatar-menu .experts { display: grid; grid-template-columns: 1fr 1fr; gap: 1px 4px; }
  #doubao-mods-avatar-menu .item.expert { align-items: center; padding: 4px 8px; }
  #doubao-mods-avatar-menu .item.expert.current { background: #f0eefc; color: #5a3fd6; font-weight: 600; }
  #doubao-mods-avatar-menu .face {
    width: 24px; height: 24px; border-radius: 50%; flex: none; background-color: #f4f2fb;
    background-repeat: no-repeat; background-size: 380% auto; background-position: 50% 24%; /* zoomed on her head */
  }
  /* a whole-body character is drawn smaller in a wider picture: zoom out so her hat and outfit show */
  #doubao-mods-avatar-menu .face.whole { background-size: 180% auto; background-position: 50% 8%; }
  #doubao-mods-avatar-menu .item.expert.current .face { box-shadow: 0 0 0 2px #7c5cff; }
  #doubao-mods-avatar-menu .hint { padding: 6px 10px 4px; color: #888; font-size: 12px; border-top: 1px solid #eee; margin-top: 4px; }
  #doubao-mods-avatar-menu .dm-sizes { display: flex; gap: 4px; padding: 2px 8px 4px; }
  #doubao-mods-avatar-menu .dm-size {
    flex: 1; text-align: center; padding: 5px 2px; border-radius: 6px; cursor: pointer; white-space: nowrap;
    font-size: 12.5px; border: 1px solid #e6e3f5;
  }
  #doubao-mods-avatar-menu .dm-size:hover { background: #f0eefc; }
  #doubao-mods-avatar-menu .dm-size.dm-on { background: #f0eefc; color: #5a3fd6; font-weight: 600; border-color: #7c5cff; }
  /* Where she stands: words on the left, a tiny window on the right with a clickable dot per corner */
  #doubao-mods-avatar-menu .dm-stand {
    display: flex; align-items: center; gap: 10px; padding: 8px 8px 4px 10px;
    border-top: 1px solid #eee; margin-top: 4px;
  }
  #doubao-mods-avatar-menu .dm-words { flex: 1; line-height: 1.35; }
  #doubao-mods-avatar-menu .dm-sub { color: #888; font-size: 12px; }
  #doubao-mods-avatar-menu .dm-map {
    position: relative; width: 58px; height: 38px; flex: none; box-sizing: border-box;
    border: 1.5px solid #d9d3f7; border-radius: 7px; background: #faf9ff;
    display: grid; grid-template: 1fr 1fr / 1fr 1fr;
  }
  /* a faint chat box at the bottom, so it reads as the app's window */
  #doubao-mods-avatar-menu .dm-map::after {
    content: ''; position: absolute; left: 32%; right: 32%; bottom: 4px; height: 6px;
    border-radius: 3px; background: #e6e1fb; pointer-events: none;
  }
  /* the desktop pet's version is the screen: a taskbar along the bottom instead */
  #doubao-mods-avatar-menu .dm-map.dm-screen::after { left: 0; right: 0; bottom: 0; height: 5px; border-radius: 0 0 5px 5px; }
  #doubao-mods-avatar-menu .dm-q i, #doubao-mods-avatar-menu .dm-here { z-index: 1; }
  #doubao-mods-avatar-menu .dm-map.dm-screen .dm-bottom-left i, #doubao-mods-avatar-menu .dm-map.dm-screen .dm-bottom-right i { bottom: 8px; }
  #doubao-mods-avatar-menu .dm-q { position: relative; cursor: pointer; }
  #doubao-mods-avatar-menu .dm-q i, #doubao-mods-avatar-menu .dm-here {
    position: absolute; width: 8px; height: 8px; border-radius: 50%; box-sizing: border-box;
    border: 1.5px solid #c9c0f2; background: #fff; transition: transform .12s, background .12s;
  }
  #doubao-mods-avatar-menu .dm-top-left { grid-area: 1 / 1; }
  #doubao-mods-avatar-menu .dm-top-right { grid-area: 1 / 2; }
  #doubao-mods-avatar-menu .dm-bottom-left { grid-area: 2 / 1; }
  #doubao-mods-avatar-menu .dm-bottom-right { grid-area: 2 / 2; }
  #doubao-mods-avatar-menu .dm-top-left i { left: 4px; top: 4px; }
  #doubao-mods-avatar-menu .dm-top-right i { right: 4px; top: 4px; }
  #doubao-mods-avatar-menu .dm-bottom-left i { left: 4px; bottom: 4px; }
  #doubao-mods-avatar-menu .dm-bottom-right i { right: 4px; bottom: 4px; }
  #doubao-mods-avatar-menu .dm-q:hover i { border-color: #7c5cff; background: #e9e4ff; transform: scale(1.35); }
  #doubao-mods-avatar-menu .dm-q.dm-on i, #doubao-mods-avatar-menu .dm-here {
    border: none; background: #7c5cff; box-shadow: 0 0 0 3px rgba(124, 92, 255, .22); transform: scale(1.2);
  }
  #doubao-mods-avatar-menu .dm-here { transform: translate(-50%, -50%) scale(1.2); pointer-events: none; }

  /* On narrow windows, push the input box right to free a corner for the avatar (shift 'none':
     the app's box can't be moved cleanly, so she stands above it instead; see place()) */
  ${APP.shift === 'none' || !APP.composer ? '' : `${APP.composer} {
    ${APP.shift === 'padding' ? 'padding-left' : 'margin-left'}: var(--doubao-avatar-room, 0px) !important;
    ${APP.shrink ? 'max-width: calc(100% - var(--doubao-avatar-room, 0px)) !important;' : ''}
  }
  /* The slide only while the room changes (setRoom): a transition rule replaces the box's own ones, so
     the app's animations (千问: the box growing with more lines, its glowing border) keep working. */
  ${splitSelectors(APP.composer).map(s => `html[data-doubao-mods-sliding] ${s}`).join(', ')} {
    transition: ${APP.shift === 'padding' ? 'padding-left' : 'margin-left'} .2s ease${APP.shrink ? ', max-width .2s ease' : ''};
  }`}
  @keyframes doubao-avatar-breathe {
    0%, 100% { transform: translateY(0) scale(1); }
    50% { transform: translateY(-3px) scale(1.006); }
  }

  /* ---- While the AI answers: a soft glow behind her and a thought bubble by her head ----
     Box classes: thinking / writing (answer in progress), done (just finished), walking (mid-walk:
     all of this waits until she's standing), flip (bubble on her left, near the window's right edge). */
  #doubao-mods-avatar .figure { position: absolute; inset: 0; transform-origin: 50% 100%;
    /* Her bottom 3 px are clear anyway (the fade): cut them off, so no stray row of the idle loop can
       show at her bottom edge while she breathes. Only the bottom: Whale Girl reaches past the top and sides. */
    clip-path: inset(-100% -100% 3px -100%); }
  /* In a reply's card she's cut at the card's edges, like the older replies' pictures (her wider
     picture would otherwise reach past the card's sides). */
  #doubao-mods-avatar.inside .figure { clip-path: inset(0 0 3px 0 round 18px 18px 0 0); }
  #doubao-mods-avatar .aura {
    position: absolute; left: -16%; right: -16%; top: -6%; bottom: 14%; pointer-events: none;
    --glow: 1;  /* stronger on dark themes (class on-dark), where the same colours look dim */
    background:
      radial-gradient(closest-side at 50% 36%, rgba(124,92,255,calc(.42 * var(--glow))), rgba(124,92,255,0) 72%),
      radial-gradient(closest-side at 64% 62%, rgba(255,92,168,calc(.30 * var(--glow))), rgba(255,92,168,0) 70%),
      radial-gradient(closest-side at 36% 66%, rgba(92,200,255,calc(.22 * var(--glow))), rgba(92,200,255,0) 70%);
    filter: blur(10px); opacity: 0; transform: scale(.85);
    transition: opacity .8s ease, transform .8s ease;
  }
  #doubao-mods-avatar.on-dark .aura { --glow: 1.9; }
  #doubao-mods-avatar:is(.thinking, .writing):not(.walking) .aura {
    opacity: 1; transform: scale(1); animation: doubao-aura-breathe 3.2s ease-in-out infinite;
  }
  #doubao-mods-avatar.writing:not(.walking) .aura { animation: doubao-aura-swirl 2.4s ease-in-out infinite; }
  #doubao-mods-avatar.done:not(.walking) .aura { animation: doubao-aura-flash 1.3s ease-out forwards; }
  @keyframes doubao-aura-breathe { 0%, 100% { opacity: .55; transform: scale(.94); } 50% { opacity: 1; transform: scale(1.04); } }
  @keyframes doubao-aura-swirl {
    0%, 100% { opacity: .8; transform: scale(.98) rotate(0deg); filter: blur(10px) hue-rotate(0deg); }
    50% { opacity: 1; transform: scale(1.05) rotate(6deg); filter: blur(10px) hue-rotate(-28deg); }
  }
  @keyframes doubao-aura-flash { 0% { opacity: 1; transform: scale(1); } 25% { opacity: 1; transform: scale(1.12); } 100% { opacity: 0; transform: scale(1.18); } }

  /* The thought cloud sits in the empty space beside her head, never over her: placeThink() reads
     her outline from the picture and sets the cloud's and puffs' positions (left/top, in px). */
  #doubao-mods-avatar .think {
    position: absolute; left: 100%; top: 0; width: 46px; height: 26px; pointer-events: none; z-index: 2;
  }
  /* A glass capsule with two beads trailing down towards her head; they rise in one after another. */
  #doubao-mods-avatar .think > * {
    position: absolute; opacity: 0; transform: translateY(5px) scale(.9);
    transition: opacity .4s ease, transform .55s cubic-bezier(.2,.8,.2,1);
  }
  #doubao-mods-avatar .think :is(.puff1, .puff2) { border-radius: 50%; }
  #doubao-mods-avatar .think .puff2 { width: 4px; height: 4px; margin: -2px 0 0 -2px; transition-delay: 0s; }
  #doubao-mods-avatar .think .puff1 { width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px; transition-delay: .1s; }
  #doubao-mods-avatar .think .cloud {
    left: 0; top: 0; width: 46px; height: 26px; border-radius: 13px; transition-delay: .2s;
    transform-origin: 0% 100%;
  }
  #doubao-mods-avatar.flip .think .cloud { transform-origin: 100% 100%; }
  #doubao-mods-avatar:is(.thinking, .writing, .done):not(.walking) .think > * { opacity: 1; transform: none; }
  /* While she thinks, the beads glow one after the other, like a thought rising to the capsule,
     and the capsule floats very gently. */
  #doubao-mods-avatar:is(.thinking, .writing):not(.walking) .think .puff2 { animation: doubao-think-bead 2.2s ease-in-out .6s infinite; }
  #doubao-mods-avatar:is(.thinking, .writing):not(.walking) .think .puff1 { animation: doubao-think-bead 2.2s ease-in-out .9s infinite; }
  @keyframes doubao-think-bead { 0%, 60%, 100% { opacity: 1; scale: 1; } 25% { opacity: .55; scale: .82; } }
  #doubao-mods-avatar:is(.thinking, .writing):not(.walking) .think .cloud { animation: doubao-think-float 4s ease-in-out .8s infinite; }
  @keyframes doubao-think-float { 0%, 100% { translate: 0 0; } 50% { translate: 0 -1.5px; } }
  /* Leaving: the capsule goes first, then the beads. */
  #doubao-mods-avatar:not(:is(.thinking, .writing, .done)) .think .cloud,
  #doubao-mods-avatar.walking .think .cloud { transition-delay: 0s; }
  #doubao-mods-avatar:not(:is(.thinking, .writing, .done)) .think .puff2,
  #doubao-mods-avatar.walking .think .puff2 { transition-delay: .16s; }
  /* Done: after the tick, everything drifts up and fades. */
  #doubao-mods-avatar.done:not(.walking) .think.leaving > * {
    opacity: 0; translate: 0 -12px; transform: scale(.96);
    transition: opacity .6s ease, translate .7s cubic-bezier(.2,.8,.2,1), transform .7s ease; transition-delay: 0s;
  }

  /* Inside the capsule: three dots breathing in turn (thinking), two lines being written (writing),
     a fine tick with a soft halo (done). */
  #doubao-mods-avatar .think .cloud > * {
    position: absolute; inset: 0; margin: auto; opacity: 0; transition: opacity .3s ease;
  }
  #doubao-mods-avatar.thinking .think .dots,
  #doubao-mods-avatar.writing .think .lines,
  #doubao-mods-avatar.done .think .check { opacity: 1; }
  #doubao-mods-avatar .think .dots { display: flex; align-items: center; justify-content: center; gap: 4px; }
  #doubao-mods-avatar .think .dots b {
    width: 4.5px; height: 4.5px; border-radius: 50%; background: var(--ink);
    animation: doubao-think-dot 1.5s ease-in-out infinite;
  }
  #doubao-mods-avatar .think .dots b:nth-child(2) { animation-delay: .2s; }
  #doubao-mods-avatar .think .dots b:nth-child(3) { animation-delay: .4s; }
  @keyframes doubao-think-dot { 0%, 70%, 100% { opacity: .25; transform: scale(.8); } 30% { opacity: 1; transform: scale(1); } }
  #doubao-mods-avatar .think .lines { width: 24px; height: 10px; }
  #doubao-mods-avatar .think .lines i {
    position: absolute; left: 0; height: 2px; border-radius: 1px; transform-origin: 0 50%;
    background: linear-gradient(90deg, var(--ink), var(--ink-soft));
    animation: doubao-think-line 2s cubic-bezier(.45,0,.25,1) infinite;
  }
  #doubao-mods-avatar .think .lines i:nth-child(1) { top: 1px; width: 24px; }
  #doubao-mods-avatar .think .lines i:nth-child(2) { top: 7px; width: 15px; animation-delay: .45s; }
  @keyframes doubao-think-line {
    0% { transform: scaleX(0); opacity: 1; } 45%, 80% { transform: scaleX(1); opacity: 1; } 100% { transform: scaleX(1); opacity: 0; }
  }
  #doubao-mods-avatar .think .check { width: 16px; height: 16px; overflow: visible; }
  #doubao-mods-avatar .think .check path {
    fill: none; stroke: var(--ink); stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round;
    stroke-dasharray: 18; stroke-dashoffset: 18;
  }
  #doubao-mods-avatar.done .think .check path { animation: doubao-think-tick .5s cubic-bezier(.65,0,.35,1) .1s forwards; }
  @keyframes doubao-think-tick { to { stroke-dashoffset: 0; } }
  /* the halo: a thin violet ring that widens and fades around the capsule */
  #doubao-mods-avatar .think .cloud::after {
    content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; opacity: 0;
  }
  #doubao-mods-avatar.done:not(.walking) .think .cloud::after { animation: doubao-think-halo .9s ease-out .15s; }
  @keyframes doubao-think-halo {
    0% { opacity: 1; box-shadow: 0 0 0 0 rgba(124,92,255,.45); }
    100% { opacity: 0; box-shadow: 0 0 0 9px rgba(124,92,255,0); }
  }
  #doubao-mods-avatar.done:not(.walking) .think .cloud { animation: doubao-think-pop .6s cubic-bezier(.3,1.4,.5,1); }
  @keyframes doubao-think-pop { 0% { scale: 1; } 40% { scale: 1.06; } 100% { scale: 1; } }

  /* Done: a little nod (dip, bounce back, settle), and sparkles bursting out of the cloud (away
     from her, so nothing covers her face). */
  #doubao-mods-avatar .figure.nod { animation: doubao-avatar-nod .95s cubic-bezier(.3,.7,.4,1); }
  @keyframes doubao-avatar-nod {
    0% { transform: none; }
    20% { transform: translateY(3.5px) scale(1.006, .982); }
    42% { transform: translateY(-2.5px) scale(.996, 1.008); }
    62% { transform: translateY(1.5px) scale(1.002, .993); }
    80% { transform: translateY(-.5px); }
    100% { transform: none; }
  }
  /* Fine glints: slim four-pointed stars in champagne gold and lavender, with a soft glow. */
  #doubao-mods-avatar .spark {
    position: absolute; width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px; pointer-events: none; z-index: 2;
    background: radial-gradient(circle, #fff 0 18%, #ffc85a 38%, #b98aff 80%);
    clip-path: polygon(50% 0, 57% 43%, 100% 50%, 57% 57%, 50% 100%, 43% 57%, 0 50%, 43% 43%);
    filter: drop-shadow(0 0 2px rgba(255, 190, 90, .95)) drop-shadow(0 0 4px rgba(185, 138, 255, .5));
    animation: doubao-avatar-spark 1.1s cubic-bezier(.2,.8,.3,1) forwards;
  }
  @keyframes doubao-avatar-spark {
    0% { transform: translate(0, 0) scale(0) rotate(0deg); opacity: 0; }
    20% { opacity: 1; }
    55% { transform: translate(var(--dx), var(--dy)) scale(var(--s)) rotate(45deg); opacity: 1; }
    100% { transform: translate(calc(var(--dx) * 1.15), calc(var(--dy) * 1.15 - 8px)) scale(0) rotate(90deg); opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    #doubao-mods-avatar .aura, #doubao-mods-avatar .think *, #doubao-mods-avatar .figure.nod { animation: none !important; }
    #doubao-mods-avatar .spark { display: none; }
  }
`;
document.head.appendChild(style);

const box = document.createElement('div');
box.id = 'doubao-mods-avatar';
box.title = IN_PET
  ? tr('Click: meet the next one · Drag: move her · Right-click: choose an expert, or back into the app',
    '点击：换下一位 · 拖动：移动她 · 右键：选择专家，或回到应用里')
  : tr('An expert for the topic of your question.\nClick: meet the next one · Drag: move her · Right-click: choose an expert, a corner or pet mode',
    '为你的问题话题而来的专家。\n点击：换下一位 · 拖动：移动她 · 右键：选择专家、位置或宠物模式');
const img = document.createElement('img');
img.alt = '';
img.src = standOf(START) || stillOf(START);
if (standOf(START)) img.classList.add('stand');
if (isWhole(START)) img.classList.add('whole');
const video = document.createElement('video');
video.muted = true;
video.playsInline = true;
video.preload = 'auto';
video.defaultPlaybackRate = PLAYBACK_RATE;
// Her idle loop while she stands (mods/media/<expert>_idle.webm): blinks and small breathing.
const idle = document.createElement('video');
idle.className = 'idle';
idle.muted = true;
idle.playsInline = true;
idle.loop = true;
idle.preload = 'auto';
const bubble = document.createElement('div');
bubble.className = 'bubble';
const pin = document.createElement('div');
pin.className = 'pin';
const nameTag = document.createElement('div');
nameTag.className = 'name';
// While the video switches to the next clip it briefly shows nothing; this canvas holds a copy of
// the frame she's standing on until the new clip's first frame is up, so nothing flickers.
const hold = document.createElement('canvas');
// Picture, hold frame and clip move together in .figure (so the "done" nod moves all of them);
// the glow sits behind it, the thought bubble by her head.
const figure = document.createElement('div');
figure.className = 'figure';
figure.append(img, idle, hold, video);
const aura = document.createElement('div');
aura.className = 'aura';
const think = document.createElement('div');
think.className = 'think';
// Built element by element, not with innerHTML: Cursor's page (like VS Code's) refuses HTML strings
// from scripts (Trusted Types).
const makeEl = (name, cls, ...kids) => { const e = document.createElement(name); if (cls) e.className = cls; e.append(...kids); return e; };
{
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const check = document.createElementNS(SVG_NS, 'svg');
  check.setAttribute('class', 'check');
  check.setAttribute('viewBox', '0 0 16 16');
  const tick = document.createElementNS(SVG_NS, 'path');
  tick.setAttribute('d', 'M3.5 8.4l3 3L12.5 5');
  check.append(tick);
  think.append(makeEl('i', 'puff2'), makeEl('i', 'puff1'), makeEl('div', 'cloud',
    makeEl('span', 'dots', makeEl('b'), makeEl('b'), makeEl('b')),
    makeEl('span', 'lines', makeEl('i'), makeEl('i')),
    check));
}
const puff1 = think.querySelector('.puff1'), puff2 = think.querySelector('.puff2'), cloud = think.querySelector('.cloud');
box.append(aura, figure, pin, nameTag, think, bubble);
document.body.appendChild(box);
// Her name plate follows her standing picture (setStanding), so it changes as the new one walks in.
// Like the topic label, it shows for a few seconds as she arrives, then fades (class away), and comes
// back while the pointer is over her.
let nameTimer;
function setName(expert) {
  nameTag.textContent = personName(expert);
}
// ms: how long it stays; 0 keeps it until the pointer leaves her.
function showName(ms) {
  nameTag.classList.remove('away');
  clearTimeout(nameTimer);
  if (ms) nameTimer = setTimeout(() => nameTag.classList.add('away'), ms);
}
function hideName() {
  clearTimeout(nameTimer);
  nameTag.classList.add('away');
}
setName(START);

// The topic label over her head: shown for a few seconds when a new expert arrives, and again while
// the pointer is over her (unless a pet-mode notice is showing there).
const TOPIC_SHOW_MS = 4000;
let topicText = '', noticeShown = false;
function showTopic(topic) {
  pin.textContent = topic?.emoji || '';
  pin.classList.toggle('show', !!topic && !expertOf(topic)); // no artwork for this topic: emoji badge
  topicText = topic ? `${topic.emoji} ${topic.label}` : '';
  if (topic) flashTopic(TOPIC_SHOW_MS);
}
// ms: how long it stays; 0 keeps it until the pointer leaves her.
function flashTopic(ms) {
  if (!topicText || noticeShown) return;
  bubble.textContent = topicText;
  bubble.classList.add('show');
  clearTimeout(bubbleTimer);
  if (ms) bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms);
  // Re-place it for its new text, so its real height keeps it inside the window (placeThink).
  requestAnimationFrame(() => { if (thinkAt) placeThink(...thinkAt); });
}
let hovered = false;
box.addEventListener('mouseenter', () => {
  hovered = true;
  flashTopic(0);
  if (!walking) showName(0);
});
box.addEventListener('mouseleave', () => {
  hovered = false;
  if (!nameTag.classList.contains('away')) showName(1000);
  if (noticeShown || !bubble.classList.contains('show')) return;
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.remove('show'), 1000);
});
showName(TOPIC_SHOW_MS);   // she's just appeared


// ---- Walk clips, asked for once each (window.__doubaoMedia) and kept as blob: URLs ----
// The answer, M.onMedia({ id, name, blob | data }): the clip itself (blob, where the asker shares the
// page's JavaScript: the DeepSeek Harness plugin, the extension), or its bytes as base64 (data, from
// the watcher over DevTools); neither: no clip.
const clips = new Map();     // name -> Promise<blob URL | null>
const waiting = new Map();   // request id -> { resolve, name }
// Numbered from a different start after each reload of the avatar (GEN), and an answer must name the
// clip it was asked for: a late answer meant for the copy before a reload used to play the wrong clip.
let mediaId = GEN * 1e6;
M.onMedia = ({ id, name, data, blob }) => {
  const w = waiting.get(id);
  if (!w || (name && name !== w.name)) return;
  const { resolve } = w;
  waiting.delete(id);
  if (blob instanceof Blob) return resolve(URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: 'video/webm' })));
  if (!data) return resolve(null);
  // Decode by hand: some apps' security policy blocks fetch() on data: URLs.
  const bin = atob(data), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  resolve(URL.createObjectURL(new Blob([bytes], { type: 'video/webm' })));
};
function clip(name) {
  if (!MEDIA.includes(name)) return Promise.resolve(null);
  if (!IN_PET && typeof window.__doubaoMedia !== 'function') return Promise.resolve(null);
  if (!clips.has(name)) {
    // The pet window loads clips from its own pet://app/media/ address instead.
    const p = (IN_PET
      ? fetch('media/' + name).then(r => (r.ok ? r.blob() : null)).then(b => b && URL.createObjectURL(b)).catch(() => null)
      : new Promise(resolve => {
        const id = ++mediaId;
        waiting.set(id, { resolve, name });
        window.__doubaoMedia(JSON.stringify({ id, name }));
        setTimeout(() => { if (waiting.delete(id)) resolve(null); }, 4000);
      })).then(url => { if (!url) clips.delete(name); return url; }); // retry next time on failure
    clips.set(name, p);
  }
  return clips.get(name);
}

// Play one clip. The picture underneath is hidden only once the clip's first frame is on screen,
// so nothing flickers. Resolves true when it played to the end (or to trim.end).
// trim (from CLIP_TRIMS, tools/make-clip-trims.py) skips the clip's empty stretch: a walk-in starts
// at trim.start, just before the expert comes into view; a walk-out stops at trim.end, just after
// she has gone. So the stage is only empty for a moment between experts.
function play(url, trim = {}, expert = null) {
  return new Promise(resolve => {
    let done = false;
    // This clip's own one-off listeners, removed when it ends either way: left behind after a failed
    // or timed-out clip, they jumped the next clip to this one's start point.
    const once = [];
    const listen = (type, fn) => { video.addEventListener(type, fn, { once: true }); once.push([type, fn]); };
    const finish = ok => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      video.onended = video.onerror = null;
      for (const [type, fn] of once) video.removeEventListener(type, fn);
      resolve(ok);
    };
    const guard = setTimeout(() => finish(false), 4000 / PLAYBACK_RATE + 3000);
    video.onended = () => finish(true);
    video.onerror = () => finish(false);
    if (trim.end && video.requestVideoFrameCallback) {
      const check = (now, meta) => {
        if (done) return;
        if (meta.mediaTime >= trim.end) { video.pause(); finish(true); return; }
        video.requestVideoFrameCallback(check);
      };
      video.requestVideoFrameCallback(check);
    }
    const onFirstFrame = () => { video.style.opacity = '1'; img.style.opacity = '0'; hold.style.opacity = '0'; };
    if (video.style.opacity === '1' && video.readyState >= 2) {   // she's standing on a video frame
      try {
        hold.width = video.videoWidth;
        hold.height = video.videoHeight;
        hold.getContext('2d').drawImage(video, 0, 0, hold.width, hold.height);
        hold.classList.toggle('whole', video.classList.contains('whole'));
        hold.style.opacity = '1';
      } catch {}
    }
    video.classList.toggle('whole', isWhole(expert));
    video.src = url;
    video.playbackRate = PLAYBACK_RATE;
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(onFirstFrame);
    else listen('playing', onFirstFrame);
    const start = () => { if (!done) video.play().catch(() => finish(false)); };
    if (trim.start > 0) {
      // Jump past the empty start first, then play.
      listen('loadedmetadata', () => {
        if (done) return;
        listen('seeked', start);
        video.currentTime = Math.min(trim.start, Math.max(0, video.duration - 0.05));
      });
    } else start();
  });
}

// Put an expert's standing picture in the <img>: the last frame of her walk-in clip
// (expert-<name>-stand.webp, from tools/make-stand-stills.py), or her portrait if that's missing.
// It gets the clip's look (class "stand": same edge fades), so swapping between them is invisible.
function setStanding(expert) {
  const stand = standOf(expert);
  img.classList.toggle('stand', !!stand);
  img.classList.toggle('whole', isWhole(expert));
  img.src = stand || stillOf(expert);
  setName(expert);
}

// After the walk-in: swap the finished video (showing its last frame) for the identical standing
// picture. She must not stand on a paused video: Chromium redraws a moving paused video only in
// steps, which made the breathing stutter; a picture moves smoothly (same as the DSH avatar).
function settle(expert, playedToEnd) {
  setStanding(expert);
  if (playedToEnd && standOf(expert)) {
    img.style.transition = 'none';     // appear at once, underneath the identical video frame
    img.style.opacity = '1';
    img.decode().catch(() => {}).then(() => requestAnimationFrame(() => {
      if (video.ended) video.style.opacity = '0';  // (unless a new walk already took the video)
      img.style.transition = '';
    }));
    return;
  }
  img.style.opacity = '1';
  setTimeout(() => { if (!walking) video.style.opacity = '0'; }, 260);
}

// ---- Idle loop while she stands ----
// The loop starts after she has settled on her standing picture. Her walk-in ends on exactly the
// loop's first frame (the build adds in-between frames, tools/morph.py), so the loop cuts in with no
// fade: a fade between two different poses showed a double image. Each loop ends on the first frame
// of her walk-out, so before she walks off, a loop that's nearly done is allowed to finish;
// otherwise the current frame is held and dissolves into the walk-out.
let idleFor = null;          // expert whose loop is playing or starting
// fromStart: a fresh loop after she has settled starts at its first frame (closest to her pose);
// coming back to the window just carries on where it paused.
async function startIdle(expert, fromStart = true) {
  if (idleFor === expert && !idle.paused) return;
  idleFor = expert;
  resting = false;
  idle.loop = true;
  lastStir = Date.now();
  if (document.hidden || walking) return;          // resumed when the window is visible again
  const url = await clip(`${expert}_idle.webm`);
  if (!url || idleFor !== expert || walking || document.hidden) return;
  idle.classList.toggle('whole', isWhole(expert));
  if (idle.dataset.url !== url) { idle.src = url; idle.dataset.url = url; }
  else if (fromStart && idle.currentTime > 0) idle.currentTime = 0;
  // At its first frame on screen: show it at once over the identical standing picture, then hide
  // the picture once the loop has been painted.
  const showIt = () => {
    if (idleFor !== expert || walking) return;
    idle.style.transition = 'none';
    idle.style.opacity = '1';
    box.classList.add('idling');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      idle.style.transition = '';
      if (idleFor === expert && !walking && idle.style.opacity === '1') {
        img.style.transition = 'none';
        img.style.opacity = '0';
        requestAnimationFrame(() => { img.style.transition = ''; });
      }
    }));
  };
  if (idle.requestVideoFrameCallback) idle.requestVideoFrameCallback(showIt);
  else idle.addEventListener('playing', showIt, { once: true });
  idle.play().catch(() => {});
}

// handover: she's about to walk out, so keep her current frame on screen (the hold canvas) until
// the walk-out's first frame replaces it with a short dissolve.
async function stopIdle(handover) {
  const showing = idle.style.opacity === '1' && idle.readyState >= 2;
  idleFor = null;
  if (handover && showing) {
    const left = idle.duration - idle.currentTime;
    if (left > 0 && left < 0.6) await new Promise(r => setTimeout(r, Math.max(0, left * 1000 - 50)));
    try {
      hold.width = idle.videoWidth;
      hold.height = idle.videoHeight;
      hold.getContext('2d').drawImage(idle, 0, 0, hold.width, hold.height);
      hold.classList.toggle('whole', idle.classList.contains('whole'));
      hold.style.transition = 'none';         // appear at once (fading in left the stage blank)...
      hold.style.opacity = '1';
      void hold.offsetWidth;
      hold.style.transition = 'opacity .2s ease';   // ...and fade out under the walk-out's first frame
      hold.addEventListener('transitionend', () => { hold.style.transition = ''; }, { once: true });
    } catch {}
  } else if (showing) {
    img.style.opacity = '1';
  }
  idle.pause();
  idle.style.transition = 'none';
  idle.style.opacity = '0';
  requestAnimationFrame(() => { idle.style.transition = ''; });
  box.classList.remove('idling');
}

// No video decoding while the window is minimised or covered.
const onVisibility = () => {
  if (document.hidden) { idle.pause(); return; }
  stirred();
  if (idleFor && !walking) { const e = idleFor; idleFor = null; startIdle(e, false); }
};
document.addEventListener('visibilitychange', onVisibility);

// Resting: after a minute with nobody using the app (no mouse, keys or scrolling in it) and nothing
// being answered, she finishes her current loop and stands still on its last frame, which is her
// standing pose, so it looks the same, but no video is decoded. She moves again at the next sign of
// you (or a question, or an answer: see tick).
const REST_AFTER_MS = 60000;
let lastStir = Date.now(), resting = false;
function stirred() {
  lastStir = Date.now();
  if (!resting) return;
  resting = false;
  idle.loop = true;
  if (idleFor && !walking && !document.hidden && idle.paused) idle.play().catch(() => {});
}
function restIfQuiet() {
  if (resting || !idleFor || walking || idle.paused || phase !== 'idle' || Date.now() - lastStir < REST_AFTER_MS) return;
  resting = true;
  idle.loop = false;   // plays to its end, then holds that frame
}
const STIR_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'focus'];
for (const e of STIR_EVENTS) addEventListener(e, stirred, { capture: true, passive: true });

// ---- Changing experts ----
let shown = START, target = START, targetTopic = null, walking = false;

// Quick fade between pictures: used when clips aren't available (watcher not running, a clip
// failed, or the window is minimised so video wouldn't play).
async function swapTo(next, topic) {
  await stopIdle(false);
  hold.style.opacity = '0';
  img.style.opacity = '0';
  nameAway(next);
  await new Promise(r => setTimeout(r, 250));
  video.style.opacity = '0';
  setStanding(next);
  img.style.opacity = '1';
  showName(hovered ? 0 : TOPIC_SHOW_MS);
  shown = kept.shown = next;
  showTopic(topic);
}
// Her name plate fades out as she leaves, unless the next one has the same name (the one-person and
// Whale Girl styles: the same character in a new outfit).
const nameAway = next => { if (personName(next) !== personName(shown)) hideName(); };

// Walk the current expert out and the target in. If the topic changes again mid-walk, it carries on
// to the newest target instead of replaying every step: after a walk-out the stage is empty, so the
// newest expert walks straight in; after a walk-in, she walks out again.
async function goTo(expert, topic) {
  target = expert;
  targetTopic = topic;
  if (walking) return;            // the running walk picks up the latest target as it goes
  if (expert === shown) return showTopic(topic);
  walking = true;
  box.classList.add('walking');   // the glow and thought bubble wait until she's standing again
  try {
    let empty = false;            // true once the previous expert has walked out
    while (empty || target !== shown) {
      if (!empty) {
        clip(`${target}_in.webm`); // start loading the walk-in during the walk-out
        const outUrl = document.hidden ? null : await clip(`${shown}_out.webm`);
        if (outUrl) { await stopIdle(true); nameAway(target); }
        if (!outUrl || !(await play(outUrl, CLIP_TRIMS[`${shown}_out.webm`], shown))) { await swapTo(target, targetTopic); continue; }
        empty = true;
      }
      const next = target, nextTopic = targetTopic;
      const inUrl = document.hidden ? null : await clip(`${next}_in.webm`);
      if (!inUrl) { empty = false; await swapTo(next, nextTopic); continue; }
      img.style.opacity = '0';    // stage is empty: the picture must not show through yet
      setStanding(next);
      showName(hovered ? 0 : TOPIC_SHOW_MS);   // her name comes in with her, for a few seconds
      showTopic(nextTopic);
      const playedToEnd = await play(inUrl, CLIP_TRIMS[`${next}_in.webm`], next);
      shown = kept.shown = next;
      empty = false;
      settle(next, playedToEnd);
    }
  } finally {
    walking = false;
    box.classList.remove('walking');
    startIdle(shown);
    if (celebrateLater) { celebrateLater = false; setTimeout(celebrate, 200); } // the answer finished mid-walk
  }
}

// The topic she's wearing (null: the everyday look); this is what the pet is told.
let wornOutfit = kept.outfit ?? null;
// fromQuestion: picked for your newest question (not chosen from the menu).
function wear(topic, fromQuestion = false) {
  wornOutfit = kept.outfit = topic?.outfit ?? null;
  if (fromQuestion) rememberTopic(pendingQuestions.at(-1), wornOutfit);
  if (petOn || hiddenHere) return wearHidden(topic);   // no walk while she's not shown
  // In the replies: the handover plays in the new question's own reply, once it has started.
  if (fromQuestion && insideActive() && awaitingReply() && !pendingHost()) { held = { topic, at: Date.now() }; return sendPet(); }
  held = null;
  if (insideActive()) place();   // into the new reply (or under the question) before the walk starts
  goTo(expertOf(topic) || EVERYDAY, topic);
}

// Pet window, first message from its app: she appears straight away as whoever the app shows (no
// walk). Until then the pet stays out of sight: it starts as the everyday look, and the first message
// used to walk that out and the real expert in (or spin, in the one-person style) every time pet mode
// was switched on.
async function appearAs(topic) {
  const expert = expertOf(topic) || EVERYDAY;
  wornOutfit = kept.outfit = topic?.outfit ?? null;
  target = expert;
  targetTopic = topic;
  if (expert !== shown) {
    await stopIdle(false);
    setStanding(expert);
    img.style.opacity = '1';
    shown = kept.shown = expert;
  }
  startIdle(expert);
  setTimeout(() => box.classList.remove('awaiting'), 30);   // once her picture has been set
}

// Pet mode, in the app window: she's hidden here, so no walk; just note who it is and tell the pet.
function wearHidden(topic) {
  const expert = expertOf(topic) || EVERYDAY;
  target = shown = kept.shown = expert;
  setStanding(expert);
  sendPet();
}

// To this app's pet (through the watcher): only the topic and the answer phase.
function sendPet() {
  if (!petOn || typeof window.__doubaoPet !== 'function') return;
  // ring: whether this app's rainbow chat box is on (null if that mod isn't installed), so the pet's
  // menu can offer the same switch while the in-app avatar (and her menu) is hidden.
  const ring = document.getElementById('doubao-mods-ring-style') ? ringOn() : null;
  window.__doubaoPet(JSON.stringify({ type: 'state', outfit: wornOutfit, phase, look, ring, dark: box.classList.contains('on-dark') }));
}

// The rainbow chat box switch (15-ring.js reads the same per-app setting, and listens for the event).
const RING_KEY = `doubao-mods-ring:${APP.id}`;
const ringOn = () => { try { return localStorage.getItem(RING_KEY) !== 'off'; } catch { return true; } };
function setRing(on) {
  try { on ? localStorage.removeItem(RING_KEY) : localStorage.setItem(RING_KEY, 'off'); } catch {}
  dispatchEvent(new Event('doubao-mods-ring'));
  sendPet();
}

// The topic an expert stands for (her own first: the teacher is "Study", not "Writing").
// Works for either style's ids (a choice from the other style maps to this style's outfit).
const topicOfExpert = expert => {
  const base = baseOf(expert), id = PREFIX + base;
  return TOPICS.find(t => t.outfit === base && expertOf(t) === id) || TOPICS.find(t => expertOf(t) === id) || null;
};

// Switch style: the same topic, shown by the other style's expert (the current one leaves first).
// remember=false: told by the app (the desktop pet follows its app's choice).
function setLook(next, remember = true) {
  if (next === look || !lookAvailable(next)) return false;
  look = next;
  PREFIX = LOOKS[next].prefix;
  EVERYDAY = PREFIX + EVERYDAY_BASE;
  lineup = makeLineup();
  if (remember) try { localStorage.setItem(LOOK_KEY, next); } catch {}
  return true;
}
// (A plain click used to bring in the next expert. Removed: pick one from the right-click menu.)

// ---------------------------------------------------------------------------------------------
// Watching for new questions
// ---------------------------------------------------------------------------------------------

// requestId starts from a different number after each reload (GEN), so a late answer meant for the
// copy before the reload can't match a new question.
let lastKey = kept.lastKey, requestId = GEN * 1e6, pendingQuestions = [];

// Whether the model answered last time (null: not asked yet). While it isn't available, the keywords stand in.
let modelReady = null;
// Answer from the background AI model (the watcher through DevTools; the DeepSeek Harness plugin or
// the browser extension in those). Ids starting "r:" are for an older reply's question (topicForReply).
M.onTopic = resp => {
  if (typeof resp.id === 'string' && resp.id.startsWith('r:')) return onReplyTopic(resp);
  if (resp.id !== requestId) return; // an older question; a newer one is already being handled
  clearTimeout(aiTimer);
  const was = modelReady;
  modelReady = !!resp.ready;
  if (modelReady && was === false) forgetReplyLooks();   // the model is back: older replies ask it
  if (!resp.ready) return wear(keywordTopicOf(pendingQuestions), true); // model loading or unavailable
  wear(resp.outfit ? topicByOutfit(resp.outfit) : null, true);
};

// Sent from the box but not shown yet (sentFromBox): the questions she already asked about. Until the
// app shows the new message, the page still lists only the questions before it; that older list isn't
// a change (it made her walk back to the previous topic for a moment, then forward again).
let sentAhead = null;
function checkTopic() {
  const questions = userQuestions();
  if (sentAhead) {
    const ahead = sentAhead.questions;
    const older = questions.length === ahead.length - 1 && questions.every((q, i) => q === ahead[i]);
    if (older && Date.now() - sentAhead.at < 15000) return;   // her new message isn't shown yet
    sentAhead = null;
  }
  askTopic(questions);
}

// The moment you send (Enter in the chat box, or its Send button): the question straight from the box,
// before the app shows it as a message. Some apps (Codex) draw your message only once their reply
// gets going, so waiting for it made the expert late. When the message does appear, it's the same
// question list, so checkTopic sees nothing new.
function sentFromBox(from) {
  if (IN_PET || !APP.composer) return;
  const chat = firstVisible(APP.composer);
  if (!chat || (from && !chat.contains(from))) return;
  const field = from?.closest?.('textarea, input, [contenteditable="true"]')
    || chat.querySelector('textarea, [contenteditable="true"]') || chat;
  const text = String(field.value ?? field.innerText ?? '').trim();
  if (!text) return;
  sentAhead = { questions: [...userQuestions(), text], at: Date.now() };
  askTopic(sentAhead.questions);
}
// Enter alone sends (Shift+Enter is a new line; Enter while typing Chinese picks a word: isComposing).
const onSendKey = e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.isComposing && e.keyCode !== 229) sentFromBox(e.target);
};
const onSendClick = e => {
  const b = e.target.closest?.('button');
  const label = b && [b.getAttribute('aria-label'), b.title, b.dataset.testid, b.getAttribute('type')].join(' ');
  if (b && /send|submit|发送/i.test(label)) sentFromBox(b);
};
if (!IN_PET) { addEventListener('keydown', onSendKey, true); addEventListener('click', onSendClick, true); }

function askTopic(questions) {
  // Which chat, and how far along. Codex's address never changes between chats and Yuanbao keeps the
  // chat's id after the "?", so the address alone missed a switch to another chat that also ends with
  // "continue": its first question and the whole address are part of it too.
  const key = location.pathname + location.search + '|' + questions.length + '|' + (questions[0] || '') + '|' + (questions.at(-1) || '');
  if (key === lastKey) return;
  lastKey = kept.lastKey = key;
  if (!questions.length) return wear(null); // new chat: everyday look

  pendingQuestions = questions;
  const id = ++requestId;
  if (typeof window.__doubaoTopic === 'function') {
    // `current`: the topic showing now, so a follow-up that still fits it doesn't switch experts.
    window.__doubaoTopic(JSON.stringify({ id, questions: questions.slice(-6), current: wornOutfit }));
    clearTimeout(aiTimer);
    // No answer at all (not "not ready": nothing): the model can't be reached, so the keywords.
    aiTimer = setTimeout(() => { if (id === requestId) { modelReady = false; wear(keywordTopicOf(questions), true); } }, AI_NO_REPLY_MS);
  } else {
    wear(keywordTopicOf(questions), true); // background AI not running (e.g. one-off inject)
  }
}

// ---------------------------------------------------------------------------------------------
// Reacting while the AI answers: thinking (sent, nothing written yet) -> writing (the answer is
// growing) -> done (a nod, a tick in the bubble and a few sparkles). APP.answering is the app's stop
// button, shown only while it answers; APP.answers are its replies.
// ---------------------------------------------------------------------------------------------

let phase = 'idle', answerStart = null, quietTicks = 0, celebrateLater = false, doneTimer;

function setPhase(next) {
  if (next === phase) return;
  phase = next;
  if (next !== 'idle') { clearTimeout(leaveTimer); think.classList.remove('leaving'); } // a new question mid-goodbye
  box.classList.toggle('thinking', next === 'thinking');
  box.classList.toggle('writing', next === 'writing');
  sendPet();
}

// In the pet window the phase comes from the app's avatar (through the watcher), already settled.
function petPhase(next) {
  if (next === 'thinking' || next === 'writing') {
    if (phase === 'idle') { clearTimeout(doneTimer); box.classList.remove('done'); }
    setPhase(next);
  } else if (phase !== 'idle') {
    setPhase('idle');
    if (walking) celebrateLater = true;
    else celebrate();
  }
}

const latestAnswer = () => {
  const all = [...document.querySelectorAll(APP.answers)].filter(isVisible);
  const el = all.at(-1) || null;
  return { el, len: el ? el.textContent.length : 0 };
};

function checkAnswer() {
  if (!APP.answering) return;
  if (firstVisible(APP.answering)) {
    quietTicks = 0;
    if (phase === 'idle') {
      clearTimeout(doneTimer);
      box.classList.remove('done');
      answerStart = APP.answers ? latestAnswer() : null; // the previous reply, before the new one exists
      setPhase('thinking');
    } else if (phase === 'thinking' && answerStart) {
      const now = latestAnswer();
      // A new reply with text in it, or (if the app reuses the element) the reply growing.
      if (now.len > 0 && (now.el !== answerStart.el || now.len > answerStart.len)) setPhase('writing');
    }
  } else if (phase !== 'idle' && ++quietTicks >= 2) { // gone for two checks: finished, not a flicker
    setPhase('idle');
    if (walking) celebrateLater = true;
    else celebrate();
  }
}

// The answer is complete: a tick pops in the cloud, she nods, sparkles burst out of the cloud
// (outwards and up, away from her), then the cloud drifts up and fades.
let leaveTimer;
function celebrate() {
  if (box.style.display === 'none' || document.hidden || phase !== 'idle') return;
  clearTimeout(leaveTimer);
  think.classList.remove('leaving');
  box.classList.add('done');
  figure.classList.remove('nod');
  void figure.offsetWidth;          // restart the nod if it's still running
  figure.classList.add('nod');
  figure.addEventListener('animationend', () => figure.classList.remove('nod'), { once: true });
  const out = box.classList.contains('flip') ? -1 : 1;   // the side away from her
  const cx = cloud.offsetLeft + think.offsetLeft + CLOUD_W / 2, cy = think.offsetTop + CLOUD_H / 2 - 3;
  const sparks = [[30, -22, 1.1], [42, 2, .75], [10, -34, .9], [-14, -30, .65], [38, -34, .7]];
  for (const [dx, dy, s] of sparks) {
    const spark = document.createElement('i');
    spark.className = 'spark';
    spark.style.cssText = `left: ${cx}px; top: ${cy}px; --dx: ${dx * out}px; --dy: ${dy}px; --s: ${s}; animation-delay: ${80 + Math.random() * 120 | 0}ms`;
    box.append(spark);
    setTimeout(() => spark.remove(), 1300);
  }
  leaveTimer = setTimeout(() => think.classList.add('leaving'), 950);
  clearTimeout(doneTimer);
  doneTimer = setTimeout(() => { box.classList.remove('done'); think.classList.remove('leaving'); }, 1650);
}
M.debugCelebrate = () => { const was = phase; phase = 'idle'; celebrate(); phase = was; }; // for testing the look

// ---------------------------------------------------------------------------------------------
// Placement. Default: fit into the gap between the main pane's left edge and the input box.
// Other choices (right-click menu): the pane's other corners, or anywhere she's dragged to.
// ---------------------------------------------------------------------------------------------

const ASPECT = 720 / 512;      // her box: the people's middle 512x720 (their clips are 672x720, portraits 724x768: see WIDE)
const MIN_GAP = 120;   // corner width the avatar needs; narrower windows get the input pushed right
const BASE_SIZE = 170;         // her width at Normal size (the default corner shrinks it only if the gap is narrower)
const EDGE = 16;               // distance from the pane's sides
const HEADER = 64;             // keep clear of the app's header bar at the top
const root = document.documentElement;

// Her size (right-click menu -> Size), remembered per app; each desktop pet has its own. Everything
// follows it: her width where she stands, the room made beside the chat box, the scenes in the replies
// (--doubao-avatar-scale in the CSS above). A pet stays within its window (pet/main.js, 320 x 340).
const SIZES = { small: 0.8, normal: 1, large: 1.25, xl: 1.5 };
const SIZE_NAMES = { small: tr('Small', '小'), normal: tr('Normal', '标准'), large: tr('Large', '大'), xl: tr('Extra large', '特大') };
const SIZE_KEY = `doubao-mods-avatar-size:${IN_PET ? 'pet:' + (new URLSearchParams(location.search).get('label') || '') : APP.id}`;
let sizeKey = 'normal';
try { const saved = localStorage.getItem(SIZE_KEY); if (SIZES[saved]) sizeKey = saved; } catch {}
let SIZE = BASE_SIZE * SIZES[sizeKey];   // her width now
root.style.setProperty('--doubao-avatar-scale', String(SIZES[sizeKey]));
function setSize(key) {
  if (!SIZES[key]) return;
  sizeKey = key;
  SIZE = BASE_SIZE * SIZES[key];
  try { key === 'normal' ? localStorage.removeItem(SIZE_KEY) : localStorage.setItem(SIZE_KEY, key); } catch {}
  root.style.setProperty('--doubao-avatar-scale', String(SIZES[key]));
  place();
}
// The room made beside the chat box. Its slide is switched on only while it changes (see the style).
let roomNow = null, slideTimer = 0;
function setRoom(px) {
  if (px === roomNow) return;
  roomNow = px;
  root.setAttribute('data-doubao-mods-sliding', '');
  clearTimeout(slideTimer);
  slideTimer = setTimeout(() => root.removeAttribute('data-doubao-mods-sliding'), 400);
  root.style.setProperty('--doubao-avatar-room', px + 'px');
}
function hide() { box.style.display = 'none'; setRoom(0); }

// Each corner's name (her menu's window picture shows it on hover). Bottom left is the default.
const CORNERS = {
  'bottom-left': tr('Bottom left', '左下角'),
  'top-left': tr('Top left', '左上角'),
  'top-right': tr('Top right', '右上角'),
  'bottom-right': tr('Bottom right', '右下角'),
};
// { mode: one of CORNERS } or { mode: 'custom', x, y } with x/y as fractions of the window size.
const POS_KEY = `doubao-mods-avatar-pos:${APP.id}`;
let pos = { mode: 'bottom-left' };
try {
  const saved = JSON.parse(localStorage.getItem(POS_KEY));
  if (saved && (CORNERS[saved.mode] || (saved.mode === 'custom' && isFinite(saved.x) && isFinite(saved.y)))) pos = saved;
} catch {}
function setPos(p) {
  pos = p;
  try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch {}
  place();
}

// The chat column: APP.pane, or else the first ancestor of the input box that is much taller than
// it and reaches well above it. (Going by width fails on narrow windows, where the input fills the
// column and the first much-wider ancestor is the whole app, sidebar included. And on a new-chat
// screen with the input in the middle, as in Codex, the first tall ancestor can be the block that
// starts at the input and holds the suggestions below it; with that as the column she got no height.)
function findPane(input) {
  // The nearest listed area around the chat box (so a list can name a narrow column first and a wider
  // one as a fallback); else, as before, the first one showing.
  if (APP.pane) return input.closest(APP.pane) || firstVisible(APP.pane);
  const ir = input.getBoundingClientRect();
  for (let e = input.parentElement; e && e !== document.body; e = e.parentElement) {
    const r = e.getBoundingClientRect();
    if (r.height > ir.height + 300 && r.width >= ir.width && r.top < ir.top - 150) return e;
  }
  return null;
}

// Left edge of the avatar's area: the pane's left edge, pushed right past any visible side panel
// (APP.avoid) that ends left of the input box.
function leftBound(pane, naturalLeft) {
  let x = pane.getBoundingClientRect().left;
  if (APP.avoid) for (const e of document.querySelectorAll(APP.avoid)) {
    if (!isVisible(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.right <= naturalLeft + 1 && r.right > x) x = r.right;
  }
  return x;
}

// ---- While she's hidden in this app: a small face button by the chat box brings her back ----
// (Her right-click menu goes with her, and Alt+Shift+H isn't something anyone remembers.) Only shown
// while she's hidden; faint until you point at it.
const showBtn = document.createElement('button');
showBtn.id = 'doubao-mods-avatar-show';
showBtn.type = 'button';
showBtn.title = tr('Show the avatar (or Alt+Shift+H)', '显示头像（或按 Alt+Shift+H）');
showBtn.setAttribute('aria-label', tr('Show the avatar', '显示头像'));
showBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); setHiddenHere(false); });
if (!IN_PET) document.body.appendChild(showBtn);
function placeShowButton() {
  const input = firstVisible(APP.composer);
  if (!hiddenHere || petOn || IN_PET || !input) { showBtn.style.display = 'none'; return; }
  const i = input.getBoundingClientRect(), S = 28;
  const main = findPane(input), left = main ? leftBound(main, i.left) : 0;
  let x, y;
  if (i.left - left >= S + 18) { x = i.left - S - 10; y = i.top + i.height / 2 - S / 2; }   // left of the box
  else { x = i.left + 12; y = i.top - S - 8; }                                              // or above its left end
  frameFace(S);
  Object.assign(showBtn.style, { display: 'block', left: Math.max(4, x) + 'px', top: Math.max(4, y) + 'px' });
}
// Her face in the button: her standing picture, zoomed on her head, which is found from the
// picture's outline (as for the thought cloud), so it fits every expert and style (a fixed crop cut
// the scientist's face in half, goggles and all).
function frameFace(S) {
  if (showBtn.dataset.face === img.src) return;
  const o = outline(), nw = img.naturalWidth, nh = img.naturalHeight;
  if (!o || !nw) return;
  showBtn.dataset.face = img.src;
  // Her head: the rows from the top of her outline down ~12% of her height; its width and middle.
  let l = Infinity, r = -Infinity;
  const headRows = Math.max(2, Math.round(o.rows * 0.12));
  for (let row = o.top; row < Math.min(o.rows, o.top + headRows); row++) {
    if (o.left[row] >= 0) { l = Math.min(l, o.left[row]); r = Math.max(r, o.right[row]); }
  }
  if (!(r > l)) return;
  const headW = (r - l) / o.cols, midX = (l + r) / 2 / o.cols;
  const iw = S * 1.3 / headW, ih = iw * nh / nw;      // the whole face fits the button
  const midY = o.top / o.rows + headW * iw * 0.9 / ih;   // her face: below the top of her hair
  Object.assign(showBtn.style, {
    backgroundImage: `url("${img.src}")`,
    backgroundSize: `${iw}px ${ih}px`,
    backgroundPosition: `${S / 2 - midX * iw}px ${S / 2 - midY * ih}px`,
  });
}

function place() {
  if (dragging) return;
  if (!hiddenHere && showBtn.style.display === 'block') showBtn.style.display = 'none';
  // Pet window: she stands at the bottom centre of her own small window (the window is what moves).
  if (IN_PET) {
    const width = Math.min(SIZE, innerWidth - 10, (innerHeight - 6) / ASPECT), height = width * ASPECT;   // within her window
    return show((innerWidth - width) / 2, innerHeight - height - 6, width, height);
  }
  if (petOn) return hide();     // she's on the desktop instead
  if (hiddenHere) { if (panels.size || box.classList.contains('inside')) clearPanels(); placeShowButton(); return hide(); }
  // In the replies: in the newest reply's panel (or her corner until the chat has a reply).
  if (insideActive() && placeInside()) return;
  if (box.classList.contains('inside')) undock();
  const input = firstVisible(APP.composer);
  const main = input && findPane(input);
  // An element whose position our room-making doesn't change (Doubao: the input's centred wrapper;
  // Codex: the input root itself, since its padding moves only the box inside it).
  const wrap = APP.natural === 'parent' ? input?.parentElement : input;
  if (!main || !wrap) return hide();
  const m = main.getBoundingClientRect(), i = input.getBoundingClientRect();
  let w = wrap.getBoundingClientRect();
  // Measuring the box itself while our margin moves it: take that margin back out, or the room we
  // made would count as free space next time and the box would slide back and forth every tick.
  if (wrap === input && APP.shift === 'margin') {
    const pushed = parseFloat(getComputedStyle(input).marginLeft) || 0;
    if (pushed) w = { left: w.left - pushed, right: w.right, top: w.top, bottom: w.bottom, width: w.width, height: w.height };
  }
  const left = leftBound(main, w.left);
  if (i.height === 0) return hide(); // no chat input on this screen

  if (pos.mode === 'bottom-left') {
    // Too little space to share: hide, or (APP.narrow 'above': Cursor's side-panel chat, which is
    // nearly always this narrow) stand above the input as below.
    const narrow = m.right - left < 520;
    if (narrow && APP.narrow !== 'above') return hide();
    const naturalGap = w.left - left;
    if (narrow || (APP.shift === 'none' && naturalGap < MIN_GAP)) {
      // The input can't be pushed aside (DeepSeek Harness): stand just above its left end instead.
      setRoom(0);
      const width = Math.min(SIZE, Math.max(80, (m.right - left) / 4)), height = width * ASPECT;
      return show(w.left + 8, i.top - height - 8, width, height);
    }
    // The room she needs grows and shrinks with her size.
    const room = Math.max(0, Math.round(MIN_GAP * SIZES[sizeKey]) - naturalGap);
    setRoom(room);
    const gap = naturalGap + room; // where the input's left edge ends up (ignores the margin animation)
    const width = Math.min(SIZE, gap - 16);
    const height = Math.min(width * ASPECT, i.bottom - m.top - 120);
    return show(left + (gap - width) / 2, i.bottom - height, width, height);
  }

  // Everywhere else she doesn't need room next to the input, so it keeps its normal size.
  setRoom(0);
  const width = Math.max(80, Math.min(SIZE, (m.right - left) / 4)); // smaller only in a very narrow pane
  const height = width * ASPECT;
  let x, y;
  if (pos.mode === 'top-left') { x = left + EDGE; y = m.top + HEADER; }
  else if (pos.mode === 'top-right') { x = m.right - EDGE - width; y = m.top + HEADER; }
  else if (pos.mode === 'bottom-right') {
    const gapRight = m.right - i.right;
    if (gapRight >= width + EDGE) { x = i.right + (gapRight - width) / 2; y = i.bottom - height; } // beside the input
    else { x = m.right - EDGE - width; y = i.top - height - 8; }                                // or just above it
  } else { x = pos.x * innerWidth; y = pos.y * innerHeight; }                                    // custom
  show(x, y, width, height);
}

function show(x, y, width, height) {
  // Always fully on screen, whatever the window size.
  x = Math.max(0, Math.min(x, innerWidth - width));
  y = Math.max(0, Math.min(y, innerHeight - height));
  Object.assign(box.style, {
    display: 'block',
    width: width + 'px', height: height + 'px',
    left: x + 'px', top: y + 'px',
  });
  box.style.setProperty('--avatar-w', String(width));   // her name plate scales with her
  placeThink(x, y, width, height);
}

// ---- "In the AI's replies" (right-click > Where she stands; per app, off by default) ----
// Instead of a corner, every reply gets its own avatar at its bottom left, in a small scene tinted for
// the topic, with a topic tag: older replies a still picture of their own expert, the newest reply the
// live avatar (the box itself moves into its panel, so her walks, idle loop and reactions all happen
// there). She follows the conversation down: the newest reply's bottom is next to the chat box, where
// the chat stays while the AI writes (a top-right spot scrolled out of view on long replies).
// The reply gets room reserved at its bottom (data-doubao-mods-room: padding) and the panel stands in
// it (position: absolute), so the reply's own text and buttons are never pushed around, and an app
// that re-draws the reply's text while it streams can't move her. Same in all four apps.
// She appears in a new reply as soon as the app shows it, while the AI is still thinking, or, in apps
// that show the reply only once it's being written, under the new question (see pendingHost); the
// handover to the new expert plays there. In a new chat she stands in her bottom-left corner.
const INSIDE_KEY = `doubao-mods-avatar-inside:${APP.id}`;
let insideOn = false;
try { insideOn = localStorage.getItem(INSIDE_KEY) === '1'; } catch {}
const insideAvailable = () => !IN_PET && !!APP.answers && !!APP.userMessages;
const insideActive = () => insideOn && insideAvailable() && !petOn && !hiddenHere;
function setInside(on) {
  insideOn = on;
  try { on ? localStorage.setItem(INSIDE_KEY, '1') : localStorage.removeItem(INSIDE_KEY); } catch {}
  if (!on) clearPanels();
  place();
}

const PANEL_CLASS = 'doubao-mods-inside';
const ROOM_ATTR = 'data-doubao-mods-room';   // on a reply: room at its bottom for its panel
const GROW_ATTR = 'data-doubao-mods-grow';   // on a list row of fixed height around one: let it grow
const SPACE_ATTR = 'data-doubao-mods-space'; // on the fixed-height list around such rows: space below it
let panelSeq = 0;
const panels = new Map();   // reply element -> its panel

// Each expert's scene gets its own soft colour.
const HUES = { casual: 330, chef: 28, doctor: 190, programmer: 220, artist: 300, teacher: 145, scientist: 175,
  business: 210, lawyer: 35, athlete: 5, musician: 268, explorer: 95, astronaut: 238, engineer: 48, gamer: 285, gardener: 115 };
const hueOf = expert => {
  const b = baseOf(expert);
  if (b in HUES) return HUES[b];
  let h = 0;
  for (const c of b) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};

// Which expert each question got (the AI model's choice), so older replies keep theirs; kept per app
// (only a short hash of each question, at most 400).
const QT_KEY = `doubao-mods-avatar-qtopics:${APP.id}`;
let qTopics = {};
try { qTopics = JSON.parse(localStorage.getItem(QT_KEY)) || {}; } catch {}
const hashOf = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
function rememberTopic(question, outfit) {
  if (!question) return;
  qTopics[hashOf(question)] = outfit ?? '';
  const keys = Object.keys(qTopics);
  if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete qTopics[k];
  try { localStorage.setItem(QT_KEY, JSON.stringify(qTopics)); } catch {}
}

const userMessageEls = () => [...document.querySelectorAll(APP.userMessages)].filter(isVisible);
// The replies on screen (the outermost match, where an app's selectors match a reply and a part of it).
function replyEls() {
  const all = [...document.querySelectorAll(APP.answers)].filter(isVisible);
  return all.filter(r => !all.some(o => o !== r && o.contains(r)));
}
const follows = (a, b) => !!(b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);  // a after b
// The chat's scrolling area: the nearest block around el that scrolls.
function scrollerOf(el) {
  for (let e = el?.parentElement; e && e !== document.body; e = e.parentElement) {
    const oy = getComputedStyle(e).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight + 1) return e;
  }
  return document.scrollingElement;
}
// The app doesn't show a reply to the newest question yet (not even a "thinking" one).
function awaitingReply() {
  const q = userMessageEls().at(-1);
  if (!q) return false;
  const r = replyEls().at(-1);
  return !r || !follows(r, q);
}
// Where a panel goes: the largest block that holds this reply (or question) and its own question,
// but no other question or reply, never the chat box, and no wider than the chat column. So in Codex
// it's the whole turn: she stands after its "Working for ..." status line and the answer, not over
// them; elsewhere it's the reply's own block. Blocks with display: contents (no box of their own)
// are passed over. A full-window row (Doubao's list rows, Codex's thread view) would put her at the
// window's left edge instead of the text's, hence the width limit.
function blockFor(el, own) {
  const users = userMessageEls(), reps = replyEls();
  const others = [...users.filter(u => u !== own && u !== el), ...reps.filter(r => r !== el)];
  const composer = firstVisible(APP.composer);
  const columnWidth = (composer || el).getBoundingClientRect().width;
  let host = el;
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    if ((composer && p.contains(composer)) || others.some(o => p.contains(o))) break;
    if (getComputedStyle(p).display === 'contents') continue;
    if (p.getBoundingClientRect().width > columnWidth * 1.15) break;
    // A row of a scrolling list whose height the app sets itself (Codex): she goes in the block
    // inside it, and the row is let grow with it (GROW_ATTR), or she'd stand on the next turn.
    if (p.style.height || p.style.maxHeight) break;
    host = p;
  }
  return host.getBoundingClientRect().width >= columnWidth * 0.6 ? host : null;
}
const questionOf = reply => userMessageEls().filter(q => follows(reply, q)).at(-1) || null;
// While the app doesn't show the reply to a new question yet (Codex and DeepSeek Harness add it only
// when the AI starts writing; Doubao and Yuanbao show it at once, with loading dots), she waits under
// the question instead, so she's in view while the AI thinks (in Codex that's the same spot the
// reply will use: the end of the turn, after the working status).
function pendingHost() {
  if (!awaitingReply()) return null;
  const q = userMessageEls().at(-1);
  return blockFor(q, q);
}

// The topic a reply's question got: the remembered choice. Not remembered (an older chat): the model
// is asked (once per question; the panel updates when it answers), and only while the model isn't
// available do the keywords stand in (and the model is asked again once it is). undefined: asked,
// not answered yet.
const replyAsked = new Set();
function topicForReply(reply) {
  const qs = userMessageEls().filter(q => follows(reply, q)).map(q => q.innerText.trim()).filter(Boolean);
  if (!qs.length) return null;
  const k = hashOf(qs.at(-1));
  if (k in qTopics) return qTopics[k] ? topicByOutfit(qTopics[k]) : null;
  if (modelReady !== false && typeof window.__doubaoTopic === 'function') {
    if (!replyAsked.has(k)) {
      replyAsked.add(k);
      const before = qs.length > 1 ? qTopics[hashOf(qs.at(-2))] || null : null;   // the topic just before it
      window.__doubaoTopic(JSON.stringify({ id: 'r:' + k, questions: qs.slice(-6), current: before }));
    }
    return undefined;
  }
  return keywordTopicOf(qs);
}
function onReplyTopic(resp) {
  const k = resp.id.slice(2);
  replyAsked.delete(k);
  if (!resp.ready) { modelReady = false; forgetReplyLooks(); return; }   // keywords meanwhile
  qTopics[k] = resp.outfit ?? '';
  try { localStorage.setItem(QT_KEY, JSON.stringify(qTopics)); } catch {}
  forgetReplyLooks();
}
// Older replies work out their expert again on the next tick (a new answer, or the model came back).
function forgetReplyLooks() {
  for (const p of panels.values()) if (p.dataset.byKeywords || !p.dataset.own) { delete p.dataset.own; delete p.dataset.byKeywords; }
}

function makePanel() {
  const p = document.createElement('div');
  p.className = PANEL_CLASS;
  p.id = 'doubao-mods-inside-' + (++panelSeq);   // swept away with the other mod elements on reload
  p.contentEditable = 'false';
  p.setAttribute('aria-hidden', 'true');
  const pic = document.createElement('img');
  pic.alt = '';
  pic.draggable = false;
  const tag = document.createElement('span');
  tag.className = 'tag';
  p.append(pic, tag);
  // The live panel holds the avatar itself, whose own handler opens the menu.
  p.addEventListener('contextmenu', e => { if (!box.contains(e.target)) openMenu(e); });
  return p;
}
// topic: what the tag names (the label over her head isn't shown in a reply). A topic without its
// own expert picture still gets its tag, though the everyday look stands there.
function setPanelExpert(p, expert, topic = baseOf(expert) === EVERYDAY_BASE ? null : topicOfExpert(expert)) {
  const key = expert + '|' + (topic?.outfit ?? '');
  if (p.dataset.key === key) return;
  p.dataset.key = key;
  p.dataset.expert = expert;
  p.style.setProperty('--hue', hueOf(expert));
  const pic = p.querySelector('img');
  pic.src = standOf(expert) || stillOf(expert);
  pic.classList.toggle('stand', !!standOf(expert));
  pic.classList.toggle('whole', isWhole(expert));
  p.querySelector('.tag').textContent = [topic ? `${topic.emoji} ${topic.label}` : '', personName(expert)].filter(Boolean).join(' · ');
}

// One answer can come in several steps (DeepSeek Harness: thinking, tools, "Let me check...", then
// the answer; Codex threads too): only the last one before the next question gets a panel, so an
// expert isn't repeated within one answer (while it's being written, she moves down with it).
function lastPerAnswer(items) {
  const users = userMessageEls();
  return items.filter(([r], i) => {
    const next = items[i + 1]?.[0];
    return !next || users.some(u => follows(u, r) && follows(next, u));
  });
}

// Put a panel at the bottom left of every answer (back in, if the app re-drew the reply), and return
// the newest one, which holds the live avatar.
function ensurePanels() {
  const dark = box.classList.contains('on-dark');
  let newest = null, changed = false;
  const seen = new Set(), grow = new Set();
  const reps = replyEls(), users = userMessageEls();
  // Was the chat scrolled to the bottom before we change anything? (See keepAtBottom.)
  const scroller = scrollerOf(reps.at(-1) || users.at(-1));
  const atBottom = scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60;
  // [the block the panel goes in, the reply it's for (null: a question still waiting for one)]
  const spots = lastPerAnswer(reps.map(r => [r])).map(([r]) => [blockFor(r, questionOf(r)), r]);
  const pending = pendingHost();
  if (pending) spots.push([pending, null]);   // the newest: under the question, until its reply shows
  for (const [host, reply] of spots) {
    if (!host || seen.has(host)) continue;
    let p = panels.get(host);
    if (!p) { p = makePanel(); panels.set(host, p); }
    p.reply = reply;
    if (!host.hasAttribute(ROOM_ATTR)) { host.setAttribute(ROOM_ATTR, ''); changed = true; }
    // The fixed-height list row just around it (Codex sets each turn's height itself) may grow. Only
    // that turn's own row: never a block holding other turns too (Codex's whole list has a set
    // height as well, and overriding it threw off its scrolling).
    for (let a = host.parentElement, i = 0; a && i < 3; a = a.parentElement, i++) {
      if (!a.style.height) continue;
      if (![...users, ...reps].some(o => a.contains(o) && !host.contains(o))) grow.add(a);
      break;
    }
    if (p.parentElement !== host) { host.append(p); changed = true; }
    p.classList.toggle('dark', dark);
    seen.add(host);
    newest = p;
  }
  for (const [host, p] of panels) if (!seen.has(host)) { p.remove(); host.removeAttribute(ROOM_ATTR); panels.delete(host); changed = true; }
  for (const a of grow) if (!a.hasAttribute(GROW_ATTR)) { a.setAttribute(GROW_ATTR, ''); changed = true; }
  for (const a of document.querySelectorAll(`[${GROW_ATTR}]`)) if (!grow.has(a)) { a.removeAttribute(GROW_ATTR); changed = true; }
  // The list around those rows keeps the height the app set (Codex), so a grown last turn hangs out of
  // its bottom: cut off, and the chat can't scroll down to her. Its own height stays (overriding it
  // threw off Codex's scrolling); the difference goes in as space below the list instead.
  const spaced = new Map();
  for (const a of grow) {
    for (let l = a.parentElement, i = 0; l && i < 4; l = l.parentElement, i++) {
      if (!l.style.height) continue;
      const over = Math.ceil(l.scrollHeight - l.clientHeight);
      if (over > 1) spaced.set(l, over);
      break;
    }
  }
  for (const [l, over] of spaced) {
    if (l.getAttribute(SPACE_ATTR) === String(over)) continue;
    l.setAttribute(SPACE_ATTR, String(over));
    l.style.setProperty('margin-bottom', over + 'px', 'important');
    changed = true;
  }
  for (const l of document.querySelectorAll(`[${SPACE_ATTR}]`)) if (!spaced.has(l)) {
    l.removeAttribute(SPACE_ATTR); l.style.removeProperty('margin-bottom'); changed = true;
  }
  // Her room makes the chat taller just after the app has scrolled to its end, and the app then
  // thinks you scrolled up and stops following the answer (Codex). So if you were at the bottom,
  // stay there.
  if (changed && atBottom) scroller.scrollTop = scroller.scrollHeight;
  for (const [host, p] of panels) {
    const live = p === newest;
    p.classList.toggle('live', live);
    // During a walk: the tag and tint of who's coming in, and the topic she's coming in for.
    // (Unknown right after a reload of the mods: then the topic of whoever stands there.)
    if (live) setPanelExpert(p, target, targetTopic || undefined);
    else {
      // Its own expert and topic, worked out once (again after a change of avatar style).
      if (p.dataset.look !== look || !p.dataset.own) {
        const topic = p.reply ? topicForReply(p.reply) : null;
        if (topic === undefined) { setPanelExpert(p, EVERYDAY, null); continue; }   // the model is being asked
        p.dataset.look = look;
        p.dataset.own = expertOf(topic) || EVERYDAY;
        p.dataset.ownTopic = topic?.outfit ?? '';
        if (modelReady === false) p.dataset.byKeywords = '1'; else delete p.dataset.byKeywords;
      }
      setPanelExpert(p, p.dataset.own, topicByOutfit(p.dataset.ownTopic));
    }
  }
  return newest;
}

function clearPanels() {
  for (const p of panels.values()) p.remove();
  panels.clear();
  for (const p of document.querySelectorAll(`.${PANEL_CLASS}`)) p.remove();
  for (const r of document.querySelectorAll(`[${ROOM_ATTR}]`)) r.removeAttribute(ROOM_ATTR);
  for (const r of document.querySelectorAll(`[${GROW_ATTR}]`)) r.removeAttribute(GROW_ATTR);
  for (const l of document.querySelectorAll(`[${SPACE_ATTR}]`)) { l.removeAttribute(SPACE_ATTR); l.style.removeProperty('margin-bottom'); }
  if (box.classList.contains('inside')) undock();
}

// Moving the box pauses her videos (taken out of the page for a moment): carry on where they were.
function resumeMedia() {
  if (idleFor && !walking) { const e = idleFor; idleFor = null; startIdle(e, false); }
  if (walking && video.paused && !video.ended) video.play().catch(() => {});
}
function undock() {
  box.classList.remove('inside');
  document.body.appendChild(box);
  resumeMedia();
}

// Called by place(): true if she's in a reply now.
function placeInside() {
  const live = ensurePanels();
  if (!live) return false;
  if (box.parentElement !== live) {
    box.classList.add('inside');
    live.append(box);
    resumeMedia();
  }
  setRoom(0);
  // Fill the card exactly. (Not its on-screen size in px: Codex draws its chat under a CSS zoom of
  // ~0.9, so those px came out 10% small and left an empty strip at her right and bottom.)
  Object.assign(box.style, { display: 'block', left: '0px', top: '0px', width: '100%', height: '100%' });
  const r = live.getBoundingClientRect();
  placeThink(r.left, r.top, live.offsetWidth, live.offsetHeight);   // where on screen; its own size
  return true;
}

// A new question's expert, waiting for its reply to start (see wear).
let held = null;
function releaseHeld() {
  const t = held.topic;
  held = null;
  place();
  goTo(expertOf(t) || EVERYDAY, t);
}
// For checking from DevTools: __doubaoMods.debugInside()
M.debugInside = () => ({ on: insideOn, active: insideActive(), held: held && (held.topic?.outfit ?? null), awaiting: awaitingReply(),
  shown, target, walking, panels: panels.size, lastKey, questions: userMessageEls().length, replies: replyEls().length });

// ---- Following the answer down ----
// Her room under the reply makes the chat ~200 px taller below the text, and the apps judge "you're
// at the bottom" with a smaller margin, so as a long reply grows they decide you've scrolled up and
// stop following it (Codex, Yuanbao); ChatGPT's chat page doesn't follow an answer at all (it pins
// your question near the top and shows a ↓ button). So while the AI answers, the chat is kept at its
// end, from the moment each answer starts. Scrolling up yourself (mouse wheel, the scrollbar,
// Page Up / Up arrow / Home) stops that; scrolling back to the bottom starts it again.
// After an answer ends the chat still grows for a while: Yuanbao types the answer out over several
// seconds after it has arrived (its Stop button is gone by then), and Doubao adds its follow-up
// question chips and "related videos" a few seconds later. So for 15 s after an answer ends, any
// growth is followed too, unless you've scrolled up or clicked in the chat (expanding something then
// shouldn't pull you down).
const AFTER_ANSWER_MS = 15000;
let following = false, followScroller = null, followPhase = 'idle';
let answerEndedAt = -Infinity;   // (no answer has ended yet)
const followGap = sc => sc.scrollHeight - sc.scrollTop - sc.clientHeight;
const onFollowWheel = e => { if (e.deltaY < 0) following = false; };
// Grabbing its scrollbar: the scroller's own (the press lands on the scroller itself) or a drawn one
// beside it (Yuanbao's SimpleBar).
const onFollowPointer = e => {
  if (!followScroller) return;
  const bar = e.target.closest?.('[class*="scrollbar"], [class*="simplebar-track"]');
  if (e.target === followScroller || (bar && followScroller.parentElement?.parentElement?.contains(bar))) following = false;
  // After the answer: a click in the chat (you're doing something there) ends the following.
  else if (phase === 'idle' && followScroller.contains(e.target)) following = false;
};
const onFollowKey = e => {
  if (['PageUp', 'ArrowUp', 'Home'].includes(e.key) && !e.target.closest?.('input, textarea, [contenteditable="true"]')) following = false;
};
const onFollowScroll = () => { if (followScroller && phase !== 'idle' && followGap(followScroller) < 60) following = true; };
function setFollowScroller(sc) {
  if (sc === followScroller) return;
  if (followScroller) {
    followScroller.removeEventListener('wheel', onFollowWheel);
    followScroller.removeEventListener('pointerdown', onFollowPointer);
    followScroller.removeEventListener('scroll', onFollowScroll);
  }
  followScroller = sc;
  if (sc) {
    sc.addEventListener('wheel', onFollowWheel, { passive: true });
    sc.addEventListener('scroll', onFollowScroll, { passive: true });
  }
}
addEventListener('keydown', onFollowKey, true);
addEventListener('pointerdown', onFollowPointer, true);
function followAnswer() {
  if (!insideActive()) return;
  const sc = scrollerOf(replyEls().at(-1) || userMessageEls().at(-1));
  if (!sc || sc === document.scrollingElement) return;
  setFollowScroller(sc);
  // A new answer (you've just asked something): follow it, wherever the app put you. (Going by
  // "were you near the bottom" missed ChatGPT, which scrolls your question to the top first.)
  const now = performance.now();
  if (phase === 'idle' && followPhase !== 'idle') answerEndedAt = now;
  // Answering, or just finished (see AFTER_ANSWER_MS).
  const active = phase !== 'idle' || now - answerEndedAt < AFTER_ANSWER_MS;
  if (phase !== 'idle' && followPhase === 'idle') following = true;
  else if (phase !== 'idle' && !following && followGap(sc) < 60) following = true;   // you came back down
  followPhase = phase;
  if (active && following && followGap(sc) > 1) sc.scrollTop = sc.scrollHeight;
}

// A re-drawn reply can drop our panel (and the avatar in it): put it back before the next paint.
// The same watch keeps a growing answer in view (followAnswer).
let insideQueued = false;
const insideWatch = new MutationObserver(() => {
  if (insideQueued || !insideActive()) return;
  insideQueued = true;
  requestAnimationFrame(() => {
    insideQueued = false;
    if (!insideActive()) return;
    for (const p of panels.values()) if (!p.isConnected) { place(); break; }
    followAnswer();
  });
});
// Watching every change in the page costs something on each keystroke and streamed word, so it's on
// only while she's in the replies (syncInsideWatch, from tick).
let insideWatching = false;
function syncInsideWatch() {
  const want = insideActive();
  if (want === insideWatching) return;
  insideWatching = want;
  if (want) insideWatch.observe(document.body, { childList: true, subtree: true, characterData: true });
  else { insideWatch.disconnect(); insideQueued = false; }
}

// ---- The thought cloud and the topic bubble: in the empty space by her head, never over her ----
// Her outline comes from her standing picture's see-through pixels, sampled small once per picture,
// so it fits each expert (a tall chef's hat, a gamer's headset, hair worn up or down).
const CLOUD_W = 46, CLOUD_H = 26, CLOUD_BUMP = 0;   // .think .cloud (the glass capsule) size
const CLOUD_GAP = 12;                                // between her outline and the capsule (room for the beads)
const outlines = new Map();                          // picture src -> { cols, rows, left[], right[], top }
function outline() {
  if (outlines.has(img.src)) return outlines.get(img.src);
  if (!img.complete || !img.naturalWidth) return null;
  const cols = 48, rows = Math.round(cols * img.naturalHeight / img.naturalWidth);
  const cv = document.createElement('canvas');
  cv.width = cols;
  cv.height = rows;
  let data;
  try {
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, cols, rows);
    data = g.getImageData(0, 0, cols, rows).data;
  } catch { return null; }
  const left = new Int16Array(rows).fill(-1), right = new Int16Array(rows).fill(-1);
  let top = -1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (data[(r * cols + c) * 4 + 3] <= 40) continue;
    if (left[r] < 0) left[r] = c;
    right[r] = c + 1;
    if (top < 0) top = r;
  }
  const o = { cols, rows, left, right, top: Math.max(0, top) };
  if (outlines.size > 80) outlines.clear();
  outlines.set(img.src, o);
  return o;
}

let thinkAt = null;   // the last placement, redone when her picture changes
function placeThink(bx, by, w, h) {
  thinkAt = [bx, by, w, h];
  const o = outline();
  // Where the picture sits in her box (object-fit: contain, at the bottom), in box pixels.
  const nw = img.naturalWidth || 672, nh = img.naturalHeight || 720;
  const { dx, dy, dw, dh } = picRect(w, h, nw, nh, img.classList.contains('whole'));
  const rowAt = py => Math.floor((py - dy) / dh * o.rows);
  const xAt = c => dx + c / o.cols * dw;
  // Her outermost point on one side (+1 right, -1 left) between box heights a and b.
  const edge = (a, b, side) => {
    let v = side > 0 ? -Infinity : Infinity;
    if (o) for (let r = Math.max(0, rowAt(a)); r <= Math.min(o.rows - 1, rowAt(b)); r++) {
      if (o.left[r] < 0) continue;
      v = side > 0 ? Math.max(v, xAt(o.right[r])) : Math.min(v, xAt(o.left[r]));
    }
    return Number.isFinite(v) ? v : w * (side > 0 ? .7 : .3);
  };
  const headTop = o ? dy + o.top / o.rows * dh : h * .05;

  // The cloud's middle a little below the top of her head (beside her forehead), kept on screen.
  const top = Math.max(headTop + h * .06 - CLOUD_H / 2, CLOUD_BUMP + 4 - by);
  const lo = top - CLOUD_BUMP, hi = top + CLOUD_H + 12;   // the cloud and the puffs under it
  // Her right side if it fits on screen, else her left (near the window's right edge).
  let side = 1, left = edge(lo, hi, 1) + CLOUD_GAP;
  if (bx + left + CLOUD_W > innerWidth - 4) {
    const l = edge(lo, hi, -1) - CLOUD_GAP - CLOUD_W;
    if (bx + l >= 4) { side = -1; left = l; } else left = innerWidth - 4 - CLOUD_W - bx; // no room either side
  }
  box.classList.toggle('flip', side < 0);
  think.style.left = left + 'px';
  think.style.top = top + 'px';

  // Two puffs trailing from the cloud's lower corner down towards her head (outside her outline).
  const cx = side > 0 ? left + 8 : left + CLOUD_W - 8, cy = top + CLOUD_H - 3;
  const ay = top + CLOUD_H + 10;
  let ax = edge(ay - 3, ay + 3, side) + side * 3;
  ax = side > 0 ? Math.min(ax, cx - 4) : Math.max(ax, cx + 4);   // always down and inwards
  let vx = ax - cx, vy = ay - cy;
  const len = Math.hypot(vx, vy) || 1, reach = Math.min(len, 22);
  vx = vx / len * reach;
  vy = vy / len * reach;
  for (const [el, t] of [[puff1, .45], [puff2, .95]]) {
    el.style.left = (cx + vx * t - left) + 'px';
    el.style.top = (cy + vy * t - top) + 'px';
  }

  // The topic bubble: centred over the top of her head.
  let mid = w / 2;
  if (o && img.classList.contains('whole')) {
    // The fish girl's top rows are mostly the one strand of hair sticking up left of centre: centre
    // on her head instead (widest extent between 10% and 30% of her height: hair, ears, hat).
    let bottom = o.rows - 1;
    while (bottom > o.top && o.left[bottom] < 0) bottom--;
    let l = Infinity, rt = -Infinity;
    for (let r = o.top + Math.floor((bottom - o.top) * .1); r <= o.top + (bottom - o.top) * .3; r++) {
      if (o.left[r] >= 0) { l = Math.min(l, o.left[r]); rt = Math.max(rt, o.right[r]); }
    }
    if (rt > l) mid = xAt((l + rt) / 2);
  } else if (o) {
    let sum = 0, n = 0;
    for (let r = o.top; r < Math.min(o.rows, o.top + o.rows * .08); r++) if (o.left[r] >= 0) { sum += (o.left[r] + o.right[r]) / 2; n++; }
    if (n) mid = xAt(sum / n);
  }
  bubble.style.left = mid + 'px';
  // Never above the window's top edge (a large avatar in the pet window, or near the top of the app):
  // then it overlaps the top of her head a little instead of being cut off. Its height: as drawn, or
  // at least one line plus padding, 2.16em (see the .bubble style), while it's still empty.
  const bubbleH = Math.max(bubble.offsetHeight, parseFloat(getComputedStyle(bubble).fontSize) * 2.16);
  bubble.style.top = Math.max(headTop - 6, 10 - by + bubbleH) + 'px';   // 10: her breathing lifts her ~5 px
}
img.addEventListener('load', () => { if (thinkAt) placeThink(...thinkAt); });

// ---- Drag her anywhere ----
let dragging = false;
box.addEventListener('pointerdown', e => {
  if (e.button !== 0 || box.classList.contains('inside')) return;   // in a reply she stays put
  if (IN_PET) return petDrag(e);
  const start = { x: e.clientX, y: e.clientY }, r = box.getBoundingClientRect();
  let moved = false;
  const move = ev => {
    if (!moved && Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) < 5) return;
    if (!moved) {
      moved = dragging = true;
      box.classList.add('dragging');
      box.setPointerCapture?.(e.pointerId);
      setRoom(0); // the input gets its normal width back while she's away from the corner
    }
    box.style.left = Math.max(0, Math.min(r.left + ev.clientX - start.x, innerWidth - r.width)) + 'px';
    box.style.top = Math.max(0, Math.min(r.top + ev.clientY - start.y, innerHeight - r.height)) + 'px';
  };
  const up = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    if (!moved) return;
    dragging = false;
    box.classList.remove('dragging');
    const b = box.getBoundingClientRect();
    setPos({ mode: 'custom', x: b.left / innerWidth, y: b.top / innerHeight });
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
});

// Pet window: dragging her moves the whole window (the pet's main process follows the cursor).
// Screen coordinates tell a drag from a click, since the window moves along under the cursor.
function petDrag(e) {
  const start = { x: e.screenX, y: e.screenY };
  let moved = false;
  box.setPointerCapture?.(e.pointerId);
  const move = ev => {
    if (moved || Math.abs(ev.screenX - start.x) + Math.abs(ev.screenY - start.y) < 5) return;
    moved = true;
    box.classList.add('dragging');
    window.petBridge?.drag('start');
  };
  const up = () => {
    box.removeEventListener('pointermove', move);
    box.removeEventListener('pointerup', up);
    box.removeEventListener('pointercancel', up);
    if (!moved) return;
    window.petBridge?.drag('end');
    box.classList.remove('dragging');
  };
  box.addEventListener('pointermove', move);
  box.addEventListener('pointerup', up);
  box.addEventListener('pointercancel', up);
}

// Pet window: is this point (window coordinates) on her, or on the see-through space around her?
// Judged from her standing picture's pixels (sampled small), so clicks pass through the gaps.
const hitCanvas = document.createElement('canvas');
let hitFor = '';
function onHer(x, y) {
  const r = box.getBoundingClientRect();
  if (box.style.display === 'none' || x < r.left || x >= r.right || y < r.top || y >= r.bottom) return false;
  if (walking) return true;                       // mid-walk: her whole box counts
  try {
    if (!img.complete || !img.naturalWidth) return true;   // picture not decoded yet
    if (hitFor !== img.src + img.className) {
      hitCanvas.width = 64;
      hitCanvas.height = Math.round(64 * ASPECT);
      const g = hitCanvas.getContext('2d', { willReadFrequently: true });
      g.clearRect(0, 0, hitCanvas.width, hitCanvas.height);
      // Drawn the way the page shows it (object-fit: contain, at the bottom; see picRect).
      const { dx, dy, dw, dh } = picRect(hitCanvas.width, hitCanvas.height, img.naturalWidth, img.naturalHeight, img.classList.contains('whole'));
      g.drawImage(img, dx, dy, dw, dh);
      hitFor = img.src + img.className;
    }
    const px = Math.floor((x - r.left) / r.width * hitCanvas.width), py = Math.floor((y - r.top) / r.height * hitCanvas.height);
    return hitCanvas.getContext('2d').getImageData(px, py, 1, 1).data[3] > 25;
  } catch { return true; }
}

// ---- Right-click menu: who she is, her style, where she stands, this app's settings ----
// One builder for both places: in the app it's shown in the page; on the desktop pet the same menu
// (same look, same choices) is shown in a small menu window of the pet program (pet/menu.html),
// since the pet's own window is only big enough for her. Every clickable part has a data-k number;
// the click runs that number's action, here or (pet) when the menu window reports the click.
let menu = null, menuActs = [];
function closeMenu() {
  menu?.remove();
  menu = null;
  removeEventListener('pointerdown', outside, true);
  removeEventListener('keydown', escape, true);
}
const outside = e => { if (menu && !menu.contains(e.target)) closeMenu(); };
const escape = e => { if (e.key === 'Escape') closeMenu(); };
const nameOf = expert => {
  const b = baseOf(expert);
  if (ZH) return EXPERT_ZH[b] || b;
  return b === EVERYDAY_BASE ? 'Everyday' : b[0].toUpperCase() + b.slice(1);
};
// Pet only: what its app last told it (avatar style, rainbow chat box), so the menu can offer them.
let hostState = null;
// The pet's app (its English name, e.g. 'Claude'), and that name as shown (豆包 in Chinese).
const PET_LABEL = IN_PET ? (new URLSearchParams(location.search).get('label') || '') : '';
const PET_NAME = ZH ? (APP_ZH[PET_LABEL] || PET_LABEL || '应用') : (PET_LABEL || 'the app');
// In Chinese, a space only between a Latin-script name (Claude) and Chinese characters.
const PET_NAME_ = /[A-Za-z]$/.test(PET_NAME) ? PET_NAME + ' ' : PET_NAME;   // before Chinese
const _PET_NAME = /^[A-Za-z]/.test(PET_NAME) ? ' ' + PET_NAME : PET_NAME;   // after Chinese
const _PET_NAME_ = /^[A-Za-z]/.test(PET_NAME_) ? ' ' + PET_NAME_ : PET_NAME_;   // between Chinese
// Docked (the Claude pet): she stands on her app's window and moves with it, so "Where she stands"
// means spots on that window (bottom-left: beside the chat box), and "back into the window" becomes
// "hide her" (Claude has no in-app avatar).
const PET_DOCKED = IN_PET && new URLSearchParams(location.search).get('docked') === '1';

function buildMenu() {
  const el = document.createElement('div');
  el.id = 'doubao-mods-avatar-menu';
  const acts = [];
  // A clickable row: act() runs on click; it returns true to keep the menu open.
  const clickable = (node, act) => { node.dataset.k = acts.push(act) - 1; return node; };
  const title = (text, section) => {
    const t = document.createElement('div');
    t.className = 'title' + (section ? ' section' : '');
    t.textContent = text;
    el.append(t);
  };
  const row = (tickText, label, act) => {
    const item = document.createElement('div');
    item.className = 'item';
    const tick = document.createElement('span');
    tick.className = 'tick';
    tick.textContent = tickText;
    const text = document.createElement('span');
    text.textContent = label;
    item.append(tick, text);
    el.append(clickable(item, act));
    return text;
  };

  if (IN_PET) title(tr(`${PET_NAME}'s avatar`, `${PET_NAME_}的头像`));

  // Who: pick an expert. She walks in, until your next question picks again.
  title(tr('Who should be here?', '请谁来？'), IN_PET);
  const grid = document.createElement('div');
  grid.className = 'experts';
  for (const expert of lineup) {
    const topic = expert === EVERYDAY ? null : topicOfExpert(expert);
    const item = document.createElement('div');
    item.className = 'item expert' + (expert === target ? ' current' : '');
    item.title = [personName(expert), topic ? `${topic.emoji} ${topic.label}` : tr('Everyday look', '日常装扮')].filter(Boolean).join(' · ');
    const face = document.createElement('span');
    face.className = 'face' + (isWhole(expert) ? ' whole' : '');
    face.style.backgroundImage = `url("${stillOf(expert)}")`;
    const text = document.createElement('span');
    text.textContent = nameOf(expert);
    item.append(face, text);
    grid.append(clickable(item, () => wear(topic)));
  }
  el.append(grid);

  // Style: different people, or one person changing outfits (when that set is installed). The pet
  // follows its app's style, so there the choice goes to the app (and comes back to the pet).
  const canStyle = Object.keys(LOOKS).filter(lookAvailable).length > 1 && (!IN_PET || hostState?.look);
  if (canStyle) {
    title(tr('Avatar style', '头像风格'), true);
    for (const [key, { label }] of Object.entries(LOOKS)) {
      if (!lookAvailable(key)) continue;
      row(look === key ? '✓' : '', label, () => {
        if (IN_PET) return void window.petBridge?.act('look', key);
        if (setLook(key)) wear(topicByOutfit(wornOutfit));   // same topic, the other style's expert
      });
    }
  }

  // Size: four buttons in a row (each pet window has its own).
  title(tr('Size', '大小'), true);
  const sizes = document.createElement('div');
  sizes.className = 'dm-sizes';
  for (const key of Object.keys(SIZES)) {
    const b = document.createElement('div');
    b.className = 'dm-size' + (key === sizeKey ? ' dm-on' : '');
    b.textContent = SIZE_NAMES[key];
    sizes.append(clickable(b, () => setSize(key)));
  }
  el.append(sizes);

  // Where she stands: a tiny picture of the window (the pet: of the screen). Click one of its
  // corners; the purple dot is her. (Class names start with dm-: the apps' own stylesheets use
  // plain names like "fixed".)
  const stand = document.createElement('div');
  stand.className = 'dm-stand';
  const words = document.createElement('div');
  words.className = 'dm-words';
  words.append(makeEl('div'), makeEl('div', 'dm-sub'));
  words.firstChild.textContent = tr('Where she stands', '她站在哪里');
  const petFree = PET_DOCKED && hostState?.free === true;   // a docked pet set free on the desktop
  words.querySelector('.dm-sub').textContent = petFree ? tr('Pick a screen corner, or drag her', '选一个屏幕角落，或拖动她')
    : PET_DOCKED ? tr(`Pick a spot on the ${PET_NAME} window, or drag her`, `在${_PET_NAME_}窗口上选一个位置，或拖动她`)
    : IN_PET ? tr('Pick a screen corner, or drag her', '选一个屏幕角落，或拖动她')
    : insideOn && insideAvailable() ? tr("In the AI's replies", '在 AI 的回答里')
    : pos.mode === 'custom' ? tr('Where you dragged her', '你拖到的位置') : tr('Pick a corner, or drag her', '选一个角落，或拖动她');
  const map = document.createElement('div');
  map.className = 'dm-map' + (IN_PET ? ' dm-screen' : '');
  for (const [mode, name] of Object.entries(CORNERS)) {
    const q = document.createElement('div');
    q.className = `dm-q dm-${mode}` + (!IN_PET && !insideOn && pos.mode === mode ? ' dm-on' : '');
    q.dataset.corner = mode;   // the pet's menu window marks the current one (it knows the screen)
    const lower = ZH ? name : name.toLowerCase();
    q.title = PET_DOCKED && !petFree
      ? (mode === 'bottom-left' ? tr('Beside the chat box (default)', '输入框旁边（默认）') : tr(`${name} of the ${PET_NAME} window`, `${PET_NAME_}窗口的${name}`))
      : IN_PET ? tr(`${name} of the screen`, `屏幕${lower}`)
      : name + (mode === 'bottom-left' ? tr(' (default)', '（默认）') : '');
    q.append(document.createElement('i'));
    map.append(clickable(q, () => {
      if (IN_PET) return void window.petBridge?.act('corner', mode);
      if (insideOn) setInside(false);   // a corner again, instead of the replies
      setPos({ mode });
    }));
  }
  if (IN_PET || (pos.mode === 'custom' && !insideOn)) {
    // Dragged: the dot sits where she is (the pet's menu window places it on the screen picture).
    const dot = document.createElement('i');
    dot.className = 'dm-here';
    if (IN_PET) dot.hidden = true;
    else {
      const cx = pos.x + SIZE / 2 / innerWidth, cy = pos.y + SIZE * ASPECT * 0.6 / innerHeight; // her middle
      dot.style.left = Math.max(8, Math.min(92, cx * 100)) + '%';
      dot.style.top = Math.max(12, Math.min(88, cy * 100)) + '%';
    }
    map.append(dot);
  }
  stand.append(words, map);
  if (!(PET_DOCKED && hostState?.where === 'chat')) el.append(stand);   // in the chat she goes with the reply
  // Or inside the AI's replies (see "In the AI's replies").
  if (insideAvailable()) {
    const text = row(insideOn ? '✓' : '', tr("💬 In the AI's replies", '💬 在 AI 的回答里'), () => setInside(!insideOn));
    text.parentElement.title = tr('She stands in the newest reply, the text wrapping round her; older replies keep their own expert',
      '她站在最新的回答里，文字环绕着她；之前的回答保留各自的专家');
  }

  // This app's own settings: the rainbow style (15-ring.js, if installed: the chat box ring and the
  // rainbow greeting) and pet mode.
  let appTitle = false;
  const appSection = () => { if (!appTitle) { appTitle = true; title(IN_PET ? tr(`${PET_NAME} only`, `仅限${_PET_NAME}`) : tr('This app only', '仅限此应用'), true); } };
  const ring = IN_PET ? hostState?.ring : (document.getElementById('doubao-mods-ring-style') ? ringOn() : null);
  if (typeof ring === 'boolean') {
    appSection();
    const text = row(ring ? '✓' : '', tr('🌈 Rainbow chat box & greeting', '🌈 彩虹输入框和问候语'), () => IN_PET ? window.petBridge?.act('ring', !ring) : setRing(!ring));
    text.parentElement.title = tr('The rainbow ring around the chat box and the rainbow greeting', '输入框周围的彩虹光环和彩虹问候语');
  }
  if (!IN_PET) {
    appSection();
    const text = row('🙈', tr('Hide the avatar in this app', '在此应用中隐藏头像'), () => setHiddenHere(true));
    text.parentElement.title = tr('Bring her back from the tray icon (by the clock), or press Alt+Shift+H here',
      '可以从时钟旁的托盘图标让她回来，或在这里按 Alt+Shift+H');
  }
  if (IN_PET) {
    appSection();
    if (PET_DOCKED) {
      // Where she is: on the app's window (beside its chat box, following it), in the chat (beside the
      // newest reply, where Claude's chat-avatar mod keeps a space for her), or free on the desktop like
      // the other apps' pets (always on top, where you put her). The menu offers the other two.
      const where = hostState?.where || (hostState?.free ? 'free' : 'docked');
      if (where !== 'docked') row('📌', tr(`Beside the ${PET_NAME} chat box`, `在${_PET_NAME_}的输入框旁边`), () => window.petBridge?.act('where', 'docked'));
      // Only where Claude's in-chat avatar mod is installed (PET.chatMod): without it she'd just vanish.
      if (where !== 'chat' && PET_INFO.chatMod && PET_LABEL === 'Claude') row('💬', tr('In the chat, beside each reply', '在聊天里，每条回答旁边'), () => window.petBridge?.act('where', 'chat'));
      if (where !== 'free') row('🐾', tr('Float freely on the desktop', '自由浮在桌面上'), () => window.petBridge?.act('where', 'free'));
      row('🙈', tr(`Hide her (turn the ${PET_NAME} pet off)`, `隐藏她（关闭${_PET_NAME_}宠物）`), () => window.petBridge?.act('back'));
    }
    else row('🏠', tr(`Back into the ${PET_NAME} window`, `回到${_PET_NAME_}窗口里`), () => window.petBridge?.act('back'));
  } else if (typeof window.__doubaoPet === 'function') {
    // Pet mode: she floats on the desktop instead (only while the background watcher runs). It's
    // this app's own setting; the other app keeps its avatar where it is.
    appSection();
    let confirming = false;
    const text = row('🐾', PET_INFO.available ? tr('Float on the desktop (pet mode)', '浮在桌面上（宠物模式）')
      : tr('Float on the desktop (pet mode, one-time setup)', '浮在桌面上（宠物模式，需一次性安装）'), () => {
      if (PET_INFO.available) return void window.__doubaoPet(JSON.stringify({ type: 'mode', on: true }));
      // First time on this PC: Electron has to be downloaded once, so ask with a second click.
      if (!confirming) { confirming = true; text.textContent = tr('Needs a one-time download (about 160 MB). Click again to set up.', '需要一次性下载（约 160 MB）。再点一次开始安装。'); return true; }
      window.__doubaoPet(JSON.stringify({ type: 'setup' }));
    });
  }
  return { el, acts };
}

// Run a menu action by its number; the menu closes unless the action says to keep it.
function runMenuAct(k) {
  const act = menuActs[k];
  if (!act) return;
  const keep = act() === true;
  if (!keep) closeMenu();
}

// The menu's own styles (the #doubao-mods-avatar-menu rules above), for the pet's menu window.
function menuCss() {
  const sheet = document.getElementById('doubao-mods-avatar-style')?.sheet;
  if (!sheet) return '';
  return [...sheet.cssRules].filter(r => r.cssText.includes('doubao-mods-avatar-menu')).map(r => r.cssText).join('\n');
}

// Right-click her (or, in the AI's replies, any reply's avatar: older replies show a still picture,
// and on a long reply the live one is often scrolled out of view) for the menu.
function openMenu(e) {
  e.preventDefault();
  closeMenu();
  const built = buildMenu();
  menuActs = built.acts;
  if (IN_PET) return window.petBridge?.menu({ html: built.el.outerHTML, css: menuCss() });
  menu = built.el;
  menu.addEventListener('click', ev => {
    const k = ev.target.closest('[data-k]')?.dataset.k;
    if (k !== undefined) runMenuAct(+k);
  });
  document.body.append(menu);
  const mr = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(e.clientX, innerWidth - mr.width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(e.clientY, innerHeight - mr.height - 8)) + 'px';
  addEventListener('pointerdown', outside, true);
  addEventListener('keydown', escape, true);
}
box.addEventListener('contextmenu', openMenu);

// While the window is minimised or covered, messages can measure as invisible; reacting then would
// reset her to the everyday look and walk the expert back in when the window returns. So topic
// changes wait until the window is visible again (placement doesn't need to).
// Apps that say nothing about their theme (DeepSeek Harness): a dark page background.
function darkBackground() {
  for (const el of [document.body, root]) {
    if (!el) continue;
    const c = getComputedStyle(el).backgroundColor, n = (c.match(/[\d.]+/g) || []).map(Number);
    if (n.length < 3 || (n.length > 3 && n[3] < 0.5)) continue;   // transparent: look further out
    const k = c.startsWith('color(') ? 255 : 1;                    // color(srgb 0.1 0.1 0.1)
    return 0.2126 * n[0] * k + 0.7152 * n[1] * k + 0.0722 * n[2] * k < 128;
  }
  return false;
}

// Hide or show her in this app (the menu item, Alt+Shift+H, or the tray icon through M.setAvatarHidden).
function setHiddenHere(on) {
  if (IN_PET || on === hiddenHere) return;
  hiddenHere = on;
  try { on ? localStorage.setItem(HIDE_KEY, '1') : localStorage.removeItem(HIDE_KEY); } catch {}
  if (on) { closeMenu(); idle.pause(); video.pause(); }
  place();
  if (!on && !petOn) startIdle(shown, false);
}
M.avatarHidden = () => hiddenHere;
M.setAvatarHidden = on => setHiddenHere(!!on);
const onHideKey = e => {
  if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyH') { e.preventDefault(); setHiddenHere(!hiddenHere); }
};
if (!IN_PET) addEventListener('keydown', onHideKey, true);

function tick() {
  if (M.generation !== GEN) return cleanup(); // a newer injection replaced this avatar
  syncInsideWatch();
  place();
  if (IN_PET) return;                          // the pet is told topic and phase by the app's copy
  if (!document.hidden) checkTopic();
  if (held && (!insideActive() || !awaitingReply() || pendingHost() || Date.now() - held.at > 60000)) releaseHeld();
  checkAnswer();
  followAnswer();
  if (phase !== 'idle') stirred(); else restIfQuiet();   // an answer in progress counts as you being there
  // Both apps declare their theme (Codex dark, Doubao light by default) through color-scheme.
  // Light or dark bubbles, following the app's theme (Doubao: data-theme; Codex: color-scheme; others: a
  // "dark" class). The desktop pet is told too, so it matches its app.
  // An explicit theme wins (data-theme / a "dark" or "light" class); color-scheme counts only when it
  // names dark alone: Qianwen (千问) declares "light dark" (it supports both) with data-theme="light".
  // Otherwise the page's own background decides.
  const cs = getComputedStyle(root).colorScheme;
  const declared = root.dataset.theme === 'dark' || root.classList.contains('dark') ? true
    : root.dataset.theme === 'light' || root.classList.contains('light') ? false
    : /\bdark\b/.test(cs) && !/\blight\b/.test(cs) ? true : null;
  const dark = declared ?? darkBackground();
  if (box.classList.contains('on-dark') !== dark) { box.classList.toggle('on-dark', dark); sendPet(); }
}
tick();
// Doubao swaps views, resizes panes and adds messages without telling us, so poll lightly.
timer = setInterval(tick, 400);
addEventListener('resize', place);

if (!petOn && !hiddenHere) {
  // Warm the cache with the everyday expert's walk-out, needed for the first topic change.
  clip(`${EVERYDAY}_out.webm`);
  startIdle(START);
} else {
  sendPet();   // pet mode: this app's pet starts with her current look and state
}

// Pet mode setup progress or an error (from the watcher), shown in her speech bubble.
M.onPetMode = info => {
  // From the pet's menu (through the watcher): the app keeps these settings, and tells the pet back.
  if (typeof info?.ring === 'boolean') return setRing(info.ring);
  if (info?.look) { if (setLook(info.look)) wear(topicByOutfit(wornOutfit)); return sendPet(); }
  const text = info?.status || info?.error;
  if (!text) return;
  bubble.textContent = '🐾 ' + text;
  bubble.classList.add('show');
  noticeShown = true;   // hovering doesn't swap it for the topic meanwhile
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => { bubble.classList.remove('show'); noticeShown = false; }, info.busy ? 60000 : 6000);
};

// Pet window: a name tag says whose avatar she is (each app has its own pet). It shows on hover, and
// for a few seconds when she first appears.
if (IN_PET) {
  const label = new URLSearchParams(location.search).get('label');
  if (label) {
    style.textContent += `
      #doubao-mods-avatar .tag {
        /* sized to her like her name plate (--avatar-w), so its spacing is in em */
        position: absolute; left: 50%; bottom: calc(56px * var(--avatar-w, 170) / 170); transform: translate(-50%, .36em); z-index: 3;   /* above her name plate */
        padding: .18em .82em; border-radius: .91em; white-space: nowrap; pointer-events: none;
        font: 600 calc(11px * var(--avatar-w, 170) / 170)/1.5 system-ui, sans-serif; color: #fff; background: rgba(38, 30, 70, .78);
        box-shadow: 0 2px 8px rgba(0,0,0,.2); opacity: 0; transition: opacity .25s ease, transform .25s ease;
      }
      #doubao-mods-avatar:hover .tag, #doubao-mods-avatar .tag.show { opacity: 1; transform: translate(-50%, 0); }`;
    const tag = document.createElement('div');
    tag.className = 'tag show';
    tag.textContent = PET_NAME;
    box.append(tag);
    setTimeout(() => tag.classList.remove('show'), 3000);
    box.title = `${tr(`${PET_NAME}'s avatar`, `${PET_NAME_}的头像`)}\n${box.title}`;
  }
}

// Pet window: state and menu choices from the pet's main process (pet/preload.js).
if (IN_PET && window.petBridge) {
  let hostOutfit;   // undefined until the first message, so that one always applies
  // Doubao and Codex send a topic id (outfit); DeepSeek Harness sends the expert's name instead.
  const topicFor = s => {
    if (s?.expert) return baseOf(s.expert) === EVERYDAY_BASE || !stillOf(PREFIX + baseOf(s.expert)) ? null : topicOfExpert(s.expert);
    return s?.outfit ? topicByOutfit(s.outfit) : null;
  };
  // Out of sight until the app says who she is (see appearAs); shown anyway after 3 s.
  let appeared = false;
  box.classList.add('awaiting');
  setTimeout(() => box.classList.remove('awaiting'), 3000);
  window.petBridge.onState(s => {
    hostState = s;    // for the menu: the app's style and rainbow chat box
    // The app's light/dark theme; an app that can't say (Claude): Windows' own setting.
    box.classList.toggle('on-dark', typeof s?.dark === 'boolean' ? s.dark : matchMedia('(prefers-color-scheme: dark)').matches);
    // The app's avatar style comes along too; a change of style re-applies her topic.
    if (s?.look && setLook(s.look, false)) hostOutfit = undefined;
    const key = s?.expert ? 'expert:' + s.expert : (s?.outfit ?? null);
    if (!appeared) { appeared = true; hostOutfit = key; appearAs(topicFor(s)); }
    else if (key !== hostOutfit) { hostOutfit = key; wear(topicFor(s)); }
    petPhase(s?.phase);
  });
  window.petBridge.onCommand(c => {
    // A click in the pet's menu window: run that item's action (see buildMenu).
    if (c?.type === 'menu' && Number.isInteger(c.k)) runMenuAct(c.k);
  });
  // Clicks pass through the window except on her (the main process asks while the cursor is over it).
  let wasOnHer = false;
  window.petBridge.onPointer(p => {
    const now = onHer(p.x, p.y);
    if (now !== wasOnHer) { wasOnHer = now; window.petBridge.hit(now); }
  });
  window.petBridge.ready();
}

// Handy for testing from DevTools: __doubaoMods.keywordTopic('怎么做红烧肉')
M.keywordTopic = text => keywordTopic(text)?.outfit ?? null;
// (cleanup was registered at the top)
