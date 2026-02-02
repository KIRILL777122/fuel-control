"use client";

import React from "react";
import { Driver, CustomList, DriverPaymentDetail } from "../types";
import styles from "../page.module.css";

const API_BASE = "";

export function DriversList({
  items,
  allLists = [],
  onUpdate,
}: {
  items: Driver[];
  allLists?: CustomList[];
  onUpdate?: () => void;
}) {
  const [loadingId, setLoadingId] = React.useState<string | null>(null);
  const [editDriver, setEditId] = React.useState<Driver | null>(null);

  const [details, setDetails] = React.useState<DriverPaymentDetail[]>([]);
  const [showDetails, setShowDetails] = React.useState<string | null>(null);
  const [newDetType, setNewDetType] = React.useState("SBP");
  const [newDetBank, setNewDetBank] = React.useState("");
  const [newDetAcc, setNewDetAcc] = React.useState("");

  const startEdit = (d: Driver) => setEditId(d);

  const saveEdit = async () => {
    if (!editDriver) return;
    setLoadingId(editDriver.id);
    try {
      const res = await fetch(`${API_BASE}/api/drivers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(editDriver),
      });
      if (res.ok) {
        setEditId(null);
        onUpdate?.();
      }
    } finally {
      setLoadingId(null);
    }
  };

  const togglePin = async (d: Driver) => {
    setLoadingId(d.id);
    try {
      await fetch(`${API_BASE}/api/drivers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...d, isPinned: !d.isPinned }),
      });
      onUpdate?.();
    } finally {
      setLoadingId(null);
    }
  };

  const deleteDriver = async (id: string) => {
    if (!confirm("Удалить водителя?")) return;
    setLoadingId(id);
    const res = await fetch(`${API_BASE}/api/drivers/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) {
      onUpdate?.();
    } else {
      alert("Ошибка при удалении");
    }
    setLoadingId(null);
  };

  const addToList = async (driverId: string, listId: string) => {
    await fetch(`${API_BASE}/api/lists/${listId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ driverId }),
    });
    alert("Добавлено в список");
  };

  const loadDetails = async (driverId: string) => {
    const res = await fetch(`${API_BASE}/api/drivers/${driverId}/payment-details`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      setDetails(data);
      setShowDetails(driverId);
    }
  };

  const saveDetail = async () => {
    if (!showDetails || !newDetAcc) return;
    const res = await fetch(`${API_BASE}/api/payment-details`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        driverId: showDetails,
        type: newDetType,
        bankName: newDetBank,
        account: newDetAcc,
      }),
    });
    if (res.ok) {
      setNewDetAcc("");
      setNewDetBank("");
      loadDetails(showDetails);
    }
  };

  const deleteDetail = async (id: string) => {
    if (!confirm("Удалить реквизиты?")) return;
    await fetch(`${API_BASE}/api/payment-details/${id}`, { method: "DELETE", credentials: "include" });
    if (showDetails) loadDetails(showDetails);
  };

  const activeItems = items.filter((d) => d.isActive !== false);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {activeItems.map((d) => (
        <div
          key={d.id}
          style={{
            padding: 16,
            borderRadius: 12,
            border: "1px solid var(--card-border)",
            background: "var(--card-bg)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              {d.fullName || d.telegramUserId}
            </div>
            <div style={{ fontSize: 12, opacity: 0.6 }}>ID: {d.telegramUserId}</div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => loadDetails(d.id)}
              className={styles.button}
              style={{ fontSize: 12, background: "var(--status-done-bg)", color: "var(--status-done-text)", borderColor: "var(--status-done-bg)" }}
            >
              💳 Реквизиты
            </button>
            <select
              onChange={(e) => e.target.value && addToList(d.id, e.target.value)}
              className={styles.select}
            >
              <option value="">+ В список</option>
              {allLists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <button onClick={() => startEdit(d)} className={styles.button} style={{ fontSize: 12 }}>
              ✏️
            </button>
            <button onClick={() => deleteDriver(d.id)} className={styles.button} style={{ fontSize: 12, color: "var(--danger-text)" }}>
              🗑️
            </button>
          </div>
        </div>
      ))}

      {editDriver && (
        <div className={styles.detailOverlay}>
          <div className={styles.detailCard} style={{ maxWidth: 400 }}>
            <h3 style={{ marginTop: 0 }}>Редактировать водителя</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label className={styles.field}>ФИО</label>
              <input
                value={editDriver.fullName || ""}
                onChange={(e) => setEditId({ ...editDriver, fullName: e.target.value })}
                placeholder="ФИО"
                className={styles.input}
              />
              <label className={styles.field}>Telegram ID</label>
              <input
                value={editDriver.telegramUserId}
                onChange={(e) => setEditId({ ...editDriver, telegramUserId: e.target.value })}
                placeholder="Telegram ID"
                className={styles.input}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button onClick={saveEdit} className={styles.button} style={{ flex: 1, background: "var(--primary-bg)", color: "var(--primary-text)" }}>
                  Сохранить
                </button>
                <button onClick={() => setEditId(null)} className={styles.button} style={{ flex: 1 }}>
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDetails && (
        <div className={styles.detailOverlay}>
          <div className={styles.detailCard} style={{ maxWidth: 500, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>Реквизиты для выплат</h3>
              <button onClick={() => setShowDetails(null)} style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer" }}>
                ×
              </button>
            </div>

            <div style={{ display: "grid", gap: 12, marginBottom: 24 }}>
              {details.length === 0 ? (
                <p style={{ opacity: 0.5, textAlign: "center" }}>Реквизиты еще не добавлены</p>
              ) : (
                details.map((det) => (
                  <div
                    key={det.id}
                    style={{ padding: 16, border: "1px solid var(--card-border)", borderRadius: 16, background: "var(--background)", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, color: "var(--text)" }}>{det.type} {det.bankName && `(${det.bankName})`}</div>
                      <div style={{ fontSize: 14, fontFamily: "monospace" }}>{det.account}</div>
                    </div>
                    <button onClick={() => deleteDetail(det.id)} style={{ color: "var(--danger-text)", background: "none", border: "none", cursor: "pointer" }}>
                      Удалить
                    </button>
                  </div>
                ))
              )}
            </div>

            <div style={{ borderTop: "1px solid var(--card-border)", paddingTop: 20 }}>
              <h4 style={{ margin: "0 0 12px" }}>Добавить реквизиты</h4>
              <div style={{ display: "grid", gap: 12 }}>
                <select value={newDetType} onChange={(e) => setNewDetType(e.target.value)} className={styles.select}>
                  <option value="SBP">СБП</option>
                  <option value="CARD">Карта</option>
                  <option value="CASH">Наличные</option>
                </select>
                <input value={newDetBank} onChange={(e) => setNewDetBank(e.target.value)} placeholder="Банк (опционально)" className={styles.input} />
                <input value={newDetAcc} onChange={(e) => setNewDetAcc(e.target.value)} placeholder="Номер счета/телефон" className={styles.input} />
                <button onClick={saveDetail} className={styles.button} style={{ background: "var(--primary-bg)", color: "var(--primary-text)" }}>
                  Добавить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
