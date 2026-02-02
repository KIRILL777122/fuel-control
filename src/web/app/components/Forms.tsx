"use client";

import React from "react";
import styles from "../page.module.css";

// Use relative URLs so requests go via the same origin (Caddy) and cookies work.
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
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label className={styles.field}>
        Telegram ID
        <input
          required
          value={telegramUserId}
          onChange={(e) => setTg(e.target.value)}
          className={styles.input}
        />
      </label>
      <label className={styles.field}>
        ФИО
        <input
          value={fullName}
          onChange={(e) => setName(e.target.value)}
          placeholder="Опционально"
          className={styles.input}
        />
      </label>
      <button className={styles.button} type="submit" disabled={loading}>
        {loading ? "Сохраняю..." : "Сохранить"}
      </button>
      {msg && <div style={{ fontSize: 12, opacity: 0.8 }}>{msg}</div>}
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
        body: JSON.stringify({ plateNumber, name }),
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
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label className={styles.field}>
        Госномер
        <input
          value={plateNumber}
          onChange={(e) => setPlate(e.target.value)}
          className={styles.input}
        />
      </label>
      <label className={styles.field}>
        Название
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Опционально"
          className={styles.input}
        />
      </label>
      <button className={styles.button} type="submit" disabled={loading}>
        {loading ? "Сохраняю..." : "Сохранить"}
      </button>
      {msg && <div style={{ fontSize: 12, opacity: 0.8 }}>{msg}</div>}
    </form>
  );
}
