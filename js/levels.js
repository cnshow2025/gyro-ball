// 關卡：每關是一條連續的雲霄飛車雙軌
// 用 Path 畫筆描述：straight 直線、turn 彎道、hill 山丘、ramp 跳台、gap 斷橋、loop 迴圈
import { Path } from './track.js';

export const LEVELS = [
  // ---------------------------------------------------------------- 1
  {
    name: '啟航', desc: '緩坡與大彎道，熟悉前傾加速、後傾煞車', sleeper: 'wood',
    build: () => new Path(0, 10, 0)
      .straight(8)
      .straight(14, -3).gem(0, 5)
      .turn(90, 16, 0, 12)
      .hill(22, 2).gem(0, 11)
      .turn(-90, 16, -1, 12)
      .checkpoint()
      .straight(10, -2).gem(0, 3)
      .turn(60, 18, 0, 10)
      .hill(24, 2.5)
      .straight(16)
      .straight(10),
  },
  // ---------------------------------------------------------------- 2
  {
    name: '波浪', desc: '連續山丘，太快會騰空飛出', sleeper: 'wood',
    build: () => new Path(0, 14, 0)
      .straight(8)
      .straight(16, -5)
      .hill(18, 3).gem(0, 9)
      .hill(18, 3.5)
      .checkpoint()
      .straight(6)
      .turn(-120, 12, -1, 20).gem(0, 10)
      .hill(16, 2.5).gem(0, 8)
      .hill(20, 4)
      .checkpoint()
      .straight(6)
      .turn(100, 12, 0, 20)
      .straight(10, -2)
      .hill(18, 3).gem(0, 9)
      .straight(14)
      .straight(10),
  },
  // ---------------------------------------------------------------- 3
  {
    name: '飛躍斷橋', desc: '衝上跳台，飛越斷橋接回軌道', sleeper: 'stone',
    build: () => new Path(0, 16, 0)
      .straight(8)
      .straight(18, -6)
      .straight(6)
      .ramp(8, 2.2)
      .gap(8, -2).gem(1, 4)
      .straight(10, -1)
      .checkpoint()
      .straight(4)
      .turn(90, 14, -2, 15).gem(0, 10)
      .straight(12, -2)
      .ramp(6, 1.6)
      .gap(6, -1.5)
      .straight(8, -1)
      .checkpoint()
      .straight(4)
      .turn(-90, 12, 0, 18)
      .hill(16, 2).gem(0, 8)
      .straight(12)
      .straight(10),
  },
  // ---------------------------------------------------------------- 4
  {
    name: '急彎連橋', desc: '髮夾彎接連續斷橋，控速是關鍵', sleeper: 'stone',
    build: () => new Path(0, 18, 0)
      .straight(8)
      .straight(14, -5)
      .turn(80, 8, -1, 25).gem(0, 6)
      .turn(-80, 8, -1, 25)
      .checkpoint()
      .straight(8, -1)
      .ramp(6, 1.5)
      .gap(6, -1.5).gem(0.8, 3)
      .straight(4, -0.5)
      .ramp(5, 1.2)
      .gap(6, -1.5)
      .straight(8, -1)
      .checkpoint()
      .straight(4)
      .turn(-150, 9, -2, 25).gem(0, 10)
      .hill(14, 2)
      .turn(90, 8, 0, 25)
      .straight(10, -2)
      .ramp(6, 1.5)
      .gap(7, -2).gem(1, 3.5)
      .straight(10, -1)
      .straight(10),
  },
  // ---------------------------------------------------------------- 5
  {
    name: '星際迴廊', desc: '高空俯衝、垂直迴圈、螺旋與斷橋', sleeper: 'stone',
    build: () => new Path(0, 28, 0)
      .straight(8)
      .straight(24, -14).gem(0, 12)
      .straight(6)
      .loop(4, 2.5)
      .straight(8)
      .checkpoint()
      .straight(4)
      .turn(90, 12, 0, 20)
      .straight(12, -3)
      .ramp(6, 1.5)
      .gap(8, -2.5).gem(1, 4)
      .straight(8, -1)
      .checkpoint()
      .straight(4)
      .turn(-270, 8, -6, 25).gem(0, 15)
      .straight(10, -1)
      .hill(16, 2.5).gem(0, 8)
      .ramp(6, 1.5)
      .gap(7, -2)
      .straight(10, -1)
      .straight(10),
  },
];

// 每關晶石數（顯示用）
for (const lv of LEVELS) lv.gemTotal = lv.build().gems.length;
