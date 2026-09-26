// 鋼珠在多段雙軌上的物理（板面座標）
// 貼軌：沿軌道一維運動（s, v），左右偏移 d 為彈簧模型；
// 走到段的盡頭：若與下一段對齊就接過去，端點有擋板就反彈，否則飛出去（自由拋物）；
// 自由飛行中落回任何軌道上方就重新貼軌；被掃桿打到會被撞飛。
import * as THREE from '../vendor/three.module.js';
import { RIDE_H, BALL_R, GRAVITY, newFrame } from './track.js';

export const G = GRAVITY;         // 重力加速度（比真實小，珠子滾得慢、好控制）
const ROLL_K = 5 / 7;             // 實心球滾動：加速度只有 5/7
const DRAG = 0.012;
const ROLL_FRICTION = 0.1;
export const MAX_SPEED = 9;
const BOOST_CAP = 12.5;           // 加速帶可以衝到的最高速度
const OVERSPEED_DRAG = 3;         // 超過平常最高速度時額外減速
const DEFAULT_GRIP = 2.0;         // 軌道能提供的側向力比例（各關可設定，越小越容易被甩出）
const D_MAX = 0.2;
const LAT_W = 11, LAT_Z = 0.55;
const JOIN_DIST = 0.3;            // 兩段端點距離在此範圍內視為對齊
const JOIN_DOT = 0.96;            // 方向夾角約 16° 以內
const CRASH_V = 6.5;              // 從太高掉下來（撞擊速度超過）不會再貼軌

// 手機傾斜 → 板面座標中的重力（整個板面像迷宮板一樣傾斜）
// tx：繞 x 軸（前後）；tz：繞 z 軸（左右）
const _q = new THREE.Quaternion(), _e = new THREE.Euler();
export function tiltGravity(out, tx, tz) {
  _q.setFromEuler(_e.set(tx, 0, tz)).invert();
  return out.set(0, -G, 0).applyQuaternion(_q);
}

const tmpW = new THREE.Vector3(), tmpH = new THREE.Vector3(), tmpV = new THREE.Vector3();
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3(), tmpD = new THREE.Vector3();

export class BallSim {
  constructor(level) {
    this.level = level;
    this.segs = level.segments;
    this.grip = level.grip ?? DEFAULT_GRIP;
    this.f = newFrame();
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.events = [];
    this.reset(0, 0.6);
  }

  reset(seg, s) {
    this.onTrack = true;
    this.seg = seg; this.s = s; this.v = 0; this.d = 0; this.vd = 0;
    this.airT = 0; this.noAttach = 0; this.danger = 0; this.knockT = -99;
    this.updatePos();
  }

  get cur() { return this.segs[this.seg]; }
  get speed() { return this.onTrack ? Math.abs(this.v) : this.vel.length(); }

  updatePos() {
    const f = this.cur.frameAt(this.s, this.f);
    this.pos.copy(f.p).addScaledVector(f.u, RIDE_H + this.d * this.d * 1.2).addScaledVector(f.b, this.d);
    this.vel.copy(f.t).multiplyScalar(this.v).addScaledVector(f.b, this.vd);
  }

  step(h, g, time) {
    if (this.onTrack) {
      // 側風：在風區內，重力再加上側向的風力（會一陣一陣變強變弱）
      const w = this.windAt(time);
      if (w) g = tmpW.copy(g).add(w);
      this.stepTrack(h, g);
    }
    else this.stepAir(h, g);
    this.checkHazards(time);
  }

  stepTrack(h, g) {
    const seg = this.cur;
    const f = seg.frameAt(this.s, this.f);

    // 崩塌木板消失了：直接掉下去
    if (!seg.solid) { this.updatePos(); return this.detach('vanish'); }

    // 冰面：傾斜的效果打折（很難減速）、幾乎沒有摩擦、側向抓地力變低
    const ice = this.iceAt();
    let gT = g.dot(f.t);
    if (ice) gT = -GRAVITY * f.t.y + (gT + GRAVITY * f.t.y) * 0.35;
    let a = ROLL_K * gT - DRAG * this.v * Math.abs(this.v) - (ice ? 0.01 : ROLL_FRICTION) * Math.sign(this.v);
    const boost = this.boosterAt();
    if (boost && this.v < boost.speed) a += 22;
    else if (Math.abs(this.v) > MAX_SPEED) a -= OVERSPEED_DRAG * Math.sign(this.v);
    if (!ice && Math.abs(this.v) < 0.05 && Math.abs(ROLL_K * gT) < ROLL_FRICTION) { a = 0; this.v = 0; }
    this.v = THREE.MathUtils.clamp(this.v + a * h, -BOOST_CAP, BOOST_CAP);
    this.s += this.v * h;

    // 側向偏移
    const need = tmpA.copy(f.k).multiplyScalar(this.v * this.v).sub(g);
    const fu = need.dot(f.u), fb = need.dot(f.b);
    const grip = ice ? this.grip * 0.55 : this.grip;
    const target = (-D_MAX * fb) / (grip * Math.max(fu, 0.5));
    this.vd += (LAT_W * LAT_W * (target - this.d) - 2 * LAT_Z * LAT_W * this.vd) * h;
    this.d += this.vd * h;
    this.danger = Math.min(Math.abs(this.d) / D_MAX, 1);

    // 走到段的盡頭
    const L = seg.length;
    if (this.s < 0 || this.s > L) {
      const atEnd = this.s > L;
      const over = atEnd ? this.s - L : -this.s;
      if (this.transfer(atEnd, over)) return;
      if (atEnd ? seg.capEnd : seg.capStart) {
        this.s = atEnd ? L : 0;
        if (Math.abs(this.v) > 1) this.events.push({ type: 'bump', strength: Math.min(Math.abs(this.v) / MAX_SPEED, 1) });
        this.v = -this.v * 0.3;
      } else {
        this.s = atEnd ? L : 0;
        this.updatePos();
        return this.detach('end');
      }
    }

    this.updatePos();
    // 彈簧跳台：往上彈飛
    const sp = this.springAt();
    if (sp) {
      const th = tmpA.set(f.t.x, 0, f.t.z).normalize();
      this.vel.copy(th).multiplyScalar(Math.max(this.v, 0) * 0.85).add(tmpB.set(0, sp.vy, 0));
      this.onTrack = false;
      this.airT = 0;
      this.noAttach = 0.3;
      this.events.push({ type: 'spring' });
      return;
    }
    if (fu < 0) return this.detach('air');
    if (Math.abs(this.d) > D_MAX) return this.detach('side');
  }

  // 找與目前端點對齊的其他段，接過去
  transfer(atEnd, over) {
    const seg = this.cur;
    const pos = tmpA, dir = tmpB, p2 = tmpC, d2 = tmpD;
    seg.endInfo(atEnd, pos, dir);
    for (let i = 0; i < this.segs.length; i++) {
      if (i === this.seg || !this.segs[i].solid) continue;
      const o = this.segs[i];
      for (const oEnd of [false, true]) {
        o.endInfo(oEnd, p2, d2);
        // 對方端點的「往外」方向要和我們前進方向相反
        if (p2.distanceTo(pos) < JOIN_DIST && -d2.dot(dir) > JOIN_DOT) {
          const speed = Math.abs(this.v);
          this.seg = i;
          this.s = oEnd ? o.length - over : over;
          this.v = oEnd ? -speed : speed;
          this.events.push({ type: 'join' });
          this.updatePos();
          return true;
        }
      }
    }
    return false;
  }

  detach(reason) {
    this.onTrack = false;
    this.airT = 0;
    this.noAttach = 0.12;
    this.events.push({ type: 'detach', reason });
  }

  stepAir(h, g) {
    this.vel.addScaledVector(g, h);
    this.pos.addScaledVector(this.vel, h);
    this.airT += h;
    this.noAttach -= h;
    this.danger = 1;
    if (this.noAttach > 0) return;

    // 找可以落上去的軌道
    const local = tmpA, vloc = tmpB;
    for (let si = 0; si < this.segs.length; si++) {
      const seg = this.segs[si];
      if (!seg.solid) continue;
      const tr = seg.track;
      seg.toLocal(this.pos, local);
      let best = -1, bd = 1.0;
      for (let i = 0; i < tr.N; i++) {
        const d = tr.P[i].distanceToSquared(local);
        if (d < bd) { bd = d; best = i; }
      }
      if (best < 0) continue;
      vloc.copy(this.vel).applyQuaternion(seg.qInv);
      const rel = tmpC.copy(local).sub(tr.P[best]);
      const U = tr.U[best], B = tr.B[best], T = tr.T[best];
      const u = rel.dot(U), b = rel.dot(B), t = rel.dot(T);
      const vu = vloc.dot(U);
      // 超出段的兩端就不算落在軌道上
      if ((best === tr.N - 1 && t > 0.02) || (best === 0 && t < -0.02)) continue;
      if (Math.abs(b) < D_MAX + 0.12 && u < RIDE_H + 0.05 && u > RIDE_H - 0.6 && vu < 1 && vu > -CRASH_V) {
        this.onTrack = true;
        this.seg = si;
        this.s = THREE.MathUtils.clamp(best * tr.ds + t, 0, tr.length);
        this.v = THREE.MathUtils.clamp(vloc.dot(T), -MAX_SPEED, MAX_SPEED);
        this.d = THREE.MathUtils.clamp(b, -D_MAX * 0.4, D_MAX * 0.4);
        this.vd = 0;
        this.events.push({ type: 'land', strength: Math.min(Math.max(-vu, 0) / CRASH_V, 1) });
        this.updatePos();
        return;
      }
    }
  }

  iceAt() {
    for (const z of this.level.ices || []) if (z.seg === this.seg && this.s >= z.s0 && this.s <= z.s1) return z;
    return null;
  }

  springAt() {
    for (const sp of this.level.springs || []) if (sp.seg === this.seg && this.s >= sp.s && this.v > 0.2) return sp;
    return null;
  }

  boosterAt() {
    for (const b of this.level.boosters || []) if (b.seg === this.seg && this.s >= b.s0 && this.s <= b.s1) return b;
    return null;
  }

  windAt(time) {
    for (const w of this.level.winds || []) {
      if (w.seg === this.seg && this.s >= w.s0 && this.s <= w.s1) {
        return tmpV.copy(w.dir).multiplyScalar(w.strength * windGust(time));
      }
    }
    return null;
  }

  // 障礙物碰撞（掃桿、擺錘）：被打到就撞飛
  checkHazards(time) {
    if (this.knockT > time - 0.5) return;
    const hit = hazardHit(this.level, this.pos, time, tmpH);
    if (!hit) return;
    if (this.onTrack) { this.updatePos(); this.detach('knock'); }
    this.vel.add(tmpH);
    this.noAttach = 0.4;
    this.knockT = time;
    this.events.push({ type: 'knock' });
  }
}

// 側風強度的陣風變化（0.55 ~ 1）
export function windGust(t) { return 0.775 + 0.225 * Math.sin(t * 2.3); }

// 擺錘在時間 t 的角度與錘頭位置
export function pendulumAngle(p, t) { return p.amp * Math.sin((2 * Math.PI * (t + p.phase)) / p.period); }
export function pendulumHead(p, t, out) {
  const th = pendulumAngle(p, t);
  return out.copy(p.pivot).addScaledVector(p.side, Math.sin(th) * p.len).add(new THREE.Vector3(0, -Math.cos(th) * p.len, 0));
}

// 檢查 pos 是否被障礙打到；打到時把撞擊速度寫入 out 並回傳 true
export function hazardHit(level, pos, time, out) {
  for (const sw of level.sweepers || []) {
    const ang = sw.phase + sw.speed * time;
    const dx = Math.cos(ang), dz = -Math.sin(ang); // 與 three.js rotation.y 相同方向
    const rx = pos.x - sw.pivot.x, rz = pos.z - sw.pivot.z;
    const along = THREE.MathUtils.clamp(rx * dx + rz * dz, 0, sw.len);
    const px = rx - dx * along, pz = rz - dz * along, py = pos.y - sw.y;
    if (px * px + pz * pz + py * py < (BALL_R + 0.12) ** 2) {
      // 桿子在接觸點的速度 = ω × r
      out.set(sw.speed * along * dz * 1.4, 2.5, -sw.speed * along * dx * 1.4);
      return true;
    }
  }
  for (const pd of level.pendulums || []) {
    const head = pendulumHead(pd, time, _head);
    if (head.distanceTo(pos) < BALL_R + pd.headR) {
      const th = pendulumAngle(pd, time);
      const w = (pd.amp * 2 * Math.PI / pd.period) * Math.cos((2 * Math.PI * (time + pd.phase)) / pd.period);
      // 錘頭速度 = 角速度 × 擺長，方向沿擺動切線
      out.copy(pd.side).multiplyScalar(Math.cos(th) * pd.len * w * 1.3).add(new THREE.Vector3(0, Math.sin(th) * pd.len * w * 1.3 + 2.5, 0));
      if (out.length() < 4) out.addScaledVector(pd.side, Math.sign(pos.clone().sub(pd.pivot).dot(pd.side)) * 4);
      return true;
    }
  }
  return false;
}
const _head = new THREE.Vector3();
