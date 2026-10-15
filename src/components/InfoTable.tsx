/** 설명용 작은 표(이론 카드·요약). 첫 열은 행 머리로 읽는다 */
export interface InfoTableData {
  caption?: string;
  header: string[];
  rows: string[][];
}

export function InfoTable({ t }: { t: InfoTableData }) {
  return (
    <div className="table-wrap">
      <table className="data cg-table">
        {t.caption && <caption>{t.caption}</caption>}
        <thead><tr>{t.header.map((h, i) => <th scope="col" key={i}>{h}</th>)}</tr></thead>
        <tbody>{t.rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th scope="row" key={j}>{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody>
      </table>
    </div>
  );
}
