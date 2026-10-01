/**
 * 레벨 0~99: 씨앗에서 숲으로 (docs/05_GROWTH_SYSTEM.md)
 * level = min(99, floor(totalXP / 100)), 최대 9,900 XP.
 */

export const XP_PER_LEVEL = 100;
export const MAX_LEVEL = 99;
export const MAX_XP = 9900;

export function levelOf(totalXp: number): number {
  const xp = Math.max(0, Math.floor(totalXp));
  return Math.min(MAX_LEVEL, Math.floor(xp / XP_PER_LEVEL));
}

export function displayXp(totalXp: number): number {
  return Math.min(MAX_XP, Math.max(0, Math.floor(totalXp)));
}

/** 다음 레벨까지 남은 XP. Lv99면 null(성장 완료) */
export function xpToNextLevel(totalXp: number): number | null {
  if (levelOf(totalXp) >= MAX_LEVEL) return null;
  return XP_PER_LEVEL - (displayXp(totalXp) % XP_PER_LEVEL);
}

export interface Stage {
  min: number;
  max: number;
  name: string;
  visual: string;
}

export const STAGES: Stage[] = [
  { min: 0, max: 0, name: '잠든 씨앗', visual: '흙 위의 씨앗 한 알' },
  { min: 1, max: 9, name: '깨어난 씨앗', visual: '씨앗이 열리고 뿌리가 자람' },
  { min: 10, max: 19, name: '새싹', visual: '흙에서 줄기와 첫 잎이 나옴' },
  { min: 20, max: 29, name: '어린 풀', visual: '잎과 작은 주변 풀이 늘어남' },
  { min: 30, max: 39, name: '작은 묘목', visual: '중심 줄기와 가지가 생김' },
  { min: 40, max: 49, name: '자라는 나무', visual: '줄기가 굵어지고 잎이 풍성해짐' },
  { min: 50, max: 59, name: '튼튼한 나무', visual: '가지가 뻗고 나무 그늘이 생김' },
  { min: 60, max: 69, name: '꽃피는 나무', visual: '꽃·열매·새가 추가됨' },
  { min: 70, max: 79, name: '작은 숲', visual: '옆에 두세 그루의 나무가 자람' },
  { min: 80, max: 89, name: '넓어지는 숲', visual: '다양한 나무와 길이 생김' },
  { min: 90, max: 98, name: '울창한 숲', visual: '숲의 깊이·다양성·색감이 증가' },
  { min: 99, max: 99, name: '나의 SQL 숲 완성', visual: '전체 정원 완성·완료 배지' },
];

export function stageOf(level: number): Stage {
  return STAGES.find((s) => level >= s.min && level <= s.max)!;
}

/** 성장 카드(닫기 가능한 짧은 카드)를 보여줄 레벨 */
export const MILESTONE_LEVELS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 99];

/**
 * 정원 장면의 결정적 파라미터. 같은 레벨이면 항상 같은 장면이 된다.
 * 각 구간 안에서도 레벨마다 최소 한 요소(풀 수, 잎 수, 가지 길이, 색 등)가 연속으로 바뀐다.
 */
export interface GardenParams {
  level: number;
  /** 0~1 씨앗 열림 정도 */
  seedOpen: number;
  rootLength: number;
  stemHeight: number;
  trunkWidth: number;
  leafCount: number;
  branchCount: number;
  branchLength: number;
  grassCount: number;
  flowerCount: number;
  fruitCount: number;
  birdCount: number;
  sideTrees: number;
  extraTrees: number;
  hasPath: boolean;
  hasShade: boolean;
  /** 0~1 색감 깊이 */
  lushness: number;
  completed: boolean;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export function gardenParams(levelInput: number): GardenParams {
  const level = clamp(Math.floor(levelInput), 0, MAX_LEVEL);
  const L = level;
  return {
    level,
    seedOpen: clamp(L / 9, 0, 1),
    rootLength: L === 0 ? 0 : Math.round(clamp(4 + L * 2.2, 0, 40)),
    stemHeight: L < 10 ? 0 : Math.round(clamp(12 + (L - 10) * 2.4, 0, 190)),
    trunkWidth: L < 30 ? (L < 10 ? 0 : 3) : Math.round(4 + (L - 30) * 0.32),
    leafCount: L < 10 ? 0 : Math.min(140, 2 + (L - 10) * 2),
    branchCount: L < 30 ? 0 : Math.min(9, 2 + Math.floor((L - 30) / 8)),
    branchLength: L < 30 ? 0 : Math.round(clamp(18 + (L - 30) * 1.1, 0, 90)),
    grassCount: L < 20 ? 0 : Math.min(40, 3 + (L - 20)),
    flowerCount: L < 60 ? 0 : Math.min(30, 1 + (L - 60)),
    fruitCount: L < 64 ? 0 : Math.min(12, Math.floor((L - 62) / 2)),
    birdCount: L < 66 ? 0 : Math.min(4, 1 + Math.floor((L - 66) / 9)),
    sideTrees: L < 70 ? 0 : Math.min(3, 1 + Math.floor((L - 70) / 4)),
    extraTrees: L < 80 ? 0 : Math.min(20, 1 + (L - 80)),
    hasPath: L >= 80,
    hasShade: L >= 50,
    lushness: clamp(L / 99, 0, 1),
    completed: L >= 99,
  };
}
