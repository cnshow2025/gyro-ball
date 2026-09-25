// 全景雙軌迷宮：軌道段、機關、關卡畫筆
import * as THREE from '../vendor/three.module.js';

export const DS = 0.1;         // 取樣間距
export const BALL_R = 0.32;    // 鋼珠半徑
export const RAIL_R = 0.055;   // 導軌半徑
export const RAIL_GAP = 0.22;  // 導軌到中心線的距離
// 鋼珠壓在兩條導軌上時，球心高於中心線的距離
export const RIDE_H = Math.sqrt((BALL_R + RAIL_R) ** 2 - RAIL_GAP ** 2);

const Y = new THREE.Vector3(0, 1, 0);
const smooth = (t) => t * t * (3 - 2 * t);
const rad = (d) => (d * Math.PI) / 180;

// ------------------------------------------------------------------ 取樣後的一段軌道（本地座標）
export class Track {
  constructor(points, banks) {
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    const L = curve.getLength();
    this.length = L;
    const N = Math.max(2, Math.round(L / DS) + 1);
    this.N = N;
    this.ds = L / (N - 1);
    this.P = []; this.T = []; this.U = []; this.B = []; this.K = [];

    const cum = [0];
    for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + points[i].distanceTo(points[i - 1]));
    const total = cum[cum.length - 1];
    const bankAt = (sp) => {
      let j = 1;
      while (j < cum.length - 1 && cum[j] < sp) j++;
      const t = THREE.MathUtils.clamp((sp - cum[j - 1]) / (cum[j] - cum[j - 1] || 1), 0, 1);
      return banks[j - 1] + (banks[j] - banks[j - 1]) * t;
    };

    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      this.P.push(curve.getPointAt(u));
      const T = curve.getTangentAt(u).normalize();
      this.T.push(T);
      let up = Y.clone().addScaledVector(T, -T.y);
      if (up.lengthSq() < 1e-4) up = this.U[i - 1].clone();
      up.normalize();
      const bank = bankAt(u * total);
      const side = new THREE.Vector3().crossVectors(T, up);
      const U = up.multiplyScalar(Math.cos(bank)).addScaledVector(side, Math.sin(bank)).normalize();
      this.U.push(U);
      this.B.push(new THREE.Vector3().crossVectors(T, U).normalize());
    }

    // 曲率向量 dT/ds（中央差分 + 平滑）
    const raw = [];
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
      raw.push(this.T[b].clone().sub(this.T[a]).divideScalar((b - a) * this.ds));
    }
    for (let i = 0; i < N; i++) {
      const k = new THREE.Vector3();
      let c = 0;
      for (let j = i - 4; j <= i + 4; j++) if (j >= 0 && j < N) { k.add(raw[j]); c++; }
      this.K.push(k.divideScalar(c));
    }
  }

  index(s) { return THREE.MathUtils.clamp(Math.floor(s / this.ds), 0, this.N - 2); }

  frameAt(s, o) {
    const i = this.index(s);
    const t = THREE.MathUtils.clamp(s / this.ds - i, 0, 1);
    o.p.lerpVectors(this.P[i], this.P[i + 1], t);
    o.t.lerpVectors(this.T[i], this.T[i + 1], t).normalize();
    o.u.lerpVectors(this.U[i], this.U[i + 1], t).normalize();
    o.b.lerpVectors(this.B[i], this.B[i + 1], t).normalize();
    o.k.lerpVectors(this.K[i], this.K[i + 1], t);
    return o;
  }
}

export function newFrame() {
  return { p: new THREE.Vector3(), t: new THREE.Vector3(), u: new THREE.Vector3(), b: new THREE.Vector3(), k: new THREE.Vector3() };
}

// ------------------------------------------------------------------ 軌道段（可能掛在機關上）
// 世界座標 = pivot + Ry(yaw)·(本地 − pivot) + off
export class Segment {
  constructor(points, banks, opts) {
    this.track = new Track(points, banks);
    this.capStart = !!opts.capStart;
    this.capEnd = !!opts.capEnd;
    this.mech = opts.mech || null;
    this.pivot = opts.pivot ? opts.pivot.clone() : new THREE.Vector3();
    this.yaw = 0;
    this.off = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.qInv = new THREE.Quaternion();
  }

  get length() { return this.track.length; }

  // 依時間更新機關姿態
  update(t) {
    const m = this.mech;
    if (!m) return;
    if (m.type === 'turntable') {
      const cyc = m.hold + m.rot;
      const tt = t + m.phase;
      const k = Math.floor(tt / cyc);
      const u = tt - k * cyc;
      const frac = u < m.hold ? 0 : smooth((u - m.hold) / m.rot);
      this.yaw = m.dir * rad(m.step) * (k + frac);
    } else if (m.type === 'bridge') {
      const cyc = m.hold0 + m.move + m.hold1 + m.move;
      let u = (t + m.phase) % cyc;
      let f;
      if (u < m.hold0) f = 0;
      else if ((u -= m.hold0) < m.move) f = smooth(u / m.move);
      else if ((u -= m.move) < m.hold1) f = 1;
      else f = 1 - smooth((u - m.hold1) / m.move);
      this.off.copy(m.axis).multiplyScalar(m.amp * f);
    }
    this.q.setFromAxisAngle(Y, this.yaw);
    this.qInv.copy(this.q).invert();
  }

  // 本地 → 世界
  point(local, out) { return out.copy(local).sub(this.pivot).applyQuaternion(this.q).add(this.pivot).add(this.off); }
  dir(local, out) { return out.copy(local).applyQuaternion(this.q); }
  // 世界 → 本地
  toLocal(world, out) { return out.copy(world).sub(this.off).sub(this.pivot).applyQuaternion(this.qInv).add(this.pivot); }

  // 取得世界座標的軌道資料
  frameAt(s, o) {
    this.track.frameAt(s, o);
    if (this.mech) {
      this.point(o.p, o.p);
      o.t.applyQuaternion(this.q); o.u.applyQuaternion(this.q);
      o.b.applyQuaternion(this.q); o.k.applyQuaternion(this.q);
    }
    return o;
  }

  // 端點（世界座標）與「往外」的方向
  endInfo(atEnd, pos, dir) {
    const tr = this.track;
    const i = atEnd ? tr.N - 1 : 0;
    this.point(tr.P[i], pos);
    this.dir(tr.T[i], dir);
    if (!atEnd) dir.negate();
  }
}

// ------------------------------------------------------------------ 關卡畫筆
// 像烏龜繪圖：yaw = 0 朝 -z，90 朝 +x；turn 正值右轉
export class Builder {
  constructor(x, y, z, yaw = 90) {
    this.pos = new THREE.Vector3(x, y, z);
    this.yaw = rad(yaw);
    this.segments = [];
    this.gems = [];
    this.checkpoints = [];
    this.sweepers = [];
    this.begin(true);
  }

  fwd() { return new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  right() { return new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw)); }

  begin(cap = false) {
    this.pts = [this.pos.clone()];
    this.banks = [0];
    this.len = 0;
    this.capNext = cap;
  }

  end(capEnd = false, mech = null) {
    if (this.pts.length < 2) return;
    this.segments.push(new Segment(this.pts, this.banks, { capStart: this.capNext, capEnd, mech }));
  }

  push(p, bank = 0) {
    const d = p.distanceTo(this.pos);
    if (d < 1e-4) return;
    this.len += d;
    this.pts.push(p.clone());
    this.banks.push(bank);
    this.pos.copy(p);
  }

  straight(len, dy = 0) {
    const n = Math.max(2, Math.ceil(len / 1.0));
    const s = this.pos.clone(), f = this.fwd();
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const p = s.clone().addScaledVector(f, len * t);
      p.y = s.y + dy * smooth(t);
      this.push(p);
    }
    return this;
  }

  // 彎道：deg > 0 右轉；彎道預設往內傾 25°，高速也不易被甩出
  turn(deg, radius, dy = 0, bank = 25) {
    const arc = Math.abs(rad(deg)) * radius;
    const n = Math.max(4, Math.ceil(arc / 0.6));
    const dYaw = rad(deg) / n, step = arc / n;
    const y0 = this.pos.y, sign = Math.sign(deg);
    for (let i = 1; i <= n; i++) {
      this.yaw += dYaw / 2;
      const p = this.pos.clone().addScaledVector(this.fwd(), step);
      this.yaw += dYaw / 2;
      const t = i / n;
      p.y = y0 + dy * smooth(t);
      this.push(p, rad(bank) * sign * Math.min(1, 3 * t, 3 * (1 - t)));
    }
    return this;
  }

  // 小間隙：鋼珠要有點速度才跨得過去
  gap(len, dy = -0.3) {
    this.end(false);
    this.pos.addScaledVector(this.fwd(), len);
    this.pos.y += dy;
    this.begin(false);
    return this;
  }

  // 旋轉轉盤：一段會一格一格轉動的直軌，對齊入口時滾上去，轉到出口方向再滾出去
  // exit：出口相對方向（90 右轉、-90 左轉）
  turntable(radius = 1.2, exit = 90, { hold = 1.8, rot = 1.0, phase = 0 } = {}) {
    const GAP = 0.12;
    this.end(false);
    const f = this.fwd();
    const pivot = this.pos.clone().addScaledVector(f, radius);
    const a = this.pos.clone().addScaledVector(f, GAP);
    const b = pivot.clone().addScaledVector(f, radius - GAP);
    const pts = [a, a.clone().lerp(b, 0.5), b];
    const seg = new Segment(pts, [0, 0, 0], {
      capStart: true, capEnd: true, pivot,
      mech: { type: 'turntable', step: 90, dir: exit > 0 ? -1 : 1, hold, rot, phase, radius },
    });
    this.segments.push(seg);
    this.yaw += rad(exit);
    this.pos.copy(pivot).addScaledVector(this.fwd(), radius);
    this.begin(false);
    return this;
  }

  // 移動橋：kind = 'slide' 左右滑動、'lift' 上下升降；對齊時才能通過
  bridge(len, kind = 'slide', amp = 1.4, { hold0 = 2.2, hold1 = 1.2, move = 1.1, phase = 0 } = {}) {
    const GAP = 0.12;
    this.end(false);
    const f = this.fwd();
    const a = this.pos.clone().addScaledVector(f, GAP);
    const b = this.pos.clone().addScaledVector(f, len - GAP);
    const axis = kind === 'lift' ? Y.clone() : this.right();
    const seg = new Segment([a, a.clone().lerp(b, 0.5), b], [0, 0, 0], {
      capStart: true, capEnd: true, pivot: a.clone().lerp(b, 0.5),
      mech: { type: 'bridge', kind, axis, amp, hold0, hold1, move, phase },
    });
    this.segments.push(seg);
    this.pos.addScaledVector(f, len);
    this.begin(false);
    return this;
  }

  // 旋轉掃桿：在目前位置旁邊立一根轉軸，桿子掃過軌道
  sweeper(side = 1, speed = 1.2, phase = 0) {
    const pivot = this.pos.clone().addScaledVector(this.right(), side * 1.0);
    this.sweepers.push({ pivot, y: this.pos.y + RIDE_H, len: 1.8, speed, phase, cross: this.pos.clone() });
    return this;
  }

  // 晶石：h 為離軌道高度，back 為往回算的距離
  gem(h = 0, back = 0) {
    const p = this.pointBack(back);
    this.gems.push(p.add(new THREE.Vector3(0, RIDE_H + h, 0)));
    return this;
  }

  checkpoint(back = 0) {
    this.checkpoints.push({ seg: this.segments.length, s: Math.max(0.3, this.len - back) });
    return this;
  }

  pointBack(back) {
    let remain = back;
    for (let i = this.pts.length - 1; i > 0; i--) {
      const d = this.pts[i].distanceTo(this.pts[i - 1]);
      if (remain <= d) return this.pts[i].clone().lerp(this.pts[i - 1], remain / d);
      remain -= d;
    }
    return this.pts[0].clone();
  }

  finish() {
    this.end(true);
    return { segments: this.segments, gems: this.gems, checkpoints: this.checkpoints, sweepers: this.sweepers };
  }
}
