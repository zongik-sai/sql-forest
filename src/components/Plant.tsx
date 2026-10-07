/**
 * 컴퓨터 일반 과목의 성장 식물(7단계: 씨앗 → 새싹 → 줄기 → 어린 나무 → 큰 나무 → 꽃 → 열매).
 * 코드로 그리는 SVG라 이미지 파일이 없고, 같은 단계는 항상 같은 모양이다.
 */
export const PLANT_STAGES = ['씨앗', '새싹', '줄기', '어린 나무', '큰 나무', '꽃', '열매'] as const;

export function Plant({ stage, size = 120, title }: { stage: number; size?: number; title?: string }) {
  const s = Math.max(0, Math.min(6, Math.floor(stage)));
  const ground = 92;
  // 단계별 줄기 높이·잎 수·수관 크기
  const stem = [0, 10, 26, 40, 54, 54, 54][s];
  const crown = [0, 0, 0, 16, 26, 26, 26][s];
  const top = ground - stem;
  const label = title ?? `성장 식물: ${PLANT_STAGES[s]}`;
  return (
    <svg viewBox="0 0 120 100" width={size} height={(size * 100) / 120} role="img" aria-label={label} className="plant-svg">
      <title>{label}</title>
      <ellipse cx="60" cy={ground + 2} rx="44" ry="6" fill="var(--soil-soft)" stroke="var(--soil)" strokeWidth="1" />
      {s === 0 && (
        <g>
          <ellipse cx="60" cy={ground - 3} rx="6" ry="4" fill="var(--soil)" />
          <path d={`M60 ${ground - 7} q2 -3 4 -2`} stroke="var(--moss)" strokeWidth="1.5" fill="none" />
        </g>
      )}
      {s >= 1 && <path d={`M60 ${ground} L60 ${top}`} stroke="var(--moss-strong)" strokeWidth={s >= 3 ? 4 : 2.5} strokeLinecap="round" />}
      {s === 1 && (
        <g fill="var(--moss)">
          <ellipse cx="55" cy={top + 1} rx="5" ry="2.6" transform={`rotate(-25 55 ${top + 1})`} />
          <ellipse cx="65" cy={top + 1} rx="5" ry="2.6" transform={`rotate(25 65 ${top + 1})`} />
        </g>
      )}
      {s === 2 && (
        <g fill="var(--moss)">
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <ellipse cx="53" cy={top + 4 + i * 8} rx="7" ry="3" transform={`rotate(-25 53 ${top + 4 + i * 8})`} />
              <ellipse cx="67" cy={top + 8 + i * 8} rx="7" ry="3" transform={`rotate(25 67 ${top + 8 + i * 8})`} />
            </g>
          ))}
        </g>
      )}
      {s >= 3 && (
        <g>
          {s >= 4 && <path d={`M60 ${top + 18} L46 ${top + 8} M60 ${top + 14} L74 ${top + 4}`} stroke="var(--moss-strong)" strokeWidth="2.5" strokeLinecap="round" />}
          <circle cx="60" cy={top} r={crown} fill="var(--moss)" opacity="0.92" />
          <circle cx={60 - crown * 0.6} cy={top + crown * 0.3} r={crown * 0.62} fill="var(--moss)" />
          <circle cx={60 + crown * 0.6} cy={top + crown * 0.35} r={crown * 0.6} fill="var(--moss)" />
        </g>
      )}
      {s >= 5 && (
        <g>
          {[[-14, -8], [10, -12], [0, 6], [16, 4], [-18, 8]].map(([dx, dy], i) => (
            <g key={i} transform={`translate(${60 + dx} ${top + dy})`}>
              {[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx="0" cy="-3" rx="1.8" ry="3" fill="#f3b6c6" transform={`rotate(${a})`} />)}
              <circle r="1.6" fill="#e8a33d" />
            </g>
          ))}
        </g>
      )}
      {s >= 6 && (
        <g>
          {[[-6, 14], [20, 16], [-22, 18]].map(([dx, dy], i) => (
            <g key={i}>
              <circle cx={60 + dx} cy={top + dy} r="4.2" fill="#d9573f" />
              <path d={`M${60 + dx} ${top + dy - 4} l1.5 -2`} stroke="var(--moss-strong)" strokeWidth="1.2" />
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}
