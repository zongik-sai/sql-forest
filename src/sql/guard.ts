import type { StatementType } from '../content/types';

/**
 * SQL 문장 종류 판정기.
 * 정규식 한 줄로 판정하지 않고, 주석·문자열·따옴표 식별자를 처리하는 토크나이저로
 * 문장을 나누고 괄호 깊이를 고려해 WITH 뒤의 실제 동사를 찾는다.
 * 엔진 단계에서도 읽기 전용 활동은 PRAGMA query_only=1로 이중 차단한다(engine.ts).
 */

export type Token =
  | { t: 'word'; v: string; pos: number }
  | { t: 'punct'; v: string; pos: number }
  | { t: 'str'; v: string; pos: number }
  | { t: 'ident'; v: string; pos: number }
  | { t: 'num'; v: string; pos: number };

export class TokenizeError extends Error {
  constructor(message: string, public pos: number) {
    super(message);
  }
}

export function tokenize(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) throw new TokenizeError('주석이 닫히지 않았어요(*/ 필요).', i);
      i = end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      const start = i;
      i++;
      let v = '';
      for (;;) {
        if (i >= n) throw new TokenizeError(c === "'" ? "문자열 따옴표(')가 닫히지 않았어요." : '식별자 따옴표가 닫히지 않았어요.', start);
        if (sql[i] === close) {
          if (close !== ']' && sql[i + 1] === close) { v += close; i += 2; continue; }
          i++;
          break;
        }
        v += sql[i++];
      }
      out.push(c === "'" ? { t: 'str', v, pos: start } : { t: 'ident', v, pos: start });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(sql[i + 1] ?? ''))) {
      const start = i;
      while (i < n && /[0-9.eE]/.test(sql[i])) i++;
      out.push({ t: 'num', v: sql.slice(start, i), pos: start });
      continue;
    }
    if (/[A-Za-z_\u0080-￿]/.test(c)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_$\u0080-￿]/.test(sql[i])) i++;
      out.push({ t: 'word', v: sql.slice(start, i).toUpperCase(), pos: start });
      continue;
    }
    out.push({ t: 'punct', v: c, pos: i });
    i++;
  }
  return out;
}

/** 세미콜론(괄호 밖) 기준으로 토큰을 문장 단위로 나눈다. 빈 문장은 버린다. */
export function splitStatements(tokens: Token[]): Token[][] {
  const stmts: Token[][] = [];
  let cur: Token[] = [];
  let depth = 0;
  for (const tk of tokens) {
    if (tk.t === 'punct' && tk.v === '(') depth++;
    if (tk.t === 'punct' && tk.v === ')') depth = Math.max(0, depth - 1);
    if (tk.t === 'punct' && tk.v === ';' && depth === 0) {
      if (cur.length) stmts.push(cur);
      cur = [];
      continue;
    }
    cur.push(tk);
  }
  if (cur.length) stmts.push(cur);
  return stmts;
}

const TCL = new Set(['BEGIN', 'COMMIT', 'END', 'ROLLBACK', 'SAVEPOINT', 'RELEASE']);

export function classifyTokens(tokens: Token[]): StatementType {
  const first = tokens[0];
  if (!first || first.t !== 'word') return 'other';
  let verb = first.v;
  if (verb === 'WITH') {
    let depth = 0;
    verb = '';
    for (let k = 1; k < tokens.length; k++) {
      const tk = tokens[k];
      if (tk.t === 'punct' && tk.v === '(') depth++;
      else if (tk.t === 'punct' && tk.v === ')') depth--;
      else if (depth === 0 && tk.t === 'word' && ['SELECT', 'VALUES', 'INSERT', 'REPLACE', 'UPDATE', 'DELETE'].includes(tk.v)) {
        verb = tk.v;
        break;
      }
    }
  }
  switch (verb) {
    case 'SELECT':
    case 'VALUES':
      return 'select';
    case 'INSERT':
    case 'REPLACE':
      return 'insert';
    case 'UPDATE':
      return 'update';
    case 'DELETE':
      return 'delete';
    case 'CREATE':
      return 'create';
    case 'DROP':
      return 'drop';
    case 'ALTER':
      return 'alter';
    default:
      return TCL.has(verb) ? 'tcl' : 'other';
  }
}

/** 학습 앱에서 어떤 활동에서도 허용하지 않는 함수/동작 */
const FORBIDDEN_WORDS = new Set(['ATTACH', 'DETACH', 'PRAGMA', 'VACUUM', 'LOAD_EXTENSION', 'EXPLAIN', 'ANALYZE', 'REINDEX']);

export interface GuardResult {
  ok: boolean;
  types: StatementType[];
  message?: string;
  pos?: number;
}

export const MAX_SQL_LENGTH = 20 * 1024;

export function guardSql(sql: string, allow: StatementType[]): GuardResult {
  if (sql.length > MAX_SQL_LENGTH) {
    return { ok: false, types: [], message: 'SQL이 너무 길어요(최대 20KB). 필요한 부분만 남겨 주세요.' };
  }
  let tokens: Token[];
  try {
    tokens = tokenize(sql);
  } catch (e) {
    const err = e as TokenizeError;
    return { ok: false, types: [], message: err.message, pos: err.pos };
  }
  const stmts = splitStatements(tokens);
  if (stmts.length === 0) return { ok: false, types: [], message: '실행할 SQL을 입력해 주세요.' };
  const types: StatementType[] = [];
  for (const st of stmts) {
    const bad = st.find((tk) => tk.t === 'word' && FORBIDDEN_WORDS.has(tk.v));
    if (bad) {
      return { ok: false, types, message: `'${bad.v}'는 이 학습 앱에서 사용할 수 없어요.`, pos: bad.pos };
    }
    const type = classifyTokens(st);
    if (type === 'other') {
      return { ok: false, types, message: `'${st[0].v}'로 시작하는 문장은 지원하지 않아요.`, pos: st[0].pos };
    }
    if (!allow.includes(type)) {
      const label = TYPE_LABEL[type];
      return { ok: false, types, message: `이 활동에서는 ${label} 문장을 실행할 수 없어요. 허용: ${allow.map((a) => TYPE_LABEL[a]).join(', ')}`, pos: st[0].pos };
    }
    types.push(type);
  }
  return { ok: true, types };
}

export const TYPE_LABEL: Record<StatementType, string> = {
  select: 'SELECT(조회)',
  insert: 'INSERT',
  update: 'UPDATE',
  delete: 'DELETE',
  create: 'CREATE',
  drop: 'DROP',
  alter: 'ALTER',
  tcl: 'COMMIT/ROLLBACK/SAVEPOINT',
  other: '기타',
};
