// 傾斜輸入：手機陀螺儀（DeviceOrientation），電腦則用方向鍵 / 滑鼠拖曳
export const MAX_TILT = 22 * Math.PI / 180;
const DEG = Math.PI / 180;

export class TiltInput {
  constructor() {
    this.sens = 1;
    this.tx = 0; // 目標傾斜：繞 x 軸（前後）
    this.tz = 0; // 目標傾斜：繞 z 軸（左右）
    this.x = 0;  // 平滑後的傾斜
    this.z = 0;
    this.hasGyro = false;
    this.raw = null;   // 最近一次 { fb, lr }（度）
    this.base = null;  // 校正基準
    this.keys = new Set();
    this.drag = null;
    this.dragTilt = { x: 0, z: 0 };

    this._onOrient = (e) => this.onOrient(e);
    addEventListener('keydown', (e) => { this.keys.add(e.key.toLowerCase()); });
    addEventListener('keyup', (e) => { this.keys.delete(e.key.toLowerCase()); });

    const cv = document.getElementById('game');
    cv.addEventListener('pointerdown', (e) => {
      if (this.hasGyro) return;
      this.drag = { x: e.clientX, y: e.clientY };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const s = Math.min(innerWidth, innerHeight) * 0.3;
      this.dragTilt.z = -clamp((e.clientX - this.drag.x) / s, -1, 1) * MAX_TILT;
      this.dragTilt.x = clamp((e.clientY - this.drag.y) / s, -1, 1) * MAX_TILT;
    });
    const end = () => { this.drag = null; this.dragTilt.x = 0; this.dragTilt.z = 0; };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }

  // 必須在使用者點擊事件中呼叫（iOS 需要授權）
  async requestPermission() {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return false;
    try {
      if (typeof DOE.requestPermission === 'function') {
        const res = await DOE.requestPermission();
        if (res !== 'granted') return false;
      }
      addEventListener('deviceorientation', this._onOrient);
      return true;
    } catch {
      return false;
    }
  }

  onOrient(e) {
    if (e.beta == null || e.gamma == null) return;
    this.hasGyro = true;
    const angle = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
    let fb = e.beta, lr = e.gamma;
    if (angle === 90) { fb = -e.gamma; lr = e.beta; }
    else if (angle === -90 || angle === 270) { fb = e.gamma; lr = -e.beta; }
    this.raw = { fb, lr };
    if (!this.base) this.calibrate();
  }

  // 以目前手機姿勢作為「水平」
  calibrate() {
    if (this.raw) this.base = { ...this.raw };
  }

  update(dt) {
    let tx = 0, tz = 0;
    if (this.hasGyro && this.raw && this.base) {
      // 前傾（上緣往外）beta 變小 → 遠端下沉 → 繞 x 負轉
      tx = (this.raw.fb - this.base.fb) * DEG * this.sens;
      // 右傾 gamma 變大 → 右側下沉 → 繞 z 負轉
      tz = -(this.raw.lr - this.base.lr) * DEG * this.sens;
    }
    const k = this.keys;
    if (k.has('arrowup') || k.has('w')) tx -= MAX_TILT;
    if (k.has('arrowdown') || k.has('s')) tx += MAX_TILT;
    if (k.has('arrowleft') || k.has('a')) tz += MAX_TILT;
    if (k.has('arrowright') || k.has('d')) tz -= MAX_TILT;
    tx += this.dragTilt.x;
    tz += this.dragTilt.z;

    this.tx = clamp(tx, -MAX_TILT, MAX_TILT);
    this.tz = clamp(tz, -MAX_TILT, MAX_TILT);
    const a = 1 - Math.exp(-dt * 14);
    this.x += (this.tx - this.x) * a;
    this.z += (this.tz - this.z) * a;
  }

  reset() { this.x = this.z = 0; }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
