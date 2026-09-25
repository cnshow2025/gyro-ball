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
    if (this.onTrack) this.stepTrack(h, g);
    else this.stepAir(h, g);
    this.checkSweepers(time);
  }

  stepTrack(h, g) {
    const seg = this.cur;
    const f = seg.frameAt(this.s, this.f);

    let a = ROLL_K * g.dot(f.t) - DRAG * this.v * Math.abs(this.v) - ROLL_FRICTION * Math.sign(this.v);
    if (Math.abs(this.v) < 0.05 && Math.abs(ROLL_K * g.dot(f.t)) < ROLL_FRICTION) { a = 0; this.v = 0; }
    this.v = THREE.MathUtils.clamp(this.v + a * h, -MAX_SPEED, MAX_SPEED);
    this.s += this.v * h;

    // 側向偏移
    const need = tmpA.copy(f.k).multiplyScalar(this.v * this.v).sub(g);
    const fu = need.dot(f.u), fb = need.dot(f.b);
    const target = (-D_MAX * fb) / (this.grip * Math.max(fu, 0.5));
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
    if (fu < 0) return this.detach('air');
    if (Math.abs(this.d) > D_MAX) return this.detach('side');
  }

  // 找與目前端點對齊的其他段，接過去
  transfer(atEnd, over) {
    const seg = this.cur;
    const pos = tmpA, dir = tmpB, p2 = tmpC, d2 = tmpD;
    seg.endInfo(atEnd, pos, dir);
    for (let i = 0; i < this.segs.length; i++) {
      if (i === this.seg) continue;
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

  // 掃桿碰撞：被打到就撞飛
  checkSweepers(time) {
    if (this.knockT > time - 0.5) return;
    for (const sw of this.level.sweepers) {
      const ang = sw.phase + sw.speed * time;
      const dx = Math.cos(ang), dz = -Math.sin(ang); // 與 three.js rotation.y 相同方向
      const rx = this.pos.x - sw.pivot.x, rz = this.pos.z - sw.pivot.z;
      const along = THREE.MathUtils.clamp(rx * dx + rz * dz, 0, sw.len);
      const px = rx - dx * along, pz = rz - dz * along, py = this.pos.y - sw.y;
      if (px * px + pz * pz + py * py < (BALL_R + 0.12) ** 2) {
        // 桿子在接觸點的速度 = ω × r
        const tx = sw.speed * along * dz, tz = -sw.speed * along * dx;
        if (this.onTrack) { this.updatePos(); this.detach('knock'); }
        this.vel.x += tx * 1.4;
        this.vel.z += tz * 1.4;
        this.vel.y += 2.5;
        this.noAttach = 0.4;
        this.knockT = time;
        this.events.push({ type: 'knock' });
        return;
      }
    }
  }
}
