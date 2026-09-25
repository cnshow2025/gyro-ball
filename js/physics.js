// 鋼珠在雙軌上的物理
// 貼軌時：沿軌道一維運動（s, v），加上左右偏移 d 的彈簧模型；
// 需要的支撐力為負（騰空）或左右偏移超過上限（被甩出）時，改成自由拋物運動；
// 自由飛行中若落回軌道上方就重新貼軌。
import * as THREE from '../vendor/three.module.js';
import { DS, RIDE_H, newFrame } from './track.js';

export const G = 16;              // 重力加速度
const ROLL_K = 5 / 7;             // 實心球滾動：加速度只有 5/7
const DRAG = 0.005;               // 空氣阻力係數
const ROLL_FRICTION = 0.12;       // 滾動摩擦
const MAX_SPEED = 28;
const MU = 0.85;                  // 軌道能提供的側向力比例（超過就被甩出）
const D_MAX = 0.2;                // 左右偏移上限
const LAT_W = 11, LAT_Z = 0.55;   // 左右偏移的彈簧參數

// 手機傾斜後的重力向量。heading：鏡頭水平朝向角；fwd：前傾角（正 = 往前下沉）；side：右傾角（正 = 右側下沉）
export function tiltGravity(out, heading, fwd, side) {
  const fx = Math.sin(heading), fz = -Math.cos(heading); // 前方
  const rx = Math.cos(heading), rz = Math.sin(heading);  // 右方
  const sf = Math.sin(fwd), ss = Math.sin(side);
  return out.set(fx * sf + rx * ss, -Math.cos(fwd) * Math.cos(side), fz * sf + rz * ss).multiplyScalar(G);
}

export class BallSim {
  constructor(track) {
    this.track = track;
    this.f = newFrame();
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.events = [];
    this.reset(0, 0);
  }

  reset(s, v) {
    this.onTrack = true;
    this.s = s; this.v = v; this.d = 0; this.vd = 0;
    this.airT = 0; this.noAttach = 0; this.danger = 0;
    this.nearI = this.track.index(s);
    this.updatePos();
  }

  updatePos() {
    const f = this.track.frameAt(this.s, this.f);
    this.pos.copy(f.p).addScaledVector(f.u, RIDE_H + this.d * this.d * 1.2).addScaledVector(f.b, this.d);
    this.vel.copy(f.t).multiplyScalar(this.v).addScaledVector(f.b, this.vd);
  }

  get speed() { return this.onTrack ? Math.abs(this.v) : this.vel.length(); }

  step(h, g) {
    if (this.onTrack) this.stepTrack(h, g);
    else this.stepAir(h, g);
  }

  stepTrack(h, g) {
    const tr = this.track;
    const f = tr.frameAt(this.s, this.f);

    // 沿軌道方向
    let a = ROLL_K * g.dot(f.t) - DRAG * this.v * Math.abs(this.v) - ROLL_FRICTION * Math.sign(this.v);
    if (Math.abs(this.v) < 0.05 && Math.abs(ROLL_K * g.dot(f.t)) < ROLL_FRICTION) { a = 0; this.v = 0; }
    this.v = THREE.MathUtils.clamp(this.v + a * h, -MAX_SPEED, MAX_SPEED);
    this.s += this.v * h;

    // 起點擋板
    if (this.s < 0.5) { this.s = 0.5; this.v = Math.abs(this.v) * 0.3; }
    // 終點擋板
    if (this.s > tr.length - 0.5) { this.s = tr.length - 0.5; this.v = -Math.abs(this.v) * 0.3; }

    // 維持在曲線上所需的力（每單位質量）= v²·κ − g
    const need = this.tmp.copy(f.k).multiplyScalar(this.v * this.v).sub(g);
    const fu = need.dot(f.u); // 需要導軌往上撐的力
    const fb = need.dot(f.b); // 需要導軌往側面推的力

    // 側向：鋼珠被推向外側，超過上限就飛出
    const target = (-D_MAX * fb) / (MU * Math.max(fu, 0.5));
    this.vd += (LAT_W * LAT_W * (target - this.d) - 2 * LAT_Z * LAT_W * this.vd) * h;
    this.d += this.vd * h;

    this.danger = Math.max(
      Math.min(Math.abs(this.d) / D_MAX, 1),
      fu < G * 0.35 ? THREE.MathUtils.clamp(1 - fu / (G * 0.35), 0, 1) : 0,
    );

    this.updatePos();
    const i = tr.index(this.s);
    this.nearI = i;

    if (fu < 0) return this.detach('air');
    if (Math.abs(this.d) > D_MAX) return this.detach('side');
    if (f.gap) return this.detach('gap');
  }

  detach(reason) {
    // pos / vel 已由 updatePos 設好
    this.onTrack = false;
    this.airT = 0;
    this.noAttach = reason === 'gap' ? 0.05 : 0.15;
    this.events.push({ type: 'detach', reason });
  }

  stepAir(h, g) {
    this.vel.addScaledVector(g, h);
    const sp = this.vel.length();
    if (sp > MAX_SPEED) this.vel.multiplyScalar(MAX_SPEED / sp);
    this.pos.addScaledVector(this.vel, h);
    this.airT += h;
    this.noAttach -= h;
    this.danger = 1;

    const tr = this.track;
    const i = tr.nearest(this.pos, this.nearI, 200);
    this.nearI = i;
    if (this.noAttach > 0 || tr.gap[i]) return;

    const rel = this.tmp.copy(this.pos).sub(tr.P[i]);
    const U = tr.U[i], B = tr.B[i], T = tr.T[i];
    const u = rel.dot(U), b = rel.dot(B), t = rel.dot(T);
    const vu = this.vel.dot(U);
    if (Math.abs(b) < D_MAX + 0.12 && u < RIDE_H + 0.05 && u > RIDE_H - 0.5 && vu < 1) {
      this.onTrack = true;
      this.s = THREE.MathUtils.clamp(i * DS + t, 0.5, tr.length - 0.5);
      this.v = this.vel.dot(T);
      // 落地時導軌會把鋼珠導回中間
      this.d = THREE.MathUtils.clamp(b, -D_MAX * 0.4, D_MAX * 0.4);
      this.vd = 0;
      this.events.push({ type: 'land', strength: Math.min(Math.max(-vu, 0) / 10, 1) });
      this.updatePos();
    }
  }
}
