"use client";

import React from "react";
import styles from "../page.module.css";

const API_BASE = "";

export function DriverForm({ onSave }: { onSave?: () => void }) {
  const [telegramUserId, setTg] = React.useState("");
  const [fullName, setName] = React.useState("");
  const [msg, setMsg] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    try {
      const payload = { telegramUserId: telegramUserId.trim(), fullName: fullName.trim() };
      const res = await fetch(`${API_BASE}/api/drivers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg("Сохранено");
        setTg("");
        setName("");
        onSave?.();
      } else {
        setMsg(`Ошибка: ${data?.message || data?.error || res.status}`);
      }
    } catch (err: any) {
      setMsg(`Ошибка: ${err?.message ?? err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
          Telegram ID
          <input
            required
            value={telegramUserId}
            onChange={(e) => setTg(e.target.value)}
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #d7d7e0" }}
          />
        </label>
        <label style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
          ФИО
          <input
            value={fullName}
            onChange={(e) => setName(e.target.value)}
            placeholder="Опционально"
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #d7d7e0" }}
          />
        </label>
      </div>
      <button className={styles.button} type="submit" disabled={loading} style={{ background: "#4338ca", color: "#fff", border: "none" }}>
        {loading ? "Сохраняю..." : "Добавить водителя"}
      </button>
      {msg && <div style={{ fontSize: 13, color: msg === "Сохранено" ? "#10b981" : "#ef4444", fontWeight: 600 }}>{msg}</div>}
    </form>
  );
}

export function VehicleForm({ onSave }: { onSave?: () => void }) {
  const [plateNumber, setPlate] = React.useState("");
  const [name, setName] = React.useState("");
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
        body: JSON.stringify({ plateNumber: plateNumber.trim().toUpperCase(), name: name.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg("Сохранено");
        setPlate("");
        setName("");
        onSave?.();
      } else {
        setMsg(`Ошибка: ${data?.message || data?.error || res.status}`);
      }
    } catch (err: any) {
      setMsg(`Ошибка: ${err?.message ?? err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
          Госномер
          <input
            required
            value={plateNumber}
            onChange={(e) => setPlate(e.target.value)}
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #d7d7e0" }}
          />
        </label>
        <label style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
          Название (кратко)
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Опционально"
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #d7d7e0" }}
          />
        </label>
      </div>
      <button className={styles.button} type="submit" disabled={loading} style={{ background: "#4338ca", color: "#fff", border: "none" }}>
        {loading ? "Сохраняю..." : "Добавить автомобиль"}
      </button>
      {msg && <div style={{ fontSize: 13, color: msg === "Сохранено" ? "#10b981" : "#ef4444", fontWeight: 600 }}>{msg}</div>}
    </form>
  );
}
