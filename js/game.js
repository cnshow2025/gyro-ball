// 3D 畫面：遊樂園戶外場景、木造雲霄飛車軌道、會傾斜的草地模型台、跟隨鏡頭；物理在 physics.js
import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { BALL_R, RAIL_R, RAIL_GAP, RIDE_H, newFrame } from './track.js';
import { BallSim, tiltGravity, pendulumAngle, windGust } from './physics.js';
import { MAX_TILT } from './input.js';

const STEP = 1 / 120;
const VISUAL_TILT = 0.5;                            // 畫面上板子傾斜的比例（實際重力用完整傾角）
const CAM_PITCH = THREE.MathUtils.degToRad(50);     // 鏡頭俯角（全景與跟隨相同，操控方向不變）
const CAM_DIR = new THREE.Vector3(0, Math.sin(CAM_PITCH), Math.cos(CAM_PITCH));
const FOLLOW_DIST = 10;                             // 跟隨時鏡頭距離
const DECK_W = 0.5;                                 // 木板軌道半寬（護欄位置）
const SKY_TOP = new THREE.Color(0x3d8ee8), SKY_HORIZON = new THREE.Color(0xd4ecff);

export class Game {
  constructor(canvas, input, events) {
    this.input = input;
    this.ev = events;
    this.state = 'idle';
    this.levelIndex = 0;
    this.time = 0;
    this.clock = 0;
    this.gemCount = 0;
    this.falls = 0;
    this.acc = 0;
    this.g = new THREE.Vector3();
    this.camTarget = new THREE.Vector3();
    this.lookAhead = new THREE.Vector3();
    this.followBlend = 0;

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
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
  }

  initScene() {
    const scene = new THREE.Scene();
    scene.background = SKY_HORIZON.clone();
    scene.fog = new THREE.Fog(0xd4ecff, 70, 260);
    this.scene = scene;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
    scene.environmentIntensity = 0.6;

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 800);

    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5b7a3a, 1.0);
    scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    // 偏移量加大：手機的陰影精度較低，板子傾斜時容易把表面誤判成陰影（大片黑斑）
    sun.shadow.bias = -0.0012;
    sun.shadow.normalBias = 0.05;
    scene.add(sun, sun.target);
    this.sun = sun;
    this.sunOffset = new THREE.Vector3(-12, 26, 10);

    this.board = new THREE.Group();
    this.content = new THREE.Group();
    this.board.add(this.content);
    scene.add(this.board);

    this.tex = {
      grass: grassTexture(),
      plank: plankTexture(),
      beam: beamTexture(),
      cloud: cloudTexture(),
      glow: radialTexture(),
    };
    this.makeSky();
    this.makeMaterials();
    this.makeBall();
  }

  makeSky() {
    // 天空漸層
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(500, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: SKY_TOP.clone() }, horizon: { value: SKY_HORIZON.clone() } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = max(vP.y, 0.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.55)), 1.0); }',
      }),
    );
    this.sky = new THREE.Group();
    this.sky.add(dome);
    this.skyUniforms = dome.material.uniforms;
    // 夜空的星星（白天隱藏）
    const sp = [];
    for (let i = 0; i < 600; i++) {
      const v = new THREE.Vector3().randomDirection();
      if (v.y < 0.05) v.y = Math.abs(v.y) + 0.05;
      v.normalize().multiplyScalar(450);
      sp.push(v.x, v.y, v.z);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
    this.stars.visible = false;
    this.sky.add(this.stars);
    // 太陽
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: 0xfff4c0, transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    sunSprite.position.copy(new THREE.Vector3(-12, 26, 10).normalize().multiplyScalar(420));
    sunSprite.scale.set(90, 90, 1);
    this.sky.add(sunSprite);
    this.sunSprite = sunSprite;
    // 雲
    this.clouds = [];
    for (let i = 0; i < 14; i++) {
      const c = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.cloud, transparent: true, opacity: 0.9, fog: false, depthWrite: false }));
      const a = Math.random() * Math.PI * 2, r = 220 + Math.random() * 150;
      c.position.set(Math.cos(a) * r, 55 + Math.random() * 70, Math.sin(a) * r - 60);
      const s = 60 + Math.random() * 70;
      c.scale.set(s * 1.8, s, 1);
      this.sky.add(c);
      this.clouds.push(c);
    }
    this.scene.add(this.sky);
  }

  makeMaterials() {
    const t = this.tex;
    this.mats = {
      rail: new THREE.MeshStandardMaterial({ color: 0xc9d2dc, metalness: 1, roughness: 0.25, envMapIntensity: 1.2 }),
      plank: new THREE.MeshStandardMaterial({ map: t.plank, roughness: 0.8, metalness: 0 }),
      stringer: new THREE.MeshStandardMaterial({ map: t.beam, color: 0xb88a5a, roughness: 0.8 }),
      guard: new THREE.MeshStandardMaterial({ map: t.plank, color: 0xd9a066, roughness: 0.8, side: THREE.DoubleSide }),
      lattice: new THREE.MeshStandardMaterial({ map: t.beam, color: 0xf2e6d2, roughness: 0.85 }),
      mechRail: new THREE.MeshStandardMaterial({ color: 0x3a4250, metalness: 0.8, roughness: 0.35 }),
      mechSpine: new THREE.MeshStandardMaterial({ color: 0x552a00, metalness: 0.6, roughness: 0.4, emissive: 0xff7a00, emissiveIntensity: 0.5 }),
      warn: new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0xff6a00, emissiveIntensity: 0.5, roughness: 0.5 }),
      cap: new THREE.MeshStandardMaterial({ color: 0xd8303a, roughness: 0.5 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x6a7482, metalness: 0.9, roughness: 0.3 }),
      disc: new THREE.MeshStandardMaterial({ color: 0x8a5a32, map: t.plank, roughness: 0.7 }),
      springPlate: new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.4, metalness: 0.2 }),
      bulb: new THREE.MeshBasicMaterial({ color: 0xfff0c0 }),
      ghost: new THREE.MeshBasicMaterial({ color: 0xff5a3a, transparent: true, opacity: 0.22, depthWrite: false }),
      boost: new THREE.MeshStandardMaterial({ color: 0xff3d00, emissive: 0xff2a00, emissiveIntensity: 1.5, roughness: 0.4, side: THREE.DoubleSide }),
      streak: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }),
      fan: new THREE.MeshStandardMaterial({ color: 0x3a7bd5, metalness: 0.5, roughness: 0.4 }),
      sweeper: new THREE.MeshStandardMaterial({ color: 0xe8283c, metalness: 0.3, roughness: 0.35, emissive: 0x880010, emissiveIntensity: 0.4 }),
      travel: new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.12, depthWrite: false }),
      grass: new THREE.MeshStandardMaterial({ map: t.grass, roughness: 1 }),
      ground: new THREE.MeshStandardMaterial({ map: t.grass, color: 0x9cc27a, roughness: 1 }),
      frame: new THREE.MeshStandardMaterial({ map: t.beam, color: 0x8a5a32, roughness: 0.8 }),
      trunk: new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 1 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 1 }),
      hillMat: new THREE.MeshStandardMaterial({ color: 0x7fae5c, roughness: 1 }),
      gem: new THREE.MeshStandardMaterial({ color: 0xffd35a, emissive: 0xff8800, emissiveIntensity: 0.5, metalness: 0.6, roughness: 0.15 }),
      flagRed: new THREE.MeshStandardMaterial({ color: 0xe8283c, roughness: 0.6, side: THREE.DoubleSide }),
      white: new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.6 }),
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
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 40, 28), new THREE.MeshStandardMaterial({ map: tex, metalness: 1, roughness: 0.1, envMapIntensity: 1.8 }));
    this.ballMesh.castShadow = true;
    this.ballGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: 0xffffff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.ballGlow.scale.set(1.6, 1.6, 1);
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

    const box = new THREE.Box3();
    for (const s of this.segs) for (const p of s.track.P) box.expandByPoint(p);
    for (const sw of level.sweepers) box.expandByPoint(sw.pivot);
    for (const pd of level.pendulums) { box.expandByPoint(pd.cross.clone().addScaledVector(pd.side, 2.6)); box.expandByPoint(pd.cross.clone().addScaledVector(pd.side, -2.6)); }
    this.floorY = box.min.y - 1.6;
    box.min.y = this.floorY;
    box.expandByVector(new THREE.Vector3(2.2, 0, 2.2));
    this.bounds = box;
    const center = box.getCenter(new THREE.Vector3());
    center.y = this.floorY;
    this.board.position.copy(center);
    this.content.position.copy(center).negate();

    this.buildBoard(box);
    this.buildWorld(box);
    // 所有軌道取樣點：支架遇到下方有其他軌道時要跳過
    this.obstacles = [];
    for (const sg of this.segs) for (let i = 0; i < sg.track.N; i += 3) this.obstacles.push(sg.track.P[i]);
    const lattice = [];
    this.segs.forEach((s, i) => this.buildSegment(s, lattice, i));
    this.buildLattice(lattice);
    this.buildSweepers(level.sweepers);
    this.buildPendulums(level.pendulums);
    this.buildBoosters(level.boosters);
    this.buildWinds(level.winds);
    this.buildSprings(level.springs || []);
    this.applyNight(!!levelDef.night);

    this.gems = level.gems.map((p) => {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.26), this.mats.gem);
      m.castShadow = true;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: 0xffc040, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.set(1.1, 1.1, 1);
      m.add(glow);
      m.position.copy(p);
      this.content.add(m);
      return { pos: p.clone(), mesh: m, taken: false, fade: 0 };
    });

    this.checkpoints = level.checkpoints.map((cp) => ({ ...cp, flag: this.makeCheckpointFlag(cp), active: false }));

    this.makeGoal();
    this.content.add(this.ballMesh, this.ballGlow);
    this.fitCamera();
    this.resetRun();
  }

  // 草地模型台（會跟著傾斜）＋木框
  buildBoard(box) {
    const size = box.getSize(new THREE.Vector3());
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const top = new THREE.Mesh(new THREE.BoxGeometry(size.x, 0.5, size.z), this.mats.grass);
    top.position.set(cx, this.floorY - 0.25, cz);
    top.receiveShadow = true;
    this.tex.grass.repeat.set(size.x / 6, size.z / 6);
    this.content.add(top);
    const fw = 0.45, fh = 0.8;
    for (const [x, z, w, d] of [
      [cx, box.min.z - fw / 2, size.x + fw * 2, fw], [cx, box.max.z + fw / 2, size.x + fw * 2, fw],
      [box.min.x - fw / 2, cz, fw, size.z], [box.max.x + fw / 2, cz, fw, size.z],
    ]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(w, fh, d), this.mats.frame);
      f.position.set(x, this.floorY - fh / 2 + 0.15, z);
      f.castShadow = true;
      f.receiveShadow = true;
      this.content.add(f);
    }
  }

  // 模型台外的遊樂園：地面、樹、遠山（不跟著傾斜）
  buildWorld(box) {
    if (this.world) { this.scene.remove(this.world); this.world.traverse((o) => o.geometry?.dispose()); }
    const w = new THREE.Group();
    this.world = w;
    // 地面要夠低：板子同時前後、左右傾到最大時，角落也不能碰到地面（否則草地上會冒出一塊顏色）
    const size0 = box.getSize(new THREE.Vector3());
    const maxTilt = MAX_TILT * VISUAL_TILT;
    const drop = (size0.x / 2 + size0.z / 2 + 1) * Math.sin(maxTilt) + 1.5;
    const gy = this.floorY - 0.5 - drop;
    const c = box.getCenter(new THREE.Vector3());
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), this.mats.ground);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(c.x, gy, c.z);
    ground.receiveShadow = true;
    const gtex = this.tex.grass.clone();
    gtex.needsUpdate = true;
    gtex.repeat.set(120, 120);
    ground.material = this.mats.ground.clone();
    ground.material.map = gtex;
    w.add(ground);

    // 模型台底座
    const size = box.getSize(new THREE.Vector3());
    // 底座放在板子裡（跟著一起傾斜），頂端貼齊板子底面，傾斜時才不會從草地穿出來
    const pedH = drop + 0.6;
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(size.x, size.z) * 0.2, Math.min(size.x, size.z) * 0.26, pedH, 24), this.mats.frame);
    ped.position.set(c.x, this.floorY - 0.5 - pedH / 2, c.z);
    this.content.add(ped);

    // 樹
    const n = 140;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 2, 6), this.mats.trunk, n);
    const leaf = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 4, 8), this.mats.leaf, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const halfX = size.x / 2 + 9, halfZ = size.z / 2 + 9;
    let k = 0;
    while (k < n) {
      const x = c.x + (Math.random() - 0.5) * 180, z = c.z + (Math.random() - 0.5) * 180 - 30;
      if (Math.abs(x - c.x) < halfX && Math.abs(z - c.z) < halfZ + 6) continue;
      // 鏡頭在板子前方（+z），前方不種樹以免擋住視線
      if (z > c.z - halfZ && Math.abs(x - c.x) < halfX + 30) continue;
      const s = 0.8 + Math.random() * 1.2;
      sc.set(s, s, s);
      m.compose(p.set(x, gy + s, z), q, sc); trunk.setMatrixAt(k, m);
      m.compose(p.set(x, gy + s * 3.6, z), q, sc); leaf.setMatrixAt(k, m);
      k++;
    }
    trunk.castShadow = leaf.castShadow = true;
    w.add(trunk, leaf);

    // 遠山
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI * 0.95 + (i / 8) * Math.PI * 0.9;
      const r = 230 + Math.random() * 60;
      const hill = new THREE.Mesh(new THREE.SphereGeometry(60 + Math.random() * 40, 20, 10), this.mats.hillMat);
      hill.scale.y = 0.35 + Math.random() * 0.2;
      hill.position.set(c.x + Math.cos(a) * r, gy - 5, c.z + Math.sin(a) * r);
      w.add(hill);
    }
    this.scene.add(w);
    this.sky.position.set(c.x, 0, c.z);
  }

  makeCheckpointFlag(cp) {
    // 軌道旁的小旗子
    const seg = this.segs[cp.seg];
    const f = seg.frameAt(Math.min(cp.s, seg.length), newFrame());
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6), this.mats.white);
    pole.position.y = 0.6;
    const flagMat = new THREE.MeshStandardMaterial({ color: 0x3aa0ff, roughness: 0.6, side: THREE.DoubleSide });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.32), flagMat);
    flag.position.set(0.25, 1.02, 0);
    g.add(pole, flag);
    g.position.copy(f.p).addScaledVector(f.b, DECK_W + 0.15).add(new THREE.Vector3(0, -0.15, 0));
    g.rotation.y = Math.atan2(-f.t.z, f.t.x) + Math.PI;
    this.content.add(g);
    return { group: g, mat: flagMat, cloth: flag };
  }

  // ------------------------------------------------------------------ 軌道外觀
  buildSegment(seg, lattice, index) {
    const ices = (this.level.ices || []).filter((z) => z.seg === index);
    const tr = seg.track;
    const outer = new THREE.Group();
    const inner = new THREE.Group();
    outer.add(inner);
    outer.position.copy(seg.pivot);
    inner.position.copy(seg.pivot).negate();
    this.content.add(outer);
    seg.view = outer;
    const m4 = new THREE.Matrix4(), tmp = new THREE.Vector3();
    const basis = (i) => m4.makeBasis(tr.B[i], tr.U[i], tmp.copy(tr.T[i]).negate());

    // 鋼條導軌
    // 崩塌木板外觀跟一般木軌一樣（顏色偏紅），但沒有支架
    const vanish = seg.mech?.type === 'vanish';
    const woody = !seg.mech || vanish;
    const railMat = woody ? this.mats.rail : this.mats.mechRail;
    inner.add(tubeMesh(tr, (i, o) => o.copy(tr.P[i]).addScaledVector(tr.B[i], -RAIL_GAP), RAIL_R, 6, railMat));
    inner.add(tubeMesh(tr, (i, o) => o.copy(tr.P[i]).addScaledVector(tr.B[i], RAIL_GAP), RAIL_R, 6, railMat));

    if (woody) {
      // 導軌下的木樑
      inner.add(tubeMesh(tr, (i, o) => o.copy(tr.P[i]).addScaledVector(tr.B[i], -RAIL_GAP).addScaledVector(tr.U[i], -0.1), 0.065, 4, this.mats.stringer, Math.PI / 4));
      inner.add(tubeMesh(tr, (i, o) => o.copy(tr.P[i]).addScaledVector(tr.B[i], RAIL_GAP).addScaledVector(tr.U[i], -0.1), 0.065, 4, this.mats.stringer, Math.PI / 4));
      // 木板路面（每片顏色略有不同）
      const step = Math.max(1, Math.round(0.2 / tr.ds));
      const list = [];
      for (let i = 0; i < tr.N; i += step) list.push(i);
      const planks = new THREE.InstancedMesh(new THREE.BoxGeometry(DECK_W * 2 + 0.1, 0.05, 0.17), this.mats.plank, list.length);
      const col = new THREE.Color();
      list.forEach((i, k) => {
        basis(i).setPosition(tmp.copy(tr.P[i]).addScaledVector(tr.U[i], -0.19));
        planks.setMatrixAt(k, m4);
        const s = tr.length - i * tr.ds, s0 = i * tr.ds;
        const nearOpen = (!seg.capStart && s0 < 1.0) || (!seg.capEnd && s < 1.0);
        const onIce = ices.some((z) => s0 >= z.s0 - 0.1 && s0 <= z.s1 + 0.1);
        if (onIce) planks.setColorAt(k, col.setHSL(0.54, 0.9, 0.72 + (Math.random() - 0.5) * 0.1));
        else if (vanish) planks.setColorAt(k, col.setHSL(0.02, 0.55, 0.45 + (Math.random() - 0.5) * 0.12));
        else planks.setColorAt(k, nearOpen ? col.set(0xff9a2a) : col.setHSL(0.07, 0.35, 0.62 + (Math.random() - 0.5) * 0.12));
      });
      planks.castShadow = planks.receiveShadow = true;
      inner.add(planks);
      // 兩側木護欄 + 小立柱
      inner.add(ribbonMesh(tr, DECK_W, -0.17, 0.1, this.mats.guard));
      inner.add(ribbonMesh(tr, -DECK_W, -0.17, 0.1, this.mats.guard));
      const pstep = Math.round(1.2 / tr.ds);
      const posts = [];
      for (let i = 0; i < tr.N; i += pstep) posts.push(i);
      const pim = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.36, 0.07), this.mats.stringer, posts.length * 2);
      posts.forEach((i, k) => {
        for (const sd of [-1, 1]) {
          basis(i).setPosition(tmp.copy(tr.P[i]).addScaledVector(tr.B[i], sd * (DECK_W + 0.05)).addScaledVector(tr.U[i], -0.05));
          pim.setMatrixAt(k * 2 + (sd > 0 ? 1 : 0), m4);
        }
      });
      pim.castShadow = true;
      inner.add(pim);
      // 格子支架的資料
      if (!vanish) this.collectLattice(tr, lattice);
      else {
        // 消失時留下半透明虛影，讓玩家知道軌道會再出現的位置
        const a = tr.P[0], b = tr.P[tr.N - 1];
        const ghost = new THREE.Mesh(new THREE.BoxGeometry(a.distanceTo(b), 0.05, DECK_W * 2 + 0.1), this.mats.ghost);
        ghost.position.copy(a).lerp(b, 0.5).addScaledVector(tr.U[0], -0.19);
        const d = b.clone().sub(a).normalize();
        ghost.rotation.y = Math.atan2(-d.z, d.x);
        ghost.visible = false;
        this.content.add(ghost);
        seg.ghost = ghost;
      }
    } else {
      // 機關：金屬枕木 + 橘色發光主樑
      inner.add(tubeMesh(tr, (i, o) => o.copy(tr.P[i]).addScaledVector(tr.U[i], -0.22), 0.07, 6, this.mats.mechSpine));
      const step = Math.max(1, Math.round(0.4 / tr.ds));
      const list = [];
      for (let i = 0; i < tr.N; i += step) list.push(i);
      const sl = new THREE.InstancedMesh(new THREE.BoxGeometry(RAIL_GAP * 2 + 0.26, 0.05, 0.12), this.mats.metal, list.length);
      list.forEach((i, k) => { basis(i).setPosition(tmp.copy(tr.P[i]).addScaledVector(tr.U[i], -(RAIL_R + 0.025))); sl.setMatrixAt(k, m4); });
      sl.castShadow = true;
      inner.add(sl);
    }

    // 端點紅色擋板
    const capGeo = new THREE.BoxGeometry(RAIL_GAP * 2 + 0.3, 0.3, 0.08);
    for (const [on, i] of [[seg.capStart, 0], [seg.capEnd, tr.N - 1]]) {
      if (!on) continue;
      const cap = new THREE.Mesh(capGeo, this.mats.cap);
      basis(i).setPosition(tmp.copy(tr.P[i]).addScaledVector(tr.U[i], 0.08).addScaledVector(tr.T[i], i === 0 ? -0.06 : 0.06));
      cap.applyMatrix4(m4);
      cap.castShadow = true;
      inner.add(cap);
    }

    if (seg.mech?.type === 'turntable') {
      const r = seg.mech.radius + 0.25;
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.12, 40), this.mats.disc);
      disc.position.set(0, tr.P[0].y - 0.36 - seg.pivot.y, 0);
      disc.castShadow = disc.receiveShadow = true;
      outer.add(disc);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 6, 40), this.mats.warn);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = disc.position.y + 0.06;
      outer.add(ring);
      const h = seg.pivot.y - 0.42 - this.floorY;
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, h, 16), this.mats.metal);
      ped.position.set(seg.pivot.x, this.floorY + h / 2, seg.pivot.z);
      ped.castShadow = true;
      this.content.add(ped);
    } else if (seg.mech?.type === 'bridge') {
      const m = seg.mech;
      const a = tr.P[0], b = tr.P[tr.N - 1];
      const len = a.distanceTo(b) + 0.2;
      const ext = m.axis.clone().multiplyScalar(m.amp);
      const dir = b.clone().sub(a).normalize();
      const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      const tv = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.mats.travel);
      tv.scale.set(len, 0.5 + Math.abs(ext.y), 0.7 + Math.abs(ext.dot(side)));
      tv.rotation.y = Math.atan2(-dir.z, dir.x);
      tv.position.copy(a).lerp(b, 0.5).addScaledVector(ext, 0.5);
      tv.position.y -= 0.1;
      this.content.add(tv);
    }
  }

  // 木造雲霄飛車的格子支架：每隔一段一組「兩根立柱 + 橫木 + 斜撐」，相鄰兩組之間再加縱向斜撐
  collectLattice(tr, out) {
    const every = Math.round(1.6 / tr.ds);
    const bents = [];
    const H = new THREE.Vector3();
    for (let i = Math.round(0.4 / tr.ds); i < tr.N; i += every) {
      const P = tr.P[i];
      // 太低、翻轉中（迴圈、翻滾）都不放支架
      if (P.y - 0.25 - this.floorY < 0.35 || tr.U[i].y < 0.75) { bents.push(null); continue; }
      H.set(tr.B[i].x, 0, tr.B[i].z).normalize();
      const topY = P.y - 0.24;
      const L = new THREE.Vector3(P.x, topY, P.z).addScaledVector(H, -0.42);
      const R = new THREE.Vector3(P.x, topY, P.z).addScaledVector(H, 0.42);
      // 正下方有別段軌道（交叉、螺旋下層）就跳過，免得支架穿過軌道
      const blocked = this.obstacles.some((q) => q.y < topY - 0.25 &&
        (Math.hypot(q.x - L.x, q.z - L.z) < 0.8 || Math.hypot(q.x - R.x, q.z - R.z) < 0.8));
      if (blocked) { bents.push(null); continue; }
      const bent = { L, R, levels: [] };
      out.push([L, new THREE.Vector3(L.x, this.floorY, L.z), 0.09]);
      out.push([R, new THREE.Vector3(R.x, this.floorY, R.z), 0.09]);
      out.push([L, R, 0.07]);
      let y = topY - 1.0, prev = topY;
      bent.levels.push(topY);
      while (y > this.floorY + 0.25) {
        const l = new THREE.Vector3(L.x, y, L.z), r = new THREE.Vector3(R.x, y, R.z);
        out.push([l, r, 0.06]);
        out.push([new THREE.Vector3(L.x, prev, L.z), r, 0.045]);
        bent.levels.push(y);
        prev = y;
        y -= 1.0;
      }
      out.push([new THREE.Vector3(L.x, prev, L.z), new THREE.Vector3(R.x, this.floorY, R.z), 0.045]);
      bents.push(bent);
    }
    for (let k = 1; k < bents.length; k++) {
      const a = bents[k - 1], b = bents[k];
      if (!a || !b) continue;
      const lo = Math.max(this.floorY + 0.3, Math.min(a.L.y, b.L.y) - 1.0);
      out.push([a.L, new THREE.Vector3(b.L.x, lo, b.L.z), 0.04]);
      out.push([a.R, new THREE.Vector3(b.R.x, lo, b.R.z), 0.04]);
    }
  }

  buildLattice(list) {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.mats.lattice, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), mid = new THREE.Vector3(), d = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    list.forEach(([a, b, t], k) => {
      d.subVectors(b, a);
      const len = d.length();
      q.setFromUnitVectors(up, d.normalize());
      m.compose(mid.addVectors(a, b).multiplyScalar(0.5), q, s.set(t, len, t));
      im.setMatrixAt(k, m);
    });
    im.castShadow = true;
    this.content.add(im);
  }

  // 彈簧跳台：紅黃色踏板 + 彈簧
  buildSprings(list) {
    this.springPads = list.map((sp) => {
      const seg = this.segs[sp.seg];
      const f = newFrame();
      seg.frameAt(Math.min(sp.s + 0.1, seg.length), f);
      const g = new THREE.Group();
      g.position.copy(f.p).addScaledVector(f.u, -0.1);
      g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.b, f.u, f.t.clone().negate()));
      const plate = new THREE.Mesh(new THREE.BoxGeometry(DECK_W * 2 + 0.1, 0.08, 1.0), this.mats.springPlate);
      plate.position.y = 0.02;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(DECK_W * 2 + 0.12, 0.085, 0.18), this.mats.cap);
      stripe.position.y = 0.02;
      const coil = new THREE.Mesh(new THREE.TorusKnotGeometry(0.18, 0.035, 48, 6, 1, 6), this.mats.metal);
      coil.rotation.x = Math.PI / 2;
      coil.position.y = -0.12;
      g.add(plate, stripe, coil);
      this.content.add(g);
      return { group: g, plate, stripe };
    });
  }

  // 白天／夜晚
  applyNight(night) {
    this.night = night;
    const u = this.skyUniforms;
    u.top.value.set(night ? 0x08112b : SKY_TOP);
    u.horizon.value.set(night ? 0x1d2c55 : SKY_HORIZON);
    this.scene.background.set(night ? 0x1d2c55 : SKY_HORIZON);
    this.scene.fog.color.set(night ? 0x141d3a : 0xd4ecff);
    this.scene.fog.near = night ? 20 : 70;
    this.scene.fog.far = night ? 80 : 260;
    this.hemi.intensity = night ? 0.28 : 1.0;
    this.hemi.color.set(night ? 0x7084c0 : 0xcfe8ff);
    this.sun.intensity = night ? 0.45 : 2.6;
    this.sun.color.set(night ? 0xaabfff : 0xfff1d6);
    this.scene.environmentIntensity = night ? 0.25 : 0.6;
    this.sunSprite.material.color.set(night ? 0xe6eeff : 0xfff4c0);
    this.sunSprite.scale.set(night ? 36 : 90, night ? 36 : 90, 1);
    for (const c of this.clouds) c.visible = !night;
    this.stars.visible = night;
    this.mats.rail.emissive.set(night ? 0x334455 : 0x000000);
    if (!this.ballLight) {
      this.ballLight = new THREE.PointLight(0xfff0c8, 0, 8, 1.4);
      this.ballMesh.add(this.ballLight);
    }
    this.ballLight.intensity = night ? 5 : 0;
    this.ballGlow.material.color.set(night ? 0xfff0c8 : 0xffffff);
    if (night) this.buildLamps();
  }

  // 夜間：軌道旁的路燈（燈泡發光，不另外打光以免太耗效能）
  buildLamps() {
    const bulbs = [];
    const f = newFrame();
    const maxSeg = this.level.goalSeg ?? this.segs.length - 1;
    let side = 1;
    this.segs.forEach((seg, i) => {
      if (seg.mech || i > maxSeg) return;
      for (let s = 2; s < seg.length - 1; s += 6) {
        seg.frameAt(s, f);
        if (f.u.y < 0.8) continue;
        const base = f.p.clone().addScaledVector(new THREE.Vector3(f.b.x, 0, f.b.z).normalize(), side * (DECK_W + 0.35));
        side = -side;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.3, 6), this.mats.metal);
        pole.position.copy(base).add(new THREE.Vector3(0, 0.45, 0));
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), this.mats.bulb);
        bulb.position.copy(base).add(new THREE.Vector3(0, 1.12, 0));
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: 0xffc96a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
        glow.scale.set(1.6, 1.6, 1);
        glow.position.copy(bulb.position);
        this.content.add(pole, bulb, glow);
        bulbs.push(glow);
      }
    });
    this.lampGlows = bulbs;
  }

  // 擺錘：門形支架 + 擺動的紅白錘頭
  buildPendulums(list) {
    this.pendulums = list.map((pd) => {
      const topY = pd.pivot.y + 0.1;
      const beams = [];
      for (const sd of [-1, 1]) {
        const base = pd.cross.clone().addScaledVector(pd.side, sd * 1.25).addScaledVector(pd.fwd, 0.75);
        beams.push([new THREE.Vector3(base.x, this.floorY, base.z), new THREE.Vector3(base.x, topY, base.z), 0.14]);
      }
      const l = pd.cross.clone().addScaledVector(pd.side, -1.25).addScaledVector(pd.fwd, 0.75);
      const r = pd.cross.clone().addScaledVector(pd.side, 1.25).addScaledVector(pd.fwd, 0.75);
      beams.push([new THREE.Vector3(l.x, topY, l.z), new THREE.Vector3(r.x, topY, r.z), 0.14]);
      const mid = pd.cross.clone().addScaledVector(pd.fwd, 0.75);
      beams.push([new THREE.Vector3(mid.x, topY, mid.z), new THREE.Vector3(pd.pivot.x, topY, pd.pivot.z), 0.1]);
      const frame = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.mats.metal, beams.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), dv = new THREE.Vector3();
      beams.forEach(([a, b, t], k) => {
        dv.subVectors(b, a);
        q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dv.clone().normalize());
        m.compose(a.clone().add(b).multiplyScalar(0.5), q, sc.set(t, dv.length(), t));
        frame.setMatrixAt(k, m);
      });
      frame.castShadow = true;
      this.content.add(frame);
      const g = new THREE.Group();
      g.position.copy(pd.pivot);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, pd.len, 8), this.mats.metal);
      rod.position.y = -pd.len / 2;
      const head = new THREE.Mesh(new THREE.SphereGeometry(pd.headR, 20, 14), this.mats.sweeper);
      head.position.y = -pd.len;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(pd.headR * 1.02, pd.headR * 1.02, 0.12, 20), this.mats.white);
      band.position.y = -pd.len;
      band.rotation.copy(new THREE.Euler(0, 0, 0));
      rod.castShadow = head.castShadow = true;
      g.add(rod, head, band);
      this.content.add(g);
      return { def: pd, mesh: g };
    });
  }

  // 加速帶：軌道上發光的箭頭
  buildBoosters(list) {
    this.boosterMeshes = [];
    const shape = new THREE.Shape();
    shape.moveTo(-0.46, -0.12); shape.lineTo(0, 0.2); shape.lineTo(0.46, -0.12); shape.lineTo(0.46, -0.3); shape.lineTo(0, 0.02); shape.lineTo(-0.46, -0.3);
    const geo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    const f = newFrame(), m4 = new THREE.Matrix4(), tmp = new THREE.Vector3();
    for (const b of list) {
      const seg = this.segs[b.seg];
      let k = 0;
      for (let s = b.s0 + 0.3; s < b.s1; s += 0.6, k++) {
        seg.frameAt(Math.min(s, seg.length), f);
        const mat = this.mats.boost.clone();
        const c = new THREE.Mesh(geo, mat);
        m4.makeBasis(f.b, f.u, tmp.copy(f.t).negate()).setPosition(tmp.copy(f.p).addScaledVector(f.u, -0.135));
        c.applyMatrix4(m4);
        this.content.add(c);
        this.boosterMeshes.push({ mat, k });
      }
    }
  }

  // 側風：風扇 + 流動的風線
  buildWinds(list) {
    this.windFx = list.map((w) => {
      const seg = this.segs[w.seg];
      const f = newFrame();
      seg.frameAt(Math.min((w.s0 + w.s1) / 2, seg.length), f);
      const fanPos = f.p.clone().addScaledVector(w.dir, -2.4);
      const g = new THREE.Group();
      g.position.copy(fanPos);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), w.dir.clone().normalize());
      const duct = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.08, 8, 28), this.mats.fan);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 12).rotateX(Math.PI / 2), this.mats.metal);
      const blades = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const bl = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.03), this.mats.white);
        bl.position.y = 0.3;
        const holder = new THREE.Group();
        holder.rotation.z = (i * Math.PI) / 2;
        holder.add(bl);
        blades.add(holder);
      }
      g.add(duct, hub, blades);
      this.content.add(g);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, fanPos.y - 0.6 - this.floorY, 8), this.mats.metal);
      pole.position.set(fanPos.x, (fanPos.y - 0.6 + this.floorY) / 2, fanPos.z);
      this.content.add(pole);
      // 風線
      const streaks = [];
      const sgeo = new THREE.BoxGeometry(0.025, 0.025, 0.8);
      for (let i = 0; i < 18; i++) {
        const m = new THREE.Mesh(sgeo, this.mats.streak);
        m.quaternion.copy(g.quaternion);
        const s = w.s0 + Math.random() * (w.s1 - w.s0);
        seg.frameAt(Math.min(s, seg.length), f);
        streaks.push({ m, base: f.p.clone().add(new THREE.Vector3(0, 0.2 + Math.random() * 0.5, 0)), u: Math.random() });
        this.content.add(m);
      }
      return { def: w, blades, streaks };
    });
  }

  buildSweepers(list) {
    this.sweepers = list.map((sw) => {
      const h = sw.y - this.floorY;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, h + 0.15, 12), this.mats.metal);
      pole.position.set(sw.pivot.x, this.floorY + (h + 0.15) / 2, sw.pivot.z);
      pole.castShadow = true;
      this.content.add(pole);
      const g = new THREE.Group();
      g.position.set(sw.pivot.x, sw.y, sw.pivot.z);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(sw.len, 0.2, 0.2), this.mats.sweeper);
      arm.position.x = sw.len / 2;
      arm.castShadow = true;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.22), this.mats.white);
      stripe.position.x = sw.len * 0.66;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.3, 16), this.mats.sweeper);
      g.add(arm, stripe, hub);
      this.content.add(g);
      return { def: sw, mesh: g };
    });
  }

  // 終點拱門
  makeGoal() {
    const last = this.level.goalSeg ?? this.segs.length - 1;
    const seg = this.segs[last];
    this.goalS = seg.length - 1.2;
    const f = seg.frameAt(this.goalS, newFrame());
    const g = new THREE.Group();
    const H = 1.5, W = DECK_W + 0.25;
    for (const sd of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, H, 10), sd < 0 ? this.mats.flagRed : this.mats.white);
      post.position.set(sd * W, H / 2 - 0.2, 0);
      post.castShadow = true;
      g.add(post);
    }
    const bannerTex = bannerTexture();
    const banner = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 0.3, 0.42, 0.06), [this.mats.white, this.mats.white, this.mats.white, this.mats.white,
      new THREE.MeshStandardMaterial({ map: bannerTex }), new THREE.MeshStandardMaterial({ map: bannerTex })]);
    banner.position.y = H - 0.2;
    banner.castShadow = true;
    g.add(banner);
    g.position.copy(f.p);
    g.rotation.y = Math.atan2(f.t.x, f.t.z);
    this.content.add(g);
    this.goal = { group: g };
  }

  clearLevel() {
    this.content.traverse((o) => { if (o !== this.ballMesh && o !== this.ballGlow) o.geometry?.dispose(); });
    this.content.clear();
  }

  // ------------------------------------------------------------------ 鏡頭
  // 全景：固定角度，距離調整到剛好看到整塊板子
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
    const corners = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    const fits = (d) => {
      cam.position.copy(c).addScaledVector(CAM_DIR, d);
      cam.lookAt(c);
      cam.updateMatrixWorld();
      return corners.every((p) => {
        const v = p.clone().project(cam);
        return Math.abs(v.x) < 0.97 && v.y > -0.95 && v.y < 0.78 && v.z < 1;
      });
    };
    let lo = 5, hi = 250;
    for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    this.overview = { target: c.clone(), dist: hi * 1.02 };
    this.overviewR = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.6 + 2;
    if (this.state === 'idle' || this.state === 'countdown') this.placeCamera(c, this.overview.dist);
  }

  placeCamera(target, dist) {
    this.camTarget.copy(target);
    this.camDist = dist;
    this.camera.position.copy(target).addScaledVector(CAM_DIR, dist);
    this.camera.lookAt(target);
  }

  resize() { this.fitCamera(); }

  // 陰影開關（設定頁）
  setShadows(on) {
    if (this.renderer.shadowMap.enabled === on) return;
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    this.scene.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
    });
  }

  updateCamera(dt) {
    const follow = this.state === 'play' || this.state === 'falling' || this.state === 'won' || this.state === 'paused';
    const ov = this.overview;
    if (!ov) return;
    let target, dist;
    if (follow) {
      // 跟著鋼珠，並往前進方向多看一段
      const ball = this.content.localToWorld(this.sim.pos.clone());
      if (this.state === 'falling') ball.y = Math.max(ball.y, this.floorY + 1);
      const v = this.sim.vel;
      const ahead = new THREE.Vector3(v.x, 0, v.z).multiplyScalar(0.55);
      if (ahead.length() > 2.8) ahead.setLength(2.8);
      this.lookAhead.lerp(ahead, 1 - Math.exp(-dt * 2));
      target = ball.add(this.lookAhead);
      dist = FOLLOW_DIST;
    } else {
      target = ov.target;
      dist = ov.dist;
    }
    // 從全景平滑拉近（開場）或拉遠
    const k = 1 - Math.exp(-dt * (follow ? 2.2 : 3));
    this.camTarget.lerp(target, k);
    this.camDist += (dist - this.camDist) * k;
    this.camera.position.copy(this.camTarget).addScaledVector(CAM_DIR, this.camDist);
    this.camera.lookAt(this.camTarget);

    // 陰影範圍跟著鏡頭焦點
    const R = THREE.MathUtils.clamp(this.camDist * 0.9, 9, this.overviewR);
    const sc = this.sun.shadow.camera;
    if (Math.abs(sc.right - R) > 0.5) {
      // 深度範圍只包住畫面附近，提高手機上的陰影精度
      const D = this.sunOffset.length();
      sc.left = sc.bottom = -R; sc.right = sc.top = R;
      sc.near = Math.max(0.5, D - R - 14); sc.far = D + R + 14;
      sc.updateProjectionMatrix();
    }
    this.sun.position.copy(this.camTarget).add(this.sunOffset);
    this.sun.target.position.copy(this.camTarget);
  }

  // ------------------------------------------------------------------ 遊戲流程
  resetRun() {
    this.time = 0;
    this.gemCount = 0;
    this.falls = 0;
    this.acc = 0;
    this.respawnAt = { seg: 0, s: 0.6 };
    for (const g of this.gems) { g.taken = false; g.fade = 0; g.mesh.visible = true; g.mesh.scale.setScalar(1); g.mesh.position.copy(g.pos); }
    for (const c of this.checkpoints) { c.active = false; c.flag.mat.color.set(0x3aa0ff); }
    this.sim.reset(0, 0.6);
    this.input.reset();
    this.ballMesh.quaternion.identity();
    this.ballMesh.scale.setScalar(1);
    this.ballGlow.material.opacity = 0.35;
    this.lookAhead.set(0, 0, 0);
    this.syncBall();
    if (this.overview) this.placeCamera(this.overview.target, this.overview.dist);
  }

  setState(s) { this.state = s; }

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
      this.ballGlow.material.opacity = Math.max(0.35 - this.winT, 0);
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

    this.board.rotation.set(this.input.x * VISUAL_TILT, 0, this.input.z * VISUAL_TILT);
    this.animateProps(dt);
    this.updateCamera(dt);
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
      else if (e.type === 'spring') { this.springKick = 0.35; this.ev.onSpring?.(); }
    }
    sim.events.length = 0;

    if (this.state !== 'play') return;

    if (sim.onTrack) {
      for (const c of this.checkpoints) {
        if (!c.active && sim.seg === c.seg && prevSeg === c.seg && prevS < c.s && sim.s >= c.s) {
          c.active = true;
          c.flag.mat.color.set(0x44d05a);
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

    if (sim.onTrack && sim.seg === (this.level.goalSeg ?? this.segs.length - 1) && sim.s >= this.goalS) {
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
    for (const sg of this.segs) {
      if (!sg.mech) continue;
      sg.view.position.copy(sg.pivot).add(sg.off);
      sg.view.rotation.y = sg.yaw;
    }
    for (const sw of this.sweepers) sw.mesh.rotation.y = sw.def.phase + sw.def.speed * this.clock;
    if (this.springKick > 0) this.springKick -= dt;
    for (const sp of this.springPads || []) {
      const k = Math.max(this.springKick || 0, 0) / 0.35;
      sp.plate.position.y = sp.stripe.position.y = 0.02 + Math.sin(k * Math.PI) * 0.25;
    }
    for (const pd of this.pendulums) pd.mesh.quaternion.setFromAxisAngle(pd.def.fwd, -pendulumAngle(pd.def, this.clock));
    // 崩塌木板：警告時閃爍、消失時只剩虛影
    for (const sg of this.segs) {
      if (sg.mech?.type !== 'vanish') continue;
      sg.view.visible = sg.solid && !(sg.warn && Math.floor(t * 10) % 2);
      sg.ghost.visible = !sg.solid;
    }
    for (const b of this.boosterMeshes) b.mat.emissiveIntensity = 0.6 + 0.9 * Math.max(0, Math.sin(t * 8 - b.k * 0.9));
    for (const w of this.windFx) {
      const gust = windGust(this.clock);
      w.blades.rotation.z += dt * 18 * gust;
      for (const st of w.streaks) {
        st.u += dt * 0.9 * gust;
        if (st.u > 1) st.u -= 1;
        st.m.position.copy(st.base).addScaledVector(w.def.dir, -2.2 + st.u * 4.4);
      }
    }
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
    for (const c of this.checkpoints) c.flag.cloth.rotation.y = Math.sin(t * 4 + c.s) * 0.25;
    for (const c of this.clouds) c.position.x += dt * 1.5;
  }

  get speed() { return this.sim ? this.sim.speed : 0; }
  get grounded() { return this.sim ? this.sim.onTrack : false; }
  get danger() { return this.state === 'play' && this.sim.onTrack ? this.sim.danger : 0; }
}

// ------------------------------------------------------------------ 幾何
// 建網格用的取樣點：每 0.2 取一點（含最後一點）
function sampleIds(tr) {
  const step = Math.max(1, Math.round(0.2 / tr.ds));
  const ids = [];
  for (let i = 0; i < tr.N; i += step) ids.push(i);
  if (ids[ids.length - 1] !== tr.N - 1) ids.push(tr.N - 1);
  return ids;
}

// 沿軌道的管子；radial = 4 且 rot = π/4 時是方形木樑
function tubeMesh(tr, centerFn, radius, radial, material, rot = 0) {
  const pos = [], nor = [], uv = [], idx = [];
  const c = new THREE.Vector3(), n = new THREE.Vector3();
  const ids = sampleIds(tr);
  ids.forEach((i, j) => {
    centerFn(i, c);
    const base = pos.length / 3;
    for (let r = 0; r <= radial; r++) {
      const a = (r / radial) * Math.PI * 2 + rot;
      n.copy(tr.B[i]).multiplyScalar(Math.cos(a)).addScaledVector(tr.U[i], Math.sin(a));
      pos.push(c.x + n.x * radius, c.y + n.y * radius, c.z + n.z * radius);
      nor.push(n.x, n.y, n.z);
      uv.push(i * tr.ds, r / radial);
    }
    if (j > 0) {
      const prev = base - (radial + 1);
      for (let r = 0; r < radial; r++) idx.push(prev + r, base + r, prev + r + 1, prev + r + 1, base + r, base + r + 1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  return m;
}

// 沿軌道一側的直立木板（護欄）
function ribbonMesh(tr, side, h0, h1, material) {
  const pos = [], nor = [], uv = [], idx = [];
  const p = new THREE.Vector3();
  const ids = sampleIds(tr);
  ids.forEach((i, j) => {
    for (const h of [h0, h1]) {
      p.copy(tr.P[i]).addScaledVector(tr.B[i], side).addScaledVector(tr.U[i], h);
      pos.push(p.x, p.y, p.z);
      const n = tr.B[i].clone().multiplyScalar(Math.sign(side));
      nor.push(n.x, n.y, n.z);
      uv.push((i * tr.ds) / 1.5, h === h0 ? 0 : 0.25);
    }
    if (j > 0) {
      const a = (j - 1) * 2, b = j * 2;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------ 程序化貼圖
function canvasTex(w, h, draw, repeat = true) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 木紋（淺色，讓 instance 顏色可以上色）
function plankTexture() {
  return canvasTex(256, 64, (g, W, H) => {
    g.fillStyle = '#e9d2b0';
    g.fillRect(0, 0, W, H);
    for (let k = 0; k < 40; k++) {
      const y0 = Math.random() * H;
      g.strokeStyle = `rgba(${Math.random() < 0.5 ? '120,80,40' : '255,240,210'},${0.15 + Math.random() * 0.25})`;
      g.lineWidth = 0.5 + Math.random() * 1.2;
      g.beginPath();
      const amp = 0.5 + Math.random() * 2, fr = 0.02 + Math.random() * 0.04, off = Math.random() * 10;
      for (let x = 0; x <= W; x += 6) { const y = y0 + Math.sin(x * fr + off) * amp; x ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    }
    g.fillStyle = 'rgba(90,55,25,0.5)';
    g.fillRect(0, 0, W, 2);
    g.fillRect(0, H - 2, W, 2);
    // 釘子
    g.fillStyle = 'rgba(60,60,60,0.8)';
    for (const x of [10, W - 10]) for (const y of [H * 0.3, H * 0.7]) { g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fill(); }
  });
}

function beamTexture() {
  return canvasTex(64, 256, (g, W, H) => {
    g.fillStyle = '#e8dcc6';
    g.fillRect(0, 0, W, H);
    for (let k = 0; k < 24; k++) {
      const x0 = Math.random() * W;
      g.strokeStyle = `rgba(110,80,50,${0.1 + Math.random() * 0.2})`;
      g.lineWidth = 0.5 + Math.random();
      g.beginPath();
      for (let y = 0; y <= H; y += 8) { const x = x0 + Math.sin(y * 0.03 + k) * 1.5; y ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    }
  });
}

function grassTexture() {
  return canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = '#5f9e3f';
    g.fillRect(0, 0, W, H);
    // 割草條紋
    for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'; g.fillRect(0, i * H / 4, W, H / 4); }
    const img = g.getImageData(0, 0, W, H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 30;
      d[i] += n * 0.6; d[i + 1] += n; d[i + 2] += n * 0.4;
    }
    g.putImageData(img, 0, 0);
    for (let k = 0; k < 500; k++) {
      g.strokeStyle = `rgba(${Math.random() < 0.5 ? '40,90,30' : '140,200,90'},0.5)`;
      g.lineWidth = 1;
      const x = Math.random() * W, y = Math.random() * H;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 3, y - 3 - Math.random() * 3); g.stroke();
    }
    // 小花
    for (let k = 0; k < 12; k++) {
      g.fillStyle = ['#fff', '#ffe066', '#ff8fb1'][k % 3];
      g.beginPath(); g.arc(Math.random() * W, Math.random() * H, 1.5, 0, Math.PI * 2); g.fill();
    }
  });
}

function cloudTexture() {
  return canvasTex(256, 128, (g, W, H) => {
    for (let k = 0; k < 14; k++) {
      const x = W * (0.2 + Math.random() * 0.6), y = H * (0.45 + Math.random() * 0.25), r = 18 + Math.random() * 28;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.95)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  }, false);
}

function bannerTexture() {
  return canvasTex(256, 64, (g, W, H) => {
    const s = 8;
    for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) {
      g.fillStyle = ((x + y) / s) % 2 ? '#111' : '#fff';
      g.fillRect(x, y, s, s);
    }
    g.fillStyle = 'rgba(232,40,60,0.92)';
    g.fillRect(W * 0.22, 6, W * 0.56, H - 12);
    g.fillStyle = '#fff';
    g.font = 'bold 34px "PingFang TC","Noto Sans TC",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('終 點', W / 2, H / 2 + 1);
  }, false);
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
