"use client";

import React from "react";

type Driver = {
  id: string;
  fullName?: string | null;
  telegramUserId: string;
  isActive?: boolean | null;
};

const API_BASE = "";

export function DriversList({ items }: { items: Driver[] }) {
  const [list, setList] = React.useState<Driver[]>(items);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editTg, setEditTg] = React.useState("");
  const [loadingId, setLoadingId] = React.useState<string | null>(null);

  const active = list.filter((d) => d.isActive !== false);

  if (!active?.length) return <p style={{ opacity: 0.7 }}>Пусто</p>;

  const startEdit = (d: Driver) => {
    setEditId(d.id);
    setEditName(d.fullName ?? "");
    setEditTg(d.telegramUserId ?? "");
  };

  const save = async (id: string) => {
    setLoadingId(id);
    try {
      const payload = { id, fullName: editName, telegramUserId: editTg };
      const res = await fetch(`${API_BASE}/api/drivers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || data?.error || res.statusText);
      setList((prev) =>
        prev.map((d) => (d.id === id ? { ...d, fullName: data.fullName, telegramUserId: data.telegramUserId } : d))
      );
      setEditId(null);
    } catch (err: any) {
      alert(`Не удалось сохранить: ${err?.message ?? err}`);
    } finally {
      setLoadingId(null);
    }
  };

  const deactivate = async (id: string) => {
    setLoadingId(id);
    try {
      const res = await fetch(`${API_BASE}/api/drivers/${id}/deactivate`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || data?.error || res.statusText);
      setList((prev) => prev.map((d) => (d.id === id ? { ...d, isActive: false } : d)));
    } catch (err: any) {
      alert(`Не удалось удалить: ${err?.message ?? err}`);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {active.map((d) => (
        <div
          key={d.id}
          style={{
            border: "1px solid #d7d7e0",
            borderRadius: 8,
            padding: 8,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {editId === d.id ? (
            <>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="ФИО"
                style={{ padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
              />
              <input
                value={editTg}
                onChange={(e) => setEditTg(e.target.value)}
                placeholder="Telegram ID"
                style={{ padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: "#4b7bec", color: "#fff" }}
                  disabled={loadingId === d.id}
                  onClick={() => save(d.id)}
                >
                  {loadingId === d.id ? "Сохраняю..." : "Сохранить"}
                </button>
                <button
                  style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ccc", background: "#f6f6f6" }}
                  onClick={() => setEditId(null)}
                >
                  Отмена
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700 }}>{d.fullName || d.telegramUserId}</div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>Telegram ID: {d.telegramUserId}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  style={{ padding: "6px 10px", borderRadius: 8, border: "none", background: "#4b7bec", color: "#fff" }}
                  onClick={() => startEdit(d)}
                >
                  Редактировать
                </button>
                <button
                  style={{ padding: "6px 10px", borderRadius: 8, border: "none", background: "#fdd", color: "#900" }}
                  disabled={loadingId === d.id}
                  onClick={() => deactivate(d.id)}
                >
                  {loadingId === d.id ? "Удаляю..." : "Удалить"}
                </button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
