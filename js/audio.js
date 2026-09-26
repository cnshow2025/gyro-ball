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

  // 遊樂園背景音樂
  musicGain = ctx.createGain();
  musicGain.gain.value = musicOn ? MUSIC_VOL : 0;
  musicGain.connect(master);
  startMusic();

  // 環境音：鳥叫、遠處人群
  ambientGain = ctx.createGain();
  ambientGain.gain.value = ambientOn ? 1 : 0;
  ambientGain.connect(master);
  startAmbient();
}

// ------------------------------------------------------------------ 環境音：鳥叫、人群、歡呼
let ambientGain = null;
let ambientOn = true;
let noiseBuf = null;

function getNoise() {
  if (noiseBuf) return noiseBuf;
  const len = ctx.sampleRate * 3;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function panner(x) {
  if (!ctx.createStereoPanner) return null;
  const p = ctx.createStereoPanner();
  p.pan.value = x;
  return p;
}

function startAmbient() {
  // 遠處人群的嗡嗡聲：帶通噪音 + 緩慢起伏
  const src = ctx.createBufferSource();
  src.buffer = getNoise();
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 550;
  bp.Q.value = 0.6;
  const g = ctx.createGain();
  g.gain.value = 0.018;
  const lfo = ctx.createOscillator();
  const lg = ctx.createGain();
  lfo.frequency.value = 0.13;
  lg.gain.value = 0.007;
  lfo.connect(lg).connect(g.gain);
  src.connect(bp).connect(g).connect(ambientGain);
  src.start();
  lfo.start();
  scheduleBird();
}

// 隨機一種鳥叫：啾啾（上滑音）、顫音、兩音口哨
function scheduleBird() {
  setTimeout(() => {
    if (ctx && ctx.state === 'running' && ambientOn && !document.hidden) bird();
    scheduleBird();
  }, 1800 + Math.random() * 5000);
}

function bird() {
  const t0 = ctx.currentTime + 0.05;
  const out = ctx.createGain();
  out.gain.value = 0.05 + Math.random() * 0.04;
  const pan = panner(Math.random() * 1.6 - 0.8);
  if (pan) out.connect(pan).connect(ambientGain); else out.connect(ambientGain);
  const kind = Math.floor(Math.random() * 3);
  const base = 2200 + Math.random() * 1600;
  const chirp = (t, f0, f1, dur, vol = 1) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.2);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  };
  if (kind === 0) {
    // 啾啾啾
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) chirp(t0 + i * 0.13, base, base * 1.6, 0.08);
  } else if (kind === 1) {
    // 顫音：快速重複的短音
    const n = 8 + Math.floor(Math.random() * 8);
    for (let i = 0; i < n; i++) chirp(t0 + i * 0.045, base * 1.2, base * 1.05, 0.035, 0.8);
  } else {
    // 兩音口哨：高－低
    chirp(t0, base * 1.3, base * 1.35, 0.18);
    chirp(t0 + 0.24, base * 0.95, base * 0.85, 0.22);
  }
}

// 人群歡呼：big = 過關的大歡呼（含掌聲），否則是一小陣
function cheer(big) {
  if (!ctx || !ambientOn) return;
  const t0 = ctx.currentTime + 0.02;
  const dur = big ? 2.6 : 1.1;
  const peak = big ? 0.5 : 0.22;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, t0);
  out.gain.linearRampToValueAtTime(peak, t0 + 0.25);
  out.gain.setTargetAtTime(peak * 0.7, t0 + 0.5, 0.4);
  out.gain.setTargetAtTime(0, t0 + dur * 0.6, dur * 0.2);
  out.connect(ambientGain);
  // 人聲的「哇～」：一群音高各異的聲音，經過母音共振峰
  const formants = [[800, 6], [1200, 8], [2600, 10]];
  const voices = big ? 14 : 7;
  for (let i = 0; i < voices; i++) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f = 180 + Math.random() * 260;
    const st = t0 + Math.random() * 0.2;
    o.frequency.setValueAtTime(f * 0.85, st);
    o.frequency.linearRampToValueAtTime(f * 1.25, st + 0.35);
    o.frequency.linearRampToValueAtTime(f * 1.05, st + dur);
    const vib = ctx.createOscillator();
    const vg = ctx.createGain();
    vib.frequency.value = 4 + Math.random() * 3;
    vg.gain.value = f * 0.03;
    vib.connect(vg).connect(o.frequency);
    const vgain = ctx.createGain();
    vgain.gain.value = 2.2 / voices;
    const pan = panner(Math.random() * 1.6 - 0.8);
    for (const [ff, q] of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = ff * (0.9 + Math.random() * 0.2);
      bp.Q.value = q;
      o.connect(bp).connect(vgain);
    }
    if (pan) vgain.connect(pan).connect(out); else vgain.connect(out);
    o.start(st); vib.start(st);
    o.stop(t0 + dur + 0.3); vib.stop(t0 + dur + 0.3);
  }
  // 人群的喧嘩（噪音）
  const n = ctx.createBufferSource();
  n.buffer = getNoise();
  const nbp = ctx.createBiquadFilter();
  nbp.type = 'bandpass';
  nbp.frequency.value = 1000;
  nbp.Q.value = 0.5;
  const ng = ctx.createGain();
  ng.gain.value = 0.6;
  n.connect(nbp).connect(ng).connect(out);
  n.start(t0, Math.random() * 1.5);
  n.stop(t0 + dur + 0.3);
  // 掌聲
  if (big) {
    const claps = 60;
    for (let i = 0; i < claps; i++) {
      const t = t0 + 0.1 + Math.random() * (dur - 0.3);
      const c = ctx.createBufferSource();
      c.buffer = getNoise();
      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.frequency.value = 1500 + Math.random() * 1500;
      hp.Q.value = 1.2;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.5, t);
      cg.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      const pan = panner(Math.random() * 1.8 - 0.9);
      c.connect(hp).connect(cg);
      if (pan) cg.connect(pan).connect(out); else cg.connect(out);
      c.start(t, Math.random() * 2.5);
      c.stop(t + 0.06);
    }
  }
}

export function setAmbientEnabled(on) {
  ambientOn = on;
  if (ambientGain) ambientGain.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.1);
}

// ------------------------------------------------------------------ 背景音樂：原創旋轉木馬圓舞曲（3/4 拍，16 小節循環）
// 以 C 大調譜寫；音高用 MIDI 編號（60 = 中央 C）
const MUSIC_VOL = 0.5;
const BEAT = 0.4; // 每拍秒數（150 BPM）
let musicGain = null;
let musicOn = true;
let musicTimer = null;
let nextBeatTime = 0;
let beatIndex = 0;

// 旋律：每小節 3 拍，[音高, 拍數]；null 為休止
const MELODY = [
  [[67, 1], [72, 1], [76, 1]], [[79, 2], [76, 1]], [[77, 2], [74, 1]], [[71, 2], [67, 1]],
  [[74, 1], [77, 1], [79, 1]], [[83, 2], [81, 1]], [[79, 2], [76, 1]], [[72, 3]],
  [[69, 1], [72, 1], [77, 1]], [[81, 2], [77, 1]], [[79, 2], [76, 1]], [[72, 1], [76, 1], [79, 1]],
  [[77, 2], [74, 1]], [[71, 1], [74, 1], [77, 1]], [[76, 2], [74, 1]], [[72, 2], [null, 1]],
];
// 和弦（每小節一個）：[低音, 和弦內音...]
const C = [48, 64, 67, 72], F = [41, 65, 69, 72], G7 = [43, 62, 65, 71];
const CHORDS = [C, C, G7, G7, G7, G7, C, C, F, F, C, C, G7, G7, C, C];

// 旋律拍位表：第幾拍開始哪個音、持續幾拍
const MELODY_AT = new Map();
{
  let b = 0;
  for (const bar of MELODY) for (const [n, d] of bar) { if (n != null) MELODY_AT.set(b, [n, d]); b += d; }
}
const LOOP_BEATS = 48;

const freq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// 風琴般的音色（方波＋三角波＋顫音），模擬旋轉木馬的蒸汽風琴
function organNote(m, t, dur, vol, bright = true) {
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = bright ? 2600 : 1200;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.015);
  g.gain.setTargetAtTime(vol * 0.6, t + 0.05, 0.12);
  g.gain.setTargetAtTime(0, t + dur - 0.04, 0.03);
  g.connect(musicGain);
  lp.connect(g);
  const vib = ctx.createOscillator();
  const vg = ctx.createGain();
  vib.frequency.value = 5.5;
  vg.gain.value = freq(m) * 0.004;
  vib.connect(vg);
  for (const [type, mul, a] of [['square', 1, 0.35], ['triangle', 1, 0.8], ['sine', 2, 0.25]]) {
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = type;
    o.frequency.value = freq(m) * mul;
    vg.connect(o.frequency);
    og.gain.value = a;
    o.connect(og).connect(lp);
    o.start(t);
    o.stop(t + dur + 0.2);
  }
  vib.start(t);
  vib.stop(t + dur + 0.2);
}

// 鐘琴般的亮音（第二輪加在旋律上方）
function bellNote(m, t, vol) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
  g.connect(musicGain);
  for (const [mul, a] of [[1, 1], [2.76, 0.3], [5.4, 0.12]]) {
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.value = freq(m) * mul;
    og.gain.value = a;
    o.connect(og).connect(g);
    o.start(t);
    o.stop(t + 1);
  }
}

function scheduleBeat(i, t) {
  const b = i % LOOP_BEATS;
  const second = i % (LOOP_BEATS * 2) >= LOOP_BEATS;
  const bar = Math.floor(b / 3), beat = b % 3;
  const chord = CHORDS[bar];
  // 伴奏：嗯－趴－趴
  if (beat === 0) organNote(chord[0], t, BEAT * 0.9, 0.16, false);
  else for (const n of chord.slice(1)) organNote(n - 12, t, BEAT * 0.45, 0.05, false);
  // 旋律
  const mel = MELODY_AT.get(b);
  if (mel) {
    organNote(mel[0], t, mel[1] * BEAT * 0.95, 0.11);
    if (second) bellNote(mel[0] + 12, t, 0.05);
  }
}

function musicTick() {
  if (!ctx || ctx.state !== 'running') return;
  // 分頁在背景太久回來時，不要一次補播一大堆音符
  if (nextBeatTime < ctx.currentTime - 0.2) nextBeatTime = ctx.currentTime + 0.05;
  while (nextBeatTime < ctx.currentTime + 0.3) {
    scheduleBeat(beatIndex, nextBeatTime);
    nextBeatTime += BEAT;
    beatIndex++;
  }
}

function startMusic() {
  if (musicTimer) return;
  nextBeatTime = ctx.currentTime + 0.1;
  beatIndex = 0;
  musicTimer = setInterval(musicTick, 60);
}

export function setMusicEnabled(on) {
  musicOn = on;
  if (musicGain) musicGain.gain.setTargetAtTime(on ? MUSIC_VOL : 0, ctx.currentTime, 0.1);
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
  cheer(big = false) { cheer(big); },
  win() {
    [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.35, 'triangle', 0.2, i * 0.1));
    tone(2093, 0.8, 'sine', 0.12, 0.5);
  },
};
