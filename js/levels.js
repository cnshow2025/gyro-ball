// 關卡：木造雲霄飛車
// Builder 畫筆：straight 直線、turn 彎道（360 即螺旋盤旋）、hill 山丘、dip 凹谷、loop 垂直迴圈、
//               corkscrew 螺旋翻滾、gap 小間隙、turntable 旋轉轉盤、bridge 移動橋、sweeper 旋轉掃桿
// Builder(x, y, z, 起始方向, { bank: 彎道內傾角, grip: 抓地力 })：後面關卡內傾小、抓地力低，太快過彎會被甩出
import { Builder } from './track.js';

const EASY = { bank: 25, grip: 2.0 };
const MID = { bank: 12, grip: 1.4 };
const HARD = { bank: 4, grip: 1.0 };

export const LEVELS = [
  // ================================================================ 入門（彎道內傾多、不易被甩出）
  {
    name: '旋轉樓梯', desc: '螺旋盤旋一圈往下，熟悉傾斜手感',
    build: () => new Builder(-10, 6, -6, 90, EASY)
      .straight(6).gem(0, 3)
      .turn(90, 3, -0.5)
      .straight(2).checkpoint()
      .turn(360, 3, -2.4).gem(0, 9)
      .straight(2)
      .turn(-90, 3, -0.3)
      .turn(-40, 4).turn(80, 4, -0.4).gem(0, 2.8).turn(-40, 4)
      .hill(8, 0.6).gem(0, 4)
      .straight(3).checkpoint()
      .turn(90, 3, -0.4)
      .straight(8, -0.6)
      .finish(),
  },
  {
    name: '8 字交叉', desc: '軌道從自己底下穿過去',
    build: () => new Builder(-6, 8, -3, 90, EASY)
      .straight(6)
      .turn(-270, 3, -1.5).gem(0, 7)
      .straight(6, -1.5)
      .checkpoint()
      .turn(180, 3, -1.2).gem(0, 4.5)
      .straight(3)
      .turn(-90, 2.5, -0.3)
      .straight(5).gap(1.2, -0.3).straight(4).gem(0, 2)
      .turn(-90, 3, -0.3)
      .straight(2).checkpoint()
      .turn(-360, 2.6, -2.2).gem(0, 8)
      .straight(6)
      .finish(),
  },
  {
    name: '第一個迴圈', desc: '衝下坡、倒掛通過垂直迴圈',
    build: () => new Builder(-12, 8, -5, 90, EASY)
      .straight(3)
      .straight(8, -3.5).gem(0, 4)
      .straight(2)
      .loop(1.2, 1.3)
      .straight(3).checkpoint()
      .turn(180, 3, -0.8).gem(0, 4.5)
      .straight(6).gap(1.2, -0.3).straight(4).gem(0, 2)
      .turn(-90, 3, -0.3)
      .straight(2).checkpoint()
      .turn(-90, 3, -0.3)
      .hill(8, 0.7).gem(0, 4)
      .straight(6)
      .finish(),
  },
  {
    name: '翻滾列車', desc: '螺旋翻滾 360°，速度不夠會掉下來',
    build: () => new Builder(-12, 8, -5, 90, EASY)
      .straight(3)
      .straight(8, -3.5)
      .corkscrew(6, 1.0, 1).gem(0, 2)
      .straight(3).checkpoint()
      .turn(180, 3, -0.8)
      .straight(7).sweeper(1, 1.3).straight(5).gem(0, 3)
      .turn(-90, 3, -0.3)
      .straight(2).checkpoint()
      .turn(-360, 3, -2.0).gem(0, 9)
      .straight(3)
      .turn(90, 3)
      .straight(6).gem(0, 3)
      .finish(),
  },
  // ================================================================ 中級（彎道較平，太快會被甩出）
  {
    name: '交織軌道', desc: '上下交錯的軌道與移動橋',
    build: () => new Builder(-12, 9, -6, 90, MID)
      .straight(8, -0.8).gem(0, 4)
      .turn(90, 3, -0.6)
      .straight(3)
      .turn(90, 3, -0.8)
      .straight(4).bridge(3, 'slide', 1.6).straight(3)
      .turn(-90, 3, -0.8).gem(0, 4.5)
      .straight(2).checkpoint()
      .straight(6, -1.2)
      .turn(-90, 3, -0.6)
      .straight(10, -0.6).gem(0, 5)
      .turn(-90, 3, -0.4)
      .straight(2).checkpoint()
      .straight(4).bridge(3, 'lift', 1.4, { phase: 1 }).straight(4)
      .turn(90, 3).gem(0, 4.5)
      .straight(6)
      .finish(),
  },
  {
    name: '雙迴圈', desc: '連續兩個迴圈，中間還有缺口',
    build: () => new Builder(-14, 10, -6, 90, MID)
      .straight(3)
      .straight(8, -3.5)
      .loop(1.2, 1.3).gem(0, 1)
      .straight(3)
      .gap(1.3, -0.4)
      .straight(3, -1.0)
      .loop(1.2, -1.3)
      .straight(3).checkpoint()
      .turn(180, 3.5, -0.8).gem(0, 5.5)
      .straight(4).turntable(1.2, -90).straight(2.4).turntable(1.2, -90, { phase: 1.4 })
      .straight(2).checkpoint()
      .straight(8, -0.6).gem(0, 4)
      .turn(-90, 3)
      .straight(5)
      .finish(),
  },
  {
    name: '螺旋塔', desc: '連轉兩圈往下衝，中途有掃桿',
    build: () => new Builder(-10, 11, -7, 90, MID)
      .straight(6).gem(0, 3)
      .turn(90, 3, -0.4)
      .straight(2).checkpoint()
      .turn(720, 3.2, -5.0).gem(0, 20)
      .straight(3)
      .turn(-90, 3, -0.3)
      .straight(7).sweeper(1, 1.4).straight(4).gem(0, 2)
      .turn(-90, 3, -0.3)
      .straight(2).checkpoint()
      .straight(4).bridge(3, 'lift', -1.2, { phase: 0.6 }).straight(4)
      .turn(90, 3).gem(0, 4.5)
      .straight(6)
      .finish(),
  },
  {
    name: '翻滾迴圈', desc: '翻滾接迴圈，再從下方穿越',
    build: () => new Builder(-14, 11, -7, 90, MID)
      .straight(3)
      .straight(8, -3.5)
      .corkscrew(6, 1.0, -1).gem(0, 2)
      .straight(3)
      .loop(1.2, 1.3)
      .straight(8, 1.0).checkpoint()
      .turn(90, 3, -0.8).gem(0, 4.5)
      .straight(4)
      .turn(90, 3, -0.8)
      .straight(8, -1.2).gem(0, 4)
      .turn(-90, 3, -0.5)
      .straight(2).checkpoint()
      .straight(4).sweeper(-1, 1.5).straight(4).gap(1.4, -0.35).straight(4)
      .turn(-90, 3).gem(0, 4.5)
      .straight(6)
      .finish(),
  },
  // ================================================================ 高級（彎道幾乎不內傾，要先減速再過彎）
  {
    name: '急彎山路', desc: '平坦急彎＋起伏，太快一定飛出去',
    build: () => new Builder(-12, 9, -7, 90, HARD)
      .straight(3).straight(6, -1.5)
      .turn(90, 2.5, -0.3).gem(0, 3.5)
      .turn(-90, 2.5, -0.3)
      .hill(8, 0.8).gem(0, 4)
      .turn(-90, 2.5, -0.3)
      .straight(2).checkpoint()
      .straight(5, -1.2)
      .turn(180, 2.5, -0.5).gem(0, 4)
      .straight(3).gap(1.4, -0.35).straight(3)
      .turn(-90, 2.5, -0.3)
      .straight(2).checkpoint()
      .turn(-360, 2.8, -2.0).gem(0, 8.5)
      .straight(3)
      .turn(90, 2.5)
      .dip(10, 0.7).gem(0, 5)
      .straight(4)
      .finish(),
  },
  {
    name: '雙翻滾', desc: '兩次翻滾、掃桿與轉盤',
    build: () => new Builder(-14, 11, -7, 90, HARD)
      .straight(3)
      .straight(8, -3.5)
      .corkscrew(6, 1.0, 1)
      .straight(2)
      .corkscrew(6, 1.0, -1).gem(0, 2)
      .straight(8, 1.2).checkpoint()
      .turn(90, 3, -0.8).gem(0, 4.5)
      .straight(7).sweeper(-1, 1.4).straight(4)
      .turntable(1.2, 90).straight(2.4).turntable(1.2, 90, { phase: 1.4 })
      .straight(2).checkpoint()
      .straight(6, -1.6).gem(0, 3)
      .turn(-90, 2.5, -0.4)
      .straight(4)
      .turn(-90, 2.5)
      .straight(6)
      .finish(),
  },
  {
    name: '交叉機關城', desc: '上下交叉、掃桿、移動橋、迴圈',
    build: () => new Builder(-12, 11, -7, 90, HARD)
      .straight(4).straight(8, -3.0)
      .loop(1.2, -1.3).gem(0, 1)
      .straight(8, 1.2).checkpoint()
      .turn(90, 3, -0.6)
      .straight(7).sweeper(1, 1.5).straight(4)
      .turn(90, 3, -0.8).gem(0, 4.5)
      .straight(3).bridge(3, 'slide', 1.6, { phase: 0.5 }).straight(3)
      .turn(-90, 3, -0.6)
      .straight(2).checkpoint()
      .straight(6, -1.2)
      .turn(-90, 3, -0.6).gem(0, 4.5)
      .straight(3).gap(1.4, -0.35).straight(3)
      .turn(-90, 3, -0.4)
      .straight(2).checkpoint()
      .straight(3).bridge(3, 'lift', 1.4, { phase: 1.2 }).straight(4).gem(0, 2)
      .turn(90, 2.5)
      .straight(6)
      .finish(),
  },
  {
    name: '終極雲霄飛車', desc: '迴圈、翻滾、螺旋、交叉與所有機關',
    build: () => new Builder(-14, 13, -8, 90, HARD)
      .straight(3).straight(8, -3.5)
      .loop(1.2, 1.3).gem(0, 1)
      .straight(2)
      .corkscrew(6, 1.0, 1)
      .straight(8, 1.2).checkpoint()
      .turn(90, 3, -0.6)
      .straight(7).sweeper(-1, 1.5).straight(4).gem(0, 2)
      .turn(90, 3, -0.6)
      .straight(3).gap(1.4, -0.35).straight(3)
      .turntable(1.2, -90).straight(2.4).turntable(1.2, -90, { phase: 1.4 })
      .straight(2).checkpoint()
      .turn(360, 3, -2.2).gem(0, 9)
      .straight(3)
      .straight(3).bridge(3, 'slide', 1.6, { phase: 0.8 }).straight(3)
      .turn(90, 2.5, -0.4).gem(0, 4)
      .straight(2).checkpoint()
      .straight(6, -1.2)
      .turn(90, 2.5)
      .straight(3).sweeper(1, -1.6).straight(5).gem(0, 2)
      .finish(),
  },
];

// 每關晶石數（顯示用）
for (const lv of LEVELS) lv.gemTotal = lv.build().gems.length;
