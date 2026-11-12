"use strict";
// Bar screen dashboard: now playing + Milkdrop (Butterchurn) visualizer + quiet idle mode.

const CFG = {
  presetSeconds: 120,      // time on one preset (randomised +/- 25%)
  blendSeconds: 8,         // slow crossfade between presets
  fps: 30,                 // cap, keeps the GPU and fans calm
  btDelay: 0.20,           // Bluetooth plays ~200 ms late; delay the visuals to match
  targetLuma: 0.28,        // auto-dimmer aims for this average brightness (0..1)
  bars: {                  // spectrum bars drawn over the visualizer
    on: true,
    count: 56,
    maxHeight: 0.5,        // never taller than half the screen
    opacity: 0.55,         // overall transparency of the layer
    minHz: 40, maxHz: 15000,
  },
  pausedToIdleMs: 5 * 60 * 1000,
  darkLuma: 0.035,         // below this average brightness the visualizer counts as blank...
  darkSeconds: 12,         // ...and after this long it switches to another preset
  // Calm, flowing presets. No strobes, lasers or disco.
  presets: [
    "Flexi - mindblob mix",
    "Flexi - mindblob [shiny mix]",
    "Geiss - Reaction Diffusion 2",
    "_Geiss - Desert Rose 2",
    "Geiss - Cauldron - painterly 2 (saturation remix)",
    "martin - frosty caves 2",
    "martin - glass corridor",
    "martin - reflections on black tiles",
    "martin - stormy sea (2010 update)",
    "martin - castle in the air",
    "Aderrasi - Songflower (Moss Posy)",
    "Aderrasi - Potion of Spirits",
    "Zylot - Star Ornament",
    "Flexi - alien fish pond",
    "Flexi + Martin - astral projection",
    "cope + martin - mother-of-pearl",
    "Unchained - Unified Drag 2",
    "TonyMilkdrop - Magellan's Nebula [Flexi - you enter first + multiverse]",
    "shifter - dark tides bdrv mix 2",
    "yin - 191 - Temporal singularities",
    "Eo.S. + Zylot - skylight (Stained Glass Majesty mix)",
    "Rovastar - Oozing Resistance",
    "Aderrasi - Airhandler (Last Breath - Calm)",
    "Geiss - Reaction Diffusion 3 (Lichen Mix)",
    "martin - ice flames",
    "Martin - journey into space",
    "flexi - jelly fish mandala",
    "Cope - Passage (mandala mix)",
    "Rovastar + Geiss - Snapshot Of Space (LSB mix)",
    "shifter - dark tides bdrv mix",
    "Geiss - Planet 1",
    "martin - city of shadows",
  ],
};

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
if (params.has("debug")) document.body.classList.add("debug");
if (params.get("bars") === "0") CFG.bars.on = false;
if (!CFG.bars.on) document.body.classList.add("nobars");
if (params.get("cycle")) { CFG.presetSeconds = +params.get("cycle"); CFG.blendSeconds = 1; }   // preview aid

// ------------------------------------------------------------ clock -------
function pad(n) { return String(n).padStart(2, "0"); }
function tickClock() {
  const d = new Date();
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  $("clockTime").textContent = t;
  $("idleTime").textContent = t;
  const date = d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  $("idleDate").textContent = tempText ? `${date}  ·  ${tempText}` : date;
}
// Outside temperature, same source and location as the panel's weather widget. Hidden when unknown.
let tempText = "";
function setTemp(c) {
  tempText = Number.isFinite(c) ? `${c}°` : "";
  if ($("temp").textContent !== tempText) { $("temp").textContent = tempText; tickClock(); }
}
setInterval(tickClock, 1000); tickClock();

// ------------------------------------------------------- now playing ------
let np = { status: "Stopped" };
let pausedSince = 0;

function fmt(us) {
  if (!us || us < 0) return "";
  let s = Math.floor(us / 1e6);
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function playerLabel(p) {
  if (!p) return "";
  if (p.startsWith("plasma-browser-integration") || p.startsWith("chromium") || p.startsWith("chrome")) return "Browser";
  if (p.startsWith("firefox")) return "Firefox";
  if (p.startsWith("spotify")) return "Spotify";
  return p.split(".")[0].replace(/_/g, " ");
}

let lastArt = null;
function render() {
  const playing = np.status === "Playing";
  const hasTrack = !!np.title;
  if (playing || !hasTrack) pausedSince = 0;
  else if (!pausedSince) pausedSince = Date.now();
  const nothing = !hasTrack || np.status === "Stopped" ||
                  (pausedSince && Date.now() - pausedSince > CFG.pausedToIdleMs);

  const b = document.body.classList;
  b.toggle("playing", playing && !nothing);
  b.toggle("paused", !playing && !nothing);
  b.toggle("nothing", nothing);

  $("player").textContent = playerLabel(np.player) + (playing ? "" : "  ·  paused");
  $("title").textContent = np.title || "";
  $("artist").textContent = np.artist || np.album || "";

  if (np.art !== lastArt) {
    lastArt = np.art;
    if (np.art) {
      $("artImg").src = np.art;
      $("artBlur").style.backgroundImage = `url("${np.art}")`;
      $("art").classList.remove("none");
    } else {
      $("artImg").removeAttribute("src");
      $("artBlur").style.backgroundImage = "";
      $("art").classList.add("none");
    }
  }
  updateProgress();
}

function updateProgress() {
  const len = np.lengthUs || 0;
  const show = len > 0 && np.positionUs != null;
  $("progress").classList.toggle("hidden", !show);
  if (!show) return;
  let pos = np.positionUs;
  if (np.status === "Playing") pos += (Date.now() - np.sampledAt) * 1000 * (np.rate || 1);
  pos = Math.max(0, Math.min(pos, len));
  $("fill").style.width = (100 * pos / len).toFixed(2) + "%";
  $("pos").textContent = fmt(pos) || "0:00";
  $("len").textContent = fmt(len);
}
setInterval(updateProgress, 250);

async function poll() {
  try {
    const q = new URLSearchParams({ preset: presetName, skipped: lastSkipped, audio: audioNote });
    const r = await fetch("/api/state?" + q, { cache: "no-store" });
    np = await r.json();
    if (params.get("force") === "playing" && np.title) np.status = "Playing";   // preview aid
    render();
    setTemp(np.temp);
    setHidden(!!np.hidden);
    setDelay(np.bluetooth ? CFG.btDelay : 0);
  } catch (e) { /* server restarting; keep last state */ }
}
setInterval(poll, 1000); poll();

// --------------------------------------------------------- visualizer -----
let audioCtx = null, delayNode = null, viz = null, presetMap = {}, presetNames = [], presetName = "";
let level = 0, spec = null;

function setDelay(sec) {
  if (delayNode) delayNode.delayTime.setTargetAtTime(sec, audioCtx.currentTime, 0.5);
}

// The capture can die when the output it listens to disappears (HDMI sink re-created after
// the monitor sleeps, Bluetooth reconnecting). Re-acquire it then, and also if it has been
// silent for a while although something is playing (default output changed under us).
let inputSrc = null, inputStream = null, silentFor = 0, lastReconnect = 0, audioNote = "";
async function connectInput(why) {
  lastReconnect = Date.now();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    if (inputSrc) inputSrc.disconnect();
    if (inputStream) inputStream.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    inputStream = stream;
    inputSrc = audioCtx.createMediaStreamSource(stream);
    inputSrc.connect(delayNode);
    stream.getAudioTracks().forEach((t) => { t.onended = () => setTimeout(() => connectInput("ended"), 1000); });
    if (why) audioNote = `reconnected (${why}) ${new Date().toLocaleTimeString()}`;
    silentFor = 0;
  } catch (e) {
    audioNote = "capture failed: " + e;
    setTimeout(() => connectInput("retry"), 5000);
  }
}
function audioWatchdog() {
  // Called every 0.5 s while visible and playing.
  silentFor = level < 1e-4 ? silentFor + 0.5 : 0;
  if (silentFor >= 8 && Date.now() - lastReconnect > 15000) connectInput("silent");
}

async function initAudio() {
  audioCtx = new AudioContext();
  // The browser's default input is the monitor of the current output (set by the service),
  // i.e. a digital copy of what is playing. Processing off so the signal is untouched.
  delayNode = audioCtx.createDelay(1.0);
  await connectInput("");

  const an = audioCtx.createAnalyser();
  an.fftSize = 1024;
  delayNode.connect(an);
  const buf = new Float32Array(an.fftSize);
  setInterval(() => {
    an.getFloatTimeDomainData(buf);
    let s = 0; for (const v of buf) s += v * v;
    level = Math.sqrt(s / buf.length);
  }, 200);
  setInterval(() => { if (!hidden && np.status === "Playing") audioWatchdog(); else silentFor = 0; }, 500);

  spec = audioCtx.createAnalyser();
  spec.fftSize = 4096;
  spec.smoothingTimeConstant = 0.5;
  spec.minDecibels = -88;
  spec.maxDecibels = -22;
  delayNode.connect(spec);
  return delayNode;
}

function loadPresets() {
  const all = Object.assign({},
    window.butterchurnPresets.getPresets(),
    window.butterchurnPresetsExtra ? window.butterchurnPresetsExtra.getPresets() : {});
  presetMap = all;
  presetNames = CFG.presets.filter((n) => all[n]);
  if (presetNames.length < 5) presetNames = Object.keys(all);   // safety net if names drift
}

let presetTimer = null;
function nextPreset(blend = CFG.blendSeconds) {
  if (!viz || !presetNames.length) return;
  let name;
  do { name = presetNames[Math.floor(Math.random() * presetNames.length)]; }
  while (presetNames.length > 1 && name === presetName);
  try { viz.loadPreset(presetMap[name], blend); presetName = name; }
  catch (e) { console.warn("preset failed", name, e); presetNames = presetNames.filter((n) => n !== name); }
  clearTimeout(presetTimer);
  const secs = CFG.presetSeconds * (0.75 + Math.random() * 0.5);
  presetTimer = setTimeout(() => nextPreset(), secs * 1000);
}

async function initViz() {
  const canvas = $("viz");
  const node = await initAudio();
  viz = window.butterchurn.default.createVisualizer(audioCtx, canvas, {
    width: canvas.width, height: canvas.height, pixelRatio: 1, textureRatio: 1,
  });
  viz.connectAudio(node);
  loadPresets();
  nextPreset(0);
}

let lastFrame = 0, frameNo = 0;

// Auto-dimmer: some presets wash out to near-white, which is glaring in a dark room.
// Sample the frame at 32x8 right after rendering and steer a CSS brightness filter so the
// average stays near CFG.targetLuma (never brighter than the base 0.8).
const dimCanvas = document.createElement("canvas");
dimCanvas.width = 32; dimCanvas.height = 8;
const dimCtx = dimCanvas.getContext("2d", { willReadFrequently: true });
let dimLevel = 0.8;
function autoDim() {
  try {
    dimCtx.drawImage($("viz"), 0, 0, 32, 8);
    const d = dimCtx.getImageData(0, 0, 32, 8).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const luma = sum / (d.length / 4) / 255;
    const want = Math.max(0.3, Math.min(0.8, CFG.targetLuma / Math.max(luma, 0.01)));
    dimLevel += (want - dimLevel) * 0.25;            // ease, no visible pumping
    $("viz").style.filter = `brightness(${dimLevel.toFixed(3)}) saturate(0.9)`;
    lastLuma = luma;
    // Some presets go almost black for certain songs. If that lasts, move on.
    darkFor = luma < CFG.darkLuma ? darkFor + 0.5 : 0;     // autoDim runs every 0.5 s
    if (darkFor >= CFG.darkSeconds) { darkFor = 0; lastSkipped = presetName; nextPreset(3); }
  } catch (e) { /* canvas not ready */ }
}
let lastLuma = 0, darkFor = 0, lastSkipped = "";
// Locked or monitors asleep: draw nothing and stop the audio graph until it's visible again.
let hidden = false;
function setHidden(h) {
  if (h === hidden) return;
  hidden = h;
  if (audioCtx) (h ? audioCtx.suspend() : audioCtx.resume()).catch(() => {});
  if (!h && audioCtx) setTimeout(() => { if (!inputStream || inputStream.getAudioTracks().every((t) => t.readyState === "ended")) connectInput("wake"); }, 1000);
}
function frame(t) {
  requestAnimationFrame(frame);
  if (hidden) return;
  if (t - lastFrame < 1000 / CFG.fps - 2) return;
  lastFrame = t;
  // Only one of the two layers animates at a time; the other holds its last frame while fading.
  if (document.body.classList.contains("playing")) {
    if (viz) { viz.render(); if (++frameNo % 15 === 0) autoDim(); }
    if (CFG.bars.on) drawBars(t);
  } else drawIdle(t);
  if (document.body.classList.contains("debug")) {
    $("debug").textContent = `${presetName} | level ${level.toFixed(3)} | luma ${lastLuma.toFixed(2)} dim ${dimLevel.toFixed(2)} | delay ${delayNode ? delayNode.delayTime.value.toFixed(2) : "-"} | ${audioNote}`;
  }
}

// ------------------------------------------------------- spectrum bars ----
// Log-spaced bands, fast rise, smooth fall, small peak caps that drift down.
const bctx = $("bars").getContext("2d");
let barX0 = 0, bandBins = null, bandVal = null, peakVal = null, peakHold = null, specBuf = null, barGrad = null, lastBarT = 0;
function setupBars() {
  const B = CFG.bars, n = B.count, hzPerBin = audioCtx.sampleRate / spec.fftSize;
  // Start just right of the album art so the bass isn't hidden behind it.
  barX0 = Math.round($("art").getBoundingClientRect().right + 20);
  bandBins = [];
  for (let i = 0; i < n; i++) {
    const lo = B.minHz * Math.pow(B.maxHz / B.minHz, i / n);
    const hi = B.minHz * Math.pow(B.maxHz / B.minHz, (i + 1) / n);
    const a = Math.floor(lo / hzPerBin), b = Math.max(a, Math.ceil(hi / hzPerBin) - 1);
    bandBins.push([a, b]);
  }
  bandVal = new Float32Array(n); peakVal = new Float32Array(n); peakHold = new Float32Array(n);
  specBuf = new Uint8Array(spec.frequencyBinCount);
  const H = 480;
  barGrad = bctx.createLinearGradient(0, H, 0, H * (1 - CFG.bars.maxHeight));
  barGrad.addColorStop(0, "rgba(61,143,224,0.95)");     // accent azure at the base
  barGrad.addColorStop(0.6, "rgba(110,170,240,0.75)");
  barGrad.addColorStop(1, "rgba(190,215,255,0.65)");    // paler at the top
}
function drawBars(t) {
  if (!spec) return;
  if (!bandBins) setupBars();
  const W = 1920, H = 480, B = CFG.bars, n = B.count;
  const dt = Math.min(0.1, (t - (lastBarT || t)) / 1000) || 1 / CFG.fps; lastBarT = t;
  spec.getByteFrequencyData(specBuf);
  const maxH = H * B.maxHeight, slot = (W - barX0 - 12) / n, bw = Math.max(2, slot * 0.72);
  bctx.clearRect(0, 0, W, H);
  bctx.globalAlpha = B.opacity;
  bctx.fillStyle = barGrad;
  for (let i = 0; i < n; i++) {
    const [a, b] = bandBins[i];
    let m = 0; for (let k = a; k <= b; k++) if (specBuf[k] > m) m = specBuf[k];
    // Music has less energy up high; tilt so the right side isn't always flat.
    let v = Math.min(1, (m / 255) * (0.92 + 0.22 * i / n));
    v = v * v;                                          // keep quiet passages low, peaks punchy
    bandVal[i] = v > bandVal[i] ? bandVal[i] + (v - bandVal[i]) * 0.7 : Math.max(v, bandVal[i] - 1.6 * dt);
    if (bandVal[i] >= peakVal[i]) { peakVal[i] = bandVal[i]; peakHold[i] = 0.35; }
    else if ((peakHold[i] -= dt) < 0) peakVal[i] = Math.max(bandVal[i], peakVal[i] - 0.5 * dt);
    const h = bandVal[i] * maxH, x = barX0 + i * slot + (slot - bw) / 2;
    if (h > 1) { bctx.beginPath(); bctx.roundRect(x, H - h, bw, h, [4, 4, 0, 0]); bctx.fill(); }
  }
  bctx.fillStyle = "rgba(225,235,255,0.9)";
  for (let i = 0; i < n; i++) {
    if (peakVal[i] < 0.02) continue;
    const x = barX0 + i * slot + (slot - bw) / 2;
    bctx.fillRect(x, H - peakVal[i] * maxH - 9, bw, 4);
  }
  bctx.globalAlpha = 1;
}

// ------------------------------------------------------ idle animation ----
// Slow drifting bands in the wallpaper's blues. Cheap 2D canvas at quarter resolution.
const ictx = $("idle").getContext("2d");
function drawIdle(t) {
  const w = 960, h = 240, s = t / 1000;
  ictx.fillStyle = "#0a0c16";
  ictx.fillRect(0, 0, w, h);
  ictx.globalCompositeOperation = "lighter";
  const bands = [
    { hue: 215, amp: 38, y: 0.55, sp: 0.05, f: 1.6, a: 0.16 },
    { hue: 228, amp: 46, y: 0.45, sp: 0.035, f: 1.1, a: 0.14 },
    { hue: 200, amp: 30, y: 0.65, sp: 0.06, f: 2.2, a: 0.10 },
  ];
  for (const b of bands) {
    const g = ictx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `hsla(${b.hue},70%,50%,0)`);
    g.addColorStop(b.y, `hsla(${b.hue},70%,50%,${b.a})`);
    g.addColorStop(1, `hsla(${b.hue},70%,50%,0)`);
    ictx.fillStyle = g;
    ictx.beginPath();
    ictx.moveTo(0, h);
    for (let x = 0; x <= w; x += 16) {
      const y = h * b.y + Math.sin(x / w * Math.PI * b.f + s * b.sp * 6) * b.amp
                        + Math.sin(x / w * Math.PI * b.f * 2.3 - s * b.sp * 4) * b.amp * 0.4;
      ictx.lineTo(x, y);
    }
    ictx.lineTo(w, h);
    ictx.closePath();
    ictx.fill();
  }
  ictx.globalCompositeOperation = "source-over";
}

initViz().catch((e) => { console.error("visualizer unavailable", e); $("debug").textContent = "viz: " + e; });
requestAnimationFrame(frame);
