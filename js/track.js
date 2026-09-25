// 雲霄飛車雙軌：路徑描述 + 取樣後的軌道資料
import * as THREE from '../vendor/three.module.js';

export const DS = 0.25;        // 取樣間距
export const BALL_R = 0.32;    // 鋼珠半徑
export const RAIL_R = 0.055;   // 導軌半徑
export const RAIL_GAP = 0.22;  // 導軌到中心線的距離
// 鋼珠同時壓在兩條導軌上時，球心高於中心線的距離
export const RIDE_H = Math.sqrt((BALL_R + RAIL_R) ** 2 - RAIL_GAP ** 2);

const Y = new THREE.Vector3(0, 1, 0);
const smooth = (t) => t * t * (3 - 2 * t);
const rad = (d) => (d * Math.PI) / 180;

// ------------------------------------------------------------------ 路徑畫筆
// 像烏龜繪圖一樣「往前走、轉彎、爬坡」來描述軌道。yaw = 0 表示朝 -z 前進，正值往右轉。
export class Path {
  constructor(x = 0, y = 0, z = 0, yaw = 0) {
    this.pos = new THREE.Vector3(x, y, z);
    this.yaw = rad(yaw);
    this.pts = [this.pos.clone()];
    this.banks = [0];
    this.len = 0;
    this.gaps = [];
    this.loops = [];
    this.gems = [];
    this.checkpoints = [];
  }

  fwd() { return new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  right() { return new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw)); }

  push(p, bank = 0) {
    const d = p.distanceTo(this.pos);
    if (d < 1e-4) return;
    this.len += d;
    this.pts.push(p.clone());
    this.banks.push(bank);
    this.pos.copy(p);
  }

  // 直線；dy 為高度變化（預設平滑過渡，linear 為等斜率）
  straight(len, dy = 0, linear = false) {
    const n = Math.max(2, Math.ceil(len / 1.5));
    const s = this.pos.clone(), f = this.fwd();
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const p = s.clone().addScaledVector(f, len * t);
      p.y = s.y + dy * (linear ? t : smooth(t));
      this.push(p);
    }
    return this;
  }

  // 斜坡（等斜率，適合飛躍前的跳台）
  ramp(len, dy) { return this.straight(len, dy, true); }

  // 彎道：deg > 0 右轉；bank 為最大內傾角（度）
  turn(deg, radius, dy = 0, bank = 0) {
    const arc = Math.abs(rad(deg)) * radius;
    const n = Math.max(3, Math.ceil(arc / 1.2));
    const dYaw = rad(deg) / n, step = arc / n;
    const y0 = this.pos.y, sign = Math.sign(deg);
    for (let i = 1; i <= n; i++) {
      this.yaw += dYaw / 2;
      const p = this.pos.clone().addScaledVector(this.fwd(), step);
      this.yaw += dYaw / 2;
      const t = i / n;
      p.y = y0 + dy * smooth(t);
      this.push(p, rad(bank) * sign * Math.sin(Math.PI * t));
    }
    return this;
  }

  // 山丘（h > 0）或凹谷（h < 0）
  hill(len, h) {
    const n = Math.max(6, Math.ceil(len / 1.0));
    const s = this.pos.clone(), f = this.fwd();
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const p = s.clone().addScaledVector(f, len * t);
      p.y = s.y + (h * (1 - Math.cos(2 * Math.PI * t))) / 2;
      this.push(p);
    }
    return this;
  }

  // 斷橋：這段沒有軌道，鋼珠必須飛過去
  gap(len, dy = 0) {
    const s0 = this.len;
    this.straight(len, dy, true);
    this.gaps.push([s0, this.len]);
    return this;
  }

  // 垂直迴圈；shift 為側移量，讓出口與入口錯開
  loop(radius, shift = 2.5) {
    const s0 = this.len;
    const start = this.pos.clone(), f = this.fwd(), r = this.right();
    const n = 28;
    for (let i = 1; i <= n; i++) {
      const th = (i / n) * Math.PI * 2;
      const p = start.clone()
        .addScaledVector(f, radius * Math.sin(th))
        .addScaledVector(Y, radius * (1 - Math.cos(th)))
        .addScaledVector(r, shift * smooth(i / n));
      this.push(p);
    }
    this.loops.push([s0, this.len]);
    return this;
  }

  // 晶石：h 為離軌道的高度，back 為往回算的距離（例如放在剛畫完的山頂）
  gem(h = 0, back = 0) { this.gems.push({ s: this.len - back, h }); return this; }
  checkpoint() { this.checkpoints.push(this.len); return this; }
}

// ------------------------------------------------------------------ 取樣後的軌道
export class Track {
  constructor(path) {
    const curve = new THREE.CatmullRomCurve3(path.pts, false, 'centripetal');
    const L = curve.getLength();
    const scale = L / path.len; // 路徑折線長度 → 曲線長度
    this.length = L;
    const N = Math.floor(L / DS) + 1;
    this.N = N;
    this.P = []; this.T = []; this.U = []; this.B = []; this.K = [];
    this.gap = new Uint8Array(N);
    this.inLoop = new Uint8Array(N);

    // 折線累積長度（用來內插傾角）
    const cum = [0];
    for (let i = 1; i < path.pts.length; i++) cum.push(cum[i - 1] + path.pts[i].distanceTo(path.pts[i - 1]));
    const bankAt = (sp) => {
      let j = 1;
      while (j < cum.length - 1 && cum[j] < sp) j++;
      const t = THREE.MathUtils.clamp((sp - cum[j - 1]) / (cum[j] - cum[j - 1] || 1), 0, 1);
      return path.banks[j - 1] + (path.banks[j] - path.banks[j - 1]) * t;
    };
    const inRanges = (sp, ranges) => ranges.some(([a, b]) => sp > a && sp < b);

    const U0 = [];
    for (let i = 0; i < N; i++) {
      const s = Math.min(i * DS, L);
      const u = s / L;
      const sp = s / scale;
      this.P.push(curve.getPointAt(u));
      const T = curve.getTangentAt(u).normalize();
      this.T.push(T);
      this.gap[i] = inRanges(sp, path.gaps) ? 1 : 0;
      this.inLoop[i] = inRanges(sp, path.loops) ? 1 : 0;

      // 法線：一般路段以「重力向上」為準；迴圈內沿用前一點做平行傳遞
      let up;
      if (this.inLoop[i] && i > 0) {
        up = U0[i - 1].clone().addScaledVector(T, -U0[i - 1].dot(T));
      } else {
        up = Y.clone().addScaledVector(T, -T.y);
        if (up.lengthSq() < 1e-3) up = U0[i - 1].clone().addScaledVector(T, -U0[i - 1].dot(T));
      }
      up.normalize();
      U0.push(up);

      const bank = bankAt(sp);
      const side = new THREE.Vector3().crossVectors(T, up);
      const U = up.clone().multiplyScalar(Math.cos(bank)).addScaledVector(side, Math.sin(bank)).normalize();
      this.U.push(U);
      this.B.push(new THREE.Vector3().crossVectors(T, U).normalize());
    }

    // 曲率向量 dT/ds（中央差分 + 平滑）
    const raw = [];
    for (let i = 0; i < N; i++) {
      const a = this.T[Math.max(0, i - 1)], b = this.T[Math.min(N - 1, i + 1)];
      const span = (Math.min(N - 1, i + 1) - Math.max(0, i - 1)) * DS;
      raw.push(b.clone().sub(a).divideScalar(span));
    }
    for (let i = 0; i < N; i++) {
      const k = new THREE.Vector3();
      let c = 0;
      for (let j = i - 3; j <= i + 3; j++) if (j >= 0 && j < N) { k.add(raw[j]); c++; }
      this.K.push(k.divideScalar(c));
    }

    this.gems = path.gems.map((g) => ({ s: g.s * scale, h: g.h }));
    this.checkpoints = path.checkpoints.map((s) => s * scale);
    this.minY = Math.min(...this.P.map((p) => p.y));
  }

  index(s) { return THREE.MathUtils.clamp(Math.floor(s / DS), 0, this.N - 2); }

  // 內插取得 s 處的軌道資料
  frameAt(s, o) {
    const i = this.index(s);
    const t = THREE.MathUtils.clamp(s / DS - i, 0, 1);
    o.p.lerpVectors(this.P[i], this.P[i + 1], t);
    o.t.lerpVectors(this.T[i], this.T[i + 1], t).normalize();
    o.u.lerpVectors(this.U[i], this.U[i + 1], t).normalize();
    o.b.lerpVectors(this.B[i], this.B[i + 1], t).normalize();
    o.k.lerpVectors(this.K[i], this.K[i + 1], t);
    o.gap = this.gap[t < 0.5 ? i : i + 1];
    return o;
  }

  // 在 [i0 - win, i0 + win] 範圍內找離 pos 最近的取樣點
  nearest(pos, i0, win) {
    let best = -1, bd = Infinity;
    const a = Math.max(0, i0 - win), b = Math.min(this.N - 1, i0 + win);
    for (let i = a; i <= b; i++) {
      const d = this.P[i].distanceToSquared(pos);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
}

export function newFrame() {
  return { p: new THREE.Vector3(), t: new THREE.Vector3(), u: new THREE.Vector3(), b: new THREE.Vector3(), k: new THREE.Vector3(), gap: 0 };
}
