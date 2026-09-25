// 本機存檔（localStorage）：解鎖進度、排行榜、設定
// v5：12 關全部重新設計（迴圈、翻滾、螺旋、交叉），排行榜重新開始；沿用名稱、音效、震動設定
const KEY = 'gyroball.v5';
const OLD_KEYS = ['gyroball.v4', 'gyroball.v3', 'gyroball.v2', 'gyroball.v1'];
const BOARD_SIZE = 10;
export const GEM_BONUS = 2; // 每顆晶石折抵秒數

function defaults() {
  return {
    unlocked: 1,
    bestGems: {},
    boards: {},
    settings: { name: '玩家', sound: true, vibrate: true, sens: 0.6, shadows: true },
  };
}

let data = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      const def = defaults();
      for (const k of OLD_KEYS) {
        const old = JSON.parse(localStorage.getItem(k) || 'null');
        if (old && old.settings) {
          const { name, sound, vibrate, sens } = old.settings;
          def.settings = { ...def.settings, name, sound, vibrate };
          if (k !== 'gyroball.v2' && k !== 'gyroball.v1' && sens) def.settings.sens = sens; // v3 起的靈敏度可以沿用
          break;
        }
      }
      return def;
    }
    const d = JSON.parse(raw);
    const def = defaults();
    return { ...def, ...d, settings: { ...def.settings, ...(d.settings || {}) } };
  } catch {
    return defaults();
  }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* 私密模式等情況忽略 */ }
}

export const store = {
  get settings() { return data.settings; },
  setSetting(k, v) { data.settings[k] = v; save(); },
  get unlocked() { return data.unlocked; },
  bestGems(i) { return data.bestGems[i] || 0; },
  board(i) { return data.boards[i] || []; },
  best(i) { return this.board(i)[0] || null; },

  // 回傳 { rank（從 1 起算，未上榜為 0）, entry }
  submit(i, time, gems, falls, total) {
    const score = Math.max(0, time - gems * GEM_BONUS);
    const entry = { name: data.settings.name || '玩家', score, time, gems, falls, date: Date.now() };
    const list = [...this.board(i), entry].sort((a, b) => a.score - b.score);
    const rank = list.indexOf(entry) + 1;
    data.boards[i] = list.slice(0, BOARD_SIZE);
    data.bestGems[i] = Math.max(this.bestGems(i), gems);
    if (i + 2 > data.unlocked) data.unlocked = Math.min(total, i + 2);
    save();
    return { rank: rank <= BOARD_SIZE ? rank : 0, entry };
  },

  reset() {
    const settings = data.settings;
    data = defaults();
    data.settings = settings;
    save();
  },
};
