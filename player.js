// ── DRUM HERO — Player Engine ────────────────────────────────────────────────

// ── INSTRUMENTS / MIDI MAP ───────────────────────────────────────────────────
export const INSTRUMENTS = [
  // Order: cymbals top → toms → snare → kick bottom (matches visual kit layout)
  { id: 'china',   label: 'CHINA',       short: 'CH', color: '#f5a623', notes: [76, 77] },
  { id: 'splash',  label: 'SPLASH',      short: 'SP', color: '#fb923c', notes: [83, 82] },
  { id: 'rideCr',  label: 'RIDE CRASH',  short: 'RC', color: '#a855f7', notes: [75] },
  { id: 'rideBow', label: 'RIDE BOW',    short: 'RB', color: '#c084fc', notes: [72, 73] },
  { id: 'crashR',  label: 'CRASH R',     short: 'CR', color: '#ff4499', notes: [67, 69] },
  { id: 'crashL',  label: 'CRASH L',     short: 'CL', color: '#fb7185', notes: [62, 64] },
  // HH CLOSED lane also contains foot notes — rendered differently in draw()
  { id: 'hhC',     label: 'HH CLOSED',   short: 'HC', color: '#00d4ff', notes: [47, 48, 45] },
  { id: 'hhO',     label: 'HH OPEN',     short: 'HO', color: '#33aaff', notes: [53, 54, 56] },
  { id: 'hhT',     label: 'HH TIGHT',    short: 'HT', color: '#0099cc', notes: [58] },
  { id: 'tom1',    label: 'TOM HIGH',    short: 'T1', color: '#22cc66', notes: [33] },
  { id: 'tom2',    label: 'TOM MID',     short: 'T2', color: '#16a34a', notes: [37] },
  { id: 'tom3',    label: 'TOM LOW',     short: 'T3', color: '#15803d', notes: [35] },
  { id: 'snare',   label: 'SNARE',       short: 'SN', color: '#ff9900', notes: [26, 30] },
  { id: 'kick',    label: 'KICK',        short: 'KI', color: '#ff4499', notes: [24] },
];

// Foot notes rendered as circle instead of diamond
export const FOOT_NOTES = new Set([43]);
// Map foot notes to the HH CLOSED lane
export const FOOT_INST_ID = 'hhC';

let noteMap = {};
export function rebuildNoteMap() {
  noteMap = {};
  INSTRUMENTS.forEach(inst => inst.notes.forEach(n => { noteMap[n] = inst.id; }));
  // Foot notes map to hhC lane but flagged separately
  FOOT_NOTES.forEach(n => { noteMap[n] = FOOT_INST_ID; });
}
rebuildNoteMap();

// Load saved map from localStorage
const saved = localStorage.getItem('dh_midimap');
if (saved) {
  try {
    const m = JSON.parse(saved);
    INSTRUMENTS.forEach(i => { if (m[i.id]) i.notes = m[i.id]; });
    rebuildNoteMap();
  } catch {}
}

export function saveMidiMap(mapObj) {
  Object.keys(mapObj).forEach(id => {
    const inst = INSTRUMENTS.find(i => i.id === id);
    if (inst) inst.notes = mapObj[id];
  });
  rebuildNoteMap();
  localStorage.setItem('dh_midimap', JSON.stringify(mapObj));
}

// ── PLAYBACK STATE ───────────────────────────────────────────────────────────
let audioCtx    = null;
let audioBuffer = null;
let audioSource = null;
let gainNode    = null;
let isPlaying   = false;
let startAudioTime = 0;
let pauseOffset    = 0;
let playbackRate   = 1;
let animFrame      = null;

export let notes = [];

// ── CANVAS ───────────────────────────────────────────────────────────────────
let canvas, ctx;
export let W = 0, H = 0;

const LANE_H      = () => Math.floor(H / INSTRUMENTS.length);
const HIT_X       = () => Math.round(W * 0.20);
let LOOK_AHEAD  = 2.6;   // seconds visible ahead — pinch to zoom changes this
const LOOK_BEHIND = 0.3;
const LOOK_AHEAD_MIN = 0.8;   // max zoom in  (~0.8s window)
const LOOK_AHEAD_MAX = 6.0;   // max zoom out (~6s window)

export function setLookAhead(v) {
  LOOK_AHEAD = Math.max(LOOK_AHEAD_MIN, Math.min(LOOK_AHEAD_MAX, v));
}
export function getLookAhead() { return LOOK_AHEAD; }

export function initCanvas(canvasEl) {
  canvas = canvasEl;
  ctx    = canvas.getContext('2d');
  resize();

  // ResizeObserver fires reliably when the container actually changes size
  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas.parentElement);

  // Orientation fallback for older Android
  window.addEventListener('orientationchange', () => setTimeout(resize, 300));
}

function resize() {
  if (!canvas) return;
  const parent = canvas.parentElement;
  W = parent.clientWidth;
  H = parent.clientHeight;
  canvas.width  = W;
  canvas.height = H;
  if (audioBuffer && H > 0) buildLaneLabels();
}

// Poll until canvas has real height, then call cb
function _waitForSize(cb) {
  const parent = canvas?.parentElement;
  if (!parent) return;
  const check = () => {
    const h = parent.clientHeight;
    if (h > 0) {
      W = parent.clientWidth;
      H = h;
      canvas.width  = W;
      canvas.height = H;
      cb();
    } else {
      requestAnimationFrame(check);
    }
  };
  requestAnimationFrame(check);
}

// ── LOAD TRACK ───────────────────────────────────────────────────────────────
export async function loadTrack(midiNotes, audioArrayBuffer) {
  // Stop any previous playback first
  _stopAudio();

  // Close previous AudioContext to free resources
  if (audioCtx) {
    try { await audioCtx.close(); } catch {}
    audioCtx = null;
  }

  notes = midiNotes
    .filter(n => noteMap[n.note])
    .map(n => ({ ...n, inst: noteMap[n.note], hit: false, isFoot: FOOT_NOTES.has(n.note) }));

  // Debug: log velocity range so we can verify it's working
  const vels = notes.map(n => n.vel);
  const velMin = Math.min(...vels), velMax = Math.max(...vels);
  console.log(`[DrumHero] Notes: ${notes.length}, vel range: ${velMin}–${velMax}`);

  audioCtx  = new AudioContext();
  gainNode  = audioCtx.createGain();
  gainNode.gain.value = 1;
  gainNode.connect(audioCtx.destination);
  audioBuffer = await audioCtx.decodeAudioData(audioArrayBuffer);

  pauseOffset  = 0;
  isPlaying    = false;
  playbackRate = 1;
  LOOK_AHEAD   = 2.6;  // reset zoom on new track

  // Reset speed selector
  const speedSel = document.getElementById('speed-sel') || document.querySelector('.speed-sel');
  if (speedSel) speedSel.value = '1';

  // Wait for real layout dimensions before building labels
  _waitForSize(() => {
    buildLaneLabels();
    startDrawLoop();
  });
}

// ── UNLOAD (called when going back to menu) ───────────────────────────────────
export function unloadTrack() {
  stopDrawLoop();
  _stopAudio();

  if (audioCtx) {
    try { audioCtx.close(); } catch {}
    audioCtx = null;
  }

  audioBuffer  = null;
  gainNode     = null;
  audioSource  = null;
  isPlaying    = false;
  pauseOffset  = 0;
  playbackRate = 1;
  notes        = [];

  // Reset play button
  const btn = document.getElementById('btn-play');
  if (btn) btn.textContent = '▶';

  // Reset progress
  const fill = document.getElementById('progress-fill');
  if (fill) fill.style.width = '0%';
  const timeEl = document.getElementById('time-text');
  if (timeEl) timeEl.textContent = '0:00 / 0:00';
}

// Internal: stop audio source without affecting state
function _stopAudio() {
  if (audioSource) {
    const src = audioSource;
    audioSource = null;   // null ref FIRST so onended guard fails
    src.onended = null;   // belt-and-suspenders
    try { src.stop(); } catch {}
  }
  isPlaying = false;
}

// ── LANE LABELS ──────────────────────────────────────────────────────────────
function buildLaneLabels() {
  const col = document.getElementById('lane-labels');
  if (!col) return;
  col.innerHTML = '';
  const laneH = LANE_H();

  // Scale font and dot to lane height — feels natural on any screen size
  // laneH ~20px (phone) → fontSize ~8px; laneH ~40px (desktop) → fontSize ~14px
  const fontSize  = Math.max(8,  Math.min(14, laneH * 0.38));
  const dotSize   = Math.max(5,  Math.min(9,  laneH * 0.22));
  const padH      = Math.max(4,  Math.min(10, laneH * 0.2));
  const labelWidth = Math.max(76, Math.min(130, laneH * 3.2));

  // Update sidebar width to fit labels
  col.style.width = labelWidth + 'px';

  INSTRUMENTS.forEach(inst => {
    const div = document.createElement('div');
    div.className = 'lane-label';
    div.style.height      = laneH + 'px';
    div.style.borderColor = inst.color + '28';
    div.style.padding     = `0 ${padH}px`;
    div.style.gap         = Math.max(4, dotSize - 1) + 'px';

    const footTag = inst.id === FOOT_INST_ID
      ? `<span style="font-size:${Math.max(7, fontSize - 2)}px;opacity:0.55;margin-left:2px;">👣</span>`
      : '';

    div.innerHTML =
      `<span class="ldot" style="background:${inst.color};width:${dotSize}px;height:${dotSize}px"></span>` +
      `<span class="lname" style="font-size:${fontSize}px;letter-spacing:${fontSize > 10 ? 1 : 0}px">${inst.label}${footTag}</span>`;

    col.appendChild(div);
  });
}

// ── DRAW LOOP ────────────────────────────────────────────────────────────────
function startDrawLoop() {
  stopDrawLoop();
  const loop = () => { draw(); updateHUD(); animFrame = requestAnimationFrame(loop); };
  animFrame = requestAnimationFrame(loop);
}

function stopDrawLoop() {
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
}

export function currentTime() {
  if (!isPlaying || !audioCtx) return pauseOffset;
  // pauseOffset + elapsed_real_time * playbackRate
  const elapsed = audioCtx.currentTime - startAudioTime;
  const t = pauseOffset + elapsed * playbackRate;
  return isNaN(t) || t < 0 ? pauseOffset : t;
}

// ── RENDER ───────────────────────────────────────────────────────────────────
function draw() {
  if (!ctx || !W || !H) return;
  ctx.clearRect(0, 0, W, H);

  const t     = currentTime();
  const laneH = LANE_H();
  const hitX  = HIT_X();
  const pxSec = (W - hitX) / LOOK_AHEAD;

  // Lane backgrounds
  INSTRUMENTS.forEach((inst, i) => {
    const y = i * laneH;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.013)' : 'rgba(0,0,0,0.07)';
    ctx.fillRect(0, y, W, laneH);
    ctx.strokeStyle = inst.color + '20';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y + laneH - 0.5); ctx.lineTo(W, y + laneH - 0.5); ctx.stroke();
  });

  // Beat grid
  const bpm   = window._currentSongBpm || 120;
  const beat  = 60 / bpm;
  const start = Math.ceil((t - LOOK_BEHIND) / beat) * beat;
  for (let b = start; b <= t + LOOK_AHEAD; b += beat) {
    const x     = hitX + (b - t) * pxSec;
    const isBar = Math.round(b / beat) % 4 === 0;
    ctx.strokeStyle = isBar ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.025)';
    ctx.lineWidth   = isBar ? 1.5 : 0.8;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }

  // Hit line glow
  const gl = ctx.createLinearGradient(hitX - 50, 0, hitX + 10, 0);
  gl.addColorStop(0, 'transparent');
  gl.addColorStop(1, 'rgba(255,68,153,0.07)');
  ctx.fillStyle = gl;
  ctx.fillRect(hitX - 50, 0, 60, H);

  // Hit line
  ctx.strokeStyle = 'rgba(255,68,153,0.75)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(hitX, 0); ctx.lineTo(hitX, H); ctx.stroke();

  // Lane dots on hit line
  INSTRUMENTS.forEach((inst, i) => {
    const cy = i * laneH + laneH / 2;
    ctx.beginPath();
    ctx.arc(hitX, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle   = inst.color;
    ctx.shadowColor = inst.color;
    ctx.shadowBlur  = 10;
    ctx.fill();
    ctx.shadowBlur  = 0;
  });

  // Notes
  notes.forEach(note => {
    if (note.hit) return;
    const dt = note.time - t;
    if (dt < -(LOOK_BEHIND + 0.15) || dt > LOOK_AHEAD + 0.1) return;

    const instIdx = INSTRUMENTS.findIndex(i => i.id === note.inst);
    if (instIdx < 0) return;
    const inst  = INSTRUMENTS[instIdx];
    const x     = hitX + dt * pxSec;
    const cy    = instIdx * laneH + laneH / 2;
    // Size scales with lane height but capped — feels right on any screen
    // Phone (~20px lane): size~7px  Tablet (~32px): size~11px  Desktop (~45px): size~14px
    // Hard cap at 16px so notes don't dominate the lane on big screens
    const size  = Math.max(5, Math.min(16, laneH * 0.32));
    const alpha = dt < 0 ? Math.max(0, 1 + dt / LOOK_BEHIND) : 1;

    // ── Velocity scaling ──────────────────────────────────────────────────────
    // Normalize vel to 0..1 within the actual range of this track (61-127 typical)
    // Stretch contrast: remap so lowest vel in track = 0, highest = 1
    const velT = Math.max(0, Math.min(note.vel / 127, 1));
    // Apply power curve to exaggerate differences in the middle range
    const velCurve = Math.pow(velT, 0.5); // sqrt: pulls low values up less, keeps high bright

    // Ghost note threshold: vel < 80 = ghost, vel > 100 = accent
    const isGhost  = note.vel < 80;
    const isAccent = note.vel >= 100;

    // glow: ghost=1px, normal=10px, accent=22px
    const glow      = isGhost ? 1 : isAccent ? 22 : 8 + velCurve * 8;
    // size bonus: ghost=-1px, accent=+4px
    const sizeBonus = isGhost ? -1 : isAccent ? 4 : velCurve * 3;
    // fill alpha: ghost=0.3, normal~0.75, accent=1.0
    const fillAlpha = isGhost ? 0.3 : isAccent ? 1.0 : 0.6 + velCurve * 0.35;

    ctx.save();
    ctx.globalAlpha = alpha;

    if (note.isFoot) {
      // ── Foot pedal: hollow circle ──────────────────────────────────────────
      const r = Math.max(3, size * 0.6);
      ctx.translate(x, cy);
      ctx.shadowColor = inst.color;
      ctx.shadowBlur  = glow;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = inst.color;
      ctx.lineWidth   = 1.5 + velCurve;
      ctx.globalAlpha = alpha * fillAlpha;
      ctx.stroke();
      ctx.shadowBlur  = 0;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2);
      ctx.fillStyle = inst.color;
      ctx.fill();
    } else {
      // ── Regular note: diamond ──────────────────────────────────────────────
      const s = Math.max(3, size + sizeBonus);
      ctx.translate(x, cy);
      ctx.rotate(Math.PI / 4);
      ctx.shadowColor = inst.color;
      ctx.shadowBlur  = glow;
      ctx.globalAlpha = alpha * fillAlpha;
      ctx.fillStyle   = inst.color;
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.shadowBlur  = 0;
      ctx.fillStyle   = `rgba(255,255,255,${0.15 + velCurve * 0.4})`;
      const hs = s * 0.32;
      ctx.fillRect(-hs / 2, -hs / 2, hs, hs);
    }

    ctx.restore();
  });
}

// ── HUD ──────────────────────────────────────────────────────────────────────
let lastHud = 0;
function updateHUD() {
  const now = performance.now();
  if (now - lastHud < 80) return;
  lastHud = now;
  if (!audioBuffer) return;

  const t   = currentTime();
  const dur = audioBuffer.duration;

  const fill = document.getElementById('progress-fill');
  if (fill) fill.style.width = Math.min(100, t / dur * 100) + '%';

  const fmt    = s => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  const timeEl = document.getElementById('time-text');
  if (timeEl) timeEl.textContent = fmt(t) + ' / ' + fmt(dur);
}

// ── CONTROLS ─────────────────────────────────────────────────────────────────
export function togglePlay() {
  if (!audioBuffer) return;
  isPlaying ? pause() : play();
}

function play() {
  if (!audioCtx || !audioBuffer) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();

  _stopAudio();

  const offset = Math.max(0, Math.min(pauseOffset, audioBuffer.duration - 0.01));
  pauseOffset  = offset;

  const src = audioCtx.createBufferSource();
  src.buffer = audioBuffer;
  src.playbackRate.value = playbackRate;
  src.connect(gainNode);
  src.start(0, offset);

  startAudioTime = audioCtx.currentTime;
  isPlaying      = true;
  audioSource    = src;

  const btn = document.getElementById('btn-play');
  if (btn) btn.textContent = '⏸';

  // Guard: only react if THIS source is still active
  src.onended = () => {
    if (audioSource === src && isPlaying) {
      isPlaying   = false;
      pauseOffset = 0;
      audioSource = null;
      const b = document.getElementById('btn-play');
      if (b) b.textContent = '▶';
    }
  };
}

function pause() {
  if (!isPlaying) return;
  pauseOffset = currentTime();
  _stopAudio();
  const btn = document.getElementById('btn-play');
  if (btn) btn.textContent = '▶';
}

export function restart() {
  const wasPlaying = isPlaying;
  _stopAudio();
  pauseOffset = 0;
  notes.forEach(n => { n.hit = false; });
  const btn = document.getElementById('btn-play');
  if (btn) btn.textContent = '▶';
  if (wasPlaying) play();
}

export function seekTo(pct) {
  const wasPlaying = isPlaying;
  _stopAudio();
  pauseOffset = pct * (audioBuffer?.duration || 0);
  if (wasPlaying) play();
}

export function setVolume(v) {
  if (gainNode) gainNode.gain.value = parseFloat(v);
}

export function setSpeed(v) {
  const wasPlaying = isPlaying;
  const t = currentTime();  // capture BEFORE stop
  _stopAudio();
  playbackRate = parseFloat(v);
  pauseOffset  = t;
  if (wasPlaying) play();
}

export function getDuration()    { return audioBuffer?.duration || 0; }
export function isPlayingNow()  { return isPlaying; }
