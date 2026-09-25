// 關卡：多層木造雙軌迷宮
// Builder 畫筆：straight 直線、turn 彎道、hill 山丘、dip 凹谷、gap 小間隙、
//               turntable 旋轉轉盤、bridge 移動橋（slide 滑動 / lift 升降）、sweeper 旋轉掃桿
// 起點朝 +x（畫面右方）；每一排走到底後迴轉到離鏡頭更近、更低的一排。
import { Builder } from './track.js';

export const LEVELS = [
  // ---------------------------------------------------------------- 1
  {
    name: '入門迴廊', desc: '左右傾讓珠子前進，迴轉時往畫面下方傾',
    build: () => new Builder(-10, 3, -6)
      .straight(5, -0.2).hill(10, 0.6).gem(0, 5).straight(5, -0.1)
      .turn(180, 2, -0.8)
      .straight(3).checkpoint().dip(11, 0.7).straight(6, -0.3).gem(0, 3)
      .turn(-180, 2, -0.8)
      .straight(3).hill(10, 0.6).gem(0, 5).straight(5)
      .finish(),
  },
  // ---------------------------------------------------------------- 2
  {
    name: '階梯瀑布', desc: '階梯、S 彎與小山丘',
    build: () => new Builder(-10, 5, -7)
      .straight(6).straight(4, -0.8).straight(6).gem(0, 3).straight(4)
      .turn(180, 2, -0.6)
      .straight(2).checkpoint().straight(4)
      .turn(-30, 3).turn(60, 3, -0.4).gem(0, 1.5).turn(-30, 3).straight(5)
      .turn(-180, 2, -0.6)
      .straight(2).checkpoint().straight(3).straight(4, -0.8).straight(2).hill(8, 0.5).gem(0, 4).straight(2)
      .turn(180, 2, -0.6)
      .straight(3).dip(12, 0.8).gem(0, 6).straight(4, -0.3)
      .finish(),
  },
  // ---------------------------------------------------------------- 3
  {
    name: '小小缺口', desc: '衝一點速度跳過軌道缺口',
    build: () => new Builder(-10, 5, -7)
      .straight(7, -0.2).gap(0.9, -0.25).straight(5).gap(1.1, -0.3).straight(6).gem(0, 3)
      .turn(180, 2, -0.6)
      .straight(2).checkpoint().hill(7, 0.4).straight(2).gap(1.3, -0.3).straight(5).gap(1.5, -0.35).straight(4).gem(0, 2)
      .turn(-180, 2, -0.6)
      .straight(2).checkpoint().straight(3).gap(1.2, -0.3).dip(8, 0.5).gap(1.6, -0.4).straight(4).gap(1.0, -0.2).straight(4).gem(0, 2)
      .finish(),
  },
  // ---------------------------------------------------------------- 4
  {
    name: '旋轉掃桿', desc: '等掃桿掃過再衝，被打到會掉下去',
    build: () => new Builder(-10, 5, -7)
      .straight(7).sweeper(1, 1.2).straight(7).gem(0, 2).straight(6)
      .turn(180, 2, -0.6)
      .straight(2).checkpoint().straight(5).sweeper(1, -1.3).straight(6).sweeper(-1, 1.4, 1.5).straight(6).gem(0, 3)
      .turn(-180, 2, -0.6)
      .straight(2).checkpoint().hill(9, 0.6).straight(5).sweeper(1, 1.5).straight(7).gem(0, 4)
      .finish(),
  },
  // ---------------------------------------------------------------- 5
  {
    name: '移動橋', desc: '橋對齊時才能通過，太早衝會掉下去',
    build: () => new Builder(-10, 5, -7)
      .straight(1).hill(7, 0.4).straight(4).bridge(3, 'slide', 1.6).straight(8).gem(0, 3)
      .turn(180, 2, -0.6)
      .straight(2).checkpoint().straight(4).bridge(3, 'lift', 1.5).straight(6).gem(0, 3).bridge(3, 'slide', -1.6, { phase: 1.7 }).straight(3)
      .turn(-180, 2, -0.6)
      .straight(2).checkpoint().straight(5).bridge(4, 'lift', -1.2, { phase: 0.8 }).straight(2).dip(10, 0.6).gem(0, 5)
      .finish(),
  },
  // ---------------------------------------------------------------- 6
  {
    name: '旋轉轉盤', desc: '轉盤對齊時滾上去，轉到出口再滾出來',
    build: () => new Builder(-10, 4, -7)
      .straight(3).hill(10, 0.6).gem(0, 5).straight(5, -0.4)
      .turntable(1.2, 90).straight(2.4).turntable(1.2, 90, { phase: 1.4 })
      .straight(2).checkpoint().dip(11, 0.7).gem(0, 5.5).straight(3, -0.4)
      .turntable(1.2, -90, { phase: 0.7 }).straight(2.4).turntable(1.2, -90, { phase: 2.1 })
      .straight(2).checkpoint().straight(2).hill(9, 0.6).gem(0, 4.5).straight(3, -0.4)
      .turntable(1.2, 90, { phase: 0.3 }).straight(2.4).turntable(1.2, 90, { phase: 1.9 })
      .straight(16, -0.4)
      .finish(),
  },
  // ---------------------------------------------------------------- 7
  {
    name: '機關組合', desc: '缺口、掃桿、移動橋輪番上陣',
    build: () => new Builder(-10, 5, -7)
      .straight(5).sweeper(1, 1.3).straight(6).gap(1.2, -0.3).straight(8).gem(0, 3)
      .turn(180, 2, -0.6)
      .straight(2).checkpoint().straight(4).bridge(3, 'slide', 1.6).straight(4).gap(1.3, -0.3).straight(6).gem(0, 2)
      .turn(-180, 2, -0.6)
      .straight(2).checkpoint().straight(4).sweeper(-1, -1.4).straight(4).bridge(3, 'lift', -1.2, { phase: 1 }).straight(2).dip(10, 0.6).gem(0, 5)
      .finish(),
  },
  // ---------------------------------------------------------------- 8
  {
    name: '星際迴廊', desc: '所有機關一次登場',
    build: () => new Builder(-10, 7, -9)
      .straight(4).sweeper(1, 1.4).straight(6).gap(1.2, -0.3).straight(8).gem(0, 3)
      .turntable(1.2, 90).straight(2.4).turntable(1.2, 90, { phase: 1.4 })
      .straight(2).checkpoint().straight(3).bridge(3, 'lift', 1.4).straight(4).gap(1.4, -0.35).straight(5).gem(0, 2)
      .turn(-180, 2, -0.6)
      .straight(2).checkpoint().straight(4).sweeper(1, -1.5).straight(4).bridge(3, 'slide', 1.6, { phase: 0.9 }).straight(5).gem(0, 2)
      .turntable(1.2, 90, { phase: 0.5 }).straight(2.4).turntable(1.2, 90, { phase: 2.0 })
      .straight(2).checkpoint().straight(3).sweeper(-1, 1.6, 1).straight(5).gap(1.5, -0.35).straight(6).gem(0, 3)
      .finish(),
  },
  // ---------------------------------------------------------------- 9
  {
    name: '過山車', desc: '大起大落：借下坡的衝力衝上山頂',
    build: () => new Builder(-10, 6, -7)
      .straight(3).straight(5, -1.5).hill(7, 1.0).gem(0, 3.5).straight(1).dip(12, 0.8).straight(1)
      .turn(180, 2, -0.5)
      .straight(2).checkpoint().straight(3, -0.8).hill(8, 0.8).gem(0, 4).dip(12, 0.8).straight(1)
      .turn(-180, 2, -0.5)
      .straight(2).checkpoint().straight(2).straight(4, -1.2).hill(8, 1.0).gem(0, 4).straight(1).dip(12, 0.7).straight(3)
      .finish(),
  },
  // ---------------------------------------------------------------- 10
  {
    name: '起伏缺口', desc: '起伏中飛越缺口，再搭轉盤',
    build: () => new Builder(-10, 6, -7)
      .straight(3).straight(4, -1.2).straight(2).gap(1.4, -0.3).hill(8, 0.7).gem(0, 4).straight(5)
      .turntable(1.2, 90).straight(2.4).turntable(1.2, 90, { phase: 1.4 })
      .straight(2).checkpoint().dip(12, 0.8).straight(3).gap(1.6, -0.35).straight(3).hill(8, 0.6).gem(0, 4).straight(2)
      .turn(-180, 2, -0.6)
      .straight(2).checkpoint().straight(3, -0.8).gap(1.5, -0.3).straight(2).dip(12, 0.8).gem(0, 6).straight(3)
      .finish(),
  },
  // ---------------------------------------------------------------- 11
  {
    name: '高低落差', desc: '升降台、斜坡與掃桿連環考驗',
    build: () => new Builder(-10, 7, -7)
      .straight(3).straight(4, -1.2).sweeper(1, 1.5).straight(4).bridge(3, 'lift', 1.8, { hold0: 1.8 }).straight(2).hill(10, 0.6).gem(0, 5).straight(2)
      .turn(180, 2, -0.6)
      .straight(2).checkpoint().straight(3).bridge(3, 'slide', 1.6, { phase: 0.6, hold0: 1.8 }).straight(2).dip(12, 0.8).straight(3).sweeper(-1, -1.6).straight(4).gap(1.5, -0.35).straight(3)
      .turn(-180, 2, -0.6)
      .straight(2).checkpoint().hill(10, 0.6).gem(0, 5).straight(4).bridge(3, 'lift', -1.4, { phase: 1.2 }).straight(4).sweeper(1, 1.8).straight(5).gem(0, 2)
      .finish(),
  },
  // ---------------------------------------------------------------- 12
  {
    name: '終極大冒險', desc: '起伏加上所有機關的最終挑戰',
    build: () => new Builder(-10, 8, -9)
      .straight(3).straight(4, -1.5).hill(6, 0.8).straight(7).sweeper(1, 1.6).straight(4).gap(1.4, -0.3).straight(6).gem(0, 3)
      .turntable(1.2, 90).straight(2.4).turntable(1.2, 90, { phase: 1.4 })
      .straight(2).checkpoint().dip(12, 0.8).gem(0, 6).straight(2).bridge(3, 'lift', 1.6, { phase: 0.4 }).straight(5).gap(1.6, -0.35).straight(3)
      .turn(-180, 2, -0.6)
      .straight(2).checkpoint().straight(3, -0.8).hill(8, 0.8).straight(6).sweeper(1, -1.6).straight(4).bridge(3, 'slide', 1.6, { phase: 1.1 }).straight(3).gem(0, 1.5)
      .turntable(1.2, 90, { phase: 0.5 }).straight(2.4).turntable(1.2, 90, { phase: 2.0 })
      .straight(2).checkpoint().dip(12, 0.8).straight(3).sweeper(-1, 1.8, 1).straight(4).gap(1.7, -0.4).straight(3).hill(8, 0.6).straight(3).gem(0, 2)
      .finish(),
  },
];

// 每關晶石數（顯示用）
for (const lv of LEVELS) lv.gemTotal = lv.build().gems.length;
