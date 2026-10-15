import { beforeAll, describe, expect, it } from 'vitest';
import type { SqlJsStatic } from 'sql.js';
import { PLAYGROUND_PRESETS, PRESET_BY_ID, isPresetId } from '../../src/features/playground/presets';
import { buildTableSql, checkName, emptyDraft, quoteIdent, sqlLiteral, type BuilderDraft } from '../../src/features/playground/tableBuilder';
import { describeSchema, erdLevels, layoutErd, textWidth } from '../../src/components/erdLayout';
import { execSql, openBaseDb, openSessionDb } from '../../src/sql/engine';
import { guardSql } from '../../src/sql/guard';
import { readSchema, type DbSchema } from '../../src/sql/schema';
import { presetBase, presetOfBase } from '../../src/sql/sessionBase';
import { ALL_DATASETS } from '../../src/sql/datasets';
import { createHandler } from '../../src/sql/worker/handler';
import { SqlClient, loadSchema } from '../../src/sql/worker/sqlClient';
import { FakeWorker } from './fakeWorker';
import { loadSql } from './sqljs';

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await loadSql();
});

const PLAYGROUND_ALLOW = ['select', 'insert', 'update', 'delete', 'create', 'drop', 'alter', 'tcl'] as const;

describe('자유 실습장 예시 데이터(presets)', () => {
  it('5개 이상, id는 안정적인 고유 문자열이고 version이 있다', () => {
    expect(PLAYGROUND_PRESETS.length).toBeGreaterThanOrEqual(5);
    const ids = PLAYGROUND_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PLAYGROUND_PRESETS) {
      expect(p.id).toMatch(/^[a-z][a-z-]+$/);
      expect(p.version).toBeGreaterThanOrEqual(1);
      expect(PRESET_BY_ID[p.id]).toBe(p);
      expect(isPresetId(p.id)).toBe(true);
      expect(presetOfBase(presetBase(p.id))).toBe(p.id);
      expect(p.summary.length).toBeGreaterThan(20);
    }
    expect(isPresetId('school')).toBe(false);
    expect(presetOfBase('school')).toBeNull();
  });

  for (const p of PLAYGROUND_PRESETS) {
    describe(p.title, () => {
      it('seed가 PRAGMA foreign_keys=ON에서 실행되고 외래키 무결성이 지켜진다', () => {
        const db = new SQL.Database();
        try {
          db.exec('PRAGMA foreign_keys = ON;');
          db.exec(p.seedSql);
          expect(db.exec('PRAGMA foreign_key_check')).toEqual([]);
          expect(db.exec('PRAGMA integrity_check')[0].values).toEqual([['ok']]);
        } finally {
          db.close();
        }
      });

      it('표마다 기본키가 있고 5~12행, 외래키가 하나 이상 있다', () => {
        const db = openBaseDb(SQL, presetBase(p.id));
        try {
          const schema = readSchema(db);
          expect(schema.tables.map((t) => t.name).sort()).toEqual([...p.tables].sort());
          for (const t of schema.tables) {
            expect(t.columns.some((c) => c.pk), `${t.name} PK`).toBe(true);
            expect(t.rowCount, `${t.name} 행 수`).toBeGreaterThanOrEqual(5);
            expect(t.rowCount, `${t.name} 행 수`).toBeLessThanOrEqual(12);
            for (const fk of t.fks) {
              const target = schema.tables.find((x) => x.name === fk.table);
              expect(target, `${t.name}.${fk.from} → ${fk.table}`).toBeDefined();
              expect(target!.columns.find((c) => c.name === fk.to)?.unique, `${fk.table}.${fk.to}는 PK/UNIQUE`).toBe(true);
            }
          }
          expect(schema.tables.reduce((n, t) => n + t.fks.length, 0)).toBeGreaterThanOrEqual(2);
        } finally {
          db.close();
        }
      });

      it('시작 SQL이 모두 실행되고 결과가 있으며, JOIN 예시가 있다', () => {
        expect(p.starters.some((s) => /\bJOIN\b/i.test(s.sql))).toBe(true);
        for (const s of p.starters) {
          const db = openBaseDb(SQL, presetBase(p.id));
          try {
            const out = execSql(db, s.sql, ['select']);
            expect(out.ok, `${s.label}: ${!out.ok ? out.error.raw : ''}`).toBe(true);
            if (out.ok) expect(out.last?.rows.length, s.label).toBeGreaterThan(0);
          } finally {
            db.close();
          }
        }
      });
    });
  }

  it('잘못된 외래키 값은 거절된다(FK 검사 켜짐)', () => {
    const db = openSessionDb(SQL, 'preset:student-scores', []);
    try {
      const out = execSql(db, 'INSERT INTO scores VALUES (99, 1, 50)', [...PLAYGROUND_ALLOW]);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error.message).toContain('FOREIGN KEY');
    } finally {
      db.close();
    }
  });
});

describe('readSchema', () => {
  it('학습 데이터셋: 열 정보·복합 PK·외래키·행 수', () => {
    const db = openBaseDb(SQL, 'school');
    try {
      const s = readSchema(db);
      const enr = s.tables.find((t) => t.name === 'enrollment')!;
      expect(enr.columns.map((c) => [c.name, c.type, c.pk])).toEqual([
        ['student_id', 'INTEGER', true],
        ['course_id', 'INTEGER', true],
        ['score', 'INTEGER', false],
      ]);
      // 복합 기본키의 한 열만으로는 UNIQUE가 아니다
      expect(enr.columns[0].unique).toBe(false);
      expect(enr.fks).toEqual([
        { from: 'student_id', table: 'students', to: 'student_id' },
        { from: 'course_id', table: 'courses', to: 'course_id' },
      ]);
      expect(enr.rowCount).toBe(6);
      const dept = s.tables.find((t) => t.name === 'departments')!;
      expect(dept.columns.find((c) => c.name === 'dept_name')).toMatchObject({ notnull: true, unique: true, pk: false });
    } finally {
      db.close();
    }
  });

  it('REFERENCES 표만 쓰면 기본키를 가리키고, 따옴표가 들어간 표 이름도 안전하게 읽는다', () => {
    const db = new SQL.Database();
    try {
      db.exec(`CREATE TABLE "a""b" (id INTEGER PRIMARY KEY); CREATE TABLE c (x INTEGER REFERENCES "a""b"); INSERT INTO "a""b" VALUES (1);`);
      const s = readSchema(db);
      expect(s.tables.map((t) => t.name)).toEqual(['a"b', 'c']);
      expect(s.tables[1].fks).toEqual([{ from: 'x', table: 'a"b', to: 'id' }]);
      expect(s.tables[0].rowCount).toBe(1);
    } finally {
      db.close();
    }
  });

  it('모든 학습 데이터셋의 스키마를 읽고 ERD 배치가 된다', () => {
    for (const d of ALL_DATASETS) {
      const db = openBaseDb(SQL, d);
      try {
        const s = readSchema(db);
        expect(s.tables.length).toBeGreaterThan(0);
        const l = layoutErd(s);
        expect(l.boxes.length).toBe(s.tables.length);
        expect(l.width).toBeGreaterThan(0);
      } finally {
        db.close();
      }
    }
  });

  it('Worker 처리기: 세션 DB의 현재 상태(만든 표 포함)를 읽는다', async () => {
    const handle = createHandler(loadSql);
    const base = presetBase('library-loans');
    const log = ['CREATE TABLE reviews (review_id INTEGER PRIMARY KEY, book_id INTEGER NOT NULL REFERENCES books(book_id), stars INTEGER)'];
    const r = await handle({ op: 'session-exec', sessionId: 's', dataset: base, log: [], sql: log[0], allow: [...PLAYGROUND_ALLOW], requestId: 1, generation: 0 });
    expect(r.op === 'session-exec' && r.data.output.ok).toBe(true);
    const sc = await handle({ op: 'schema', base, session: { id: 's', log }, requestId: 2, generation: 0 });
    expect(sc.op).toBe('schema');
    if (sc.op === 'schema') {
      expect(sc.schema.tables.map((t) => t.name)).toContain('reviews');
      expect(sc.schema.tables.find((t) => t.name === 'reviews')!.fks).toEqual([{ from: 'book_id', table: 'books', to: 'book_id' }]);
    }
    // 세션 없이: 시작 데이터 그대로
    const fresh = await handle({ op: 'schema', base, requestId: 3, generation: 0 });
    if (fresh.op === 'schema') expect(fresh.schema.tables.map((t) => t.name)).not.toContain('reviews');
  });

  it('loadSchema(SqlClient): 학습 데이터셋 id로 읽는다', async () => {
    const c = new SqlClient(() => new FakeWorker(10) as unknown as Worker, 2000);
    const s = await loadSchema('clubs', c);
    expect(s.tables.find((t) => t.name === 'clubs_tree')!.fks).toEqual([{ from: 'parent_id', table: 'clubs_tree', to: 'club_id' }]);
  });
});

describe('직접 표 만들기: SQL 생성기', () => {
  const ctx = { existingTables: ['students', 'subjects', 'scores'], fkTargets: [{ table: 'students', column: 'student_id' }, { table: 'subjects', column: 'subject_id' }] };
  const draft = (over: Partial<BuilderDraft> = {}): BuilderDraft => ({
    tableName: '상담_기록',
    columns: [
      { key: 'a', name: '번호', type: 'INTEGER', pk: true, fk: null },
      { key: 'b', name: '메모', type: 'TEXT', pk: false, fk: null },
      { key: 'c', name: 'student_id', type: 'INTEGER', pk: false, fk: { table: 'students', column: 'student_id' } },
    ],
    rows: [
      { key: 'r1', cells: { a: '1', b: "O'Brien 진로 상담", c: '1' } },
      { key: 'r2', cells: { a: '2', b: '', c: '' } },
      { key: 'r3', cells: {} },
    ],
    ...over,
  });

  it('식별자는 큰따옴표로 감싸고, 따옴표는 두 번 써서 이스케이프한다', () => {
    expect(quoteIdent('students')).toBe('"students"');
    expect(quoteIdent('a"b')).toBe('"a""b"');
  });

  it('값: 문자열 이스케이프, 빈 칸 NULL, 숫자 검사', () => {
    expect(sqlLiteral("it's", 'TEXT')).toEqual({ ok: true, sql: "'it''s'" });
    expect(sqlLiteral("'); DROP TABLE students; --", 'TEXT')).toEqual({ ok: true, sql: "'''); DROP TABLE students; --'" });
    expect(sqlLiteral('  ', 'INTEGER')).toEqual({ ok: true, sql: 'NULL' });
    expect(sqlLiteral('007', 'INTEGER')).toEqual({ ok: true, sql: '7' });
    expect(sqlLiteral('1.5', 'INTEGER').ok).toBe(false);
    expect(sqlLiteral('1; DROP TABLE x', 'INTEGER').ok).toBe(false);
    expect(sqlLiteral('-2.5e3', 'REAL')).toEqual({ ok: true, sql: '-2500' });
    expect(sqlLiteral('abc', 'REAL').ok).toBe(false);
  });

  it('PK·FK가 들어간 CREATE TABLE + INSERT를 만든다(빈 행은 건너뜀)', () => {
    const r = buildTableSql(draft(), ctx);
    expect(r.errors).toEqual([]);
    expect(r.rowCount).toBe(2);
    expect(r.sql).toBe(
      `CREATE TABLE "상담_기록" (
  "번호" INTEGER PRIMARY KEY,
  "메모" TEXT,
  "student_id" INTEGER REFERENCES "students" ("student_id")
);
INSERT INTO "상담_기록" ("번호", "메모", "student_id") VALUES
  (1, 'O''Brien 진로 상담', 1),
  (2, NULL, NULL);`,
    );
    expect(guardSql(r.sql, [...PLAYGROUND_ALLOW])).toMatchObject({ ok: true, types: ['create', 'insert'] });
  });

  it('만든 SQL이 예시 DB에서 실행되고 외래키가 스키마에 보인다', () => {
    const db = openSessionDb(SQL, 'preset:student-scores', []);
    try {
      const r = buildTableSql(draft(), ctx);
      const out = execSql(db, r.sql, [...PLAYGROUND_ALLOW]);
      expect(out.ok).toBe(true);
      const t = readSchema(db).tables.find((x) => x.name === '상담_기록')!;
      expect(t.rowCount).toBe(2);
      expect(t.fks).toEqual([{ from: 'student_id', table: 'students', to: 'student_id' }]);
      // 없는 학생을 가리키면 SQLite가 거절한다(친절한 한국어 오류)
      const bad = buildTableSql({ ...draft({ tableName: '상담_기록2' }), rows: [{ key: 'x', cells: { a: '1', c: '99' } }] }, ctx);
      const out2 = execSql(db, bad.sql, [...PLAYGROUND_ALLOW]);
      expect(out2.ok).toBe(false);
      if (!out2.ok) expect(out2.error.message).toContain('FOREIGN KEY');
    } finally {
      db.close();
    }
  });

  it('복합 기본키는 표 제약조건으로 만든다', () => {
    const r = buildTableSql(
      {
        tableName: 'attend',
        columns: [
          { key: 'a', name: 'student_id', type: 'INTEGER', pk: true, fk: { table: 'students', column: 'student_id' } },
          { key: 'b', name: 'day', type: 'TEXT', pk: true, fk: null },
        ],
        rows: [{ key: 'r', cells: { a: '1', b: '월' } }, { key: 's', cells: { a: '1', b: '월' } }, { key: 't', cells: { a: '2' } }],
      },
      ctx,
    );
    expect(r.sql).toContain('  PRIMARY KEY ("student_id", "day")');
    expect(r.sql).not.toContain('INTEGER PRIMARY KEY');
    expect(r.errors).toContain('2행: 기본키 값이 1행과 같아요. 기본키는 행마다 달라야 해요.');
    expect(r.errors.some((e) => e.startsWith('3행: 기본키(PK) 열'))).toBe(true);
  });

  it('위험하거나 잘못된 이름은 친절한 한국어 오류로 거절한다', () => {
    for (const bad of ['x"; DROP TABLE students; --', "a'b", 'a b', 'a-b', '1반', 'select', 'Table', 'sqlite_x', '', 'a'.repeat(31), 'a;b', '[x]', 'a.b']) {
      expect(checkName(bad, '표 이름'), bad).not.toBeNull();
      const r = buildTableSql(draft({ tableName: bad }), ctx);
      expect(r.errors.length, bad).toBeGreaterThan(0);
    }
    for (const good of ['상담_기록', '_tmp', 'clubs2', '반친구', 'Ünïcode']) expect(checkName(good, '표 이름'), good).toBeNull();
    expect(checkName('a b', '표 이름')).toContain('밑줄');
    expect(checkName('1반', '표 이름')).toContain('숫자로 시작');
    expect(checkName('select', '표 이름')).toContain('예약어');
  });

  it('이미 있는 표·겹치는 열 이름·없는 FK 대상·자료형 오류를 알려 준다', () => {
    expect(buildTableSql(draft({ tableName: 'Students' }), ctx).errors).toContain("'Students' 표가 이미 있어요. 다른 이름을 써 주세요.");
    const dup = draft();
    dup.columns[1] = { ...dup.columns[1], name: '번호' };
    expect(buildTableSql(dup, ctx).errors.some((e) => e.includes("'번호'이 두 번"))).toBe(true);
    const fk = draft();
    fk.columns[2] = { ...fk.columns[2], fk: { table: 'teachers', column: 'teacher_id' } };
    expect(buildTableSql(fk, ctx).errors.some((e) => e.includes('teachers.teacher_id을 찾을 수 없어요'))).toBe(true);
    const typ = draft({ rows: [{ key: 'r', cells: { a: '하나', b: 'x' } }] });
    expect(buildTableSql(typ, ctx).errors).toContain("1행 '번호': '하나'는 정수(INTEGER)가 아니에요.");
    expect(buildTableSql({ ...draft(), columns: [] }, ctx).errors).toContain('열을 하나 이상 만들어 주세요.');
  });

  it('INTEGER 단일 기본키는 비워 두면 자동 번호(NULL 허용)', () => {
    const r = buildTableSql(draft({ rows: [{ key: 'r', cells: { b: '메모만' } }] }), ctx);
    expect(r.errors).toEqual([]);
    expect(r.sql).toContain("(NULL, '메모만', NULL)");
  });

  it('기본 양식: 열 2개(번호 PK, 이름), 빈 행 1개, 표 이름만 채우면 된다', () => {
    const d = emptyDraft();
    expect(d.columns.map((c) => [c.name, c.type, c.pk])).toEqual([['번호', 'INTEGER', true], ['이름', 'TEXT', false]]);
    expect(buildTableSql(d, ctx).errors).toEqual(['표 이름을 입력해 주세요.']);
    expect(buildTableSql({ ...d, tableName: '새표' }, ctx)).toMatchObject({ errors: [], rowCount: 0 });
  });
});

describe('ERD 자동 배치', () => {
  const schemaOf = (base: Parameters<typeof openBaseDb>[1]): DbSchema => {
    const db = openBaseDb(SQL, base);
    try {
      return readSchema(db);
    } finally {
      db.close();
    }
  };
  const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it('외래키 의존 단계로 열을 나눈다(가리키는 표가 왼쪽)', () => {
    const lv = erdLevels(schemaOf('preset:class-schedule'));
    expect(Object.fromEntries(lv)).toEqual({ class_students: 2, classes: 1, students: 0, subjects: 0, teachers: 0 });
  });

  it('상자는 겹치지 않고, 선은 외래키마다 하나이며 까마귀발(from)은 외래키 표에 붙는다', () => {
    for (const p of PLAYGROUND_PRESETS) {
      const s = schemaOf(presetBase(p.id));
      const l = layoutErd(s);
      for (let i = 0; i < l.boxes.length; i++) for (let j = i + 1; j < l.boxes.length; j++) expect(overlap(l.boxes[i], l.boxes[j]), `${p.id}`).toBe(false);
      for (const b of l.boxes) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(l.width);
        expect(b.y + b.h).toBeLessThanOrEqual(l.height);
      }
      expect(l.edges.length).toBe(s.tables.reduce((n, t) => n + t.fks.length, 0));
      for (const e of l.edges) {
        const fromBox = l.boxes.find((b) => b.name === e.from.table)!;
        const toBox = l.boxes.find((b) => b.name === e.to.table)!;
        expect(fromBox.level).toBeGreaterThan(toBox.level);
        expect(e.from.x).toBe(fromBox.x); // 외래키 표의 왼쪽 변
        expect(e.to.x).toBe(toBox.x + toBox.w); // 가리키는 표의 오른쪽 변
        expect(e.from.y).toBe(fromBox.rows.find((r) => r.name === e.from.column)!.cy);
        expect(e.path).toMatch(/^M[\d.]+ [\d.]+ L/);
        expect(e.optional).toBe(false); // 예시의 외래키 열은 모두 NOT NULL
      }
    }
  });

  it('두 칸 이상 떨어진 선은 가운데 칸의 상자를 지나지 않는다', () => {
    const l = layoutErd(schemaOf('preset:class-schedule'));
    const e = l.edges.find((x) => x.from.table === 'class_students' && x.to.table === 'students')!;
    const mid = l.boxes.find((b) => b.name === 'classes')!;
    // 경로의 수평 구간(lane) y가 classes 상자 세로 범위 밖이어야 한다
    const ys = [...e.path.matchAll(/L([\d.]+) ([\d.]+)/g)].map((m) => Number(m[2]));
    const lane = ys.find((y) => y !== e.from.y && y !== e.to.y)!;
    expect(lane < mid.y || lane > mid.y + mid.h).toBe(true);
  });

  it('자기 참조(동아리 조직도)는 같은 상자 오른쪽 고리, NULL 허용이면 optional', () => {
    const s = schemaOf('clubs');
    const l = layoutErd({ tables: s.tables.filter((t) => t.name === 'clubs_tree') });
    expect(l.edges).toHaveLength(1);
    const e = l.edges[0];
    expect(e.self).toBe(true);
    expect(e.optional).toBe(true);
    expect(e.from.dir).toBe(1);
    expect(l.width).toBeGreaterThan(l.boxes[0].x + l.boxes[0].w);
  });

  it('서로를 가리키는 순환 관계·그림에 없는 표도 멈추지 않는다', () => {
    const cyc: DbSchema = {
      tables: [
        { name: 'a', rowCount: 0, columns: [{ name: 'id', type: 'INTEGER', pk: true, notnull: false, unique: true }, { name: 'b_id', type: 'INTEGER', pk: false, notnull: false, unique: false }], fks: [{ from: 'b_id', table: 'b', to: 'id' }] },
        { name: 'b', rowCount: 0, columns: [{ name: 'id', type: 'INTEGER', pk: true, notnull: false, unique: true }, { name: 'a_id', type: 'INTEGER', pk: false, notnull: false, unique: false }], fks: [{ from: 'a_id', table: 'a', to: 'id' }, { from: 'id', table: 'zzz', to: 'id' }] },
      ],
    };
    const l = layoutErd(cyc);
    expect(l.boxes).toHaveLength(2);
    expect(l.edges).toHaveLength(2); // zzz는 그림에 없어 선 없음
    expect(describeSchema(cyc).relations.some((r) => r.includes('그림에 없어요'))).toBe(true);
    expect(layoutErd({ tables: [] })).toEqual({ width: 0, height: 0, boxes: [], edges: [] });
  });

  it('글 요약: 표·열·관계를 문장으로', () => {
    const d = describeSchema(schemaOf('preset:student-scores'));
    expect(d.tables).toContain('subjects 표, 5행: subject_id(INTEGER, 기본키), subject_name(TEXT, 필수), credits(INTEGER, 필수)');
    expect(d.relations).toContain('scores.student_id → students.student_id: students 한 행에 scores 여러 행이 연결돼요(1:N).');
  });

  it('글자 폭 어림: 한글은 영문보다 넓다', () => {
    expect(textWidth('가나', 10)).toBe(20);
    expect(textWidth('ab', 10)).toBe(13);
  });
});
