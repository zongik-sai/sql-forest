import { useEffect, useState } from 'react';
import type { DatasetId } from '../../content/types';
import type { ResultSet } from '../../sql/grader/compare';
import { outcomeMessage, sqlClient } from '../../sql/worker/sqlClient';

/** 콘텐츠의 신뢰된 SQL을 Worker에서 실행해(읽기 전용, main seed) 표시·정답 계산에 쓴다. 결과를 하드코딩하지 않는다. */
export function useQuery(dataset: DatasetId, sql: string | null | undefined): { data: ResultSet | null; error: string | null } {
  const [state, setState] = useState<{ data: ResultSet | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    if (!sql) return;
    let alive = true;
    const run = async (attempt: number): Promise<void> => {
      const o = await sqlClient().query(dataset, sql);
      if (!alive) return;
      if (o.status === 'ok') setState({ data: o.data, error: null });
      else if ((o.status === 'stale' || o.status === 'interrupted') && attempt < 5) return run(attempt + 1);
      else setState({ data: null, error: outcomeMessage(o) ?? '불러오지 못했어요.' });
    };
    void run(0);
    return () => {
      alive = false;
    };
  }, [dataset, sql]);
  return state;
}

export const cellKey = (c: unknown) => (c === null ? 'NULL' : String(c));
