/**
 * 예전 보충 학습 주소 → 기초 다듬기(/basics) 주소(2026-11-09 합침). 북마크·예전 안내 링크가 계속 열리게.
 * - /binary, /ip → /basics
 * - /binary/unit/U1~U3[/단계] → /basics/unit/U1~U3[/단계], /ip/unit/U1·U2·U3[/단계] → /basics/unit/U6·U8·U10[/단계]
 * - /binary|ip/mock…(모의고사 목록·회차) → /basics/mock, /binary|ip/wrong → /basics/wrong
 * - /binary|ip/teacher(예전 반 학습 현황) → 선생님 화면의 기초 다듬기 탭
 * - 그 밖(없는 단원 등) → /basics
 * 예전 주소가 아니면 null.
 */
const UNIT_MAP: Record<'binary' | 'ip', Record<string, string>> = {
  binary: { U1: 'U1', U2: 'U2', U3: 'U3' },
  ip: { U1: 'U6', U2: 'U8', U3: 'U10' },
};

export const BASICS_PATH = '/basics';

export function legacyCoursePath(path: string): string | null {
  const m = /^\/(binary|ip)(?:\/(.*))?$/.exec(path.split(/[?#]/)[0]);
  if (!m) return null;
  const units = UNIT_MAP[m[1] as 'binary' | 'ip'];
  const rest = (m[2] ?? '').split('/').filter(Boolean);
  if (rest[0] === 'unit' && rest[1] && Object.hasOwn(units, rest[1])) {
    const lv = rest[2] && /^[1-5]$/.test(rest[2]) ? `/${rest[2]}` : '';
    return `${BASICS_PATH}/unit/${units[rest[1]]}${lv}`;
  }
  if (rest[0] === 'mock') return `${BASICS_PATH}/mock`;
  if (rest[0] === 'wrong') return `${BASICS_PATH}/wrong`;
  if (rest[0] === 'teacher') return '/teacher?s=basic';
  return BASICS_PATH;
}
