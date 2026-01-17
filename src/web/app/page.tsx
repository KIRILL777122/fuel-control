import styles from "./page.module.css";
import ReceiptTable from "./components/ReceiptTable";
import { DriverForm, VehicleForm } from "./components/Forms";
import { Driver, Vehicle, Receipt } from "./types";
import AuthGuard from "./components/AuthGuard";
import LogoutButton from "./components/LogoutButton";
import { CompensationList } from "./components/CompensationList";
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

function ListSection({ title, rows }: { title: string; rows: any }) {
  const arr = Array.isArray(rows) ? rows : null;
  return (
    <section style={{ marginTop: 16 }}>
      <h2 style={{ margin: "12px 0 6px" }}>{title}</h2>
      {!arr && (
        <pre style={{ padding: 12, background: "#f6f6f6", borderRadius: 8, overflow: "auto" }}>
          {JSON.stringify(rows, null, 2)}
        </pre>
      )}
      {arr && arr.length === 0 && <p style={{ opacity: 0.7 }}>Пусто</p>}
      {arr && arr.length > 0 && (
        <pre style={{ padding: 12, background: "#f6f6f6", borderRadius: 8, overflow: "auto", maxHeight: 320 }}>
          {JSON.stringify(arr.slice(0, 50), null, 2)}
        </pre>
      )}
    </section>
  );
}

export default async function Home() {
  const [health, driversRes, vehiclesRes, receiptsRes, summaryRes] = await Promise.all([
    getJson("/health"),
    getJson("/api/drivers"),
    getJson("/api/vehicles"),
    getJson("/api/receipts?limit=500"),
    getJson("/api/reports/summary"),
  ]);

  const drivers: Driver[] = Array.isArray(driversRes.data) ? driversRes.data : [];
  const vehicles: Vehicle[] = Array.isArray(vehiclesRes.data) ? vehiclesRes.data : [];
  const receipts: Receipt[] = Array.isArray(receiptsRes.data) ? receiptsRes.data : [];
  const summary = summaryRes?.data ?? {};
  const selfPaidAll = receipts.filter((r) => r.paidByDriver);

  return (
    <AuthGuard>
      <main style={{ padding: 24, fontFamily: "Arial" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Fuel Control</h1>
          <p style={{ marginTop: 8, opacity: 0.75 }}>Backend: {API_BASE_URL} • Web</p>
        </div>
        <LogoutButton />
      </div>

      <section style={{ marginTop: 16, padding: 12, background: "#f6f6f6", borderRadius: 8 }}>
        <div><b>Health:</b> {health.ok ? "OK" : "FAIL"} (status {health.status})</div>
        {!health.ok && (
          <pre style={{ marginTop: 8, overflow: "auto" }}>{JSON.stringify(health.data, null, 2)}</pre>
        )}
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 12 }}>
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
          <div style={{ fontSize: 12, opacity: 0.7 }}>Сумма “оплатил сам”</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{summary.selfPaidTotal ?? "—"}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <div className={styles.card}>
          <h3 style={{ marginTop: 0 }}>Водители</h3>
          <DriverForm apiBase={API_BASE_URL} />
        </div>
        <div className={styles.card}>
          <h3 style={{ marginTop: 0 }}>Авто</h3>
          <VehicleForm apiBase={API_BASE_URL} />
        </div>
      </div>

      <CompensationList items={selfPaidAll} />

      <ReceiptTable receipts={receipts} drivers={drivers} vehicles={vehicles} />

      <ListSection title={`Водители (${drivers.length})`} rows={drivers} />
      <ListSection title={`Авто (${vehicles.length})`} rows={vehicles} />
    </main>
    </AuthGuard>
  );
}
