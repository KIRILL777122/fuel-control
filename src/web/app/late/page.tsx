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
  return new Date(dateStr).toLocaleDateString('ru-RU');
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
  
  // Filters
  const [dateFrom, setDateFrom] = React.useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = React.useState<string>(() => new Date().toISOString().split('T')[0]);
  const [selectedDrivers, setSelectedDrivers] = React.useState<string[]>([]);
  const [selectedListId, setSelectedListId] = React.useState<string>("");
  
  // Metadata
  const [allDrivers, setAllDrivers] = React.useState<Driver[]>([]);
  const [driverLists, setDriverLists] = React.useState<CustomList[]>([]);
  
  // Selection
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  // Sorting for Rating tab
  const [ratingSortBy, setRatingSortBy] = React.useState<"total" | "red" | "yellow" | "green" | "totalMinutes">("total");
  const [ratingSortDir, setRatingSortDir] = React.useState<"desc" | "asc">("desc");

  const loadMetadata = React.useCallback(async () => {
    const [dRes, lRes] = await Promise.all([
      getJson("/api/drivers"),
      getJson("/api/lists?type=DRIVER")
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
      return true;
    });
  }, [delays, selectedDrivers]);

  const analyticsData = React.useMemo(() => {
    const stats: Record<string, { driverName: string; red: number; yellow: number; green: number; total: number; totalMinutes: number; details: LateDelay[] }> = {};
    
    processedDelays.forEach(d => {
      if (!stats[d.driverName]) {
        stats[d.driverName] = { driverName: d.driverName, red: 0, yellow: 0, green: 0, total: 0, totalMinutes: 0, details: [] };
      }
      const s = stats[d.driverName];
      s.total++;
      s.totalMinutes += d.delayMinutes;
      s.details.push(d);
      if (d.delayMinutes >= 21) s.red++;
      else if (d.delayMinutes >= 11) s.yellow++;
      else s.green++;
    });
    
    // Apply sorting
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
      if (res.ok) {
        setDelays(prev => prev.filter(d => !selectedIds.has(d.id)));
        setSelectedIds(new Set());
      }
    } catch (err) {
      alert("Ошибка удаления");
    }
  };

  const handleRatingSort = (column: typeof ratingSortBy) => {
    if (ratingSortBy === column) {
      setRatingSortDir(prev => (prev === "desc" ? "asc" : "desc"));
    } else {
      setRatingSortBy(column);
      setRatingSortDir("desc");
    }
  };

  const getSortIndicator = (column: typeof ratingSortBy) => {
    if (ratingSortBy === column) {
      return ratingSortDir === "desc" ? " ↓" : " ↑";
    }
    return "";
  };

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ margin: "0 0 24px 0" }}>🕒 Опоздания</h1>

      {/* ФИЛЬТРЫ */}
      <div style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e9e9f2", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            Период от
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            Период до
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }} />
          </label>
          
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13 }}>Список водителей</span>
            <select 
              value={selectedListId} 
              onChange={e => handleListChange(e.target.value)}
              style={{ padding: 8, borderRadius: 8, border: "1px solid #d7d7e0", minWidth: 180 }}
            >
              <option value="">-- Все --</option>
              {driverLists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>

          <button className={styles.button} onClick={loadDelays} disabled={loading} style={{ height: 38 }}>
            {loading ? "..." : "Обновить"}
          </button>
        </div>

        {selectedListId === "" && (
          <div style={{ marginTop: 12 }}>
            <span style={{ fontSize: 12, opacity: 0.7, display: "block", marginBottom: 4 }}>Выберите водителей вручную:</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", maxHeight: 80, overflowY: "auto", padding: 8, border: "1px solid #eee", borderRadius: 8 }}>
              {allDrivers.map(d => {
                const name = d.fullName || d.telegramUserId;
                const isSel = selectedDrivers.includes(name);
                return (
                  <label key={d.id} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", padding: "2px 6px", background: isSel ? "#eef2ff" : "#f9fafb", borderRadius: 4, border: "1px solid", borderColor: isSel ? "#4338ca" : "#e5e7eb" }}>
                    <input 
                      type="checkbox" 
                      checked={isSel} 
                      onChange={() => setSelectedDrivers(prev => isSel ? prev.filter(x => x !== name) : [...prev, name])} 
                    />
                    {name}
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ТАБЫ */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button 
          className={styles.button} 
          onClick={() => setActiveTab("history")}
          style={{ background: activeTab === "history" ? "#eef2ff" : "#fff", borderColor: activeTab === "history" ? "#4338ca" : "#d7d7e0" }}
        >
          📋 История ({processedDelays.length})
        </button>
        <button 
          className={styles.button} 
          onClick={() => setActiveTab("analytics")}
          style={{ background: activeTab === "analytics" ? "#eef2ff" : "#fff", borderColor: activeTab === "analytics" ? "#4338ca" : "#d7d7e0" }}
        >
          📊 Аналитика
        </button>
        <button 
          className={styles.button} 
          onClick={() => setActiveTab("rating")}
          style={{ background: activeTab === "rating" ? "#fffbeb" : "#fff", borderColor: activeTab === "rating" ? "#d97706" : "#d7d7e0" }}
        >
          🏆 Рейтинг (Топ)
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center" }}>Загрузка данных...</div>
      ) : activeTab === "history" ? (
        <div className={styles.tableWrap}>
          {selectedIds.size > 0 && (
            <div style={{ padding: 12, background: "#fff4f4", borderBottom: "1px solid #fecaca", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#991b1b" }}>Выбрано: {selectedIds.size}</span>
              <button onClick={deleteSelected} style={{ background: "#ef4444", color: "#fff", border: "none", padding: "6px 12px", borderRadius: 6, cursor: "pointer" }}>Удалить выбранные</button>
            </div>
          )}
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th} style={{ width: 40 }}></th>
                <th className={styles.th}>Дата</th>
                <th className={styles.th}>Водитель</th>
                <th className={styles.th}>Маршрут</th>
                <th className={styles.th}>План / Факт</th>
                <th className={styles.th}>Опоздание</th>
                <th className={styles.th}>Авто</th>
              </tr>
            </thead>
            <tbody>
              {processedDelays.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", opacity: 0.6 }}>Записей не найдено</td></tr>
              ) : (
                processedDelays.map(d => (
                  <tr key={d.id} onClick={() => toggleSelect(d.id)} style={{ cursor: "pointer", background: selectedIds.has(d.id) ? "#fff1f2" : "inherit" }}>
                    <td className={styles.td}>
                      <input type="checkbox" checked={selectedIds.has(d.id)} readOnly />
                    </td>
                    <td className={styles.td}>{formatDate(d.delayDate)}</td>
                    <td className={styles.td} style={{ fontWeight: 600 }}>{d.driverName}</td>
                    <td className={styles.td}>{d.routeName}</td>
                    <td className={styles.td}>{d.plannedTime} / {d.assignedTime}</td>
                    <td className={styles.td}>
                      <span style={{ marginRight: 6 }}>{getDelayEmoji(d.delayMinutes)}</span>
                      <strong>{d.delayMinutes} мин.</strong>
                    </td>
                    <td className={styles.td}>{d.plateNumber || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : activeTab === "analytics" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {analyticsData.length === 0 ? (
            <div style={{ gridColumn: "1/-1", padding: 40, textAlign: "center", opacity: 0.6 }}>Нет данных для аналитики</div>
          ) : (
            analyticsData.map((stat, idx) => (
              <div key={stat.driverName} style={{ background: "#fff", padding: 20, borderRadius: 16, border: "1px solid #e9e9f2", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)", position: "relative" }}>
                <div style={{ position: "absolute", top: 12, right: 16, fontSize: 24, fontWeight: 900, opacity: 0.1 }}>#{idx + 1}</div>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, color: "#1e293b", borderBottom: "1px solid #f1f5f9", paddingBottom: 12, paddingRight: 40 }}>
                  {stat.driverName}
                </div>
                
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
                  <div style={{ textAlign: "center", flex: 1 }}>
                    <div style={{ fontSize: 24 }}>🔴</div>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{stat.red}</div>
                    <div style={{ fontSize: 11, opacity: 0.6, fontWeight: 600 }}>КРИТИЧНО</div>
                  </div>
                  <div style={{ textAlign: "center", flex: 1, borderLeft: "1px solid #f1f5f9", borderRight: "1px solid #f1f5f9" }}>
                    <div style={{ fontSize: 24 }}>🟡</div>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{stat.yellow}</div>
                    <div style={{ fontSize: 11, opacity: 0.6, fontWeight: 600 }}>СРЕДНЕ</div>
                  </div>
                  <div style={{ textAlign: "center", flex: 1 }}>
                    <div style={{ fontSize: 24 }}>🟢</div>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{stat.green}</div>
                    <div style={{ fontSize: 11, opacity: 0.6, fontWeight: 600 }}>МАЛОЕ</div>
                  </div>
                </div>

                <div style={{ background: "#f8fafc", padding: "12px 16px", borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#64748b" }}>Всего опозданий:</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{stat.total}</span>
                </div>
                <div style={{ background: "#f8fafc", padding: "12px 16px", borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#64748b" }}>Общее время опозданий:</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{stat.totalMinutes} мин.</span>
                </div>
                
                {stat.red > 0 && (
                  <div style={{ marginTop: 12, fontSize: 12, color: "#991b1b", background: "#fef2f2", padding: "8px 12px", borderRadius: 8, fontWeight: 500 }}>
                    ⚠️ Требует внимания: {Math.round((stat.red / stat.total) * 100)}% критических
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      ) : (
        <div style={{ background: "#fff", padding: 24, borderRadius: 16, border: "1px solid #e9e9f2" }}>
          <h2 style={{ marginTop: 0, marginBottom: 20 }}>🏆 Рейтинг водителей по опозданиям</h2>
          <div style={{ maxWidth: 800 }}>
            {analyticsData.length === 0 ? (
              <p style={{ opacity: 0.6 }}>Нет данных для составления рейтинга</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", fontSize: 14, opacity: 0.6 }}>
                    <th style={{ padding: "12px 8px", borderBottom: "2px solid #f1f5f9" }}>Место</th>
                    <th style={{ padding: "12px 8px", borderBottom: "2px solid #f1f5f9" }}>Водитель</th>
                    <th 
                      style={{ padding: "12px 8px", borderBottom: "2px solid #f1f5f9", textAlign: "center", cursor: "pointer", background: ratingSortBy === "total" ? "#f0f4f8" : "transparent" }}
                      onClick={() => handleRatingSort("total")}
                    >
                      Всего{getSortIndicator("total")}
                    </th>
                    <th 
                      style={{ padding: "12px 8px", borderBottom: "2px solid #f1f5f9", textAlign: "center", cursor: "pointer", background: ratingSortBy === "red" ? "#f0f4f8" : "transparent" }}
                      onClick={() => handleRatingSort("red")}
                    >
                      🔴{getSortIndicator("red")}
                    </th>
                    <th 
                      style={{ padding: "12px 8px", borderBottom: "2px solid #f1f5f9", textAlign: "center", cursor: "pointer", background: ratingSortBy === "yellow" ? "#f0f4f8" : "transparent" }}
                      onClick={() => handleRatingSort("yellow")}
                    >
                      🟡{getSortIndicator("yellow")}
                    </th>
                    <th 
                      style={{ padding: "12px 8px", borderBottom: "2px solid #f1f5f9", textAlign: "center", cursor: "pointer", background: ratingSortBy === "green" ? "#f0f4f8" : "transparent" }}
                      onClick={() => handleRatingSort("green")}
                    >
                      🟢{getSortIndicator("green")}
                    </th>
                    <th 
                      style={{ padding: "12px 8px", borderBottom: "2px solid #f1f5f9", textAlign: "right", cursor: "pointer", background: ratingSortBy === "totalMinutes" ? "#f0f4f8" : "transparent" }}
                      onClick={() => handleRatingSort("totalMinutes")}
                    >
                      Общее время{getSortIndicator("totalMinutes")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {analyticsData.map((stat, idx) => (
                    <tr key={stat.driverName} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "16px 8px", fontWeight: 800, fontSize: 18, color: idx < 3 ? "#d97706" : "#64748b" }}>
                        {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`}
                      </td>
                      <td style={{ padding: "16px 8px", fontWeight: 600 }}>{stat.driverName}</td>
                      <td style={{ padding: "16px 8px", textAlign: "center", fontWeight: ratingSortBy === "total" ? 800 : 700 }}>{stat.total}</td>
                      <td style={{ padding: "16px 8px", textAlign: "center", color: "#ef4444", fontWeight: ratingSortBy === "red" ? 800 : 500 }}>{stat.red}</td>
                      <td style={{ padding: "16px 8px", textAlign: "center", color: "#f59e0b", fontWeight: ratingSortBy === "yellow" ? 800 : 500 }}>{stat.yellow}</td>
                      <td style={{ padding: "16px 8px", textAlign: "center", color: "#10b981", fontWeight: ratingSortBy === "green" ? 800 : 500 }}>{stat.green}</td>
                      <td style={{ padding: "16px 8px", textAlign: "right", fontWeight: ratingSortBy === "totalMinutes" ? 800 : 500 }}>{stat.totalMinutes} мин.</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
