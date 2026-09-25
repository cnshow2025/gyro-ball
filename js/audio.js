// 以 Web Audio 即時合成所有音效，不需要音檔
let ctx = null;
let master = null;
let rollGain = null;
let rollFilter = null;
let enabled = true;

export function initAudio() {
  if (ctx) { ctx.resume?.(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = enabled ? 0.8 : 0;
  master.connect(ctx.destination);

  // 滾動聲：循環白噪音 → 帶通濾波 → 音量隨速度
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) { last = last * 0.9 + (Math.random() * 2 - 1) * 0.1; ch[i] = last * 4; }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  rollFilter = ctx.createBiquadFilter();
  rollFilter.type = 'bandpass';
  rollFilter.frequency.value = 300;
  rollFilter.Q.value = 0.8;
  rollGain = ctx.createGain();
  rollGain.gain.value = 0;
  src.connect(rollFilter).connect(rollGain).connect(master);
  src.start();

  // 科幻背景低鳴
  const drone = ctx.createGain();
  drone.gain.value = 0.035;
  drone.connect(master);
  [55, 82.5, 110.3].forEach((f, i) => {
    const o = ctx.createOscillator();
    o.type = i === 2 ? 'triangle' : 'sine';
    o.frequency.value = f;
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 0.07 + i * 0.05;
    lg.gain.value = 1.5;
    lfo.connect(lg).connect(o.frequency);
    o.connect(drone);
    o.start(); lfo.start();
  });
}

export function setSoundEnabled(on) {
  enabled = on;
  if (master) master.gain.setTargetAtTime(on ? 0.8 : 0, ctx.currentTime, 0.05);
}

// speed：鋼珠速度；grounded：是否接觸軌道
export function updateRoll(speed, grounded) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const v = grounded ? Math.min(speed / 12, 1) : 0;
  rollGain.gain.setTargetAtTime(v * 0.5, t, 0.05);
  rollFilter.frequency.setTargetAtTime(180 + v * 900, t, 0.05);
}

function tone(freq, dur, type = 'sine', vol = 0.3, when = 0, slideTo = null) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  hit(strength) { // 撞擊金屬聲
    const s = Math.min(strength, 1);
    tone(900 + Math.random() * 300, 0.12, 'triangle', 0.25 * s);
    tone(2400 + Math.random() * 500, 0.06, 'sine', 0.1 * s);
  },
  gem() {
    [880, 1320, 1760].forEach((f, i) => tone(f, 0.25, 'sine', 0.22, i * 0.06));
  },
  checkpoint() {
    tone(660, 0.15, 'square', 0.08); tone(990, 0.25, 'square', 0.08, 0.1);
  },
  fall() {
    tone(500, 0.8, 'sawtooth', 0.15, 0, 60);
  },
  count(final) {
    tone(final ? 1046 : 523, final ? 0.4 : 0.15, 'square', 0.12);
  },
  win() {
    [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.35, 'triangle', 0.2, i * 0.1));
    tone(2093, 0.8, 'sine', 0.12, 0.5);
  },
};
