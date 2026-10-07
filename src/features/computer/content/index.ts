import type { CgMcq, CgUnit, CgUnitId } from '../types';
import { CG_BANK } from './bank';

/** 컴퓨터 일반 8단원(원본 문제은행을 변환한 데이터) */
export const CG_UNITS: CgUnit[] = CG_BANK;
export const CG_UNIT_BY_ID: Partial<Record<CgUnitId, CgUnit>> = Object.fromEntries(CG_UNITS.map((u) => [u.id, u]));
export const CG_MCQ_BY_ID: Record<string, CgMcq> = Object.fromEntries(CG_UNITS.flatMap((u) => [...u.basic, ...u.check]).map((q) => [q.id, q]));
