import { useMemo } from 'react';
import { gardenParams, stageOf } from '../features/growth/levels';

/** 결정적 의사난수: 같은 레벨·같은 인덱스면 항상 같은 위치 */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const BADGE_COLORS = ['#b8743d', '#6f8f3a', '#3f7d8a', '#8a6fb0', '#c08a2c', '#4f7d4f', '#2f6f9a', '#9a5a7a', '#7a7a3a', '#3a8a7a', '#8a5a3a', '#2f6440'];

export interface GardenProps {
  level: number;
  /** 획득한 단원 배지(U01~U12 순) */
  unitBadges?: boolean[];
  title?: string;
  className?: string;
  small?: boolean;
}

/** 코드로 생성하는 정원 SVG. 사진·외부 이미지 없음. 같은 레벨·배지면 같은 장면. */
export function Garden({ level, unitBadges = [], title, className, small }: GardenProps) {
  const p = useMemo(() => gardenParams(level), [level]);
  const stage = stageOf(p.level);
  const scene = useMemo(() => {
    const r = rng(7);
    const leafColor = mix([150, 200, 120], [40, 110, 60], p.lushness);
    const leafColor2 = mix([175, 215, 140], [60, 135, 75], p.lushness);
    const sky = mix([228, 240, 232], [205, 228, 220], p.lushness);
    const groundY = 210;
    const cx = 200;
    const top = groundY - p.stemHeight;
    const trunkW = Math.max(2, p.trunkWidth);
    const canopyR = p.level < 30 ? 0 : 22 + (p.level - 30) * 0.75;

    const leaves: { x: number; y: number; rx: number; ry: number; rot: number; c: string }[] = [];
    for (let i = 0; i < p.leafCount; i++) {
      if (p.level < 30) {
        const t = (i + 1) / (p.leafCount + 1);
        const side = i % 2 === 0 ? -1 : 1;
        leaves.push({ x: cx + side * 8, y: groundY - p.stemHeight * t, rx: 8, ry: 4, rot: side * -30, c: i % 3 ? leafColor : leafColor2 });
      } else {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * canopyR;
        leaves.push({ x: cx + Math.cos(a) * d * 1.25, y: top + Math.sin(a) * d * 0.85, rx: 7 + r() * 3, ry: 4 + r() * 2, rot: r() * 180, c: r() > 0.5 ? leafColor : leafColor2 });
      }
    }
    const branches = Array.from({ length: p.branchCount }, (_, i) => {
      const y = top + 14 + i * (p.stemHeight * 0.45) / Math.max(1, p.branchCount);
      const side = i % 2 === 0 ? -1 : 1;
      return { x1: cx, y1: y, x2: cx + side * p.branchLength * (0.6 + 0.4 * ((i * 37) % 10) / 10), y2: y - 14 - i * 2 };
    });
    const grass = Array.from({ length: p.grassCount }, (_, i) => {
      const x = 12 + ((i * 97) % 376);
      const h = 6 + ((i * 31) % 9);
      return { x, h };
    });
    const flowers = Array.from({ length: p.flowerCount }, (_, i) => {
      const a = (i * 2.399) % (Math.PI * 2);
      const d = (0.35 + ((i * 53) % 60) / 100) * canopyR;
      return { x: cx + Math.cos(a) * d * 1.2, y: top + Math.sin(a) * d * 0.8, c: i % 3 === 0 ? '#f2c4d0' : i % 3 === 1 ? '#fff2b8' : '#ffffff' };
    });
    const fruits = Array.from({ length: p.fruitCount }, (_, i) => {
      const a = (i * 1.7 + 0.5) % (Math.PI * 2);
      return { x: cx + Math.cos(a) * canopyR * 0.75, y: top + Math.sin(a) * canopyR * 0.55 + 6 };
    });
    const extra = Array.from({ length: p.extraTrees }, (_, i) => {
      const x = 20 + ((i * 113) % 360);
      const s = 0.45 + ((i * 29) % 30) / 100;
      return { x, s, c: mix([120, 170, 110], [30, 95, 70], Math.min(1, p.lushness + (i % 4) * 0.06)) };
    }).filter((t) => Math.abs(t.x - cx) > 26);
    const side = [
      { x: 70, s: 0.75 },
      { x: 330, s: 0.7 },
      { x: 120, s: 0.55 },
    ].slice(0, p.sideTrees);
    return { leafColor, sky, groundY, cx, top, trunkW, canopyR, leaves, branches, grass, flowers, fruits, extra, side };
  }, [p]);

  const s = scene;
  const label = title ?? `나의 정원: Lv${p.level} ${stage.name}. ${stage.visual}`;
  return (
    <svg viewBox="0 0 400 260" className={className ?? 'garden-svg'} role="img" aria-label={label} data-level={p.level}>
      <title>{label}</title>
      <rect x="0" y="0" width="400" height="260" fill={s.sky} />
      {p.completed && <circle cx="350" cy="44" r="18" fill="#f6d77a" />}
      {/* 배경 숲 */}
      {s.extra.map((t, i) => (
        <g key={`e${i}`} transform={`translate(${t.x} ${s.groundY}) scale(${t.s})`}>
          <rect x="-3" y="-40" width="6" height="40" fill="#6b4f33" />
          <ellipse cx="0" cy="-52" rx="22" ry="28" fill={t.c} />
        </g>
      ))}
      {/* 땅 */}
      <rect x="0" y={s.groundY} width="400" height={260 - s.groundY} fill="#8a6a48" />
      <rect x="0" y={s.groundY} width="400" height="6" fill="#6f8f4a" opacity={p.level >= 20 ? 1 : 0.35} />
      {p.hasPath && <path d={`M 0 250 C 90 232, 150 252, 210 236 S 330 246, 400 228`} stroke="#c9ab84" strokeWidth="9" fill="none" strokeLinecap="round" />}
      {p.hasShade && <ellipse cx={s.cx} cy={s.groundY + 4} rx={30 + s.canopyR} ry="7" fill="#000" opacity="0.12" />}
      {/* 뿌리 */}
      {p.rootLength > 0 && (
        <g stroke="#e8d7bd" strokeWidth="1.5" fill="none" opacity="0.9">
          <path d={`M ${s.cx} ${s.groundY + 4} q -6 ${p.rootLength * 0.5} -14 ${p.rootLength}`} />
          <path d={`M ${s.cx} ${s.groundY + 4} q 5 ${p.rootLength * 0.5} 12 ${p.rootLength * 0.85}`} />
          {p.rootLength > 20 && <path d={`M ${s.cx} ${s.groundY + 4} l 0 ${p.rootLength * 0.9}`} />}
        </g>
      )}
      {/* 씨앗 */}
      {p.level < 10 && (
        <g>
          <ellipse cx={s.cx} cy={s.groundY + 2} rx="9" ry="6" fill="#a0723f" />
          {p.seedOpen > 0 && <path d={`M ${s.cx - 6} ${s.groundY} q 6 ${-6 * p.seedOpen} 12 0`} stroke="#5f8f45" strokeWidth={1 + p.seedOpen * 2} fill="none" />}
        </g>
      )}
      {/* 옆 나무 */}
      {s.side.map((t, i) => (
        <g key={`s${i}`} transform={`translate(${t.x} ${s.groundY}) scale(${t.s})`}>
          <rect x="-5" y="-70" width="10" height="70" fill="#6b4f33" />
          <circle cx="0" cy="-86" r="34" fill={s.leafColor} />
          <circle cx="-18" cy="-70" r="20" fill={s.leafColor} opacity="0.85" />
        </g>
      ))}
      {/* 줄기와 나무 */}
      <g className="grow-sway">
        {p.stemHeight > 0 && <rect x={s.cx - s.trunkW / 2} y={s.top} width={s.trunkW} height={p.stemHeight} fill={p.level < 30 ? '#5f8f45' : '#6b4f33'} rx={s.trunkW / 3} />}
        {s.branches.map((b, i) => (
          <line key={`b${i}`} x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} stroke="#6b4f33" strokeWidth={Math.max(2, s.trunkW * 0.35)} strokeLinecap="round" />
        ))}
        {s.leaves.map((l, i) => (
          <ellipse key={`l${i}`} cx={l.x} cy={l.y} rx={l.rx} ry={l.ry} transform={`rotate(${l.rot} ${l.x} ${l.y})`} fill={l.c} />
        ))}
        {s.flowers.map((f, i) => <circle key={`f${i}`} cx={f.x} cy={f.y} r="3.2" fill={f.c} />)}
        {s.fruits.map((f, i) => <circle key={`r${i}`} cx={f.x} cy={f.y} r="4" fill="#d0533f" />)}
      </g>
      {/* 풀 */}
      {s.grass.map((g, i) => (
        <path key={`g${i}`} d={`M ${g.x} ${s.groundY + 2} l -2 ${-g.h} M ${g.x} ${s.groundY + 2} l 3 ${-g.h + 2}`} stroke="#5f8f45" strokeWidth="1.6" />
      ))}
      {/* 새 */}
      {Array.from({ length: p.birdCount }, (_, i) => (
        <path key={`bird${i}`} d={`M ${60 + i * 70} ${40 + (i % 2) * 14} q 6 -6 12 0 q 6 -6 12 0`} stroke="#2f3f37" strokeWidth="1.6" fill="none" />
      ))}
      {/* 단원 배지 장식 */}
      {unitBadges.map((has, i) =>
        has ? (
          <g key={`ub${i}`}>
            <title>{`U${String(i + 1).padStart(2, '0')} 배지`}</title>
            <circle cx={22 + i * 32} cy={248} r="5.5" fill={BADGE_COLORS[i]} stroke="#fff" strokeWidth="1.2" />
          </g>
        ) : null,
      )}
      {!small && p.completed && (
        <g>
          <rect x="140" y="12" width="120" height="24" rx="12" fill="#2f6440" />
          <text x="200" y="29" textAnchor="middle" fontSize="12" fill="#fff" fontFamily="sans-serif">SQL 숲 완성</text>
        </g>
      )}
    </svg>
  );
}
