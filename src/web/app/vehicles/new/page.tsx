"use client";

import React from "react";
import { useRouter } from "next/navigation";
import styles from "../../page.module.css";

const API_BASE = "";

export default function VehicleCreatePage() {
  const router = useRouter();
  const [form, setForm] = React.useState({
    plateNumber: "",
    makeModel: "",
    year: "",
    vin: "",
    engine: "",
    color: "",
    purchasedAt: "",
    purchasedOdometerKm: "",
    notes: "",
  });
  const [msg, setMsg] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/vehicles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          plateNumber: form.plateNumber,
          makeModel: form.makeModel,
          year: form.year,
          vin: form.vin,
          engine: form.engine,
          color: form.color,
          purchasedAt: form.purchasedAt || null,
          purchasedOdometerKm: form.purchasedOdometerKm,
          notes: form.notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(`Ошибка: ${data?.message || data?.error || res.status}`);
        return;
      }
      router.push(`/vehicles/${data.id}`);
    } catch (err: any) {
      setMsg(`Ошибка: ${err?.message ?? err}`);
    } finally {
      setLoading(false);
    }
  };

  const update = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div>
      <h1 style={{ margin: "0 0 24px 0" }}>Новое авто</h1>
      <form onSubmit={submit} style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e9e9f2", display: "grid", gap: 12 }}>
        <label>
          Госномер*
          <input
            required
            value={form.plateNumber}
            onChange={(e) => update("plateNumber", e.target.value)}
            style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
          />
        </label>
        <label>
          Марка/модель
          <input
            value={form.makeModel}
            onChange={(e) => update("makeModel", e.target.value)}
            style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
          />
        </label>
        <label>
          Год
          <input
            value={form.year}
            onChange={(e) => update("year", e.target.value)}
            type="number"
            style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
          />
        </label>
        <label>
          VIN
          <input
            value={form.vin}
            onChange={(e) => update("vin", e.target.value)}
            style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
          />
        </label>
        <label>
          Двигатель
          <input
            value={form.engine}
            onChange={(e) => update("engine", e.target.value)}
            style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
          />
        </label>
        <label>
          Цвет
          <input
            value={form.color}
            onChange={(e) => update("color", e.target.value)}
            style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
          />
        </label>
        <label>
          Дата покупки
          <input
            value={form.purchasedAt}
            onChange={(e) => update("purchasedAt", e.target.value)}
            type="date"
            style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
          />
        </label>
        <label>
          Пробег при покупке
          <input
            value={form.purchasedOdometerKm}
            onChange={(e) => update("purchasedOdometerKm", e.target.value)}
            type="number"
            style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
          />
        </label>
        <label>
          Заметки
          <textarea
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
          />
        </label>
        <button className={styles.button} type="submit" disabled={loading}>
          {loading ? "Сохраняю..." : "Сохранить"}
        </button>
        {msg && <div style={{ fontSize: 12 }}>{msg}</div>}
      </form>
    </div>
  );
}
