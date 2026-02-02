import { CompensationList } from "../components/CompensationList";
import styles from "../page.module.css";
import { Receipt } from "../types";
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

export default async function CompensationsPage() {
  const receiptsRes = await getJson("/api/receipts?limit=500");
  const receipts: Receipt[] = Array.isArray(receiptsRes.data) ? receiptsRes.data : [];
  const selfPaidAll = receipts.filter((r) => r.paidByDriver);

  return (
    <div>
      <h1 className={styles.pageTitle}>Компенсация</h1>
      <CompensationList items={selfPaidAll} />
    </div>
  );
}
