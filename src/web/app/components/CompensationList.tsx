"use client";

import React from "react";
import styles from "../page.module.css";
import { Receipt } from "../types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.API_BASE_URL ||
  "http://localhost:3000";

export function CompensationList({ items }: { items: Receipt[] }) {
  const [data, setData] = React.useState(items);
  const [marking, setMarking] = React.useState<string | null>(null);
  const [downloading, setDownloading] = React.useState(false);
  const [includePaid, setIncludePaid] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [dateFrom, setDateFrom] = React.useState<string>("");
  const [dateTo, setDateTo] = React.useState<string>("");
  const [driverSearch, setDriverSearch] = React.useState<string>("");
  const [vehicleSearch, setVehicleSearch] = React.useState<string>("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const filtered = React.useMemo(() => {
    const fromTs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toTs = dateTo ? new Date(dateTo).getTime() : null;
    return data.filter((r) => {
      const ts = new Date(r.receiptAt).getTime();
      if (fromTs && ts < fromTs) return false;
      if (toTs && ts > toTs) return false;
      const driverStr = (r.driver?.fullName || r.driver?.telegramUserId || "").toLowerCase();
      const vehStr = (r.vehicle?.plateNumber || r.vehicle?.name || "").toLowerCase();
      if (driverSearch && !driverStr.includes(driverSearch.toLowerCase())) return false;
      if (vehicleSearch && !vehStr.includes(vehicleSearch.toLowerCase())) return false;
      return true;
    });
  }, [data, dateFrom, dateTo, driverSearch, vehicleSearch]);

  const visible = includePaid ? filtered : filtered.filter((r) => !r.reimbursed);

  const totalPending = filtered.filter((r) => !r.reimbursed);
  const sumPending = totalPending.reduce((acc, r) => acc + (Number(r.totalAmount) || 0), 0);
  const sumAll = filtered.reduce((acc, r) => acc + (Number(r.totalAmount) || 0), 0);

  React.useEffect(() => {
    setSelected(new Set());
  }, [includePaid]);

  React.useEffect(() => {
    const controller = new AbortController();
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("pending", "true");
        params.set("includePaid", includePaid ? "true" : "false");
        if (dateFrom) params.set("dateFrom", dateFrom);
        if (dateTo) params.set("dateTo", dateTo);
        if (driverSearch.trim()) params.set("driver", driverSearch.trim());
        if (vehicleSearch.trim()) params.set("vehicle", vehicleSearch.trim());
        params.set("limit", "300");
        const res = await fetch(`${API_BASE}/api/compensations?${params.toString()}`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (res.status === 401) {
          setError("Сессия истекла, войдите снова.");
          return;
        }
        const json = await res.json();
        if (!res.ok) {
          setError(json?.error || `HTTP ${res.status}`);
          return;
        }
        if (Array.isArray(json?.items)) {
          setData(json.items);
          setSelected(new Set());
        }
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setError(err?.message ?? String(err));
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    return () => controller.abort();
  }, [includePaid, dateFrom, dateTo, driverSearch, vehicleSearch]);

  const markReimbursed = async (id: string) => {
    setMarking(id);
    try {
      const res = await fetch(`${API_BASE}/api/receipts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reimbursed: true }),
      });
      if (res.status === 401) {
        alert("Сессия истекла, войдите снова.");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Ошибка сохранения: ${data?.error || res.status}`);
        return;
      }
      setData((prev) => prev.filter((r) => r.id !== id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } finally {
      setMarking(null);
    }
  };

  const toggleSelect = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const markSelected = async () => {
    if (selected.size === 0) return;
    setMarking("bulk");
    try {
      const ids = Array.from(selected).filter((id) => {
        const r = data.find((x) => x.id === id);
        return r && !r.reimbursed;
      });
      if (!ids.length) {
        setMarking(null);
        return;
      }
      const res = await fetch(`${API_BASE}/api/receipts/mark-reimbursed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids }),
      });
      if (res.status === 401) {
        alert("Сессия истекла, войдите снова.");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Ошибка сохранения: ${data?.error || res.status}`);
        return;
      }
      setData((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, reimbursed: true } : r)));
      setSelected(new Set());
    } finally {
      setMarking(null);
    }
  };

  const exportCsv = async () => {
    setDownloading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/reports/compensations/export?pending=true&includePaid=${includePaid ? "true" : "false"}&dateFrom=${dateFrom}&dateTo=${dateTo}&driver=${driverSearch}&vehicle=${vehicleSearch}`,
        {
          credentials: "include",
        }
      );
      if (res.status === 401) {
        alert("Сессия истекла, войдите снова.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "compensations_pending.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Ошибка выгрузки: ${err?.message ?? err}`);
    } finally {
      setDownloading(false);
    }
  };

  const exportXlsx = async () => {
    setDownloading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/reports/compensations/export.xlsx?pending=true&includePaid=${includePaid ? "true" : "false"}&dateFrom=${dateFrom}&dateTo=${dateTo}&driver=${driverSearch}&vehicle=${vehicleSearch}`,
        {
          credentials: "include",
        }
      );
      if (res.status === 401) {
        alert("Сессия истекла, войдите снова.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "compensations_pending.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Ошибка выгрузки: ${err?.message ?? err}`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section style={{ marginTop: 16, padding: 12, background: "#f6f6f6", borderRadius: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h3 style={{ margin: "4px 0 8px" }}>Требуют компенсации</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className={styles.button} onClick={exportCsv} disabled={downloading}>
            {downloading ? "Выгружаю..." : "Экспорт CSV"}
          </button>
          <button className={styles.button} onClick={exportXlsx} disabled={downloading}>
            {downloading ? "Выгружаю..." : "Экспорт XLSX"}
          </button>
        </div>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 8 }}>
        <input type="checkbox" checked={includePaid} onChange={(e) => setIncludePaid(e.target.checked)} />
        Показывать все оплаченные водителем (не только без компенсации)
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 8, fontSize: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Дата с
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Дата по
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Водитель
          <input value={driverSearch} onChange={(e) => setDriverSearch(e.target.value)} placeholder="ФИО/ID" />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Авто
          <input value={vehicleSearch} onChange={(e) => setVehicleSearch(e.target.value)} placeholder="Госномер/название" />
        </label>
      </div>
      <div style={{ marginBottom: 8, display: "flex", gap: 12, fontSize: 14 }}>
        <div>Ожидает компенсации: {totalPending.length} шт · {sumPending.toFixed(2)}</div>
        <div>Всего оплачено водителем: {filtered.length} шт · {sumAll.toFixed(2)}</div>
      </div>
      <div style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
        <button className={styles.button} onClick={markSelected} disabled={marking === "bulk" || selected.size === 0}>
          {marking === "bulk" ? "Отмечаю..." : `Отметить компенсировано (${selected.size})`}
        </button>
        <button
          className={styles.button}
          onClick={() => {
            if (visible.length === 0) return;
            const next = new Set<string>();
            visible.forEach((r) => {
              if (!r.reimbursed) next.add(r.id);
            });
            setSelected(next);
          }}
          disabled={visible.length === 0}
        >
          Выбрать все на экране
        </button>
        <button className={styles.button} onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
          Сбросить выбор
        </button>
      </div>
      {visible.length === 0 && (
        <div style={{ opacity: 0.7 }}>
          {includePaid ? "Нет чеков, оплаченных водителем." : "Нет чеков с оплатой водителем без компенсации."}
        </div>
      )}
      {visible.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          {visible.slice(0, 50).map((r) => (
            <li key={r.id} style={{ marginBottom: 10 }}>
              <div>
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={(e) => toggleSelect(r.id, e.target.checked)}
                  style={{ marginRight: 8 }}
                />
                <b>{r.driver?.fullName ?? r.driver?.telegramUserId ?? "Водитель"}</b> — {r.vehicle?.plateNumber ?? r.vehicle?.name ?? "Авто"} —{" "}
                {r.totalAmount ?? "—"} — {new Date(r.receiptAt).toLocaleString("ru-RU")} {r.paymentComment ? ` • ${r.paymentComment}` : ""}
              </div>
              <div style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center" }}>
                <button className={styles.button} onClick={() => markReimbursed(r.id)} disabled={marking === r.id}>
                  {marking === r.id ? "Отмечаю..." : "Отметить компенсировано"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
