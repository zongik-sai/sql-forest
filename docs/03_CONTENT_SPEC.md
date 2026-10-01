# 콘텐츠 데이터와 활동 제작 규격

## 필수 콘텐츠 양
12단원×4개=48개 핵심 활동, 12단원×3개=36개 체크포인트, 최초 진단 5문항, 최종 진단 12문항. 체크포인트는 각 개념의 변형 재도전 문항을 최소 1개 추가한다(별도 36문항). 빈칸형·결과 예측·직접 SQL·조작 활동을 섞고 객관식만으로 채우지 않는다. 각 단원 4개 활동 중 최소 2개는 직접 SQL 실행 또는 의미 있는 시각 조작이다.

## 스키마
```ts
type ActivityKind = 'erd'|'normalize'|'sql-blocks'|'predict-result'|
  'sql-editor'|'row-filter'|'join-visualizer'|'group-visualizer'|
  'window-visualizer'|'transaction'|'pivot'|'hierarchy'|'classify';
interface LessonActivity {
  id: string; unitId: string; contentVersion: number;
  title: string; objective: string; estimatedMinutes: number;
  explanation: string; glossary: {term:string; meaning:string}[];
  kind: ActivityKind; mode:'executable'|'simulation'|'dialect-comparison';
  datasetId: string; prompt: string; starterSql?: string;
  prediction?: {prompt:string; options:string[]; correctIndex:number};
  hints: [string,string,string];
  solution: {sql?:string; reasoning:string; commonMistakes:string[]};
  rubric: {type:'result'|'state'|'choices'; ordered?:boolean; targetId:string};
  conceptTags:string[]; dialectNotes?:string[];
}
```
활동 설정은 kind별 discriminated union으로 확장한다. 임의 any를 사용하지 않는다. 정답·채점 데이터는 별도 데이터 모듈로 관리한다. 이 앱은 학습용이므로 클라이언트 정답을 완전 은닉할 수 없음을 문서화하고 고위험 시험 보안으로 주장하지 않는다.

## 예시: U04-A04
- 목표: NULL이 포함된 NOT IN과 NOT EXISTS의 차이를 이해한다.
- 설명: NULL은 값이 없거나 알려지지 않았다는 뜻이다. NULL과 비교한 결과는 TRUE나 FALSE가 아닌 UNKNOWN이 될 수 있다. WHERE는 TRUE인 행만 남긴다.
- 데이터: DATA_AND_SQL의 students와 enrollment. 비교용 값 목록은 `[1, NULL]`을 별도로 제공한다.
- 1단계: `SELECT student_id FROM students WHERE student_id NOT IN (1, NULL);`의 결과를 예측한다. 정답: 0행.
- 2단계: 실제 실행하고 학생 ID별 TRUE/FALSE/UNKNOWN 표를 클릭해 확인한다.
- 3단계: 수강하지 않은 학생을 NOT EXISTS로 찾는 SQL을 작성한다.
- 정답: `SELECT s.student_id FROM students s WHERE NOT EXISTS (SELECT 1 FROM enrollment e WHERE e.student_id=s.student_id) ORDER BY s.student_id;` 결과 4,5.
- 힌트: ①'해당 학생의 수강 행이 없는 경우'를 찾는다 ②서브쿼리에서 외부 학생 ID와 연결한다 ③NOT EXISTS 구조를 제공한다.
- 피드백: 결과 0행은 데이터가 없는 것이 아니라 조건이 UNKNOWN이기 때문이다. 실제 enrollment.student_id는 NOT NULL이므로 그 열 자체에 NULL이 있다고 설명하지 않는다.

## 공통 피드백
정답이면 어떤 데이터가 조건을 만족했는지 한 줄, 오답이면 첫 차이 행과 개념 이유를 제시한다. 힌트 1=개념, 2=접근 방법, 3=구조/부분 SQL. 정답 보기는 사용자의 명시 클릭 후 제공한다. 한번에 전체 해설을 펼치지 않는다.

데이터 변경 시 예측과 채점 결과가 함께 갱신되어야 한다. 결과를 하드코딩해 실행 결과처럼 표시하지 않는다. 시뮬레이션은 제한된 예제에 대해 수학적으로 검증한 변환 결과를 제공하고 임의 SQL 실행기로 포장하지 않는다.
