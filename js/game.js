// 3D 畫面：固定全景鏡頭、隨手機傾斜的迷宮板、多段雙軌與機關；物理在 physics.js
import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { BALL_R, RAIL_R, RAIL_GAP, RIDE_H, newFrame } from './track.js';
import { BallSim, tiltGravity } from './physics.js';

const STEP = 1 / 120;
const VISUAL_TILT = 0.5; // 畫面上板子傾斜的比例（實際重力用完整傾角）
const CAM_PITCH = THREE.MathUtils.degToRad(52);

export class Game {
  constructor(canvas, input, events) {
    this.input = input;
    this.ev = events;
    this.state = 'idle';
    this.levelIndex = 0;
    this.time = 0;
    this.clock = 0; // 機關時間
    this.gemCount = 0;
    this.falls = 0;
    this.acc = 0;
    this.g = new THREE.Vector3();

    this.initRenderer(canvas);
    this.initScene();
    addEventListener('resize', () => this.resize());
  }

  // ------------------------------------------------------------------ 初始化
  initRenderer(canvas) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.1;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
  }

  initScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070f);
    this.scene = scene;

    // 環境反射：室內光 + 霓虹燈條，讓鋼珠和導軌有科幻金屬反光
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = new RoomEnvironment();
    const neon = (color, pos, size) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial({ color }));
      m.material.color.multiplyScalar(6);
      m.position.set(...pos);
      env.add(m);
    };
    neon(0x33ddff, [-8, 6, 0], [0.3, 0.3, 14]);
    neon(0xff33cc, [8, 5, 0], [0.3, 0.3, 14]);
    neon(0x33ddff, [0, 12, -8], [14, 0.3, 0.3]);
    scene.environment = pmrem.fromScene(env, 0.02).texture;
    env.dispose?.();

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 600);

    scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x2a1030, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    scene.add(sun, sun.target);
    this.sun = sun;

    // 迷宮板（會傾斜）：board 在板面中心，content 再平移回來
    this.board = new THREE.Group();
    this.content = new THREE.Group();
    this.board.add(this.content);
    scene.add(this.board);

    this.makeBackdrop();
    this.makeMaterials();
    this.makeBall();
  }

  makeBackdrop() {
    const n = 1500;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(250 + Math.random() * 100);
      pos.set([v.x, v.y, v.z], i * 3);
      c.setHSL(0.55 + Math.random() * 0.35, 0.6, 0.6 + Math.random() * 0.4);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false })));

    this.glowTex = radialTexture();
    [[0x3355ff, -140, 30, -260, 220], [0xaa33ff, 150, 20, -240, 200], [0x00aacc, 20, -120, -200, 260]].forEach(([color, x, y, z, s]) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.position.set(x, y, z);
      sp.scale.set(s, s, 1);
      this.scene.add(sp);
    });
  }

  makeMaterials() {
    const wood = woodTexture();
    const stone = stoneTexture();
    const floorTex = floorTexture();
    this.mats = {
      rail: new THREE.MeshStandardMaterial({ color: 0xd8e2ee, metalness: 1, roughness: 0.18, emissive: 0x0a3a48, envMapIntensity: 1.3 }),
      spine: new THREE.MeshStandardMaterial({ color: 0x1a2533, metalness: 0.8, roughness: 0.35, emissive: 0x1fa8d0, emissiveIntensity: 0.8 }),
      spineMech: new THREE.MeshStandardMaterial({ color: 0x332211, metalness: 0.8, roughness: 0.35, emissive: 0xff8a1f, emissiveIntensity: 1.0 }),
      wood: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.7, metalness: 0.05 }),
      stone: new THREE.MeshStandardMaterial({ map: stone, roughness: 0.85, metalness: 0.1 }),
      warn: new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0xff7a00, emissiveIntensity: 1.1, roughness: 0.5 }),
      cap: new THREE.MeshStandardMaterial({ color: 0x4fe3ff, emissive: 0x4fe3ff, emissiveIntensity: 1.2 }),
      pillar: new THREE.MeshStandardMaterial({ map: stone, color: 0x8894a8, roughness: 0.8, metalness: 0.2 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x5a6574, metalness: 0.9, roughness: 0.3 }),
      disc: new THREE.MeshStandardMaterial({ color: 0x2a3140, metalness: 0.8, roughness: 0.3, emissive: 0xff7a00, emissiveIntensity: 0.25 }),
      sweeper: new THREE.MeshStandardMaterial({ color: 0xff2a50, metalness: 0.5, roughness: 0.3, emissive: 0xcc0030, emissiveIntensity: 0.9 }),
      travel: new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.08, depthWrite: false }),
      floor: new THREE.MeshStandardMaterial({ map: floorTex, color: 0x9aa6bb, roughness: 0.6, metalness: 0.4 }),
      floorEdge: new THREE.LineBasicMaterial({ color: 0x4fe3ff }),
      gem: new THREE.MeshStandardMaterial({ color: 0xffd35a, emissive: 0xff8800, emissiveIntensity: 0.7, metalness: 0.6, roughness: 0.15 }),
    };
  }

  makeBall() {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = '#e6e9ee'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#6b7280';
    g.fillRect(0, 62, 256, 4);
    g.fillRect(126, 0, 4, 128);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 40, 28), new THREE.MeshStandardMaterial({ map: tex, metalness: 1, roughness: 0.12, envMapIntensity: 1.6 }));
    this.ballMesh.castShadow = true;
    // 光暈讓小小的珠子在全景畫面中也很顯眼
    this.ballGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x7fefff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.ballGlow.scale.set(2.2, 2.2, 1);
  }

  // ------------------------------------------------------------------ 關卡
  loadLevel(levelDef, index) {
    this.clearLevel();
    this.levelDef = levelDef;
    this.levelIndex = index;
    const level = levelDef.build();
    this.level = level;
    this.segs = level.segments;
    this.clock = 0;
    for (const s of this.segs) s.update(0);
    this.sim = new BallSim(level);

    // 範圍
    const box = new THREE.Box3();
    for (const s of this.segs) for (const p of s.track.P) box.expandByPoint(p);
    for (const sw of level.sweepers) box.expandByPoint(sw.pivot);
    this.floorY = box.min.y - 1.6;
    box.min.y = this.floorY;
    box.expandByVector(new THREE.Vector3(1.8, 0, 1.8));
    this.bounds = box;
    const center = box.getCenter(new THREE.Vector3());
    center.y = this.floorY;
    this.board.position.copy(center);
    this.content.position.copy(center).negate();

    this.buildFloor(box);
    this.segs.forEach((s, i) => this.buildSegment(s, i, levelDef.sleeper || 'wood'));
    this.buildSweepers(level.sweepers);

    // 晶石
    this.gems = level.gems.map((p) => {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.26), this.mats.gem);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffb030, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.set(1.3, 1.3, 1);
      m.add(glow);
      m.position.copy(p);
      this.content.add(m);
      return { pos: p.clone(), mesh: m, taken: false, fade: 0 };
    });

    // 檢查點光環
    this.checkpoints = level.checkpoints.map((cp) => ({ ...cp, mesh: this.gate(cp.seg, cp.s, 0.7, 0.04, new THREE.MeshBasicMaterial({ color: 0x4fe3ff })), active: false }));

    this.makeGoal();
    this.content.add(this.ballMesh, this.ballGlow);
    this.fitCamera();
    this.resetRun();
  }

  buildFloor(box) {
    const size = box.getSize(new THREE.Vector3());
    const geo = new THREE.BoxGeometry(size.x, 0.4, size.z);
    const floor = new THREE.Mesh(geo, this.mats.floor);
    floor.position.set((box.min.x + box.max.x) / 2, this.floorY - 0.2, (box.min.z + box.max.z) / 2);
    floor.receiveShadow = true;
    this.mats.floor.map.repeat.set(size.x / 4, size.z / 4);
    floor.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.mats.floorEdge));
    this.content.add(floor);
  }

  // 垂直於軌道的圓環
  gate(segIdx, s, radius, tube, material) {
    const seg = this.segs[segIdx];
    const f = seg.frameAt(Math.min(s, seg.length), newFrame());
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 40), material);
    ring.position.copy(f.p).addScaledVector(f.u, RIDE_H);
    ring.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.b, f.u, f.t.clone().negate()));
    this.content.add(ring);
    return ring;
  }

  buildSegment(seg, index, sleeperMat) {
    const tr = seg.track;
    // 機關段放在會動的 group 裡：group 位置 = pivot，內層平移 −pivot
    const outer = new THREE.Group();
    const inner = new THREE.Group();
    outer.add(inner);
    outer.position.copy(seg.pivot);
    inner.position.copy(seg.pivot).negate();
    this.content.add(outer);
    seg.view = outer;

    const stride = 1;
    inner.add(tubeMesh(tr, stride, (i, o) => o.copy(tr.P[i]).addScaledVector(tr.B[i], -RAIL_GAP), RAIL_R, 8, this.mats.rail));
    inner.add(tubeMesh(tr, stride, (i, o) => o.copy(tr.P[i]).addScaledVector(tr.B[i], RAIL_GAP), RAIL_R, 8, this.mats.rail));
    inner.add(tubeMesh(tr, stride, (i, o) => o.copy(tr.P[i]).addScaledVector(tr.U[i], -0.26), 0.07, 6, seg.mech ? this.mats.spineMech : this.mats.spine));

    // 枕木：開放端點附近改為橘色警示
    const every = Math.max(1, Math.round(0.6 / tr.ds));
    const normal = [], warn = [];
    for (let i = 0; i < tr.N; i += every) {
      const s = i * tr.ds;
      const nearOpen = (!seg.capStart && s < 1.2) || (!seg.capEnd && s > tr.length - 1.2);
      (nearOpen && !seg.mech ? warn : normal).push(i);
    }
    const sleeperGeo = new THREE.BoxGeometry(RAIL_GAP * 2 + 0.26, 0.05, 0.14);
    const postGeo = new THREE.BoxGeometry(0.05, 0.2, 0.05);
    const m4 = new THREE.Matrix4(), tmp = new THREE.Vector3();
    const place = (list, geo, mat, offU) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((i, k) => {
        m4.makeBasis(tr.B[i], tr.U[i], tmp.copy(tr.T[i]).negate());
        m4.setPosition(tmp.copy(tr.P[i]).addScaledVector(tr.U[i], offU));
        im.setMatrixAt(k, m4);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      inner.add(im);
    };
    place(normal, sleeperGeo, seg.mech ? this.mats.metal : this.mats[sleeperMat], -(RAIL_R + 0.025));
    place(warn, sleeperGeo, this.mats.warn, -(RAIL_R + 0.025));
    place([...normal, ...warn], postGeo, this.mats.spine, -0.16);

    // 端點擋板
    const capGeo = new THREE.BoxGeometry(RAIL_GAP * 2 + 0.2, 0.3, 0.08);
    for (const [on, i] of [[seg.capStart, 0], [seg.capEnd, tr.N - 1]]) {
      if (!on) continue;
      const cap = new THREE.Mesh(capGeo, this.mats.cap);
      m4.makeBasis(tr.B[i], tr.U[i], tmp.copy(tr.T[i]).negate());
      m4.setPosition(tmp.copy(tr.P[i]).addScaledVector(tr.U[i], 0.1).addScaledVector(tr.T[i], i === 0 ? -0.06 : 0.06));
      cap.applyMatrix4(m4);
      inner.add(cap);
    }

    if (!seg.mech) {
      // 支柱
      const list = [];
      for (let i = Math.round(1 / tr.ds); i < tr.N; i += Math.round(3 / tr.ds)) {
        if (tr.P[i].y - this.floorY > 0.8) list.push(i);
      }
      if (list.length) {
        const pim = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.11, 1, 8), this.mats.pillar, list.length);
        list.forEach((i, k) => {
          const h = tr.P[i].y - 0.3 - this.floorY;
          m4.makeScale(1, h, 1).setPosition(tr.P[i].x, this.floorY + h / 2, tr.P[i].z);
          pim.setMatrixAt(k, m4);
        });
        pim.castShadow = true;
        this.content.add(pim);
      }
    } else if (seg.mech.type === 'turntable') {
      // 轉盤：底下旋轉圓盤 + 固定底座
      const r = seg.mech.radius + 0.15;
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.08, 40), this.mats.disc);
      disc.position.set(0, tr.P[0].y - 0.36 - seg.pivot.y, 0);
      disc.receiveShadow = true;
      outer.add(disc);
      const arrow = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r - 0.04, 40, 1, 0, Math.PI * 1.5), this.mats.warn);
      arrow.rotation.x = -Math.PI / 2;
      arrow.position.y = disc.position.y + 0.05;
      outer.add(arrow);
      const h = seg.pivot.y - 0.4 - this.floorY;
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, h, 16), this.mats.metal);
      ped.position.set(seg.pivot.x, this.floorY + h / 2, seg.pivot.z);
      ped.castShadow = true;
      this.content.add(ped);
    } else if (seg.mech.type === 'bridge') {
      // 移動範圍以淡橘色半透明方塊標示
      const m = seg.mech;
      const a = tr.P[0], b = tr.P[tr.N - 1];
      const len = a.distanceTo(b) + 0.2;
      const ext = m.axis.clone().multiplyScalar(m.amp);
      const tv = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.mats.travel);
      const dir = b.clone().sub(a).normalize();
      const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      const w = 0.7 + Math.abs(ext.dot(side));
      const hgt = 0.5 + Math.abs(ext.y);
      tv.scale.set(len, hgt, w);
      tv.rotation.y = Math.atan2(-dir.z, dir.x);
      tv.position.copy(a).lerp(b, 0.5).addScaledVector(ext, 0.5);
      tv.position.y += -0.1;
      this.content.add(tv);
    }
  }

  buildSweepers(list) {
    this.sweepers = list.map((sw) => {
      const h = sw.y - this.floorY;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, h + 0.15, 12), this.mats.metal);
      pole.position.set(sw.pivot.x, this.floorY + (h + 0.15) / 2, sw.pivot.z);
      pole.castShadow = true;
      this.content.add(pole);
      const g = new THREE.Group();
      g.position.set(sw.pivot.x, sw.y, sw.pivot.z);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(sw.len, 0.2, 0.2), this.mats.sweeper);
      arm.position.x = sw.len / 2;
      arm.castShadow = true;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.3, 16), this.mats.sweeper);
      g.add(arm, hub);
      this.content.add(g);
      return { def: sw, mesh: g };
    });
  }

  makeGoal() {
    const last = this.segs.length - 1;
    this.goalS = this.segs[last].length - 1.2;
    const ring = this.gate(last, this.goalS, 0.85, 0.07, new THREE.MeshStandardMaterial({ color: 0x4fe3ff, emissive: 0x4fe3ff, emissiveIntensity: 1.6, metalness: 0.8, roughness: 0.2 }));
    const ring2 = this.gate(last, this.goalS, 0.65, 0.04, new THREE.MeshBasicMaterial({ color: 0xff4fd8 }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.82, 40), new THREE.MeshBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    disc.position.copy(ring.position);
    disc.quaternion.copy(ring.quaternion);
    const light = new THREE.PointLight(0xff4fd8, 6, 6, 1.5);
    light.position.copy(ring.position);
    this.content.add(disc, light);
    this.goal = { ring, ring2, disc };
  }

  clearLevel() {
    this.content.traverse((o) => { if (o !== this.ballMesh && o !== this.ballGlow) o.geometry?.dispose(); });
    this.content.clear();
  }

  // 鏡頭：固定角度，距離調整到剛好看到整塊板子
  fitCamera() {
    if (!this.bounds) return;
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    const cam = this.camera;
    cam.aspect = w / h;
    cam.fov = 40;
    cam.updateProjectionMatrix();
    const box = this.bounds.clone();
    box.max.y += 0.8;
    const c = box.getCenter(new THREE.Vector3());
    const dir = new THREE.Vector3(0, Math.sin(CAM_PITCH), Math.cos(CAM_PITCH));
    const corners = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    const fits = (d) => {
      cam.position.copy(c).addScaledVector(dir, d);
      cam.lookAt(c);
      cam.updateMatrixWorld();
      return corners.every((p) => {
        const v = p.clone().project(cam);
        return Math.abs(v.x) < 0.97 && v.y > -0.95 && v.y < 0.78 && v.z < 1;
      });
    };
    let lo = 5, hi = 200;
    for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    fits(hi * 1.02);

    // 陰影範圍涵蓋整塊板子
    const size = box.getSize(new THREE.Vector3());
    const R = Math.max(size.x, size.z) * 0.6 + 2;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -R; sc.right = sc.top = R; sc.near = 1; sc.far = 120;
    sc.updateProjectionMatrix();
    this.sun.position.copy(c).add(new THREE.Vector3(-10, 30, 14));
    this.sun.target.position.copy(c);
  }

  resize() { this.fitCamera(); }

  // 重設本關（回到起點、計時歸零）
  resetRun() {
    this.time = 0;
    this.gemCount = 0;
    this.falls = 0;
    this.acc = 0;
    this.respawnAt = { seg: 0, s: 0.6 };
    for (const g of this.gems) { g.taken = false; g.fade = 0; g.mesh.visible = true; g.mesh.scale.setScalar(1); g.mesh.position.copy(g.pos); }
    for (const c of this.checkpoints) { c.active = false; c.mesh.material.color.set(0x4fe3ff); }
    this.sim.reset(0, 0.6);
    this.input.reset();
    this.ballMesh.quaternion.identity();
    this.ballMesh.scale.setScalar(1);
    this.syncBall();
  }

  setState(s) { this.state = s; }

  // ------------------------------------------------------------------ 主迴圈
  update(dt) {
    dt = Math.min(dt, 0.05);
    const s = this.state;
    if (!this.level) return;

    if (s === 'play' || s === 'falling') {
      this.input.update(dt);
      this.time += dt;
      this.acc += dt;
      while (this.acc >= STEP) {
        this.acc -= STEP;
        this.physicsStep();
        if (this.state !== 'play' && this.state !== 'falling') break;
      }
      this.syncBall();
      if (this.state === 'falling') {
        this.fallTimer -= dt;
        if (this.fallTimer <= 0) this.respawn();
      }
    } else if (s === 'won') {
      this.winT += dt;
      this.ballMesh.scale.setScalar(Math.max(1 - this.winT * 1.5, 0.01));
      this.ballGlow.material.opacity = Math.max(0.55 - this.winT, 0);
      this.relaxTilt();
    } else if (s === 'idle') {
      this.clock += dt;
      for (const sg of this.segs) sg.update(this.clock);
      this.sim.updatePos();
      this.syncBall();
      this.relaxTilt();
    } else if (s === 'countdown') {
      this.input.update(dt);
    }

    // 畫面上的板子傾斜
    this.board.rotation.set(this.input.x * VISUAL_TILT, 0, this.input.z * VISUAL_TILT);
    this.animateProps(dt);
    this.renderer.render(this.scene, this.camera);
  }

  relaxTilt() { this.input.x *= 0.9; this.input.z *= 0.9; }

  physicsStep() {
    const sim = this.sim;
    this.clock += STEP;
    for (const sg of this.segs) sg.update(this.clock);
    const prevSeg = sim.seg, prevS = sim.s;
    tiltGravity(this.g, this.input.x, this.input.z);
    sim.step(STEP, this.g, this.clock);
    this.rollBall(STEP);

    for (const e of sim.events) {
      if (e.type === 'land') this.ev.onHit?.(0.3 + e.strength * 0.7);
      else if (e.type === 'bump') this.ev.onHit?.(0.2 + e.strength * 0.5);
      else if (e.type === 'knock') this.ev.onKnock?.();
    }
    sim.events.length = 0;

    if (this.state !== 'play') return;

    if (sim.onTrack) {
      for (const c of this.checkpoints) {
        if (!c.active && sim.seg === c.seg && prevSeg === c.seg && prevS < c.s && sim.s >= c.s) {
          c.active = true;
          c.mesh.material.color.set(0x5aff8a);
          this.respawnAt = { seg: c.seg, s: c.s };
          this.ev.onCheckpoint?.();
        }
      }
    }

    for (const g of this.gems) {
      if (!g.taken && sim.pos.distanceTo(g.pos) < BALL_R + 0.45) {
        g.taken = true;
        this.gemCount++;
        this.ev.onGem?.(this.gemCount);
      }
    }

    if (sim.onTrack && sim.seg === this.segs.length - 1 && sim.s >= this.goalS) {
      this.state = 'won';
      this.winT = 0;
      this.ev.onWin?.(this.time, this.gemCount, this.falls);
      return;
    }

    if (!sim.onTrack && (sim.airT > 3 || sim.pos.y < this.floorY + BALL_R)) {
      this.state = 'falling';
      this.fallTimer = 0.9;
      this.ev.onFall?.();
    }
  }

  respawn() {
    this.falls++;
    this.sim.reset(this.respawnAt.seg, this.respawnAt.s);
    this.input.reset();
    this.syncBall();
    this.state = 'play';
    this.ev.onRespawn?.(this.falls);
  }

  rollBall(h) {
    const sim = this.sim;
    if (sim.onTrack) {
      this.spinAxis = (this.spinAxis || new THREE.Vector3()).copy(sim.f.b).negate();
      this.spinRate = sim.v / BALL_R;
    }
    if (this.spinAxis) this.ballMesh.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(this.spinAxis, this.spinRate * h));
  }

  syncBall() {
    this.ballMesh.position.copy(this.sim.pos);
    this.ballGlow.position.copy(this.sim.pos);
  }

  animateProps(dt) {
    const t = performance.now() / 1000;
    // 機關姿態
    for (const sg of this.segs) {
      if (!sg.mech) continue;
      sg.view.position.copy(sg.pivot).add(sg.off);
      sg.view.rotation.y = sg.yaw;
    }
    for (const sw of this.sweepers) sw.mesh.rotation.y = sw.def.phase + sw.def.speed * this.clock;

    for (const g of this.gems) {
      if (g.taken) {
        if (g.mesh.visible) {
          g.fade += dt * 4;
          g.mesh.scale.setScalar(1 + g.fade * 1.5);
          g.mesh.position.y = g.pos.y + g.fade * 0.8;
          if (g.fade >= 1) g.mesh.visible = false;
        }
      } else {
        g.mesh.rotation.y = t * 2;
        g.mesh.position.y = g.pos.y + Math.sin(t * 3 + g.pos.x) * 0.06;
      }
    }
    if (this.goal) {
      this.goal.ring2.rotateZ(dt * 1.5);
      this.goal.disc.material.opacity = 0.2 + Math.sin(t * 4) * 0.1;
    }
    if (this.state !== 'won') this.ballGlow.material.opacity = 0.45 + Math.sin(t * 5) * 0.1;
  }

  get speed() { return this.sim ? this.sim.speed : 0; }
  get grounded() { return this.sim ? this.sim.onTrack : false; }
  get danger() { return this.state === 'play' && this.sim.onTrack ? this.sim.danger : 0; }
}

// ------------------------------------------------------------------ 幾何
function tubeMesh(tr, stride, centerFn, radius, radial, material) {
  const pos = [], nor = [], idx = [];
  const c = new THREE.Vector3(), n = new THREE.Vector3();
  let rings = 0;
  const add = (i) => {
    centerFn(i, c);
    const base = pos.length / 3;
    for (let r = 0; r < radial; r++) {
      const a = (r / radial) * Math.PI * 2;
      n.copy(tr.B[i]).multiplyScalar(Math.cos(a)).addScaledVector(tr.U[i], Math.sin(a));
      pos.push(c.x + n.x * radius, c.y + n.y * radius, c.z + n.z * radius);
      nor.push(n.x, n.y, n.z);
    }
    if (rings > 0) {
      const prev = base - radial;
      for (let r = 0; r < radial; r++) {
        const r2 = (r + 1) % radial;
        idx.push(prev + r, base + r, prev + r2, prev + r2, base + r, base + r2);
      }
    }
    rings++;
  };
  for (let i = 0; i < tr.N; i += stride) add(i);
  if ((tr.N - 1) % stride) add(tr.N - 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------ 程序化貼圖
function canvasTex(size, draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function woodTexture() {
  return canvasTex(256, (g, S) => {
    g.fillStyle = 'hsl(26,45%,34%)';
    g.fillRect(0, 0, S, S);
    for (let k = 0; k < 60; k++) {
      const y0 = Math.random() * S;
      g.strokeStyle = `hsla(26,40%,${Math.random() < 0.5 ? 22 : 44}%,${0.25 + Math.random() * 0.3})`;
      g.lineWidth = 0.5 + Math.random() * 1.5;
      g.beginPath();
      const amp = 1 + Math.random() * 3, fr = 0.02 + Math.random() * 0.03, off = Math.random() * 10;
      for (let x = 0; x <= S; x += 8) {
        const y = y0 + Math.sin(x * fr + off) * amp;
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
  });
}

function stoneTexture() {
  return canvasTex(256, (g, S) => {
    g.fillStyle = '#4c5563';
    g.fillRect(0, 0, S, S);
    const img = g.getImageData(0, 0, S, S);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 34;
      d[i] += n; d[i + 1] += n; d[i + 2] += n + 4;
    }
    g.putImageData(img, 0, 0);
  });
}

// 板面：深色金屬板 + 霓虹細格線
function floorTexture() {
  return canvasTex(256, (g, S) => {
    g.fillStyle = '#141b27';
    g.fillRect(0, 0, S, S);
    const img = g.getImageData(0, 0, S, S);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 10;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(79,227,255,0.35)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, S - 2, S - 2);
    g.strokeStyle = 'rgba(79,227,255,0.12)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(S / 2, 0); g.lineTo(S / 2, S); g.moveTo(0, S / 2); g.lineTo(S, S / 2); g.stroke();
  });
}

function radialTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}
