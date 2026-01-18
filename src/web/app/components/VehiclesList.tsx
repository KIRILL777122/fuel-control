 "use client";

import React from "react";
import styles from "../page.module.css";

type Vehicle = {
  id: string;
  plateNumber: string | null;
  name: string | null;
  isActive?: boolean | null;
};

const API_BASE = "";

export function VehiclesList({ initial }: { initial: Vehicle[] }) {
  const [items, setItems] = React.useState<Vehicle[]>(initial);
  const [loadingId, setLoadingId] = React.useState<string | null>(null);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [editPlate, setEditPlate] = React.useState("");
  const [editName, setEditName] = React.useState("");
  const active = items.filter((v) => v.isActive !== false);

  const deactivate = async (id: string) => {
    if (!window.confirm("Удалить авто?")) return;
    setLoadingId(id);
    try {
      const res = await fetch(`${API_BASE}/api/vehicles/${id}/deactivate`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      setItems((prev) => prev.map((v) => (v.id === id ? { ...v, isActive: false } : v)));
    } catch (err: any) {
      alert(`Не удалось удалить: ${err?.message ?? err}`);
    } finally {
      setLoadingId(null);
    }
  };

  const startEdit = (v: Vehicle) => {
    setEditId(v.id);
    setEditPlate(v.plateNumber ?? "");
    setEditName(v.name ?? "");
  };

  const saveEdit = async (id: string) => {
    setLoadingId(id);
    try {
      const payload = { id, plateNumber: editPlate, name: editName };
      const res = await fetch(`${API_BASE}/api/vehicles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error || res.statusText);
      }
      setItems((prev) =>
        prev.map((v) => (v.id === id ? { ...v, plateNumber: data.plateNumber, name: data.name, isActive: data.isActive } : v))
      );
      setEditId(null);
    } catch (err: any) {
      alert(`Не удалось сохранить: ${err?.message ?? err}`);
    } finally {
      setLoadingId(null);
    }
  };

  if (active.length === 0) return <p style={{ opacity: 0.7 }}>Пусто</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {active.map((v) => (
        <div
          key={v.id}
          style={{
            border: "1px solid #d7d7e0",
            borderRadius: 8,
            padding: 8,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          {editId === v.id ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
              <input
                value={editPlate}
                onChange={(e) => setEditPlate(e.target.value)}
                placeholder="Госномер"
                style={{ padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
              />
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Название"
                style={{ padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className={styles.button}
                  disabled={loadingId === v.id}
                  onClick={() => saveEdit(v.id)}
                >
                  {loadingId === v.id ? "Сохраняю..." : "Сохранить"}
                </button>
                <button
                  className={styles.button}
                  style={{ background: "#eee", color: "#333" }}
                  onClick={() => setEditId(null)}
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <div style={{ fontWeight: 700 }}>{v.plateNumber ?? "—"}</div>
                {v.name && <div style={{ fontSize: 12, opacity: 0.75 }}>{v.name}</div>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className={styles.button} onClick={() => startEdit(v)}>
                  Редактировать
                </button>
                <button
                  className={styles.button}
                  style={{ background: "#fdd", color: "#900" }}
                  disabled={loadingId === v.id}
                  onClick={() => deactivate(v.id)}
                >
                  {loadingId === v.id ? "Удаляю..." : "Удалить"}
                </button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
