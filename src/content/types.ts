/**
 * 학습 콘텐츠 타입.
 * - 모든 콘텐츠는 안정적인 문자열 ID(U01-A01, U01-Q01, U01-Q01V, P01, F01, CH-U01)를 갖는다.
 * - 진도 ID로 배열 위치를 쓰지 않는다.
 * - contentVersion은 문구/데이터 수정 시 올리며, XP 보상 ID(entitlement)와는 분리된다.
 *
 * 주의: 학습용 앱이므로 정답·채점 데이터가 클라이언트 번들에 포함된다.
 * 이것은 고위험 시험 보안을 제공하지 않는다(README '신뢰 경계' 참고).
 */

export type UnitId =
  | 'U01' | 'U02' | 'U03' | 'U04' | 'U05' | 'U06'
  | 'U07' | 'U08' | 'U09' | 'U10' | 'U11' | 'U12';

export type ActivityKind =
  | 'erd' | 'normalize' | 'sql-blocks' | 'predict-result'
  | 'sql-editor' | 'row-filter' | 'join-visualizer' | 'group-visualizer'
  | 'window-visualizer' | 'transaction' | 'pivot' | 'hierarchy' | 'classify';

/** executable: SQLite에서 실제 실행 / simulation: 제한된 예제의 검증된 변환 / dialect-comparison: DBMS 문법 비교 */
export type ExecMode = 'executable' | 'simulation' | 'dialect-comparison';

export type DatasetId = 'school' | 'normal' | 'points' | 'clubs' | 'monthly' | 'sandbox';

export interface GlossaryItem { term: string; meaning: string }

export interface Prediction {
  prompt: string;
  options: string[];
  correctIndex: number;
  /** 예측 후 보여주는 한 줄 설명 */
  reveal: string;
  /** 데이터에 의존하는 정답이면 기준 DB에서 이 SQL의 첫 값이 정답 선택지에 들어 있어야 한다(테스트로 검증) */
  verifySql?: string;
}

export interface RunnableSql { label: string; sql: string }

export interface Solution {
  sql?: string;
  reasoning: string;
  commonMistakes: string[];
}

export interface Rubric {
  type: 'result' | 'state' | 'choices';
  ordered?: boolean;
  /** 채점 대상(정답 SQL id, 상태 id 등) */
  targetId: string;
}

/** 선택지 배정형(분류·정규화·ERD 등)의 항목 */
export interface AssignItem { id: string; label: string; detail?: string }
export interface AssignOption { id: string; label: string }

/** 정답을 정적으로 줄지, 기준 DB에서 SQL로 계산할지 */
export type AssignAnswer =
  | { source: 'static'; map: Record<string, string> }
  /** SQL 결과의 (item_id, option_id) 두 열로 정답을 만든다. */
  | { source: 'sql'; sql: string };

/* ---------- 종류별 설정 (discriminated union) ---------- */

export interface SqlEditorConfig {
  kind: 'sql-editor';
  starterSql: string;
  solutionSql: string;
  /** 문제에서 ORDER BY를 요구하면 true → 행 순서까지 비교 */
  ordered: boolean;
  /** 열 이름(별칭)까지 비교할지. 기본 false */
  checkColumnNames?: boolean;
  /** DML 과제: 학생 SQL 실행 후 상태 확인 쿼리(정답 DB와 같은 쿼리로 비교) */
  stateCheckSql?: string;
  /** 허용 문장 종류. 기본 ['select'] */
  allow?: StatementType[];
  /** 블록 보조: 클릭하면 커서 위치에 삽입되는 조각 */
  blocks?: string[];
  /** 함께 실행해 볼 수 있는 탐색용 SQL */
  explore?: RunnableSql[];
}

export interface SqlBlocksConfig {
  kind: 'sql-blocks';
  /** 정답에 필요한 블록 + 방해 블록(섞어서 보여줌) */
  blocks: string[];
  solutionSql: string;
  ordered: boolean;
}

export interface PredictResultConfig {
  kind: 'predict-result';
  /** 학생이 실행해보는 SQL (실행형) */
  sql: string;
  /** 비교용으로 함께 실행해보는 SQL들 */
  compareSql?: { label: string; sql: string }[];
  /** 실행 후 결과 해석 질문 */
  check: Prediction;
}

export interface TemplateSlot {
  id: string;
  label: string;
  options: { label: string; value: string }[];
}

export interface RowFilterConfig {
  kind: 'row-filter';
  /** 학생이 조작하는 SQL 템플릿. {slotId} 자리에 선택값이 들어간다. */
  template: string;
  slots: TemplateSlot[];
  /** 정답 결과 SQL (결과 비교) */
  solutionSql: string;
  ordered: boolean;
  /** 전체 행 보기 SQL: 선택된 행 하이라이트에 사용 (첫 열이 행 ID) */
  baseSql: string;
}

export interface JoinVisualizerConfig {
  kind: 'join-visualizer';
  leftTitle: string;
  rightTitle: string;
  /** 첫 열이 행 ID, 나머지는 표시 열 */
  leftSql: string;
  rightSql: string;
  /** 학생이 만들어야 할 (left_id, right_id) 쌍. right_id가 NULL이면 '짝 없음(NULL)' */
  pairsSql: string;
  /** 짝 없는 왼쪽 행을 'NULL로 남기기'로 표시해야 하는지 (LEFT JOIN) */
  keepUnmatchedLeft: boolean;
  /** 연결 후 실제로 실행해 보여줄 JOIN SQL */
  joinSql: string;
  /** 비교해 볼 다른 조인 SQL (INNER/LEFT/RIGHT/FULL/USING 등) */
  altJoinSql?: RunnableSql[];
}

export interface GroupVisualizerConfig {
  kind: 'group-visualizer';
  /** 첫 열이 행 ID */
  rowsSql: string;
  /** (row_id, group_label) – 행을 어느 그룹 상자에 넣어야 하는지 */
  groupOfRowSql: string;
  /** (group_label, value) – 그룹별 집계 값 */
  aggregateSql: string;
  aggregateLabel: string;
  /** 실제로 실행해 보여줄 GROUP BY SQL */
  groupSql: string;
}

export interface WindowVisualizerConfig {
  kind: 'window-visualizer';
  /** 첫 열이 행 ID, 나머지 표시 열 */
  rowsSql: string;
  /** (row_id, value...) 학생이 채워야 할 값들. 열 이름이 입력 칸 제목 */
  answerSql: string;
  /** 실제 실행해 보여줄 윈도우 SQL */
  windowSql: string;
}

export interface TxAction { id: string; label: string; sql: string }
export interface TransactionConfig {
  kind: 'transaction';
  actions: TxAction[];
  /** 현재 상태를 보여주는 SQL */
  stateSql: string;
  /** 활동 시작 시 이미 실행된 SQL (예: 실수로 실행한 UPDATE) */
  initialLog: string[];
  /** 정답 상태를 만드는 동작 순서 (initialLog 뒤에 실행해 목표 상태 계산) */
  solutionActions: string[];
  /** 마지막에 COMMIT 상태(열린 트랜잭션 없음)여야 하는지 */
  requireClosed: boolean;
}

export interface PivotConfig {
  kind: 'pivot';
  /** 원본 행 SQL */
  sourceSql: string;
  /** 정답 표: 첫 열은 행 머리, 나머지 열은 학생이 채울 칸 */
  answerSql: string;
  /** 시험 문법(Oracle 등) 원문 — 실행하지 않음 */
  dialectSql: string;
  /** SQLite에서 같은 결과를 내는 대안 SQL(실제 실행) */
  equivalentSql: string;
}

export interface HierarchyConfig {
  kind: 'hierarchy';
  /** (id, parent_id, name) */
  nodesSql: string;
  /** 학생이 선택해야 할 노드 id 집합 */
  answerSql: string;
  question: string;
  /** 시험 문법(CONNECT BY 등) 원문 — 실행하지 않음 */
  dialectSql?: string;
  /** SQLite 대안(재귀 CTE/셀프조인) — 실제 실행 */
  runnable: RunnableSql[];
}

export interface ClassifyConfig {
  kind: 'classify';
  items: AssignItem[];
  options: AssignOption[];
  answer: AssignAnswer;
  /** order: 선택지가 순서 번호(1..n)이며 각 번호를 한 번만 사용 */
  layout: 'bins' | 'order';
  /** 조작 후 실제로 실행해 보여줄 SQL(선택) */
  demoSql?: string;
  /** 정규표현식 시뮬레이션: 브라우저 정규식 엔진으로 적용(SQLite에는 REGEXP 없음). 처음 맞는 패턴의 option */
  patterns?: { optionId: string; regex: string }[];
  /** patterns에 아무것도 안 맞을 때의 option */
  fallbackOptionId?: string;
}

export interface ErdConfig {
  kind: 'erd';
  entities: { id: string; name: string; attributes: string[] }[];
  relations: { id: string; from: string; to: string; question: string; options: AssignOption[] }[];
  answer: Record<string, string>;
}

export interface NormalizeConfig {
  kind: 'normalize';
  /** 비정규 표를 보여주는 SQL */
  sourceSql: string;
  columns: AssignItem[];
  tables: AssignOption[];
  answer: Record<string, string>;
  /** 분해한 표를 조인해 원래 정보를 복원하는 SQL (실제 실행) */
  rejoinSql: string;
}

export type ActivityConfig =
  | SqlEditorConfig | SqlBlocksConfig | PredictResultConfig | RowFilterConfig
  | JoinVisualizerConfig | GroupVisualizerConfig | WindowVisualizerConfig
  | TransactionConfig | PivotConfig | HierarchyConfig | ClassifyConfig
  | ErdConfig | NormalizeConfig;

export interface LessonActivity {
  id: string;
  unitId: UnitId;
  contentVersion: number;
  title: string;
  objective: string;
  estimatedMinutes: number;
  /** 2~4문장, 약 100~250자 */
  explanation: string;
  glossary: GlossaryItem[];
  kind: ActivityKind;
  mode: ExecMode;
  datasetId: DatasetId;
  prompt: string;
  prediction?: Prediction;
  hints: [string, string, string];
  solution: Solution;
  rubric: Rubric;
  conceptTags: string[];
  dialectNotes?: string[];
  config: ActivityConfig;
  /** 활동 성공 시 문구: 'JOIN으로 두 표를 연결했어요.' */
  successMessage: string;
}

/* ---------- 문항 ---------- */

export type StatementType = 'select' | 'insert' | 'update' | 'delete' | 'create' | 'drop' | 'alter' | 'tcl' | 'other';

export type QuestionBody =
  | { type: 'choice'; options: string[]; correctIndex: number }
  | { type: 'number'; answer: number }
  | {
      type: 'sql';
      datasetId: DatasetId;
      solutionSql: string;
      ordered: boolean;
      starterSql: string;
      /** 기본 ['select'] */
      allow?: StatementType[];
      stateCheckSql?: string;
    };

export type QuestionArea = 'modeling' | 'basic' | 'aggregate-join' | 'advanced' | 'management';

export interface Question {
  id: string;
  /** 체크포인트는 단원, 진단은 null */
  unitId: UnitId | null;
  set: 'checkpoint' | 'variant' | 'pre' | 'final';
  contentVersion: number;
  prompt: string;
  /** 문항이 참조하는 SQL/표 (보기 전용) */
  code?: string;
  body: QuestionBody;
  explanation: string;
  /** 오답 시 짧은 개념 복습 (정답을 직접 말하지 않음) */
  review: string;
  conceptTags: string[];
  area: QuestionArea;
  /** 변형 문항: 원문 ID */
  variantOf?: string;
  /** 데이터 의존 정답 검증 SQL (첫 값이 정답과 일치해야 함, 테스트로 검증) */
  verify?: { datasetId: DatasetId; sql: string };
}

export interface Challenge {
  id: string;
  unitId: UnitId;
  contentVersion: number;
  activity: LessonActivity;
}

export interface Unit {
  id: UnitId;
  order: number;
  title: string;
  minutes: number;
  concepts: string[];
  badgeId: string;
  badgeName: string;
  intro: string;
  activityIds: string[];
  checkpointIds: string[];
  /** 체크포인트 예상 시간 */
  checkpointMinutes: number;
  /** 시작·진단 등 단원에 포함된 기타 시간 */
  extraMinutes: number;
  extraNote?: string;
}
