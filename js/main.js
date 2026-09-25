import { Game } from './game.js';
import { TiltInput } from './input.js';
import { LEVELS } from './levels.js';
import { store } from './storage.js';
import { initAudio, setSoundEnabled, updateRoll, sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const screens = ['menu', 'levels', 'board', 'settings', 'pause', 'clear'];

const input = new TiltInput();
input.sens = store.settings.sens;
setSoundEnabled(store.settings.sound);

const game = new Game($('game'), input, {
  onGem(n) {
    sfx.gem();
    vibrate([30, 40, 30]);
    toast(`晶石 +1（${n}/${LEVELS[game.levelIndex].gemTotal}）`);
    updateHud();
  },
  onHit(s) {
    sfx.hit(s);
    vibrate(Math.round(10 + s * 40));
  },
  onFall() {
    sfx.fall();
    vibrate(250);
    toast('掉下去了！');
  },
  onKnock() {
    sfx.hit(1);
    vibrate([60, 40, 120]);
    toast('被掃桿打飛！');
  },
  onRespawn() {
    toast('重新出發');
    updateHud();
  },
  onCheckpoint() {
    sfx.checkpoint();
    vibrate(60);
    toast('已到達檢查點');
  },
  onWin(time, gems, falls) {
    sfx.win();
    vibrate([80, 60, 80, 60, 250]);
    const idx = game.levelIndex;
    const res = store.submit(idx, time, gems, falls, LEVELS.length);
    setTimeout(() => { if (game.state === 'won' && game.levelIndex === idx) showClear(idx, time, gems, falls, res); }, 1100);
  },
});

let gyroGranted = false;
let wakeLock = null;

// ------------------------------------------------------------------ 畫面切換
function show(name) {
  for (const s of screens) $('screen-' + s).classList.toggle('hidden', s !== name);
  const inGame = name === null || name === 'pause' || name === 'clear';
  $('hud').classList.toggle('hidden', !inGame);
}

function vibrate(p) {
  if (store.settings.vibrate && navigator.vibrate) {
    try { navigator.vibrate(p); } catch { /* 不支援 */ }
  }
}

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1200);
}

function fmt(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

function updateHud() {
  $('hud-level').textContent = game.levelIndex + 1;
  $('hud-gems').textContent = `${game.gemCount}/${LEVELS[game.levelIndex].gemTotal}`;
  $('hud-falls').textContent = game.falls;
}

// ------------------------------------------------------------------ 進入關卡
async function enableSensors() {
  initAudio();
  if (!gyroGranted) gyroGranted = await input.requestPermission();
  // Android：全螢幕並鎖定橫向（iPhone 不支援，會自動略過）
  try {
    if (matchMedia('(pointer: coarse)').matches && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
    await screen.orientation?.lock?.('landscape');
  } catch { /* 不支援就略過 */ }
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* 忽略 */ }
}

let countdownTimer = 0;
function startLevel(i) {
  clearInterval(countdownTimer);
  game.loadLevel(LEVELS[i], i);
  show(null);
  updateHud();
  $('hud-time').textContent = fmt(0);
  game.setState('countdown');

  const cd = $('countdown');
  let n = 3;
  cd.textContent = n;
  sfx.count(false);
  showControlHint();
  countdownTimer = setInterval(() => {
    n--;
    if (n > 0) {
      cd.textContent = n;
      sfx.count(false);
    } else {
      clearInterval(countdownTimer);
      cd.textContent = 'GO!';
      sfx.count(true);
      vibrate(80);
      input.calibrate(); // 以開始時的握持姿勢當作水平
      input.reset();
      game.setState('play');
      setTimeout(() => { if (cd.textContent === 'GO!') cd.textContent = ''; }, 600);
    }
  }, 800);
}

function showControlHint() {
  const h = $('control-hint');
  h.textContent = input.hasGyro
    ? '手機往哪邊傾，珠子就往畫面哪邊滾。倒數結束時自動校正水平，按 ⊕ 可重新校正'
    : '電腦：方向鍵 / WASD 傾斜板子（或在畫面上拖曳）';
  h.style.opacity = 1;
  setTimeout(() => { h.style.transition = 'opacity 1s'; h.style.opacity = 0; }, 5000);
}

function showClear(idx, time, gems, falls, res) {
  const total = LEVELS[idx].gemTotal;
  const last = idx === LEVELS.length - 1;
  $('clear-title').textContent = last ? '全部通關！' : `第 ${idx + 1} 關 通關！`;
  $('res-time').textContent = fmt(time);
  $('res-gems').textContent = `${'◆'.repeat(gems)}${'◇'.repeat(total - gems)}`;
  $('res-falls').textContent = falls;
  $('res-score').textContent = fmt(res.entry.score);
  $('res-rank').textContent = res.rank === 1 ? '★ 新紀錄！排行榜第 1 名 ★' : res.rank ? `排行榜第 ${res.rank} 名` : '未進入排行榜前 10 名';
  $('btn-next').classList.toggle('hidden', last);
  show('clear');
}

// ------------------------------------------------------------------ 選單
function renderLevels() {
  const list = $('level-list');
  list.innerHTML = '';
  LEVELS.forEach((lv, i) => {
    const locked = i + 1 > store.unlocked;
    const best = store.best(i);
    const gems = store.bestGems(i);
    const b = document.createElement('button');
    b.className = 'btn level-card' + (locked ? ' locked' : '');
    b.disabled = locked;
    b.innerHTML = `
      <span class="num">${locked ? '🔒' : i + 1}</span>
      <span class="info">
        <span class="name">${lv.name}</span>
        <span class="meta">${lv.desc}</span>
        <span class="meta">${best ? '最佳成績 ' + fmt(best.score) : '尚未通關'}</span>
      </span>
      <span class="gems">${'◆'.repeat(gems)}${'◇'.repeat(lv.gemTotal - gems)}</span>`;
    b.onclick = async () => { await enableSensors(); startLevel(i); };
    list.appendChild(b);
  });
}

let boardLevel = 0;
function renderBoard() {
  const tabs = $('board-tabs');
  tabs.innerHTML = '';
  LEVELS.forEach((lv, i) => {
    const b = document.createElement('button');
    b.textContent = `第 ${i + 1} 關`;
    b.className = i === boardLevel ? 'active' : '';
    b.onclick = () => { boardLevel = i; renderBoard(); };
    tabs.appendChild(b);
  });
  const body = $('board-body');
  const rows = store.board(boardLevel);
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">還沒有紀錄，快去挑戰！</td></tr>';
    return;
  }
  body.innerHTML = rows.map((r, k) => {
    const d = new Date(r.date);
    return `<tr><td>${k + 1}</td><td>${escapeHtml(r.name)}</td><td class="score">${fmt(r.score)}</td>
      <td>${fmt(r.time)}</td><td>${r.gems}</td><td>${d.getMonth() + 1}/${d.getDate()}</td></tr>`;
  }).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderSettings() {
  const s = store.settings;
  $('set-name').value = s.name;
  $('set-sound').checked = s.sound;
  $('set-vibrate').checked = s.vibrate;
  $('set-shadows').checked = s.shadows;
  $('set-sens').value = s.sens;
  $('sens-val').textContent = `×${Number(s.sens).toFixed(1)}`;
}

function goMenu() {
  clearInterval(countdownTimer);
  $('countdown').textContent = '';
  game.loadLevel(LEVELS[0], 0);
  game.setState('idle');
  show('menu');
}

// ------------------------------------------------------------------ 綁定按鈕
$('btn-start').onclick = async () => {
  await enableSensors();
  startLevel(Math.min(store.unlocked, LEVELS.length) - 1);
};
$('btn-levels').onclick = () => { renderLevels(); show('levels'); };
$('btn-board').onclick = () => { renderBoard(); show('board'); };
$('btn-settings').onclick = () => { renderSettings(); show('settings'); };
document.querySelectorAll('[data-back]').forEach((b) => { b.onclick = () => show('menu'); });

let pausedFrom = null;
function pause() {
  if (game.state !== 'play' && game.state !== 'falling') return;
  pausedFrom = game.state;
  game.setState('paused');
  updateRoll(0, false);
  show('pause');
}
$('btn-pause').onclick = pause;
$('btn-resume').onclick = () => {
  show(null);
  input.reset();
  game.setState(pausedFrom || 'play');
};
$('btn-restart').onclick = () => startLevel(game.levelIndex);
$('btn-quit').onclick = goMenu;
$('btn-calibrate').onclick = () => { input.calibrate(); toast('已重新校正水平'); };

$('btn-next').onclick = () => startLevel(game.levelIndex + 1);
$('btn-retry').onclick = () => startLevel(game.levelIndex);
$('btn-menu').onclick = goMenu;

$('set-name').oninput = (e) => store.setSetting('name', e.target.value.trim() || '玩家');
$('set-sound').onchange = (e) => { store.setSetting('sound', e.target.checked); setSoundEnabled(e.target.checked); };
$('set-shadows').onchange = (e) => { store.setSetting('shadows', e.target.checked); game.setShadows(e.target.checked); };
$('set-vibrate').onchange = (e) => { store.setSetting('vibrate', e.target.checked); if (e.target.checked) vibrate(60); };
$('set-sens').oninput = (e) => {
  const v = parseFloat(e.target.value);
  store.setSetting('sens', v);
  input.sens = v;
  $('sens-val').textContent = `×${v.toFixed(1)}`;
};
$('btn-reset').onclick = () => {
  if (confirm('確定要清除所有關卡進度與排行榜嗎？')) { store.reset(); toast('紀錄已清除'); }
};

document.addEventListener('visibilitychange', async () => {
  if (document.hidden) pause();
  else if (wakeLock) { try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* 忽略 */ } }
});

// 遊戲為橫向畫面：手機直拿時提示改橫向
const portrait = matchMedia('(orientation: portrait) and (pointer: coarse)');
const checkRotate = () => {
  $('rotate-hint').classList.toggle('hidden', !portrait.matches);
  if (!portrait.matches) game.resize();
};
portrait.addEventListener?.('change', checkRotate);
checkRotate();

$('menu-tip').textContent = window.isSecureContext
  ? '請橫向握持手機；iPhone 會詢問「動作與方向」權限，請按允許'
  : '⚠ 陀螺儀需要 HTTPS 網址才能使用';

// 太快（快被甩出或騰空）時畫面邊緣閃紅光，並輕微震動提醒
let lastWarn = 0;
function updateDanger(now) {
  const d = game.danger;
  const level = d > 0.55 ? (d - 0.55) / 0.45 : 0;
  $('danger').style.opacity = level ? (0.35 + 0.65 * level) * (0.75 + 0.25 * Math.sin(now / 60)) : 0;
  if (level > 0.6 && now - lastWarn > 350) {
    lastWarn = now;
    vibrate(20);
  }
}

// ------------------------------------------------------------------ 主迴圈
let last = performance.now();
function frame(now) {
  const dt = (now - last) / 1000;
  last = now;
  game.update(dt);
  if (game.state === 'play' || game.state === 'falling') {
    $('hud-time').textContent = fmt(game.time);
    $('hud-speed').textContent = Math.round(game.speed * 3.6);
    updateRoll(game.speed, game.grounded);
  } else {
    updateRoll(0, false);
  }
  updateDanger(now);
  requestAnimationFrame(frame);
}

game.setShadows(store.settings.shadows);
goMenu();
requestAnimationFrame(frame);

// 除錯用（方便在瀏覽器主控台檢查）
window.__game = game;
