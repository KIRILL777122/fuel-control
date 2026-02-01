"use client";

import React from "react";
import { Vehicle, CustomList } from "../types";
import styles from "../page.module.css";

const API_BASE = "";

export function VehiclesList({
  initial = [],
  allLists = [],
  onUpdate,
}: {
  initial: Vehicle[];
  allLists?: CustomList[];
  onUpdate?: () => void;
}) {
  const [loadingId, setLoadingId] = React.useState<string | null>(null);
  const [editVehicle, setEditVehicle] = React.useState<Vehicle | null>(null);

  const startEdit = (v: Vehicle) => setEditVehicle(v);

  const saveEdit = async () => {
    if (!editVehicle) return;
    setLoadingId(editVehicle.id);
    try {
      const res = await fetch(`${API_BASE}/api/vehicles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(editVehicle),
      });
      if (res.ok) {
        setEditVehicle(null);
        onUpdate?.();
      }
    } finally {
      setLoadingId(null);
    }
  };

  const togglePin = async (v: Vehicle) => {
    setLoadingId(v.id);
    try {
      await fetch(`${API_BASE}/api/vehicles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...v, isPinned: !v.isPinned }),
      });
      onUpdate?.();
    } finally {
      setLoadingId(null);
    }
  };

  const deleteVehicle = async (id: string) => {
    if (!confirm("Удалить автомобиль?")) return;
    setLoadingId(id);
    const res = await fetch(`${API_BASE}/api/vehicles/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) {
      onUpdate?.();
    } else {
      alert("Ошибка при удалении");
    }
    setLoadingId(null);
  };

  const addToList = async (vehicleId: string, listId: string) => {
    await fetch(`${API_BASE}/api/lists/${listId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ vehicleId }),
    });
    alert("Добавлено в список");
  };

  const activeItems = initial.filter((v) => v.isActive !== false);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {activeItems.map((v) => (
        <div
          key={v.id}
          style={{
            padding: 16,
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            background: "#fff",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              <span onClick={() => togglePin(v)} style={{ cursor: "pointer", marginRight: 8 }}>
                {v.isPinned ? "⭐" : "☆"}
              </span>
              {v.plateNumber}
            </div>
            <div style={{ fontSize: 12, opacity: 0.6 }}>{v.name} {v.makeModel && `(${v.makeModel})`}</div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <select
              onChange={(e) => e.target.value && addToList(v.id, e.target.value)}
              style={{ padding: "4px 8px", borderRadius: 8, border: "1px solid #d7d7e0", fontSize: 12 }}
            >
              <option value="">+ В список</option>
              {allLists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <button onClick={() => startEdit(v)} className={styles.button} style={{ fontSize: 12 }}>
              ✏️
            </button>
            <button onClick={() => deleteVehicle(v.id)} className={styles.button} style={{ fontSize: 12, color: "#ef4444" }}>
              🗑️
            </button>
          </div>
        </div>
      ))}

      {editVehicle && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div style={{ background: "#fff", padding: 24, borderRadius: 16, width: "100%", maxWidth: 400 }}>
            <h3 style={{ marginTop: 0 }}>Редактировать авто</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={{ fontSize: 12 }}>Госномер</label>
              <input value={editVehicle.plateNumber || ""} onChange={(e) => setEditVehicle({ ...editVehicle, plateNumber: e.target.value })} placeholder="Госномер" style={{ padding: 10, borderRadius: 8, border: "1px solid #d7d7e0" }} />
              <label style={{ fontSize: 12 }}>Краткое имя</label>
              <input value={editVehicle.name || ""} onChange={(e) => setEditVehicle({ ...editVehicle, name: e.target.value })} placeholder="Краткое имя" style={{ padding: 10, borderRadius: 8, border: "1px solid #d7d7e0" }} />
              <label style={{ fontSize: 12 }}>Марка/Модель</label>
              <input value={editVehicle.makeModel || ""} onChange={(e) => setEditVehicle({ ...editVehicle, makeModel: e.target.value })} placeholder="Марка/Модель" style={{ padding: 10, borderRadius: 8, border: "1px solid #d7d7e0" }} />
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button onClick={saveEdit} className={styles.button} style={{ flex: 1, background: "#4338ca", color: "#fff" }}>
                  Сохранить
                </button>
                <button onClick={() => setEditVehicle(null)} className={styles.button} style={{ flex: 1 }}>
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
