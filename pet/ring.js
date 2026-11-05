// The rainbow chat box window's page (ring.html): turns the rainbow like mods/15-ring.js, faster and
// with a breathing glow while Claude answers. A plain timer at 20 frames a second (30 while
// answering), not a CSS animation: that kept the page redrawing 60 times a second.
'use strict';
const ring = document.getElementById('ring');
const halo = ring.querySelector('.halo');
const SPIN_MS = 6000, ANSWER_RATE = 5, RAMP_MS = 500, BREATHE_MS = 2600;
let angle = 0, rate = 1, target = 1, last = performance.now(), answering = false, breathStart = 0;

function turn() {
  const now = performance.now(), dt = Math.min(now - last, 100);
  last = now;
  rate += (target - rate) * Math.min(1, dt / RAMP_MS * 3);
  angle = (angle + rate * 360 * dt / SPIN_MS) % 360;
  ring.style.setProperty('--a', angle.toFixed(1) + 'deg');
  if (answering) {
    const base = ring.classList.contains('dark') ? 0.38 : 0.20;   // as --halo in ring.html
    const k = 0.5 - 0.5 * Math.cos(2 * Math.PI * (now - breathStart) / BREATHE_MS);
    halo.style.opacity = (base * (1 + 0.8 * k)).toFixed(3);
  }
}
(function loop() { turn(); setTimeout(loop, answering || rate > 1.05 ? 33 : 50); })();

// From the pet program: { dark, busy, radius } (radius of Claude's chat box corners, in DIPs).
window.ringBridge?.onState(s => {
  ring.classList.toggle('dark', !!s?.dark);
  if (Number.isFinite(s?.radius)) ring.style.setProperty('--r', s.radius + 'px');
  const on = !!s?.busy;
  if (on !== answering) {
    answering = on;
    target = on ? ANSWER_RATE : 1;
    breathStart = performance.now();
    ring.classList.toggle('answering', on);
    if (!on) halo.style.opacity = '';
  }
});
