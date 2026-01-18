import styles from "./page.module.css";
import SummaryStats from "./components/SummaryStats";
export const dynamic = "force-dynamic";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3000";

async function getJson(path: string) {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e: any) {
    return { ok: false, status: 0, data: { error: String(e?.message ?? e) } };
  }
}

export default async function SummaryPage() {
  const [receiptsRes, summaryRes] = await Promise.all([
    getJson("/api/receipts?limit=500"),
    getJson("/api/reports/summary"),
  ]);

  const receipts: any[] = Array.isArray(receiptsRes.data) ? receiptsRes.data : [];
  const summary = summaryRes?.data ?? {};

  return (
    <div>
      <h1 style={{ margin: "0 0 24px 0" }}>Сводка</h1>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <div className={styles.card}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Чеки</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{Array.isArray(receipts) ? receipts.length : "—"}</div>
        </div>
        <div className={styles.card}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Сумма</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{summary.totalAmount ?? "—"}</div>
        </div>
        <div className={styles.card}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Литры</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{summary.totalLiters ?? "—"}</div>
        </div>
        <div className={styles.card}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Средн. л/100</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{summary.avgLPer100 ?? "—"}</div>
        </div>
        <div className={styles.card}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Оплатил сам (кол-во)</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{summary.paidByDriverCount ?? "—"}</div>
        </div>
        <div className={styles.card}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Компенсация выплачена</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{summary.reimbursedCount ?? "—"}</div>
        </div>
        <div className={styles.card}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Сумма "оплатил сам"</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{summary.selfPaidTotal ?? "—"}</div>
        </div>
      </div>
      <SummaryStats receipts={receipts} />
    </div>
  );
}
