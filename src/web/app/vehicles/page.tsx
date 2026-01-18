"use client";

import React from "react";
import Link from "next/link";
import styles from "../page.module.css";

const API_BASE = "";

type Vehicle = {
  id: string;
  plateNumber: string;
  makeModel?: string | null;
  year?: number | null;
  vin?: string | null;
  engine?: string | null;
  currentOdometerKm?: number | null;
};

async function getJson(path: string) {
  try {
    const res = await fetch(`${API_BASE}${path}`, { cache: "no-store", credentials: "include" });
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

export default function VehiclesPage() {
  const [items, setItems] = React.useState<Vehicle[]>([]);
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    async function load() {
      setLoading(true);
      const res = await getJson("/api/vehicles");
      setItems(Array.isArray(res.data) ? res.data : []);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = items.filter((item) => {
    const target = `${item.plateNumber} ${item.makeModel ?? ""}`.toLowerCase();
    return target.includes(query.toLowerCase());
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Авто</h1>
        <Link className={styles.button} href="/vehicles/new">
          + Добавить авто
        </Link>
      </div>

      <div style={{ marginBottom: 12 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по госномеру или модели"
          style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #d7d7e0" }}
        />
      </div>

      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e9e9f2", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", background: "#f8f8fb" }}>
              <th style={{ padding: 12 }}>Госномер</th>
              <th style={{ padding: 12 }}>Модель</th>
              <th style={{ padding: 12 }}>Год</th>
              <th style={{ padding: 12 }}>VIN</th>
              <th style={{ padding: 12 }}>Двигатель</th>
              <th style={{ padding: 12 }}>Текущий пробег</th>
              <th style={{ padding: 12 }}>Статус ТО</th>
              <th style={{ padding: 12 }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} style={{ padding: 12 }}>Загрузка...</td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 12, opacity: 0.7 }}>Нет данных</td>
              </tr>
            )}
            {filtered.map((item) => (
              <tr key={item.id} style={{ borderTop: "1px solid #eee" }}>
                <td style={{ padding: 12, fontWeight: 600 }}>{item.plateNumber}</td>
                <td style={{ padding: 12 }}>{item.makeModel ?? "—"}</td>
                <td style={{ padding: 12 }}>{item.year ?? "—"}</td>
                <td style={{ padding: 12 }}>{item.vin ?? "—"}</td>
                <td style={{ padding: 12 }}>{item.engine ?? "—"}</td>
                <td style={{ padding: 12 }}>{item.currentOdometerKm ? `${item.currentOdometerKm} км` : "—"}</td>
                <td style={{ padding: 12 }}>—</td>
                <td style={{ padding: 12 }}>
                  <Link className={styles.button} href={`/vehicles/${item.id}`}>
                    Открыть
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
