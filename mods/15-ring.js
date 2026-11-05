// Rainbow ring mod: a thin rainbow edge and a rainbow glow that slowly turn around the chat
// input, in every app (Doubao, Codex, Yuanbao). Brighter while you type in it; while the AI answers
// it spins faster and the glow breathes. Turn it off per app from the avatar's right-click menu
// ("This app only" > Rainbow chat box & greeting), or the desktop pet's menu in pet mode; that also turns off the
// rainbow greeting (10-theme.css).
//
// How it's drawn: one small element inside the input's visible box. Everything is masked to the
// outside of the box's edge, so it never covers text, and it ignores the mouse. The colours move 20
// times a second (see "Turning" for why not faster).

if (APP.pet || !APP.composer) return;

const SPIN_MS = 6000;      // one turn while idle
const ANSWER_RATE = 5;     // how much faster while the AI is thinking or replying (3 was hard to notice)
// The full rainbow mixed about a fifth of the way toward white: a little softer than pure colours.
// (A pastel version, #f28bb4, #f6a98a, #8ec5f5, #9d9bf5, #c995ef with a fainter glow, was tried and
// found too faint to notice; the pure colours #ff4d6d, #ff9f1c, #ffd60a, #3ddc97, #2ec4ff, #7b61ff,
// #f72585 a little too loud.)
const COLORS = '#ff7189, #ffb249, #ffde3b, #64e3ac, #58d0ff, #9581ff, #f9519d, #ff7189';

const style = document.createElement('style');
style.id = 'doubao-mods-ring-style';
style.textContent = `
  #doubao-mods-ring {
    position: absolute; inset: 0; pointer-events: none; border-radius: var(--r, 16px);
    --p: 38px;        /* room for the glow outside the box */
    --halo: .30; --edge: .75;   /* glow: .46 / .66 / .55 / .78 / .85 / 1 was too much, half of that a bit too little; now 65% */
  }
  #doubao-mods-ring.track { inset: auto; }
  #doubao-mods-ring.focused { --halo: .43; --edge: .95; }
  #doubao-mods-ring.dark { --halo: .36; }
  #doubao-mods-ring.dark.focused { --halo: .51; }
  #doubao-mods-ring.answering { --edge: .95; }
  /* on a near-black page: a stronger, wider glow (see onBlack) */
  #doubao-mods-ring.on-black { --halo: .56; --band: 11px; }
  #doubao-mods-ring.on-black.focused { --halo: .65; }

  /* Ring-shaped masks: keep only what's between the content box (the input's own edge) and the outside */
  #doubao-mods-ring .halo, #doubao-mods-ring .band, #doubao-mods-ring .edge {
    position: absolute;
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
  }
  /* The rainbow: a conic gradient whose starting angle (--a) the timer turns */
  #doubao-mods-ring .band, #doubao-mods-ring .edge {
    background: conic-gradient(from var(--a, 0deg), ${COLORS}) border-box;
  }
  /* The glow: a 7px rainbow band just outside the edge, blurred into a soft bloom, then cut to the
     outside only */
  #doubao-mods-ring .halo {
    inset: calc(-1 * var(--p)); padding: var(--p); border-radius: calc(var(--r, 16px) + var(--p));
    filter: blur(12px); opacity: var(--halo); transition: opacity .5s ease;
  }
  #doubao-mods-ring .band {
    inset: calc(var(--p) - var(--band, 7px)); padding: var(--band, 7px); border-radius: calc(var(--r, 16px) + var(--band, 7px));
  }
  /* The edge: 1.75px */
  #doubao-mods-ring .edge {
    inset: -1.75px; padding: 1.75px; border-radius: calc(var(--r, 16px) + 1.75px);
    opacity: var(--edge); transition: opacity .5s ease;
  }
  /* While answering, the glow breathes (set by the turning timer, so no transition) */
  #doubao-mods-ring.answering .halo { transition: none; }
  @media (prefers-reduced-motion: reduce) {
    #doubao-mods-ring.answering .halo { opacity: .52; }
  }
`;
document.head.appendChild(style);

const root = document.createElement('div');
root.id = 'doubao-mods-ring';
root.setAttribute('aria-hidden', 'true');
// Built element by element, not with innerHTML: Cursor's page (like VS Code's) refuses HTML strings
// from scripts (Trusted Types).
{
  const div = cls => Object.assign(document.createElement('div'), { className: cls });
  const halo = div('halo');
  halo.append(div('band'));
  root.append(halo, div('edge'));
}

// ---- Turning ----
// A plain timer at 20 frames a second, not a CSS/Web animation. Measured in Doubao: a browser
// animation of this ring kept the app redrawing 60 times a second (about a third of a processor
// core, even with fewer steps); this timer costs about 7% of one core and looks the same on a
// slow-moving gradient.
// It turns the gradient's starting angle rather than rotating a big gradient square: in Codex a
// rotating square inside the ring's clip flickered (every other frame lost the ring's round ends).
// While the AI answers it turns faster, so the timer runs at 30 frames a second then (smooth at
// that speed); idle it stays at 20 to keep the cost down.
const FRAME_MS = 50, ANSWER_FRAME_MS = 33;
const RAMP_MS = 500;       // how long speeding up / slowing down takes
const BREATHE_MS = 2600;   // one glow breath while the AI answers
const halo = root.querySelector('.halo');
const still = matchMedia('(prefers-reduced-motion: reduce)'); // then: a still rainbow, no breathing
let angle = 0, rate = 1, targetRate = 1, last = performance.now(), answering = false, breathStart = 0;
let haloBase = 0.5; // the glow's normal strength right now (light/dark, typing or not); set by update()
function turn() {
  const now = performance.now(), dt = Math.min(now - last, 100);
  last = now;
  if (still.matches || document.hidden || !root.isConnected) return;
  rate += (targetRate - rate) * Math.min(1, dt / RAMP_MS * 3);   // eases toward the new speed
  angle = (angle + rate * 360 * dt / SPIN_MS) % 360; // speed changes never make it jump
  root.style.setProperty('--a', angle.toFixed(1) + 'deg');
  if (answering) {
    const base = haloBase;
    const k = 0.5 - 0.5 * Math.cos(2 * Math.PI * (now - breathStart) / BREATHE_MS); // 0 -> 1 -> 0
    halo.style.opacity = (base * (1 + 0.8 * k)).toFixed(3);   // swells to 1.8x its normal strength
  }
}
function setAnswering(on) {
  if (on === answering) return;
  answering = on;
  targetRate = on ? ANSWER_RATE : 1;
  breathStart = performance.now();
  if (!on) halo.style.opacity = ''; // back to the normal glow (with its fade)
}
// The frame timer runs only while the ring is drawn and seen: switched off, not on the page, the
// window hidden or reduced motion asked for, it stops, and update() (every 400 ms) wakes it again.
let spinTimer = 0, spinning = false;
const spinLoop = () => {
  if (still.matches || document.hidden || !root.isConnected) { spinning = false; return; }
  turn();
  spinTimer = setTimeout(spinLoop, answering || rate > 1.05 ? ANSWER_FRAME_MS : FRAME_MS);
};
function wake() {
  if (spinning || still.matches || document.hidden || !root.isConnected) return;
  spinning = true;
  last = performance.now();   // no jump for the time it slept
  spinTimer = setTimeout(spinLoop, 0);
}

// ---- Finding the input's visible box ----
const firstVisible = sel => {
  for (const e of document.querySelectorAll(sel)) {
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return e;
  }
  return null;
};
const alphaOf = c => {
  if (!c || c === 'transparent') return 0;
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; }
  const s = c.match(/\/\s*([\d.]+)(%?)\s*\)$/);
  return s ? parseFloat(s[1]) / (s[2] ? 100 : 1) : 1;
};
const painted = e => {
  const c = getComputedStyle(e);
  return alphaOf(c.backgroundColor) > 0.3 || c.backgroundImage !== 'none' ||
    (parseFloat(c.borderTopWidth) > 0 && alphaOf(c.borderTopColor) > 0.05);
};
// The composer element isn't always the box you see: Doubao's is a wrapper around a white surface,
// Codex's holds a toolbar and the box, and gets extra left padding when the avatar needs room.
// So: the biggest painted (background or border) element within the composer's top levels. Codex's
// new-chat box sits 7 levels down, so it looks 8 deep, at most 600 elements.
function findBox(composer) {
  const cr = composer.getBoundingClientRect();
  let best = null, bestArea = 0, seen = 0;
  const walk = (e, depth) => {
    if (++seen > 600) return;
    const r = e.getBoundingClientRect();
    if (r.width >= cr.width * 0.5 && r.height >= 32 && painted(e) && r.width * r.height > bestArea + 1) {
      best = e; bestArea = r.width * r.height;
    }
    if (depth < 8) for (const k of e.children) if (k !== root) walk(k, depth + 1);
  };
  walk(composer, 0);
  return best || composer;
}
const visibleOverflow = c => c.overflowX === 'visible' && c.overflowY === 'visible';

// ---- Placing ----
let composer = null, box = null, age = 0;
function mount() {
  const c = firstVisible(APP.composer);
  if (!c) { root.remove(); return false; }
  if (c !== composer || !box?.isConnected || !c.contains(box) || ++age > 15) { composer = c; box = findBox(c); age = 0; }
  const cs = getComputedStyle(box);
  // Normally the ring lives inside the box itself and follows it for free. If the box would clip it
  // (overflow) or can't anchor it (not positioned), it lives in the nearest ancestor that doesn't
  // clip, and is kept lined up with the box.
  const inside = cs.position !== 'static' && visibleOverflow(cs);
  let parent = box;
  if (!inside) {
    parent = box.parentElement;
    while (parent && parent !== document.body && !visibleOverflow(getComputedStyle(parent))) parent = parent.parentElement;
    parent ||= document.body;
  }
  if (root.parentElement !== parent) parent.insertBefore(root, parent.firstChild);
  const r = box.getBoundingClientRect();
  root.classList.toggle('track', !inside);
  // k: how much a CSS pixel here is scaled on screen. Codex draws its chat box under a CSS zoom
  // (~0.9), so sizes measured on screen must be divided by it, or the ring came out ~10% small and
  // its right and bottom edges hid under the box (only the top-left of the edge showed).
  let k = 1;
  if (inside) root.style.left = root.style.top = root.style.width = root.style.height = '';
  else {
    const was = parseFloat(root.style.width), cur = root.getBoundingClientRect();
    if (was > 0 && cur.width > 0) k = cur.width / was;
    if (was > 0 && cur.width > 0) {
      // Already placed: move by the remaining on-screen difference (exact whatever is in between).
      root.style.left = parseFloat(root.style.left) + (r.left - cur.left) / k + 'px';
      root.style.top = parseFloat(root.style.top) + (r.top - cur.top) / k + 'px';
    } else {
      const op = root.offsetParent || document.body, o = op.getBoundingClientRect();
      root.style.left = r.left - o.left - op.clientLeft + op.scrollLeft + 'px';
      root.style.top = r.top - o.top - op.clientTop + op.scrollTop + 'px';
    }
    root.style.width = r.width / k + 'px';
    root.style.height = r.height / k + 'px';
  }
  const radius = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, r.height / 2 / k, r.width / 2 / k);
  root.style.setProperty('--r', radius + 'px');
  return true;
}

// Dark theme: judged from the box's own background (works the same in all three apps).
function isDark() {
  const m = getComputedStyle(box).backgroundColor.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (m && alphaOf(getComputedStyle(box).backgroundColor) > 0.3) return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 < 0.45;
  const html = document.documentElement;
  return getComputedStyle(html).colorScheme.includes('dark') || html.dataset.theme === 'dark' || html.classList.contains('dark');
}

// Near-black page behind the box (Doubao's dark mode is pure black; Codex's is dark grey): the same
// see-through glow almost disappears on black, so it gets stronger and wider there.
const lumOf = c => { const m = c.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/); return m ? (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 : null; };
function onBlack() {
  for (let e = box.parentElement; e; e = e.parentElement) {
    const bg = getComputedStyle(e).backgroundColor;
    if (alphaOf(bg) > 0.5) { const l = lumOf(bg); return l !== null && l < 0.06; }
  }
  return false;
}

// On/off per app: the avatar's right-click menu (or the pet's) sets this and sends the event.
const RING_KEY = `doubao-mods-ring:${APP.id}`;
const ringOn = () => { try { return localStorage.getItem(RING_KEY) !== 'off'; } catch { return true; } };

// The same switch turns off the rainbow greeting too (10-theme.css only applies while <html> doesn't
// have this attribute).
const OFF_ATTR = 'data-doubao-mods-rainbow-off';

function update() {
  if (M.generation !== GEN) return cleanup();
  document.documentElement.toggleAttribute(OFF_ATTR, !ringOn());
  if (!ringOn()) { root.remove(); setAnswering(false); return; }   // off: nothing drawn, timer idles
  if (!mount()) return;
  // A visible Stop button only: Codex keeps hidden copies of its other tabs, one of them with a Stop
  // button, which kept the ring spinning fast as if the AI were always answering.
  const now = !!APP.answering && [...document.querySelectorAll(APP.answering)].some(e => e.getBoundingClientRect().width > 0);
  root.classList.toggle('answering', now);
  root.classList.toggle('focused', composer.matches(':focus-within'));
  root.classList.toggle('dark', isDark());
  root.classList.toggle('on-black', onBlack());
  haloBase = parseFloat(getComputedStyle(root).getPropertyValue('--halo')) || 0.5;
  setAnswering(now);
  wake();
}

const onFocus = () => setTimeout(update, 0);
document.addEventListener('focusin', onFocus);
document.addEventListener('focusout', onFocus);
addEventListener('doubao-mods-ring', update);
const timer = setInterval(update, 400);
update();

function cleanup() {
  clearInterval(timer);
  clearTimeout(spinTimer);
  document.removeEventListener('focusin', onFocus);
  document.removeEventListener('focusout', onFocus);
  removeEventListener('doubao-mods-ring', update);
  document.documentElement.removeAttribute(OFF_ATTR);
  root.remove();
  style.remove();
}
return cleanup;
