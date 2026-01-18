import ReceiptTable from "../components/ReceiptTable";
import { Driver, Vehicle, Receipt } from "../types";
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

export default async function ReceiptsPage() {
  const [driversRes, vehiclesRes, receiptsRes] = await Promise.all([
    getJson("/api/drivers"),
    getJson("/api/vehicles"),
    getJson("/api/receipts?limit=500"),
  ]);

  const drivers: Driver[] = Array.isArray(driversRes.data) ? driversRes.data : [];
  const vehicles: Vehicle[] = Array.isArray(vehiclesRes.data) ? vehiclesRes.data : [];
  const receipts: Receipt[] = Array.isArray(receiptsRes.data) ? receiptsRes.data : [];

  return (
    <div>
      <h1 style={{ margin: "0 0 24px 0" }}>Чеки</h1>
      <ReceiptTable receipts={receipts} drivers={drivers} vehicles={vehicles} />
    </div>
  );
}
