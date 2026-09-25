// 關卡資料
// 座標系：y 向上，鏡頭在 +z 方向往 -z 看；軌道大致往 -z 延伸。
// 所有 y 值都是「軌道表面」高度。

const T = 0.5; // 軌道厚度

function floor(cx, cz, w, d, y = 0, mat) {
  return { type: 'box', kind: 'floor', mat, pos: [cx, y - T / 2, cz], size: [w, T, d] };
}

// 護欄（只支援與 x 或 z 軸平行）
function rail(x1, z1, x2, z2, y = 0) {
  const h = 0.55, t = 0.2;
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
  const size = x1 === x2 ? [t, h, Math.abs(z2 - z1) + t] : [Math.abs(x2 - x1) + t, h, t];
  return { type: 'box', kind: 'rail', mat: 'rail', pos: [cx, y + h / 2, cz], size };
}

// 斜坡：由 (x1,y1,z1) 表面點連到 (x2,y2,z2) 表面點
function ramp(x1, z1, y1, x2, z2, y2, w, mat) {
  const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
  const horiz = Math.hypot(dx, dz);
  const len = Math.hypot(horiz, dy) + 0.3; // 稍微加長，避免接縫
  const yaw = Math.atan2(dx, dz);
  const pitch = -Math.atan2(dy, horiz);
  return {
    type: 'ramp', kind: 'floor', mat,
    mid: [(x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2],
    size: [w, T, len], euler: [pitch, yaw, 0],
  };
}

// 移動平台：沿 axis 做正弦往返
function mover(x, surfaceY, z, w, d, axis, amp, period, phase = 0) {
  return { type: 'mover', pos: [x, surfaceY - T / 2, z], size: [w, T, d], axis, amp, period, phase };
}

// 旋轉掃桿
function spinner(x, surfaceY, z, len, speed) {
  return { type: 'spinner', pos: [x, surfaceY + 0.3, z], len, speed };
}

export const LEVELS = [
  // ---------------------------------------------------------------- 1
  {
    name: '啟航', desc: '寬敞木軌，熟悉傾斜手感', mat: 'wood',
    start: [0, 0.5, 1], goal: [6, 0, -27],
    pieces: [
      floor(0, -5, 4, 16),
      floor(3, -15, 10, 4),
      floor(6, -23, 4, 12),
      rail(-2, 3, 2, 3), rail(-2, 3, -2, -17), rail(2, 3, 2, -13),
      rail(2, -13, 8, -13), rail(-2, -17, 4, -17),
      rail(8, -13, 8, -29), rail(4, -17, 4, -29), rail(4, -29, 8, -29),
    ],
    gems: [[0, 0.5, -4], [3, 0.5, -15], [6, 0.5, -21]],
    checkpoints: [],
  },
  // ---------------------------------------------------------------- 2
  {
    name: '雙峰', desc: '上坡、平台、下坡，小心邊緣', mat: 'wood',
    start: [0, 0.5, 1], goal: [-8, 0, -37],
    pieces: [
      floor(0, -3, 3, 10),
      rail(-1.5, 2, 1.5, 2), rail(-1.5, 2, -1.5, -8), rail(1.5, 2, 1.5, -8),
      ramp(0, -8, 0, 0, -16, 2, 3),
      floor(0, -19, 3, 6, 2),
      floor(-4, -23.5, 11, 3, 2),
      rail(-9.5, -22, -1.5, -22, 2), rail(-6.5, -25, 1.5, -25, 2), rail(1.5, -22, 1.5, -25, 2),
      ramp(-8, -25, 2, -8, -33, 0, 3),
      floor(-8, -36, 4, 6),
      rail(-10, -33, -10, -39), rail(-6, -33, -6, -39), rail(-10, -39, -6, -39),
    ],
    gems: [[0, 1.5, -12], [-5, 2.5, -23.5], [-8, 1.5, -29]],
    checkpoints: [[0, 2, -18]],
  },
  // ---------------------------------------------------------------- 3
  {
    name: '浮動橋', desc: '搭上移動平台跨越深淵', mat: 'stone',
    start: [0, 0.5, 1], goal: [0, 0, -43],
    pieces: [
      floor(0, -3, 3, 10),
      rail(-1.5, 2, 1.5, 2), rail(-1.5, 2, -1.5, -8), rail(1.5, 2, 1.5, -8),
      mover(0, 0, -13, 3, 3, 'z', 3.5, 6),
      floor(0, -21, 3, 6),
      floor(0, -30, 1.6, 12),
      mover(0, 0, -37.5, 3, 3, 'x', 3, 5),
      floor(0, -42, 4, 6),
      rail(-2, -39, -2, -45), rail(2, -39, 2, -45), rail(-2, -45, 2, -45),
    ],
    gems: [[0, 0.5, -13], [0, 0.5, -30], [2.6, 0.5, -37.5]],
    checkpoints: [[0, 0, -20]],
  },
  // ---------------------------------------------------------------- 4
  {
    name: '旋轉閘門', desc: '抓準時機穿越掃桿，再走窄道', mat: 'stone',
    start: [0, 0.5, 1], goal: [3.6, 0, -36.5],
    pieces: [
      floor(0, -8, 5, 20),
      rail(-2.5, 2, 2.5, 2), rail(-2.5, 2, -2.5, -18), rail(2.5, 2, 2.5, -18),
      rail(-0.7, -18, 2.5, -18),
      spinner(0, 0, -5, 4.4, 1.2),
      spinner(0, 0, -13, 4.4, -1.6),
      floor(-1.6, -21.5, 1.8, 7),
      floor(1, -25.9, 7, 1.8),
      floor(3.6, -30.4, 1.8, 7.2),
      floor(3.6, -36, 4, 4),
      rail(1.6, -34, 1.6, -38), rail(5.6, -34, 5.6, -38), rail(1.6, -38, 5.6, -38),
    ],
    gems: [[0, 0.5, -9], [-1.6, 0.5, -23], [3.6, 0.5, -31]],
    checkpoints: [[-1.6, 0, -19.5]],
  },
  // ---------------------------------------------------------------- 5
  {
    name: '星際迴廊', desc: '集合所有機關的終極挑戰', mat: 'stone',
    start: [0, 0.5, 1], goal: [8, 0.5, -54],
    pieces: [
      floor(0, -2, 3, 8),
      rail(-1.5, 2, 1.5, 2), rail(-1.5, 2, -1.5, -6), rail(1.5, 2, 1.5, -6),
      ramp(0, -6, 0, 0, -14, 2.5, 3),
      floor(0, -16, 3, 4, 2.5, 'wood'),
      rail(-1.5, -14, -1.5, -18, 2.5),
      mover(4, 2.5, -19.5, 3, 3, 'x', 4, 7, -Math.PI / 2),
      floor(8, -25, 3, 8, 2.5, 'wood'),
      rail(9.5, -21, 9.5, -29, 2.5),
      spinner(8, 2.5, -26, 2.8, 1.8),
      ramp(8, -29, 2.5, 8, -35, 0.5, 2),
      floor(8, -39, 1.4, 8, 0.5),
      mover(8, 0.5, -46.5, 2.5, 2.5, 'z', 2.25, 4),
      floor(8, -53, 4, 6, 0.5),
      rail(6, -50, 6, -56, 0.5), rail(10, -50, 10, -56, 0.5), rail(6, -56, 10, -56, 0.5),
    ],
    gems: [[0, 1.75, -10], [8, 3, -28], [8, 1, -40]],
    checkpoints: [[0, 2.5, -15.5], [8, 2.5, -22.5]],
  },
];
