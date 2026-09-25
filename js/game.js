// 3D 畫面：雲霄飛車雙軌、鋼珠、鏡頭；物理在 physics.js
import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { Track, BALL_R, RAIL_R, RAIL_GAP, RIDE_H, DS, newFrame } from './track.js';
import { BallSim, tiltGravity } from './physics.js';

const STEP = 1 / 120;
const Y = new THREE.Vector3(0, 1, 0);

export class Game {
  constructor(canvas, input, events) {
    this.input = input;
    this.ev = events;
    this.state = 'idle';
    this.levelIndex = 0;
    this.time = 0;
    this.gemCount = 0;
    this.falls = 0;
    this.acc = 0;
    this.heading = 0;
    this.g = new THREE.Vector3();
    this.f = newFrame();

    this.initRenderer(canvas);
    this.initScene();
    addEventListener('resize', () => this.resize());
    this.resize();
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
    scene.fog = new THREE.Fog(0x05070f, 40, 120);
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

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    this.camTarget = new THREE.Vector3();

    scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x2a1030, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -12; sc.right = sc.top = 12; sc.near = 1; sc.far = 60;
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);
    this.sun = sun;

    this.levelRoot = new THREE.Group();
    scene.add(this.levelRoot);

    this.makeBackdrop();
    this.makeMaterials();
    this.makeBall();
  }

  makeBackdrop() {
    // 星空
    const n = 1800;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(200 + Math.random() * 100);
      if (v.y < -40) v.y *= -0.5;
      pos.set([v.x, v.y, v.z], i * 3);
      c.setHSL(0.55 + Math.random() * 0.35, 0.6, 0.6 + Math.random() * 0.4);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({
      size: 1.5, vertexColors: true, fog: false, transparent: true, opacity: 0.9, depthWrite: false,
    }));
    this.scene.add(this.stars);

    // 星雲
    this.glowTex = radialTexture();
    const nebula = new THREE.Group();
    [[0x3355ff, -100, 40, -200, 180], [0xaa33ff, 110, 10, -180, 150], [0x00aacc, 20, -40, -220, 200]].forEach(([color, x, y, z, s]) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTex, color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, fog: false, depthWrite: false,
      }));
      sp.position.set(x, y, z);
      sp.scale.set(s, s, 1);
      nebula.add(sp);
    });
    this.nebula = nebula;
    this.scene.add(nebula);

    // 地面霓虹網格
    const grid = new THREE.GridHelper(600, 150, 0x2a6cff, 0x12305a);
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    grid.material.depthWrite = false;
    this.grid = grid;
    this.scene.add(grid);
  }

  makeMaterials() {
    const wood = woodTexture();
    const stone = stoneTexture();
    this.mats = {
      rail: new THREE.MeshStandardMaterial({ color: 0xd8e2ee, metalness: 1, roughness: 0.18, emissive: 0x0a3a48, envMapIntensity: 1.3 }),
      spine: new THREE.MeshStandardMaterial({ color: 0x1a2533, metalness: 0.8, roughness: 0.35, emissive: 0x1fa8d0, emissiveIntensity: 0.9 }),
      wood: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.7, metalness: 0.05 }),
      stone: new THREE.MeshStandardMaterial({ map: stone, roughness: 0.85, metalness: 0.1 }),
      warn: new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0xff7a00, emissiveIntensity: 1.2, roughness: 0.5 }),
      pillar: new THREE.MeshStandardMaterial({ map: stone, color: 0x8894a8, roughness: 0.8, metalness: 0.2 }),
      gem: new THREE.MeshStandardMaterial({ color: 0xffd35a, emissive: 0xff8800, emissiveIntensity: 0.7, metalness: 0.6, roughness: 0.15 }),
    };
  }

  makeBall() {
    // 鋼珠：鏡面金屬，加兩條細紋讓滾動看得出來
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = '#e6e9ee'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#6b7280';
    g.fillRect(0, 62, 256, 4);
    g.fillRect(126, 0, 4, 128);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: tex, metalness: 1, roughness: 0.12, envMapIntensity: 1.6 });
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 48, 32), mat);
    this.ballMesh.castShadow = true;
    this.scene.add(this.ballMesh);

    this.ballGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTex, color: 0x4fe3ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.ballGlow.scale.set(1.6, 1.6, 1);
    this.scene.add(this.ballGlow);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 68 : 55;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ 關卡
  loadLevel(level, index) {
    this.clearLevel();
    this.level = level;
    this.levelIndex = index;
    const tr = new Track(level.build());
    this.track = tr;
    this.sim = new BallSim(tr);
    this.groundY = tr.minY - 10;
    this.goalS = tr.length - 4;
    this.startS = 2;

    this.buildTrackMeshes(tr, level.sleeper || 'wood');

    // 晶石
    this.gems = tr.gems.map((g) => {
      const f = tr.frameAt(g.s, newFrame());
      const pos = f.p.clone().addScaledVector(f.u, RIDE_H + g.h);
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), this.mats.gem);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffb030, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.set(1.4, 1.4, 1);
      m.add(glow);
      m.position.copy(pos);
      this.levelRoot.add(m);
      return { pos, mesh: m, taken: false, fade: 0 };
    });

    // 檢查點光環
    this.checkpoints = tr.checkpoints.map((s) => {
      const ring = this.gate(s, 0.95, 0.045, new THREE.MeshBasicMaterial({ color: 0x4fe3ff }));
      return { s, mesh: ring, active: false };
    });

    this.makeGoal();
    this.resetRun();
  }

  // 垂直於軌道的圓環
  gate(s, radius, tube, material) {
    const f = this.track.frameAt(s, newFrame());
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 48), material);
    ring.position.copy(f.p).addScaledVector(f.u, RIDE_H);
    ring.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.b, f.u, f.t.clone().negate()));
    this.levelRoot.add(ring);
    return ring;
  }

  buildTrackMeshes(tr, sleeperMat) {
    const stride = 2;
    const tmp = new THREE.Vector3();
    // 兩條導軌 + 下方發光主樑
    this.levelRoot.add(tubeMesh(tr, stride, (i, o) => o.copy(tr.P[i]).addScaledVector(tr.B[i], -RAIL_GAP), RAIL_R, 8, this.mats.rail));
    this.levelRoot.add(tubeMesh(tr, stride, (i, o) => o.copy(tr.P[i]).addScaledVector(tr.B[i], RAIL_GAP), RAIL_R, 8, this.mats.rail));
    this.levelRoot.add(tubeMesh(tr, stride, (i, o) => o.copy(tr.P[i]).addScaledVector(tr.U[i], -0.3), 0.08, 6, this.mats.spine));

    // 枕木（斷橋前改成橘色警示）
    const every = Math.round(0.9 / DS);
    const normal = [], warn = [];
    for (let i = 0; i < tr.N; i += every) {
      if (tr.gap[i]) continue;
      let nearGap = false;
      for (let j = i; j < Math.min(tr.N, i + Math.round(5 / DS)); j++) if (tr.gap[j]) { nearGap = true; break; }
      (nearGap ? warn : normal).push(i);
    }
    const sleeperGeo = new THREE.BoxGeometry(RAIL_GAP * 2 + 0.3, 0.06, 0.16);
    const postGeo = new THREE.BoxGeometry(0.06, 0.24, 0.06);
    const m4 = new THREE.Matrix4();
    const place = (list, geo, mat, offU) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((i, k) => {
        m4.makeBasis(tr.B[i], tr.U[i], tmp.copy(tr.T[i]).negate());
        m4.setPosition(tmp.copy(tr.P[i]).addScaledVector(tr.U[i], offU));
        im.setMatrixAt(k, m4);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      this.levelRoot.add(im);
    };
    place(normal, sleeperGeo, this.mats[sleeperMat], -(RAIL_R + 0.03));
    place(warn, sleeperGeo, this.mats.warn, -(RAIL_R + 0.03));
    place([...normal, ...warn], postGeo, this.mats.spine, -0.19);

    // 支柱：往下接到地面
    const pillars = [];
    for (let i = 0; i < tr.N; i += Math.round(6 / DS)) {
      if (tr.gap[i] || tr.U[i].y < 0.85) continue;
      pillars.push(i);
    }
    const pgeo = new THREE.CylinderGeometry(0.1, 0.16, 1, 10);
    const pim = new THREE.InstancedMesh(pgeo, this.mats.pillar, pillars.length);
    pillars.forEach((i, k) => {
      const top = tr.P[i].y - 0.35;
      const h = top - this.groundY;
      m4.makeScale(1, h, 1).setPosition(tr.P[i].x, this.groundY + h / 2, tr.P[i].z);
      pim.setMatrixAt(k, m4);
    });
    pim.castShadow = true;
    this.levelRoot.add(pim);

    // 斷橋兩端的橘色標示環
    for (let i = 1; i < tr.N; i++) {
      if (tr.gap[i] !== tr.gap[i - 1]) {
        const s = (tr.gap[i] ? i - 1 : i) * DS;
        this.gate(s, 0.55, 0.035, this.mats.warn);
      }
    }
  }

  makeGoal() {
    const s = this.goalS;
    const ring = this.gate(s, 1.4, 0.09, new THREE.MeshStandardMaterial({ color: 0x4fe3ff, emissive: 0x4fe3ff, emissiveIntensity: 1.5, metalness: 0.8, roughness: 0.2 }));
    const ring2 = this.gate(s, 1.1, 0.05, new THREE.MeshBasicMaterial({ color: 0xff4fd8 }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.35, 48), new THREE.MeshBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    disc.position.copy(ring.position);
    disc.quaternion.copy(ring.quaternion);
    const light = new THREE.PointLight(0xff4fd8, 8, 10, 1.5);
    light.position.copy(ring.position);
    this.levelRoot.add(disc, light);
    this.goal = { ring, ring2, disc };
  }

  clearLevel() {
    this.levelRoot.traverse((o) => { o.geometry?.dispose(); });
    this.levelRoot.clear();
  }

  // 重設本關（回到起點、計時歸零）
  resetRun() {
    this.time = 0;
    this.gemCount = 0;
    this.falls = 0;
    this.acc = 0;
    this.respawnS = this.startS;
    for (const g of this.gems) { g.taken = false; g.fade = 0; g.mesh.visible = true; g.mesh.scale.setScalar(1); g.mesh.position.copy(g.pos); }
    for (const c of this.checkpoints) { c.active = false; c.mesh.material.color.set(0x4fe3ff); }
    this.sim.reset(this.startS, 0);
    this.input.reset();
    this.ballMesh.quaternion.identity();
    this.ballMesh.scale.setScalar(1);
    this.syncBall();
    this.snapCamera();
  }

  setState(s) { this.state = s; }

  // ------------------------------------------------------------------ 主迴圈
  update(dt) {
    dt = Math.min(dt, 0.05);
    const s = this.state;

    if (s === 'play' || s === 'falling') {
      this.input.update(dt);
      this.time += dt;
      this.acc += dt;
      while (this.acc >= STEP) {
        this.acc -= STEP;
        this.physicsStep();
        if (this.state !== s) break;
      }
      this.syncBall();
      if (this.state === 'falling') {
        this.fallTimer -= dt;
        if (this.fallTimer <= 0) this.respawn();
      }
    } else if (s === 'won') {
      // 鋼珠穿過傳送門後縮小消失
      this.winT += dt;
      const sim = this.sim;
      sim.v = Math.max(sim.v * 0.97, 3);
      sim.s = Math.min(sim.s + sim.v * dt, this.track.length - 0.5);
      sim.updatePos();
      this.ballMesh.scale.setScalar(Math.max(1 - this.winT * 1.5, 0.01));
      this.syncBall();
    } else if (s === 'countdown') {
      this.input.update(dt);
    }

    this.updateHeading(dt);
    this.animateProps(dt);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  physicsStep() {
    const sim = this.sim;
    const prevS = sim.s;
    // 手機傾斜 → 重力方向（以鏡頭朝向為準）
    tiltGravity(this.g, this.heading, -this.input.x, -this.input.z);
    sim.step(STEP, this.g);
    this.rollBall(STEP);

    for (const e of sim.events) {
      if (e.type === 'land') this.ev.onHit?.(0.3 + e.strength * 0.7);
    }
    sim.events.length = 0;

    if (this.state !== 'play') return;

    // 檢查點
    if (sim.onTrack) {
      for (const c of this.checkpoints) {
        if (!c.active && prevS < c.s && sim.s >= c.s) {
          c.active = true;
          c.mesh.material.color.set(0x5aff8a);
          this.respawnS = c.s;
          this.ev.onCheckpoint?.();
        }
      }
    }

    // 晶石
    for (const g of this.gems) {
      if (!g.taken && sim.pos.distanceTo(g.pos) < BALL_R + 0.5) {
        g.taken = true;
        this.gemCount++;
        this.ev.onGem?.(this.gemCount);
      }
    }

    // 通關
    if (sim.onTrack && sim.s >= this.goalS) {
      this.state = 'won';
      this.winT = 0;
      this.ev.onWin?.(this.time, this.gemCount, this.falls);
      return;
    }

    // 飛出軌道太久或掉到下方 → 失敗
    if (!sim.onTrack && (sim.pos.y < this.groundY + 2 || sim.airT > 4)) {
      this.state = 'falling';
      this.fallTimer = 1.0;
      this.fallCam = this.camera.position.clone();
      this.ev.onFall?.();
    }
  }

  respawn() {
    this.falls++;
    this.sim.reset(this.respawnS, 0);
    this.input.reset();
    this.syncBall();
    this.snapCamera();
    this.state = 'play';
    this.ev.onRespawn?.(this.falls);
  }

  // 滾動時轉動鋼珠
  rollBall(h) {
    const sim = this.sim;
    if (sim.onTrack) {
      const f = sim.f;
      this.spinAxis = (this.spinAxis || new THREE.Vector3()).copy(f.b).negate();
      this.spinRate = sim.v / BALL_R;
    }
    if (this.spinAxis) {
      const q = new THREE.Quaternion().setFromAxisAngle(this.spinAxis, this.spinRate * h);
      this.ballMesh.quaternion.premultiply(q);
    }
  }

  syncBall() {
    this.ballMesh.position.copy(this.sim.pos);
    this.ballGlow.position.copy(this.sim.pos);
  }

  // 鏡頭水平朝向：沿軌道方向平滑轉動（迴圈中維持不變）
  updateHeading(dt) {
    const sim = this.sim;
    let dir = null;
    if (sim.onTrack) {
      // 迴圈中或倒退時不轉鏡頭
      if (!this.track.inLoop[this.track.index(sim.s)] && sim.v > -0.5) dir = sim.f.t;
    } else if (Math.hypot(sim.vel.x, sim.vel.z) > 2) {
      dir = sim.vel;
    }
    if (dir && Math.hypot(dir.x, dir.z) > 0.3) {
      const target = Math.atan2(dir.x, -dir.z);
      let d = target - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * (1 - Math.exp(-dt * 3.5));
    }
  }

  animateProps(dt) {
    const t = performance.now() / 1000;
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
    this.nebula.rotation.z = t * 0.01;
  }

  updateCamera(dt) {
    const p = this.ballMesh.position;
    const fx = Math.sin(this.heading), fz = -Math.cos(this.heading);
    const fwd = new THREE.Vector3(fx, 0, fz);
    const right = new THREE.Vector3(-fz, 0, fx);
    let desired, look;

    if (this.state === 'idle') {
      const t = performance.now() / 1000 * 0.15;
      desired = p.clone().add(new THREE.Vector3(Math.sin(t) * 9, 4, Math.cos(t) * 9));
      look = p.clone();
    } else if (this.state === 'falling') {
      desired = this.fallCam;
      look = p.clone();
    } else {
      desired = p.clone().addScaledVector(fwd, -6).addScaledVector(Y, 2.6);
      look = p.clone().addScaledVector(fwd, 4).addScaledVector(Y, 0.2);
      look.y += this.input.x * 4; // 前傾時視線略往下
    }
    const k = 1 - Math.exp(-dt * 6);
    this.camera.position.lerp(desired, k);
    this.camTarget.lerp(look, 1 - Math.exp(-dt * 10));
    // 左右傾時鏡頭微微側滾，讓畫面有傾斜感
    const roll = this.input.z * 0.5;
    this.camera.up.copy(Y).multiplyScalar(Math.cos(roll)).addScaledVector(right, Math.sin(roll));
    this.camera.lookAt(this.camTarget);

    this.sun.position.copy(p).add(new THREE.Vector3(6, 16, 5));
    this.sun.target.position.copy(p);
    this.stars.position.copy(this.camera.position);
    this.nebula.position.copy(this.camera.position);
    this.grid.position.set(Math.round(p.x / 4) * 4, this.groundY ?? -10, Math.round(p.z / 4) * 4);
  }

  snapCamera() {
    this.syncBall();
    const i = this.track.index(this.sim.s);
    const T = this.track.T[i];
    this.heading = Math.atan2(T.x, -T.z);
    const p = this.ballMesh.position;
    const fwd = new THREE.Vector3(Math.sin(this.heading), 0, -Math.cos(this.heading));
    this.camera.position.copy(p).addScaledVector(fwd, -6).addScaledVector(Y, 2.6);
    this.camTarget.copy(p).addScaledVector(fwd, 4);
  }

  get speed() { return this.sim.speed; }
  get grounded() { return this.sim.onTrack; }
  get danger() { return this.state === 'play' && this.sim.onTrack ? this.sim.danger : 0; }
  get airborne() { return this.state === 'play' && !this.sim.onTrack; }
}

// ------------------------------------------------------------------ 幾何
// 沿軌道建立管狀網格（遇到斷橋就斷開）
function tubeMesh(tr, stride, centerFn, radius, radial, material) {
  const pos = [], nor = [], idx = [];
  const c = new THREE.Vector3(), n = new THREE.Vector3();
  let ringCount = 0; // 目前這一段已有幾圈
  const flush = () => { ringCount = 0; };
  for (let i = 0; i < tr.N; i += stride) {
    if (tr.gap[i]) { flush(); continue; }
    centerFn(i, c);
    const base = pos.length / 3;
    for (let r = 0; r < radial; r++) {
      const a = (r / radial) * Math.PI * 2;
      n.copy(tr.B[i]).multiplyScalar(Math.cos(a)).addScaledVector(tr.U[i], Math.sin(a));
      pos.push(c.x + n.x * radius, c.y + n.y * radius, c.z + n.z * radius);
      nor.push(n.x, n.y, n.z);
    }
    if (ringCount > 0) {
      const prev = base - radial;
      for (let r = 0; r < radial; r++) {
        const r2 = (r + 1) % radial;
        idx.push(prev + r, base + r, prev + r2, prev + r2, base + r, base + r2);
      }
    }
    ringCount++;
  }
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
    for (let k = 0; k < 50; k++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '20,24,32' : '140,150,165'},${0.05 + Math.random() * 0.12})`;
      g.beginPath();
      g.arc(Math.random() * S, Math.random() * S, 4 + Math.random() * 24, 0, Math.PI * 2);
      g.fill();
    }
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
