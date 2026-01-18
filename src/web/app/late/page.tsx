"use client";

import React from "react";
import styles from "../page.module.css";

const API_BASE = typeof window !== "undefined" ? "" : (process.env.API_BASE_URL || "http://localhost:3000");

type LateDelay = {
  id: string;
  driverName: string;
  plateNumber: string | null;
  routeName: string;
  plannedTime: string | null;
  assignedTime: string | null;
  delayMinutes: number;
  delayDate: string;
};

type SummaryItem = {
  driverName: string;
  red: number;
  yellow: number;
  green: number;
};

function getDelayEmoji(delay: number): string {
  if (delay >= 21) return "🔴";
  if (delay >= 11) return "🟡";
  return "🟢";
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("ru-RU");
}

export default function LatePage() {
  const [delays, setDelays] = React.useState<LateDelay[]>([]);
  const [summary, setSummary] = React.useState<SummaryItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [driverSearch, setDriverSearch] = React.useState("");
  const [sortBy, setSortBy] = React.useState<"driver" | "date">("date");

  const loadData = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      if (driverSearch) params.append("driverName", driverSearch);

      const [delaysRes, summaryRes] = await Promise.all([
        fetch(`${API_BASE}/api/late-delays?${params}`, { credentials: "include" }),
        fetch(`${API_BASE}/api/late-delays/summary?${params}`, { credentials: "include" }),
      ]);

      if (delaysRes.status === 401 || summaryRes.status === 401) {
        alert("Сессия истекла, войдите снова.");
        return;
      }

      const delaysData = await delaysRes.json();
      const summaryData = await summaryRes.json();

      setDelays(delaysData.items || []);
      setSummary(summaryData.summary || []);
    } catch (err: any) {
      console.error("Failed to load data:", err);
      alert(`Ошибка загрузки: ${err?.message ?? err}`);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, driverSearch]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const sortedDelays = React.useMemo(() => {
    const sorted = [...delays];
    if (sortBy === "driver") {
      sorted.sort((a, b) => a.driverName.localeCompare(b.driverName));
    } else {
      sorted.sort((a, b) => new Date(b.delayDate).getTime() - new Date(a.delayDate).getTime());
    }
    return sorted;
  }, [delays, sortBy]);

  return (
    <div>
      <h1 style={{ margin: "0 0 24px 0" }}>Опоздания</h1>

      {/* Сводка */}
      {summary.length > 0 && (
        <div className={styles.card} style={{ marginBottom: 24 }}>
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>Сводка по водителям</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
            {summary.map((item) => (
              <div key={item.driverName} style={{ padding: 12, background: "#f8f8fb", borderRadius: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{item.driverName}</div>
                <div style={{ fontSize: 14, color: "#666" }}>
                  🔴 {item.red} 🟡 {item.yellow} 🟢 {item.green}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Фильтры */}
      <div className={styles.filters}>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12, gap: 4 }}>
          Дата с
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ padding: 6 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12, gap: 4 }}>
          Дата по
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ padding: 6 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12, gap: 4 }}>
          Водитель
          <input
            type="text"
            placeholder="Поиск по ФИО"
            value={driverSearch}
            onChange={(e) => setDriverSearch(e.target.value)}
            className={styles.search}
            style={{ minWidth: 200 }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12, gap: 4 }}>
          Сортировка
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "driver" | "date")} style={{ padding: 6 }}>
            <option value="date">По дате</option>
            <option value="driver">По водителю</option>
          </select>
        </label>
        <button className={styles.button} onClick={loadData} disabled={loading} style={{ alignSelf: "flex-end" }}>
          {loading ? "Загрузка..." : "Обновить"}
        </button>
      </div>

      {/* Таблица */}
      <div className={styles.tableWrap} style={{ marginTop: 12 }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center" }}>Загрузка...</div>
        ) : sortedDelays.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", opacity: 0.7 }}>Нет данных</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Наименование маршрута</th>
                <th className={styles.th}>Плановое время подачи</th>
                <th className={styles.th}>Время назначения а/м на маршрут (факт)</th>
                <th className={styles.th}>Опоздание, мин.</th>
                <th className={styles.th}>ФИО водителя</th>
                <th className={styles.th}>Гос. №</th>
              </tr>
            </thead>
            <tbody>
              {sortedDelays.map((delay) => (
                <tr key={delay.id}>
                  <td className={styles.td}>{delay.routeName}</td>
                  <td className={styles.td}>{delay.plannedTime || "—"}</td>
                  <td className={styles.td}>{delay.assignedTime || "—"}</td>
                  <td className={styles.td}>
                    <span style={{ marginRight: 4 }}>{getDelayEmoji(delay.delayMinutes)}</span>
                    {delay.delayMinutes}
                  </td>
                  <td className={styles.td}>{delay.driverName}</td>
                  <td className={styles.td}>{delay.plateNumber || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
