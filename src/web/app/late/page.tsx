"use client";

import React from "react";
import styles from "../page.module.css";

import { LateDelay, Driver, CustomList } from "../types";

const API_BASE = "";

function getDelayEmoji(minutes: number) {
  if (minutes >= 21) return "🔴";
  if (minutes >= 11) return "🟡";
  return "🟢";
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("ru-RU");
}

async function getJson(url: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return { ok: false, error: res.statusText };
  return { ok: true, data: await res.json() };
}

export default function LatePage() {
  const [activeTab, setActiveTab] = React.useState<"history" | "analytics" | "rating">("history");
  const [delays, setDelays] = React.useState<LateDelay[]>([]);
  const [loading, setLoading] = React.useState(true);
  
  const [dateFrom, setDateFrom] = React.useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = React.useState<string>(() => new Date().toISOString().split("T")[0]);
  const [selectedDrivers, setSelectedDrivers] = React.useState<string[]>([]);
  const [selectedListId, setSelectedListId] = React.useState<string>("");
  const [driverQuery, setDriverQuery] = React.useState("");
  const [selectedRoutes, setSelectedRoutes] = React.useState<string[]>([]);
  const [ratingSortBy, setRatingSortBy] = React.useState<"total" | "red" | "yellow" | "green" | "totalMinutes">("total");
  const [ratingSortDir, setRatingSortDir] = React.useState<"desc" | "asc">("desc");
  
  const [allDrivers, setAllDrivers] = React.useState<Driver[]>([]);
  const [driverLists, setDriverLists] = React.useState<CustomList[]>([]);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  const loadMetadata = React.useCallback(async () => {
    const [dRes, lRes] = await Promise.all([
      getJson("/api/drivers"),
      getJson("/api/lists?type=DRIVER"),
    ]);
    if (dRes.ok) setAllDrivers(dRes.data);
    if (lRes.ok) setDriverLists(lRes.data);
  }, []);

  const loadDelays = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      
      const res = await fetch(`${API_BASE}/api/late-delays?${params}`, { credentials: "include" });
      const data = await res.json();
      setDelays(data.items || []);
      setSelectedIds(new Set());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  React.useEffect(() => {
    loadMetadata();
    loadDelays();
  }, [loadMetadata, loadDelays]);

  const handleListChange = (listId: string) => {
    setSelectedListId(listId);
    if (!listId) {
      setSelectedDrivers([]);
      return;
    }
    const list = driverLists.find(l => l.id === listId);
    if (list) {
      const ids = list.items.map(i => i.driverId);
      const names = allDrivers
        .filter(d => ids.includes(d.id))
        .map(d => d.fullName || d.telegramUserId);
      setSelectedDrivers(names);
    }
  };

  const processedDelays = React.useMemo(() => {
    return delays.filter(d => {
      if (selectedDrivers.length > 0 && !selectedDrivers.includes(d.driverName)) return false;
      if (selectedRoutes.length > 0 && !selectedRoutes.includes(d.routeName)) return false;
      return true;
    });
  }, [delays, selectedDrivers, selectedRoutes]);

  const routeOptions = React.useMemo(() => {
    const unique = Array.from(new Set(delays.map((d) => d.routeName).filter(Boolean)));
    return unique.sort((a, b) => a.localeCompare(b, "ru"));
  }, [delays]);

  const analyticsData = React.useMemo(() => {
    const stats: Record<string, { driverName: string; red: number; yellow: number; green: number; total: number; totalMinutes: number; details: LateDelay[]; routes: Record<string, number>; vehicles: Record<string, number> }> = {};
    processedDelays.forEach(d => {
      if (!stats[d.driverName]) {
        stats[d.driverName] = { driverName: d.driverName, red: 0, yellow: 0, green: 0, total: 0, totalMinutes: 0, details: [], routes: {}, vehicles: {} };
      }
      const s = stats[d.driverName];
      s.total++;
      s.totalMinutes += d.delayMinutes;
      s.details.push(d);
      s.routes[d.routeName] = (s.routes[d.routeName] || 0) + 1;
      if (d.plateNumber) {
        s.vehicles[d.plateNumber] = (s.vehicles[d.plateNumber] || 0) + 1;
      }
      if (d.delayMinutes >= 21) s.red++;
      else if (d.delayMinutes >= 11) s.yellow++;
      else s.green++;
    });
    return Object.values(stats).sort((a, b) => {
      let compare = 0;
      if (ratingSortBy === "total") compare = b.total - a.total;
      else if (ratingSortBy === "red") compare = b.red - a.red;
      else if (ratingSortBy === "yellow") compare = b.yellow - a.yellow;
      else if (ratingSortBy === "green") compare = b.green - a.green;
      else if (ratingSortBy === "totalMinutes") compare = b.totalMinutes - a.totalMinutes;
      return ratingSortDir === "desc" ? compare : -compare;
    });
  }, [processedDelays, ratingSortBy, ratingSortDir]);

  const routeSummary = React.useMemo(() => {
    const totals: Record<string, number> = {};
    processedDelays.forEach((d) => {
      totals[d.routeName] = (totals[d.routeName] || 0) + 1;
    });
    return Object.entries(totals).sort((a, b) => b[1] - a[1]);
  }, [processedDelays]);

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Удалить выбранные опоздания (${selectedIds.size})?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/late-delays`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (!res.ok) {
        const text = await res.text();
        alert(text || "Не удалось удалить записи");
        return;
      }
      setDelays(prev => prev.filter(d => !selectedIds.has(d.id)));
      setSelectedIds(new Set());
      await loadDelays();
    } catch (err) {
      alert("Ошибка удаления");
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h1 className={styles.pageTitle}>🕒 Опоздания</h1>

      <div className={styles.tabBar}>
        <button
          className={`${styles.tabButton} ${activeTab === "history" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("history")}
        >
          📋 История ({processedDelays.length})
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === "analytics" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("analytics")}
        >
          📊 Аналитика
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === "rating" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("rating")}
        >
          🏆 Рейтинг (Топ)
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, marginBottom: 16 }}>
        <div className={styles.filterCard} style={{ marginBottom: 0 }}>
          <div className={styles.filterRow} style={{ marginBottom: 12 }}>
            <label className={styles.field}>
              Период от
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={styles.input} />
            </label>
            <label className={styles.field}>
              Период до
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={styles.input} />
            </label>
            <label className={styles.field}>
              Список
              <select
                value={selectedListId}
                onChange={e => handleListChange(e.target.value)}
                className={styles.select}
              >
                <option value="">-- Все --</option>
                {driverLists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <button className={styles.button} onClick={loadDelays} disabled={loading} style={{ height: 38 }}>
              {loading ? "..." : "Обновить"}
            </button>
          </div>

          {selectedListId === "" && (
            <div>
              <span className={styles.muted} style={{ display: "block", marginBottom: 4 }}>Выбор водителей:</span>
              <div style={{ position: "relative" }}>
                <input
                  value={driverQuery}
                  onChange={(e) => setDriverQuery(e.target.value)}
                  placeholder="Поиск по ФИО для выбора..."
                  className={styles.input}
                  style={{ width: "100%" }}
                />
                <div
                  style={{
                    marginTop: 8,
                    maxHeight: 100,
                    overflowY: "auto",
                    border: "1px solid var(--card-border)",
                    borderRadius: 10,
                    padding: 8,
                    background: "var(--card-bg)",
                  }}
                >
                  {allDrivers
                    .map((d) => d.fullName || d.telegramUserId)
                    .filter((name) => name && name.toLowerCase().includes(driverQuery.toLowerCase()))
                    .map((name) => {
                      const isSel = selectedDrivers.includes(name);
                      return (
                        <label key={name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "2px 0", cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() =>
                              setSelectedDrivers((prev) =>
                                isSel ? prev.filter((x) => x !== name) : [...prev, name]
                              )
                            }
                          />
                          {name}
                        </label>
                      );
                    })}
                </div>
              </div>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <span className={styles.muted} style={{ display: "block", marginBottom: 4 }}>Выбор маршрутов:</span>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 11, opacity: 0.7 }}>Выбор:</span>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  onClick={() => setSelectedRoutes(routeOptions)}
                  style={{ fontSize: 10, cursor: "pointer", border: "1px solid var(--card-border)", borderRadius: 999, padding: "2px 8px", background: "var(--card-bg)", color: "var(--text)" }}
                >
                  Все
                </button>
                <button
                  onClick={() => setSelectedRoutes([])}
                  style={{ fontSize: 10, cursor: "pointer", border: "1px solid var(--card-border)", borderRadius: 999, padding: "2px 8px", background: "var(--card-bg)", color: "var(--text)" }}
                >
                  Очистить
                </button>
              </div>
            </div>
            <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid var(--card-border)", borderRadius: 10, padding: 8, background: "var(--card-bg)" }}>
              {routeOptions.map((route) => {
                const isSel = selectedRoutes.includes(route);
                return (
                  <label key={route} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "2px 0", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => setSelectedRoutes((prev) => (isSel ? prev.filter((x) => x !== route) : [...prev, route]))}
                    />
                    {route}
                  </label>
                );
              })}
              {routeOptions.length === 0 && <div className={styles.muted}>Нет маршрутов</div>}
            </div>
          </div>
        </div>

        <div className={styles.sidePanel}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--text)" }}>Сводка маршрутов</div>
          <div style={{ display: "grid", gap: 4 }}>
            {routeSummary.map(([route, cnt]) => (
              <div
                key={route}
                style={{
                  fontSize: 12,
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "4px 0",
                  borderBottom: "1px solid var(--table-border)",
                }}
              >
                <span style={{ fontWeight: 500 }}>{route}</span>
                <span style={{ color: "var(--accent-color)", fontWeight: 700 }}>{cnt}</span>
              </div>
            ))}
            {routeSummary.length === 0 && <div className={styles.muted}>Нет данных</div>}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center" }}>Загрузка данных...</div>
      ) : activeTab === "history" ? (
        <div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <button
              className={styles.button}
              onClick={deleteSelected}
              disabled={selectedIds.size === 0}
              style={{
                background: "var(--danger-bg)",
                color: "var(--danger-text)",
                opacity: selectedIds.size === 0 ? 0.6 : 1,
              }}
            >
              Удалить выбранные ({selectedIds.size})
            </button>
          </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th} style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === processedDelays.length && processedDelays.length > 0}
                    onChange={() => {
                      if (selectedIds.size === processedDelays.length) setSelectedIds(new Set());
                      else setSelectedIds(new Set(processedDelays.map(d => d.id)));
                    }}
                  />
                </th>
                <th className={styles.th}>Дата</th>
                <th className={styles.th}>Маршрут</th>
                <th className={styles.th}>Плановое время</th>
                <th className={styles.th}>Факт назначения</th>
                <th className={styles.th}>Опоздание (мин)</th>
                <th className={styles.th}>Водитель</th>
                <th className={styles.th}>Гос. №</th>
              </tr>
            </thead>
            <tbody>
              {processedDelays.map(d => (
                <tr key={d.id}>
                  <td className={styles.td}>
                    <input type="checkbox" checked={selectedIds.has(d.id)} onChange={() => toggleSelect(d.id)} />
                  </td>
                  <td className={styles.td}>{formatDate(d.delayDate)}</td>
                  <td className={styles.td}>{d.routeName}</td>
                  <td className={styles.td}>{d.plannedTime || "—"}</td>
                  <td className={styles.td}>{d.assignedTime || "—"}</td>
                  <td className={styles.td}>{getDelayEmoji(d.delayMinutes)} {d.delayMinutes}</td>
                  <td className={styles.td}>{d.driverName}</td>
                  <td className={styles.td}>{d.plateNumber || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {processedDelays.length === 0 && <div style={{ padding: 16, opacity: 0.6 }}>Нет данных</div>}
        </div>
      </div>
      ) : activeTab === "analytics" ? (
        <div className={styles.ratingGrid}>
          {analyticsData.map(d => (
            <div key={d.driverName} className={styles.ratingCard}>
              <div className={styles.ratingHeader}>
                <div className={styles.ratingName}>{d.driverName}</div>
              </div>
              <div className={styles.ratingStats}>
                <div className={`${styles.ratingStat} ${styles.ratingAccentBlue}`}>
                  <div className={styles.ratingLabel}>Всего опозданий</div>
                  <div className={styles.ratingValue}>{d.total}</div>
                </div>
                <div className={`${styles.ratingStat} ${styles.ratingAccentBlue}`}>
                  <div className={styles.ratingLabel}>Минут всего</div>
                  <div className={styles.ratingValue}>{d.totalMinutes}</div>
                </div>
                <div className={`${styles.ratingStat} ${styles.ratingAccentRed}`}>
                  <div className={styles.ratingLabel}>🔴 &ge; 21 мин</div>
                  <div className={styles.ratingValue}>{d.red}</div>
                </div>
                <div className={`${styles.ratingStat} ${styles.ratingAccentYellow}`}>
                  <div className={styles.ratingLabel}>🟡 11–20 мин</div>
                  <div className={styles.ratingValue}>{d.yellow}</div>
                </div>
                <div className={`${styles.ratingStat} ${styles.ratingAccentGreen}`}>
                  <div className={styles.ratingLabel}>🟢 0–10 мин</div>
                  <div className={styles.ratingValue}>{d.green}</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                <div>
                  <div className={styles.ratingLabel} style={{ marginBottom: 6 }}>Маршруты</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {Object.entries(d.routes).map(([route, cnt]) => (
                      <div key={route} className={styles.itemCard}>
                        <div className={styles.itemLabel}>{route}</div>
                        <div className={styles.itemValue}>Смен: {cnt}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className={styles.ratingLabel} style={{ marginBottom: 6 }}>Автомобили</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {Object.entries(d.vehicles).map(([plate, cnt]) => (
                      <div key={plate} className={styles.itemCard}>
                        <div className={styles.itemLabel}>{plate}</div>
                        <div className={styles.itemValue}>Смен: {cnt}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {analyticsData.length === 0 && <div style={{ opacity: 0.6 }}>Нет данных</div>}
        </div>
      ) : (
        <div className={styles.card}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Рейтинг (общий)</div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>#</th>
                  <th className={styles.th} style={{ cursor: "pointer" }} onClick={() => {
                    setRatingSortBy("total");
                    setRatingSortDir(prev => (ratingSortBy === "total" && prev === "desc") ? "asc" : "desc");
                  }}>
                    Всего {ratingSortBy === "total" ? (ratingSortDir === "desc" ? "↓" : "↑") : ""}
                  </th>
                  <th className={styles.th} style={{ cursor: "pointer", color: "var(--error-color)" }} onClick={() => {
                    setRatingSortBy("red");
                    setRatingSortDir(prev => (ratingSortBy === "red" && prev === "desc") ? "asc" : "desc");
                  }}>
                    🔴 {ratingSortBy === "red" ? (ratingSortDir === "desc" ? "↓" : "↑") : ""}
                  </th>
                  <th className={styles.th} style={{ cursor: "pointer", color: "var(--status-pending-text)" }} onClick={() => {
                    setRatingSortBy("yellow");
                    setRatingSortDir(prev => (ratingSortBy === "yellow" && prev === "desc") ? "asc" : "desc");
                  }}>
                    🟡 {ratingSortBy === "yellow" ? (ratingSortDir === "desc" ? "↓" : "↑") : ""}
                  </th>
                  <th className={styles.th} style={{ cursor: "pointer", color: "var(--success-color)" }} onClick={() => {
                    setRatingSortBy("green");
                    setRatingSortDir(prev => (ratingSortBy === "green" && prev === "desc") ? "asc" : "desc");
                  }}>
                    🟢 {ratingSortBy === "green" ? (ratingSortDir === "desc" ? "↓" : "↑") : ""}
                  </th>
                  <th className={styles.th} style={{ cursor: "pointer" }} onClick={() => {
                    setRatingSortBy("totalMinutes");
                    setRatingSortDir(prev => (ratingSortBy === "totalMinutes" && prev === "desc") ? "asc" : "desc");
                  }}>
                    Минут {ratingSortBy === "totalMinutes" ? (ratingSortDir === "desc" ? "↓" : "↑") : ""}
                  </th>
                  <th className={styles.th}>Водитель</th>
                </tr>
              </thead>
              <tbody>
                {analyticsData.map((d, index) => (
                  <tr key={d.driverName}>
                    <td className={styles.td}>{index + 1}</td>
                    <td className={styles.td}>{d.total}</td>
                    <td className={styles.td}>{d.red}</td>
                    <td className={styles.td}>{d.yellow}</td>
                    <td className={styles.td}>{d.green}</td>
                    <td className={styles.td}>{d.totalMinutes}</td>
                    <td className={styles.td}>{d.driverName}</td>
                  </tr>
                ))}
                {analyticsData.length === 0 && <tr><td className={styles.td} colSpan={7}>Нет данных</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
