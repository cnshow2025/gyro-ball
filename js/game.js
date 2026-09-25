// 3D 場景 + 物理
// 做法：物理世界固定不動，把「重力方向」依手機傾斜反向旋轉；
// 畫面上則把整個關卡繞著鋼珠旋轉，看起來就是軌道在傾斜。
import * as THREE from 'three';
import * as CANNON from '../vendor/cannon-es.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';

const BALL_R = 0.35;
const GRAVITY = 22;
const STEP = 1 / 120;
const MAX_SPEED = 16;

export class Game {
  constructor(canvas, input, events) {
    this.input = input;
    this.ev = events;
    this.state = 'idle';
    this.levelIndex = 0;
    this.time = 0;
    this.gemCount = 0;
    this.falls = 0;
    this.clock = 0; // 物理時間（驅動機關）
    this.acc = 0;
    this.lastHit = 0;

    this.initRenderer(canvas);
    this.initScene();
    this.initPhysics();
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
    scene.fog = new THREE.Fog(0x05070f, 30, 90);
    this.scene = scene;

    // 環境反射：室內光 + 霓虹燈條，讓鋼珠有科幻金屬反光
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

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
    this.camera.position.set(0, 7, 10);
    this.camTarget = new THREE.Vector3();

    scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x2a1030, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -14; sc.right = sc.top = 14; sc.near = 1; sc.far = 50;
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);
    this.sun = sun;

    this.pivot = new THREE.Group();   // 傾斜中心（跟著鋼珠）
    this.levelRoot = new THREE.Group(); // 關卡本體（物理座標）
    this.pivot.add(this.levelRoot);
    scene.add(this.pivot);

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
      const v = new THREE.Vector3().randomDirection().multiplyScalar(150 + Math.random() * 100);
      if (v.y < -40) v.y *= -0.5;
      pos.set([v.x, v.y, v.z], i * 3);
      c.setHSL(0.55 + Math.random() * 0.35, 0.6, 0.6 + Math.random() * 0.4);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({
      size: 1.3, vertexColors: true, fog: false, transparent: true, opacity: 0.9, depthWrite: false,
    }));
    this.scene.add(this.stars);

    // 星雲
    this.glowTex = radialTexture();
    const nebula = new THREE.Group();
    [[0x3355ff, -80, 30, -160, 140], [0xaa33ff, 90, 10, -140, 120], [0x00aacc, 20, -40, -180, 160]].forEach(([color, x, y, z, s]) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTex, color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, fog: false, depthWrite: false,
      }));
      sp.position.set(x, y, z);
      sp.scale.set(s, s, 1);
      nebula.add(sp);
    });
    this.nebula = nebula;
    this.scene.add(nebula);

    // 深淵下方的霓虹網格
    const grid = new THREE.GridHelper(400, 100, 0x2a6cff, 0x12305a);
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
      wood: new THREE.MeshStandardMaterial({ map: wood, bumpMap: wood, bumpScale: 1.5, roughness: 0.7, metalness: 0.05, envMapIntensity: 0.5 }),
      stone: new THREE.MeshStandardMaterial({ map: stone, bumpMap: stone, bumpScale: 2, roughness: 0.85, metalness: 0.1, envMapIntensity: 0.5 }),
      rail: new THREE.MeshStandardMaterial({ color: 0x1c2a3a, metalness: 0.85, roughness: 0.3, emissive: 0x06303c }),
      railGlow: new THREE.MeshBasicMaterial({ color: 0x4fe3ff }),
      mover: new THREE.MeshStandardMaterial({ color: 0x9aa8b8, metalness: 0.9, roughness: 0.35, emissive: 0x221100 }),
      spinner: new THREE.MeshStandardMaterial({ color: 0xff2a50, metalness: 0.5, roughness: 0.3, emissive: 0xaa0022, emissiveIntensity: 0.9 }),
      pillar: new THREE.MeshStandardMaterial({ color: 0x333a44, metalness: 0.9, roughness: 0.3 }),
      edge: new THREE.LineBasicMaterial({ color: 0x4fe3ff, transparent: true, opacity: 0.75 }),
      edgeWarn: new THREE.LineBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.9 }),
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

    // 腳下光暈
    this.ballGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTex, color: 0x4fe3ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.ballGlow.scale.set(1.8, 1.8, 1);
  }

  initPhysics() {
    const w = new CANNON.World({ gravity: new CANNON.Vec3(0, -GRAVITY, 0) });
    w.broadphase = new CANNON.NaiveBroadphase();
    w.solver.iterations = 12;
    w.allowSleep = false;
    this.world = w;

    this.pmBall = new CANNON.Material('ball');
    this.pmTrack = new CANNON.Material('track');
    this.pmRail = new CANNON.Material('rail');
    w.addContactMaterial(new CANNON.ContactMaterial(this.pmBall, this.pmTrack, { friction: 0.45, restitution: 0.15 }));
    w.addContactMaterial(new CANNON.ContactMaterial(this.pmBall, this.pmRail, { friction: 0.1, restitution: 0.45 }));

    const ball = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(BALL_R), material: this.pmBall });
    ball.linearDamping = 0.08;
    ball.angularDamping = 0.12;
    ball.addEventListener('collide', (e) => {
      if (this.state !== 'play') return;
      const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
      const now = performance.now();
      if (v > 3 && now - this.lastHit > 90) {
        this.lastHit = now;
        this.ev.onHit?.(Math.min(v / 12, 1));
      }
    });
    this.ball = ball;
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 直向螢幕視野較窄，把 FOV 放大一點
    this.camera.fov = w < h ? 62 : 50;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ 關卡
  loadLevel(level, index) {
    this.clearLevel();
    this.level = level;
    this.levelIndex = index;
    this.movers = [];
    this.spinners = [];
    this.gems = [];
    this.checkpoints = [];
    const defMat = level.mat || 'wood';
    let minY = Infinity;

    for (const p of level.pieces) {
      if (p.type === 'box' || p.type === 'ramp') {
        const isRail = p.kind === 'rail';
        const mesh = this.boxMesh(p.size, isRail ? this.mats.rail : this.mats[p.mat || defMat], !isRail);
        const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(...p.size.map((s) => s / 2))), material: isRail ? this.pmRail : this.pmTrack });
        if (p.type === 'ramp') {
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.euler[0], p.euler[1], p.euler[2], 'YXZ'));
          const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
          const c = new THREE.Vector3(...p.mid).addScaledVector(up, -p.size[1] / 2);
          mesh.position.copy(c);
          mesh.quaternion.copy(q);
          body.position.set(c.x, c.y, c.z);
          body.quaternion.set(q.x, q.y, q.z, q.w);
          minY = Math.min(minY, p.mid[1] - Math.abs(p.size[2] * up.z) / 2);
        } else {
          mesh.position.set(...p.pos);
          body.position.set(...p.pos);
          if (!isRail) minY = Math.min(minY, p.pos[1]);
        }
        if (isRail) {
          const strip = new THREE.Mesh(new THREE.BoxGeometry(p.size[0] * 0.98, 0.04, p.size[2] * 0.98).scale(p.size[0] > p.size[2] ? 1 : 0.4, 1, p.size[0] > p.size[2] ? 0.4 : 1), this.mats.railGlow);
          strip.position.y = p.size[1] / 2 + 0.02;
          mesh.add(strip);
        }
        this.levelRoot.add(mesh);
        this.world.addBody(body);
      } else if (p.type === 'mover') {
        const mesh = this.boxMesh(p.size, this.mats.mover, true, this.mats.edgeWarn);
        const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, shape: new CANNON.Box(new CANNON.Vec3(...p.size.map((s) => s / 2))), material: this.pmTrack });
        this.levelRoot.add(mesh);
        this.world.addBody(body);
        this.movers.push({ p, mesh, body });
        minY = Math.min(minY, p.pos[1]);
      } else if (p.type === 'spinner') {
        const group = new THREE.Group();
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.7, 16), this.mats.pillar);
        pillar.castShadow = true;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(p.len, 0.4, 0.28), this.mats.spinner);
        bar.castShadow = true;
        group.add(pillar, bar);
        group.position.set(...p.pos);
        const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: this.pmRail });
        body.addShape(new CANNON.Box(new CANNON.Vec3(p.len / 2, 0.2, 0.14)));
        body.position.set(...p.pos);
        this.levelRoot.add(group);
        this.world.addBody(body);
        this.spinners.push({ p, mesh: group, body });
      }
    }
    this.killY = minY - 7;

    // 晶石
    for (const g of level.gems) {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.26), this.mats.gem);
      m.castShadow = true;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffb030, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.set(1.3, 1.3, 1);
      m.add(glow);
      m.position.set(...g);
      this.levelRoot.add(m);
      this.gems.push({ pos: new THREE.Vector3(...g), mesh: m, taken: false, fade: 0 });
    }

    // 檢查點
    for (const c of level.checkpoints) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 40), new THREE.MeshBasicMaterial({ color: 0x4fe3ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(c[0], c[1] + 0.02, c[2]);
      this.levelRoot.add(ring);
      this.checkpoints.push({ pos: new THREE.Vector3(...c), mesh: ring, active: false });
    }

    this.makeGoal(level.goal);
    this.levelRoot.add(this.ballMesh, this.ballGlow);
    this.resetRun();
  }

  makeGoal(gp) {
    const g = new THREE.Group();
    g.position.set(...gp);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.02;
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x4fe3ff, emissive: 0x4fe3ff, emissiveIntensity: 1.5, metalness: 0.8, roughness: 0.2 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.07, 12, 64), ringMat);
    ring.position.y = 1.1;
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.04, 8, 48), new THREE.MeshBasicMaterial({ color: 0xff4fd8 }));
    ring2.position.y = 1.1;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 6, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x4fe3ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.y = 3;
    const light = new THREE.PointLight(0xff4fd8, 6, 8, 1.5);
    light.position.y = 1.2;
    g.add(disc, ring, ring2, beam, light);
    this.levelRoot.add(g);
    this.goal = { pos: new THREE.Vector3(...gp), group: g, ring, ring2, disc };
  }

  // 建立方塊，並依實際尺寸縮放 UV（避免貼圖拉伸），附上霓虹描邊
  boxMesh(size, material, edges = true, edgeMat = this.mats.edge) {
    const [w, h, d] = size;
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv;
    const S = 2; // 每 2 單位重複一次貼圖
    const faceDims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, uv.getX(i) * faceDims[f][0] / S, uv.getY(i) * faceDims[f][1] / S);
      }
    }
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (edges) mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
    return mesh;
  }

  clearLevel() {
    for (const b of [...this.world.bodies]) this.world.removeBody(b);
    this.levelRoot.traverse((o) => {
      if (o === this.ballMesh || o === this.ballGlow) return;
      o.geometry?.dispose();
    });
    this.levelRoot.clear();
  }

  // 重設本關（回到起點、計時歸零）
  resetRun() {
    this.time = 0;
    this.gemCount = 0;
    this.falls = 0;
    this.clock = 0;
    this.acc = 0;
    this.fallingNotified = false;
    this.respawnPoint = new THREE.Vector3(...this.level.start);
    for (const g of this.gems) { g.taken = false; g.fade = 0; g.mesh.visible = true; g.mesh.scale.setScalar(1); }
    for (const c of this.checkpoints) { c.active = false; c.mesh.material.color.set(0x4fe3ff); }
    this.placeBall(this.respawnPoint);
    this.input.reset();
    this.carrier = null;
    for (const m of this.movers) m.last = null;
    this.updateKinematics(0);
    this.snapCamera();
  }

  placeBall(p) {
    const b = this.ball;
    if (!this.world.bodies.includes(b)) this.world.addBody(b);
    b.position.set(p.x, p.y, p.z);
    b.velocity.setZero();
    b.angularVelocity.setZero();
    b.quaternion.set(0, 0, 0, 1);
    this.ballMesh.scale.setScalar(1);
    this.syncBall();
  }

  // ------------------------------------------------------------------ 狀態控制
  setState(s) { this.state = s; }

  // ------------------------------------------------------------------ 主迴圈
  update(dt) {
    dt = Math.min(dt, 0.05);
    const s = this.state;

    if (s === 'play' || s === 'falling') {
      this.input.update(dt);
      this.time += dt;
      this.applyTilt();
      this.acc += dt;
      let grounded = false;
      while (this.acc >= STEP) {
        this.updateKinematics(this.clock);
        // 站在移動平台上：跟著平台一起移動
        if (this.carrier) {
          const d = this.carrier.delta;
          this.ball.position.x += d[0];
          this.ball.position.z += d[2];
        }
        this.world.step(STEP);
        this.clock += STEP;
        this.acc -= STEP;
        const v = this.ball.velocity;
        const sp = v.length();
        if (sp > MAX_SPEED) v.scale(MAX_SPEED / sp, v);
        this.carrier = null;
        for (const c of this.world.contacts) {
          if (c.bi !== this.ball && c.bj !== this.ball) continue;
          grounded = true;
          const other = c.bi === this.ball ? c.bj : c.bi;
          const m = this.movers.find((mv) => mv.body === other);
          if (m) this.carrier = m;
        }
      }
      this.grounded = grounded;
      this.syncBall();
      if (s === 'play') this.checkTriggers();
      else {
        this.fallTimer -= dt;
        if (this.fallTimer <= 0) this.respawn();
      }
    } else if (s === 'won') {
      // 鋼珠被傳送門吸入
      this.winT += dt;
      const k = Math.min(this.winT / 0.8, 1);
      const p = this.ballMesh.position;
      p.lerp(new THREE.Vector3(this.goal.pos.x, this.goal.pos.y + 1.1, this.goal.pos.z), 0.08);
      this.ballMesh.scale.setScalar(1 - k * 0.9);
      this.ballGlow.position.copy(p);
      this.input.x *= 0.9; this.input.z *= 0.9;
      this.applyTilt();
    } else if (s === 'idle') {
      this.clock += dt;
      this.updateKinematics(this.clock);
      this.input.x *= 0.9; this.input.z *= 0.9;
      this.applyTilt();
    } else if (s === 'countdown') {
      this.input.update(dt); // 讓輸入保持最新，但不作用
    }

    this.animateProps(dt);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  applyTilt() {
    const x = this.input.x, z = this.input.z;
    this.pivot.rotation.set(x, 0, z);
    // 物理重力 = 世界向下方向轉換到關卡座標
    const g = new THREE.Vector3(0, -GRAVITY, 0).applyQuaternion(this.pivot.quaternion.clone().invert());
    this.world.gravity.set(g.x, g.y, g.z);
  }

  updateKinematics(t) {
    for (const m of this.movers) {
      const { p, body } = m;
      const w = (Math.PI * 2) / p.period;
      const off = p.amp * Math.sin(w * t + p.phase);
      const ax = p.axis === 'x' ? 0 : 2;
      const pos = [...p.pos];
      pos[ax] += off;
      // 平台以「瞬移」方式移動（速度設 0），鋼珠的跟隨由 carrier 處理，
      // 否則滾動的鋼珠會因慣性從平台上滑落
      m.delta = m.last ? pos.map((v, i) => v - m.last[i]) : [0, 0, 0];
      m.last = pos;
      body.position.set(...pos);
      body.velocity.setZero();
      m.mesh.position.set(...pos);
    }
    for (const sp of this.spinners) {
      const a = sp.p.speed * t;
      sp.body.quaternion.setFromEuler(0, a, 0);
      sp.body.angularVelocity.set(0, sp.p.speed, 0);
      sp.mesh.rotation.y = a;
    }
  }

  syncBall() {
    const b = this.ball;
    this.ballMesh.position.set(b.position.x, b.position.y, b.position.z);
    this.ballMesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    this.ballGlow.position.set(b.position.x, b.position.y - BALL_R + 0.05, b.position.z);
  }

  checkTriggers() {
    const bp = this.ballMesh.position;

    for (const g of this.gems) {
      if (!g.taken && bp.distanceTo(g.pos) < BALL_R + 0.4) {
        g.taken = true;
        this.gemCount++;
        this.ev.onGem?.(this.gemCount);
      }
    }

    for (const c of this.checkpoints) {
      if (!c.active && Math.hypot(bp.x - c.pos.x, bp.z - c.pos.z) < 1.1 && Math.abs(bp.y - c.pos.y - BALL_R) < 1) {
        c.active = true;
        c.mesh.material.color.set(0x5aff8a);
        this.respawnPoint = c.pos.clone().add(new THREE.Vector3(0, BALL_R + 0.2, 0));
        this.ev.onCheckpoint?.();
      }
    }

    const gp = this.goal.pos;
    if (Math.hypot(bp.x - gp.x, bp.z - gp.z) < 0.9 && Math.abs(bp.y - gp.y - BALL_R) < 0.6) {
      this.state = 'won';
      this.winT = 0;
      this.ev.onWin?.(this.time, this.gemCount, this.falls);
      return;
    }

    if (bp.y < this.killY) {
      this.state = 'falling';
      this.fallTimer = 0.2;
      this.ev.onFall?.();
    } else if (bp.y < this.killY + 5 && this.ball.velocity.y < -4) {
      // 已經掉出軌道：提早觸發，讓鏡頭停在上方
      if (!this.fallingNotified) {
        this.fallingNotified = true;
        this.state = 'falling';
        this.fallTimer = 1.0;
        this.ev.onFall?.();
      }
    }
  }

  respawn() {
    this.falls++;
    this.fallingNotified = false;
    this.placeBall(this.respawnPoint);
    this.input.reset();
    this.carrier = null;
    this.state = 'play';
    this.ev.onRespawn?.(this.falls);
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
        g.mesh.position.y = g.pos.y + Math.sin(t * 3 + g.pos.x) * 0.08;
      }
    }
    if (this.goal) {
      this.goal.ring.rotation.y = t * 0.8;
      this.goal.ring2.rotation.y = -t * 1.3;
      this.goal.ring2.rotation.x = Math.sin(t) * 0.4;
      this.goal.disc.material.opacity = 0.35 + Math.sin(t * 4) * 0.15;
    }
    for (const c of this.checkpoints) c.mesh.rotation.z = t;
    this.nebula.rotation.z = t * 0.01;
  }

  // 鏡頭跟隨鋼珠；關卡以鋼珠為中心傾斜
  focusPoint() {
    const p = this.ballMesh.position.clone();
    if (this.state === 'falling') p.y = Math.max(p.y, this.killY + 6);
    return p;
  }

  updateCamera(dt) {
    const p = this.focusPoint();
    this.pivot.position.copy(p);
    this.levelRoot.position.copy(p).negate();

    let desired;
    if (this.state === 'idle') {
      const t = performance.now() / 1000 * 0.15;
      desired = p.clone().add(new THREE.Vector3(Math.sin(t) * 11, 7, Math.cos(t) * 11));
    } else {
      desired = p.clone().add(new THREE.Vector3(0, 6.5, 7.5));
    }
    const k = 1 - Math.exp(-dt * 5);
    this.camera.position.lerp(desired, k);
    this.camTarget.lerp(p.clone().add(new THREE.Vector3(0, 0, this.state === 'idle' ? 0 : -2.5)), k);
    this.camera.lookAt(this.camTarget);

    this.sun.position.copy(p).add(new THREE.Vector3(6, 14, 5));
    this.sun.target.position.copy(p);
    this.stars.position.copy(this.camera.position);
    this.nebula.position.copy(this.camera.position);
    this.grid.position.set(Math.round(p.x / 4) * 4, (this.killY ?? -8) - 2, Math.round(p.z / 4) * 4);
  }

  snapCamera() {
    this.syncBall();
    const p = this.focusPoint();
    this.camera.position.copy(p).add(new THREE.Vector3(0, 6.5, 7.5));
    this.camTarget.copy(p).add(new THREE.Vector3(0, 0, -2.5));
  }

  get speed() { return this.ball.velocity.length(); }
}

// ------------------------------------------------------------------ 程序化貼圖
function canvasTex(size, draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function woodTexture() {
  return canvasTex(512, (g, S) => {
    const planks = 4;
    const ph = S / planks;
    for (let i = 0; i < planks; i++) {
      const hue = 24 + Math.random() * 6;
      const light = 30 + Math.random() * 10;
      g.fillStyle = `hsl(${hue},45%,${light}%)`;
      g.fillRect(0, i * ph, S, ph);
      // 木紋
      for (let k = 0; k < 40; k++) {
        const y0 = i * ph + Math.random() * ph;
        g.strokeStyle = `hsla(${hue},40%,${light + (Math.random() < 0.5 ? -12 : 10)}%,${0.25 + Math.random() * 0.3})`;
        g.lineWidth = 0.5 + Math.random() * 1.5;
        g.beginPath();
        const amp = 1 + Math.random() * 3, fr = 0.01 + Math.random() * 0.02, off = Math.random() * 10;
        for (let x = 0; x <= S; x += 8) {
          const y = y0 + Math.sin(x * fr + off) * amp;
          x ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      }
      // 木節
      if (Math.random() < 0.7) {
        const kx = Math.random() * S, ky = i * ph + ph / 2;
        g.fillStyle = `hsla(${hue},50%,18%,0.6)`;
        g.beginPath(); g.ellipse(kx, ky, 10, 4, 0, 0, Math.PI * 2); g.fill();
      }
      // 接縫
      g.fillStyle = 'rgba(20,10,5,0.8)';
      g.fillRect(0, i * ph, S, 3);
      const seam = Math.random() * S;
      g.fillRect(seam, i * ph, 3, ph);
    }
  });
}

function stoneTexture() {
  return canvasTex(512, (g, S) => {
    g.fillStyle = '#4c5563';
    g.fillRect(0, 0, S, S);
    const img = g.getImageData(0, 0, S, S);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 34;
      d[i] += n; d[i + 1] += n; d[i + 2] += n + 4;
    }
    g.putImageData(img, 0, 0);
    // 石斑
    for (let k = 0; k < 90; k++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '20,24,32' : '140,150,165'},${0.05 + Math.random() * 0.12})`;
      g.beginPath();
      g.arc(Math.random() * S, Math.random() * S, 6 + Math.random() * 40, 0, Math.PI * 2);
      g.fill();
    }
    // 石板分割（科幻刻線）
    const t = S / 2;
    g.strokeStyle = 'rgba(10,14,22,0.9)';
    g.lineWidth = 4;
    for (let i = 0; i <= 2; i++) {
      g.beginPath(); g.moveTo(0, i * t); g.lineTo(S, i * t); g.stroke();
      g.beginPath(); g.moveTo(i * t, 0); g.lineTo(i * t, S); g.stroke();
    }
    g.strokeStyle = 'rgba(79,227,255,0.35)';
    g.lineWidth = 1.5;
    g.strokeRect(12, 12, t - 24, t - 24);
    g.strokeRect(t + 12, t + 12, t - 24, t - 24);
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
