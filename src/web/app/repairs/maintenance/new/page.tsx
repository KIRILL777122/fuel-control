"use client";

import React from "react";
import { useRouter } from "next/navigation";
import styles from "../../../page.module.css";

const API_BASE = "";

export default function MaintenanceNewPage() {
  const router = useRouter();
  const [vehicles, setVehicles] = React.useState<any[]>([]);
  const [form, setForm] = React.useState({ vehicleId: "", name: "", intervalKm: "", intervalDays: "" });

  React.useEffect(() => {
    fetch(`${API_BASE}/api/vehicles`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setVehicles(Array.isArray(data) ? data : []));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch(`${API_BASE}/api/maintenance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(form),
    });
    router.push("/repairs");
  };

  return (
    <div>
      <h1 style={{ margin: "0 0 24px 0" }}>Новый пункт ТО</h1>
      <form onSubmit={submit} style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e9e9f2", display: "grid", gap: 12 }}>
        <select value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })} required>
          <option value="">Выберите авто</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.plateNumber}
            </option>
          ))}
        </select>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Пункт ТО" required />
        <input value={form.intervalKm} onChange={(e) => setForm({ ...form, intervalKm: e.target.value })} placeholder="Интервал, км" />
        <input value={form.intervalDays} onChange={(e) => setForm({ ...form, intervalDays: e.target.value })} placeholder="Интервал, дней" />
        <button className={styles.button} type="submit">
          Сохранить
        </button>
      </form>
    </div>
  );
}
