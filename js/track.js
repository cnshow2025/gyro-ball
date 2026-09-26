// 全景雙軌迷宮：軌道段、機關、關卡畫筆
import * as THREE from '../vendor/three.module.js';

export const DS = 0.1;         // 取樣間距
export const GRAVITY = 12;     // 重力加速度（物理也使用這個值）
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
  // ups：每個點可指定「軌道上方」方向（迴圈、翻滾用；null 表示以重力方向為準）
  // dvs：每個點的「設計速度」（翻滾用）：軌道會依這個速度自動翻轉到剛好不側滑的角度
  constructor(points, banks, ups = [], dvs = []) {
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
    const locate = (sp) => {
      let j = 1;
      while (j < cum.length - 1 && cum[j] < sp) j++;
      return [j, THREE.MathUtils.clamp((sp - cum[j - 1]) / (cum[j] - cum[j - 1] || 1), 0, 1)];
    };
    const bankAt = (sp) => {
      const [j, t] = locate(sp);
      return banks[j - 1] + (banks[j] - banks[j - 1]) * t;
    };
    const dvAt = (sp) => {
      const [j, t] = locate(sp);
      return (t < 0.5 ? dvs[j - 1] : dvs[j]) ?? null;
    };
    const upAt = (sp) => {
      const [j, t] = locate(sp);
      const a = ups[j - 1], b = ups[j];
      if (!a && !b) return null;
      return (a || Y).clone().lerp(b || Y, t);
    };

    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      this.P.push(curve.getPointAt(u));
      const T = curve.getTangentAt(u).normalize();
      this.T.push(T);
      const want = upAt(u * total) || Y;
      let up = want.clone().addScaledVector(T, -want.dot(T));
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

    // 設計速度：法線 = v²·κ + g 的方向（在這個速度下完全不需要側向力）
    for (let i = 0; i < N; i++) {
      const dv = dvAt((i / (N - 1)) * total);
      if (dv == null) continue;
      const T = this.T[i];
      const need = this.K[i].clone().multiplyScalar(dv * dv).add(new THREE.Vector3(0, GRAVITY, 0));
      need.addScaledVector(T, -need.dot(T));
      if (need.lengthSq() < 1e-6) continue;
      this.U[i].copy(need.normalize());
      this.B[i].crossVectors(T, this.U[i]).normalize();
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
    this.track = new Track(points, banks, opts.ups || [], opts.dvs || []);
    this.capStart = !!opts.capStart;
    this.capEnd = !!opts.capEnd;
    this.mech = opts.mech || null;
    this.pivot = opts.pivot ? opts.pivot.clone() : new THREE.Vector3();
    this.yaw = 0;
    this.off = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.qInv = new THREE.Quaternion();
    this.solid = true;  // 崩塌木板消失時為 false
    this.warn = false;  // 崩塌前的閃爍警告
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
    } else if (m.type === 'switch') {
      // 道岔：停在正路 → 轉到岔路 → 停在岔路 → 轉回正路
      const hold1 = m.hold * 0.7, cyc = m.hold + m.move + hold1 + m.move;
      let u = (((t + m.phase) % cyc) + cyc) % cyc, f;
      if (u < m.hold) f = 0;
      else if ((u -= m.hold) < m.move) f = smooth(u / m.move);
      else if ((u -= m.move) < hold1) f = 1;
      else f = 1 - smooth((u - hold1) / m.move);
      this.yaw = m.ang * f;
    } else if (m.type === 'vanish') {
      const u = (((t + m.phase) % (m.on + m.off)) + (m.on + m.off)) % (m.on + m.off);
      this.solid = u < m.on;
      this.warn = this.solid && u > m.on - 0.9;
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
  // opts.bank：彎道預設內傾角（度）；opts.grip：軌道側向抓地力（越小越容易被甩出）
  constructor(x, y, z, yaw = 90, opts = {}) {
    this.pos = new THREE.Vector3(x, y, z);
    this.yaw = rad(yaw);
    this.bankDef = opts.bank ?? 25;
    this.grip = opts.grip ?? 2.0;
    this.segments = [];
    this.gems = [];
    this.checkpoints = [];
    this.sweepers = [];
    this.pendulums = [];
    this.boosters = [];
    this.winds = [];
    this.ices = [];
    this.springs = [];
    this.spurs = [];
    this.begin(true);
  }

  fwd() { return new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  right() { return new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw)); }

  begin(cap = false) {
    this.pts = [this.pos.clone()];
    this.banks = [0];
    this.ups = [null];
    this.dvs = [null];
    this.len = 0;
    this.capNext = cap;
  }

  end(capEnd = false, mech = null) {
    if (this.pts.length < 2) return;
    this.segments.push(new Segment(this.pts, this.banks, { capStart: this.capNext, capEnd, mech, ups: this.ups, dvs: this.dvs }));
  }

  push(p, bank = 0, up = null, dv = null) {
    const d = p.distanceTo(this.pos);
    if (d < 1e-4) return;
    this.len += d;
    this.pts.push(p.clone());
    this.banks.push(bank);
    this.ups.push(up);
    this.dvs.push(dv);
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

  // 山丘（h > 0）；凹谷請用 dip。起點與終點高度相同、坡度平滑
  hill(len, h) {
    const n = Math.max(6, Math.ceil(len / 0.5));
    const s = this.pos.clone(), f = this.fwd();
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const p = s.clone().addScaledVector(f, len * t);
      p.y = s.y + (h * (1 - Math.cos(2 * Math.PI * t))) / 2;
      this.push(p);
    }
    return this;
  }

  // 垂直大迴圈：珠子倒掛通過；shift 為側移，讓出口與入口錯開
  loop(radius = 1.2, shift = 1.3) {
    const start = this.pos.clone(), f = this.fwd(), r = this.right();
    const n = 40;
    for (let i = 1; i <= n; i++) {
      const t = i / n, th = t * Math.PI * 2;
      const side = shift * smooth(t);
      const p = start.clone().addScaledVector(f, radius * Math.sin(th)).addScaledVector(Y, radius * (1 - Math.cos(th))).addScaledVector(r, side);
      const c = start.clone().addScaledVector(Y, radius).addScaledVector(r, side);
      this.push(p, 0, c.sub(p).normalize());
    }
    return this;
  }

  // 螺旋翻滾：軌道繞著前進方向翻轉 360°（dir = 1 往右翻、-1 往左翻）
  // 翻轉角度依設計速度 speed 自動計算；速度差太多會被甩出，太慢則在頂端掉下來
  corkscrew(len = 6, radius = 1.0, dir = 1, speed = 8) {
    const start = this.pos.clone(), f = this.fwd(), r = this.right();
    const n = 40;
    for (let i = 1; i <= n; i++) {
      // 角度用緩入緩出，讓入口和出口的方向與直線相接，不會突然轉折
      const t = i / n, th = 2 * Math.PI * t - Math.sin(2 * Math.PI * t);
      const p = start.clone().addScaledVector(f, len * t).addScaledVector(r, dir * radius * Math.sin(th)).addScaledVector(Y, radius * (1 - Math.cos(th)));
      const c = start.clone().addScaledVector(f, len * t).addScaledVector(Y, radius);
      this.push(p, 0, c.sub(p).normalize(), speed);
    }
    return this;
  }

  // 凹谷：先下後上，可以借衝力
  dip(len, depth) { return this.hill(len, -depth); }

  // 彎道：deg > 0 右轉；彎道預設往內傾 25°，高速也不易被甩出
  turn(deg, radius, dy = 0, bank = this.bankDef) {
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

  // 擺錘：軌道正上方左右擺盪的大鎚子（擺動平面與軌道垂直）
  pendulum(period = 3.2, amp = 65, phase = 0, len = 2.2) {
    this.pendulums.push({
      pivot: this.pos.clone().add(new THREE.Vector3(0, RIDE_H + len, 0)),
      side: this.right(), fwd: this.fwd(), len, headR: 0.36,
      amp: rad(amp), period, phase, cross: this.pos.clone(),
    });
    return this;
  }

  // 崩塌木板：一段會週期性消失的軌道（消失前閃爍警告）
  vanish(len = 3, { on = 2.6, off = 1.6, phase = 0 } = {}) {
    const GAP = 0.05;
    this.end(false);
    const f = this.fwd();
    const a = this.pos.clone().addScaledVector(f, GAP);
    const b = this.pos.clone().addScaledVector(f, len - GAP);
    this.segments.push(new Segment([a, a.clone().lerp(b, 0.5), b], [0, 0, 0], {
      capStart: false, capEnd: false,
      mech: { type: 'vanish', on, off, phase },
    }));
    this.pos.addScaledVector(f, len);
    this.begin(false);
    return this;
  }

  // 加速帶：經過時被推到 speed（可超過平常的最高速度）
  booster(len = 3, speed = 11.5) {
    this.boosters.push({ seg: this.segments.length, s0: this.len, s1: this.len + len, speed });
    return this.straight(len);
  }

  // 側風區：windOn 到 windOff 之間的軌道會被側風吹（side = 1 吹向右、-1 吹向左，方向在開始時固定）
  windOn(side = 1, strength = 7) {
    this.windOpen = { seg: this.segments.length, s0: this.len, dir: this.right().multiplyScalar(side), strength };
    return this;
  }

  // 冰面：iceOn 到 iceOff 之間的軌道結冰（抓地力低、傾斜很難減速）
  iceOn() { this.iceOpen = { seg: this.segments.length, s0: this.len }; return this; }
  iceOff() {
    const z = this.iceOpen;
    if (z && z.seg === this.segments.length) { z.s1 = this.len; this.ices.push(z); }
    this.iceOpen = null;
    return this;
  }

  // 彈簧跳台：衝上彈簧板會被往上彈，飛到前方 dist、高 rise 處的軌道
  // 水平速度取決於衝上來的速度：太慢會飛不到而掉下去
  spring(rise = 2, dist = 3, vy = 8) {
    this.straight(1.2);
    this.springs.push({ seg: this.segments.length, s: this.len - 0.45, vy, pos: this.pos.clone(), fwd: this.fwd() });
    this.end(false);
    this.pos.addScaledVector(this.fwd(), dist);
    this.pos.y += rise;
    this.begin(false);
    return this;
  }

  // 分岔：一段會左右切換的道岔。直走接正路；切到另一邊時接一條岔路（盡頭有晶石的死路，要自己滾回來）
  fork(side = 1, { hold = 2.2, move = 0.6, phase = 0, turn = 35, len = 4 } = {}) {
    const L = 2.0, ANG = rad(13);
    this.end(false);
    const f = this.fwd();
    const a = this.pos.clone().addScaledVector(f, 0.05);
    const b = this.pos.clone().addScaledVector(f, L);
    const yawSpur = -side * ANG; // three.js 的 yaw 負值是往右
    this.segments.push(new Segment([a, a.clone().lerp(b, 0.5), b], [0, 0, 0], {
      capStart: false, capEnd: true, pivot: a.clone(),
      mech: { type: 'switch', ang: yawSpur, hold, move, phase },
    }));
    // 岔路
    const spurDir = f.clone().applyAxisAngle(Y, yawSpur);
    const s0 = a.clone().addScaledVector(spurDir, L - 0.05 + 0.05);
    const sub = new Builder(s0.x, s0.y, s0.z, ((this.yaw + side * ANG) * 180) / Math.PI, { bank: this.bankDef, grip: this.grip });
    sub.capNext = false;
    sub.straight(1.5).turn(side * turn, 4).straight(len).gem(0, 0.6);
    sub.end(true);
    for (const sg of sub.segments) { sg.spur = true; this.spurs.push(sg); }
    this.gems.push(...sub.gems);
    // 正路繼續
    this.pos.copy(b).addScaledVector(f, 0.05);
    this.begin(false);
    return this;
  }

  windOff() {
    const w = this.windOpen;
    if (w && w.seg === this.segments.length) { w.s1 = this.len; this.winds.push(w); }
    this.windOpen = null;
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
    // 終點在最後一段正路；岔路接在所有正路後面
    const goalSeg = this.segments.length - 1;
    return {
      segments: [...this.segments, ...this.spurs], goalSeg, gems: this.gems, checkpoints: this.checkpoints, grip: this.grip,
      sweepers: this.sweepers, pendulums: this.pendulums, boosters: this.boosters, winds: this.winds,
      ices: this.ices, springs: this.springs,
    };
  }
}
