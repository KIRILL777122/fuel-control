"use client";

import React from "react";
import styles from "../page.module.css";
import { Shift, Driver, Vehicle, CustomList } from "../types";

const API_BASE = "";

async function getJson(url: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return { ok: false, error: res.statusText };
  return { ok: true, data: await res.json() };
}

export default function ShiftsPage() {
  const [activeTab, setActiveTab] = React.useState<"history" | "analytics">("history");
  const [shifts, setShifts] = React.useState<Shift[]>([]);
  const [loading, setLoading] = React.useState(true);
  
  // Filters
  const [dateFrom, setDateFrom] = React.useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = React.useState<string>(() => new Date().toISOString().split('T')[0]);
  const [selectedDrivers, setSelectedDrivers] = React.useState<string[]>([]);
  const [selectedDriverListId, setSelectedDriverListId] = React.useState<string>("");
  const [selectedVehicles, setSelectedVehicles] = React.useState<string[]>([]);
  const [selectedVehicleListId, setSelectedVehicleListId] = React.useState<string>("");
  const [selectedRoutes, setSelectedRoutes] = React.useState<string[]>([]);
  const [selectedRouteListId, setSelectedRouteListId] = React.useState<string>("");

  // Metadata
  const [allDrivers, setAllDrivers] = React.useState<Driver[]>([]);
  const [allVehicles, setAllVehicles] = React.useState<Vehicle[]>([]);
  const [driverLists, setDriverLists] = React.useState<CustomList[]>([]);
  const [vehicleLists, setVehicleLists] = React.useState<CustomList[]>([]);
  const [routeLists, setRouteLists] = React.useState<CustomList[]>([]);

  const loadMetadata = React.useCallback(async () => {
    const [dRes, vRes, lRes, vlRes, rlRes] = await Promise.all([
      getJson("/api/drivers"),
      getJson("/api/vehicles"),
      getJson("/api/lists?type=DRIVER"),
      getJson("/api/lists?type=VEHICLE"),
      getJson("/api/lists?type=ROUTE")
    ]);
    if (dRes.ok) setAllDrivers(dRes.data);
    if (vRes.ok) setAllVehicles(vRes.data);
    if (lRes.ok) setDriverLists(lRes.data);
    if (vlRes.ok) setVehicleLists(vlRes.data);
    if (rlRes.ok) setRouteLists(rlRes.data);
  }, []);

  const loadShifts = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      params.append("limit", "2000");
      
      const res = await fetch(`${API_BASE}/api/shifts?${params}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setShifts(data.items || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  React.useEffect(() => {
    loadMetadata();
    loadShifts();
  }, [loadMetadata, loadShifts]);

  const filterOptions = React.useMemo(() => {
    const drivers = Array.from(new Set(shifts.map(s => s.driverName))).sort();
    const vehicles = Array.from(new Set(shifts.filter(s => s.plateNumber).map(s => s.plateNumber as string))).sort();
    const routes = Array.from(new Set(shifts.map(s => s.routeName))).sort();
    return { drivers, vehicles, routes };
  }, [shifts]);

  const filteredShifts = React.useMemo(() => {
    return shifts.filter(s => {
      if (selectedDrivers.length > 0 && !selectedDrivers.includes(s.driverName)) return false;
      if (selectedVehicles.length > 0 && (!s.plateNumber || !selectedVehicles.includes(s.plateNumber))) return false;
      if (selectedRoutes.length > 0 && !selectedRoutes.includes(s.routeName)) return false;
      return true;
    });
  }, [shifts, selectedDrivers, selectedVehicles, selectedRoutes]);

  const analyticsData = React.useMemo(() => {
    const stats: Record<string, { driverName: string; total: number; routes: Record<string, number>; vehicleCounts: Record<string, number> }> = {};
    filteredShifts.forEach(s => {
      if (!stats[s.driverName]) {
        stats[s.driverName] = { driverName: s.driverName, total: 0, routes: {}, vehicleCounts: {} };
      }
      const st = stats[s.driverName];
      st.total++;
      st.routes[s.routeName] = (st.routes[s.routeName] || 0) + 1;
      if (s.plateNumber) {
        st.vehicleCounts[s.plateNumber] = (st.vehicleCounts[s.plateNumber] || 0) + 1;
      }
    });
    return Object.values(stats).sort((a, b) => b.total - a.total);
  }, [filteredShifts]);

  const routeSummary = React.useMemo(() => {
    const totals: Record<string, number> = {};
    filteredShifts.forEach(s => {
      totals[s.routeName] = (totals[s.routeName] || 0) + 1;
    });
    return Object.entries(totals).sort((a, b) => b[1] - a[1]);
  }, [filteredShifts]);

  const handleListChange = (listId: string) => {
    setSelectedDriverListId(listId);
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

  const handleVehicleListChange = (listId: string) => {
    setSelectedVehicleListId(listId);
    if (!listId) {
      setSelectedVehicles([]);
      return;
    }
    const list = vehicleLists.find(l => l.id === listId);
    if (list) {
      const ids = list.items.map(i => i.vehicleId);
      const plates = allVehicles
        .filter(v => ids.includes(v.id))
        .map(v => v.plateNumber || v.name || v.id);
      setSelectedVehicles(plates);
    }
  };

  const handleRouteListChange = (listId: string) => {
    setSelectedRouteListId(listId);
    if (!listId) {
      setSelectedRoutes([]);
      return;
    }
    const list = routeLists.find(l => l.id === listId);
    if (list) {
      const names = list.items.map(i => i.routeName).filter(Boolean) as string[];
      setSelectedRoutes(names);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ margin: "0 0 24px 0" }}>📅 Графики смен</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button 
          className={styles.button} 
          onClick={() => setActiveTab("history")}
          style={{ background: activeTab === "history" ? "#eef2ff" : "#fff", borderColor: activeTab === "history" ? "#4338ca" : "#d7d7e0" }}
        >
          📋 История ({filteredShifts.length})
        </button>
        <button 
          className={styles.button} 
          onClick={() => setActiveTab("analytics")}
          style={{ background: activeTab === "analytics" ? "#eef2ff" : "#fff", borderColor: activeTab === "analytics" ? "#4338ca" : "#d7d7e0" }}
        >
          📊 Аналитика
        </button>
      </div>

      <div style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e9e9f2", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            Дата от
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            Дата до
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }} />
          </label>
          <button className={styles.button} onClick={loadShifts} disabled={loading} style={{ height: 38 }}>
            {loading ? "..." : "Обновить"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {/* Driver Filter */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Водители</span>
            <select 
              value={selectedDriverListId} 
              onChange={e => handleListChange(e.target.value)}
              style={{ padding: 6, borderRadius: 8, border: "1px solid #d7d7e0", fontSize: 12 }}
            >
              <option value="">-- Все списки --</option>
              {driverLists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, opacity: 0.7 }}>Вручную:</span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => { setSelectedDrivers(filterOptions.drivers); setSelectedDriverListId(""); }} style={{ fontSize: 10, cursor: "pointer", border: "1px solid #e2e8f0", borderRadius: 999, padding: "2px 8px", background: "#f8fafc", color: "#334155" }}>Все</button>
                  <button onClick={() => { setSelectedDrivers([]); setSelectedDriverListId(""); }} style={{ fontSize: 10, cursor: "pointer", border: "1px solid #e2e8f0", borderRadius: 999, padding: "2px 8px", background: "#f8fafc", color: "#334155" }}>Очистить</button>
                </div>
              </div>
              <div style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #d7d7e0", minWidth: 150, height: 100, background: "#fff", overflowY: "auto" }}>
                {filterOptions.drivers.map(d => (
                  <label key={d} style={{ display: "block", fontSize: 12, padding: "2px 0", whiteSpace: "nowrap", cursor: "pointer" }}>
                    <input 
                      type="checkbox" 
                      checked={selectedDrivers.includes(d)} 
                      onChange={() => {
                        setSelectedDrivers(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
                        setSelectedDriverListId("");
                      }} 
                    />
                    {d}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Vehicle Filter */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Автомобили</span>
            <select 
              value={selectedVehicleListId} 
              onChange={e => handleVehicleListChange(e.target.value)}
              style={{ padding: 6, borderRadius: 8, border: "1px solid #d7d7e0", fontSize: 12 }}
            >
              <option value="">-- Все списки --</option>
              {vehicleLists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, opacity: 0.7 }}>Выбор:</span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => setSelectedVehicles(filterOptions.vehicles)} style={{ fontSize: 10, cursor: "pointer", border: "1px solid #e2e8f0", borderRadius: 999, padding: "2px 8px", background: "#f8fafc", color: "#334155" }}>Все</button>
                  <button onClick={() => setSelectedVehicles([])} style={{ fontSize: 10, cursor: "pointer", border: "1px solid #e2e8f0", borderRadius: 999, padding: "2px 8px", background: "#f8fafc", color: "#334155" }}>Очистить</button>
                </div>
              </div>
              <div style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #d7d7e0", minWidth: 150, height: 100, background: "#fff", overflowY: "auto" }}>
                {filterOptions.vehicles.map(v => (
                  <label key={v} style={{ display: "block", fontSize: 12, padding: "2px 0", whiteSpace: "nowrap", cursor: "pointer" }}>
                    <input 
                      type="checkbox" 
                      checked={selectedVehicles.includes(v)} 
                      onChange={() => { setSelectedVehicles(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]); setSelectedVehicleListId(""); }} 
                    />
                    {v}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Route Filter */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Маршруты</span>
            <select 
              value={selectedRouteListId} 
              onChange={e => handleRouteListChange(e.target.value)}
              style={{ padding: 6, borderRadius: 8, border: "1px solid #d7d7e0", fontSize: 12 }}
            >
              <option value="">-- Все списки --</option>
              {routeLists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, opacity: 0.7 }}>Выбор:</span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => setSelectedRoutes(filterOptions.routes)} style={{ fontSize: 10, cursor: "pointer", border: "1px solid #e2e8f0", borderRadius: 999, padding: "2px 8px", background: "#f8fafc", color: "#334155" }}>Все</button>
                  <button onClick={() => setSelectedRoutes([])} style={{ fontSize: 10, cursor: "pointer", border: "1px solid #e2e8f0", borderRadius: 999, padding: "2px 8px", background: "#f8fafc", color: "#334155" }}>Очистить</button>
                </div>
              </div>
              <div style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #d7d7e0", minWidth: 150, height: 100, background: "#fff", overflowY: "auto" }}>
                {filterOptions.routes.map(r => (
                  <label key={r} style={{ display: "block", fontSize: 12, padding: "2px 0", whiteSpace: "nowrap", cursor: "pointer" }}>
                    <input 
                      type="checkbox" 
                      checked={selectedRoutes.includes(r)} 
                      onChange={() => { setSelectedRoutes(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]); setSelectedRouteListId(""); }} 
                    />
                    {r}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
        <div style={{ marginTop: 16, padding: 12, borderRadius: 12, border: "1px solid #eef2f7", background: "#f8fafc" }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: "#475569" }}>Сводка по маршрутам</div>
          {routeSummary.length === 0 ? (
            <div style={{ fontSize: 12, opacity: 0.6 }}>Нет данных</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 120, overflowY: "auto" }}>
              {routeSummary.map(([name, count]) => (
                <div key={name} style={{ padding: "6px 10px", borderRadius: 999, background: "#fff", border: "1px solid #e2e8f0", fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>{name}</span> <span style={{ opacity: 0.6 }}>({count})</span>
                </div>
              ))}
            </div>
          )}
        </div>

      {activeTab === "history" ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Маршрут №</th>
                <th className={styles.th}>Дата</th>
                <th className={styles.th}>Типовой маршрут</th>
                <th className={styles.th}>Плановое время подачи</th>
                <th className={styles.th}>Назначение на маршрут</th>
                <th className={styles.th}>Передача на выезд</th>
                <th className={styles.th}>Опоздание, мин</th>
                <th className={styles.th}>Водитель</th>
                <th className={styles.th}>Госномер</th>
              </tr>
            </thead>
            <tbody>
              {filteredShifts.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", opacity: 0.6 }}>Записей не найдено</td></tr>
              ) : (
                filteredShifts.map(s => (
                  <tr key={s.id}>
                    <td className={styles.td}>{s.routeNumber || "—"}</td>
                    <td className={styles.td}>{new Date(s.shiftDate).toLocaleDateString('ru-RU')}</td>
                    <td className={styles.td}>{s.routeName || "—"}</td>
                    <td className={styles.td}>{s.plannedTime || "—"}</td>
                    <td className={styles.td}>{s.assignedTime || "—"}</td>
                    <td className={styles.td}>{s.departureTime || "—"}</td>
                    <td className={styles.td}>{s.delayMinutes ?? "—"}</td>
                    <td className={styles.td} style={{ fontWeight: 600 }}>{s.driverName}</td>
                    <td className={styles.td}>{s.plateNumber || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: 16 }}>
          {analyticsData.map(stat => (
            <div key={stat.driverName} style={{ background: "#fff", padding: 20, borderRadius: 16, border: "1px solid #e9e9f2", boxShadow: "0 6px 16px rgba(15, 23, 42, 0.06)" }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, borderBottom: "1px solid #eef2f7", paddingBottom: 8 }}>{stat.driverName}</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, background: "#f8fafc", borderRadius: 12, padding: "10px 12px" }}>
                <span style={{ fontSize: 12, color: "#64748b" }}>Всего смен</span>
                <span style={{ fontWeight: 800, fontSize: 18 }}>{stat.total}</span>
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 }}>Авто и смены</div>
                {Object.keys(stat.vehicleCounts).length === 0 ? (
                  <div style={{ fontSize: 12, opacity: 0.6 }}>Нет данных</div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {Object.entries(stat.vehicleCounts).sort((a,b) => b[1] - a[1]).map(([plate, count]) => (
                      <div key={plate} style={{ padding: "6px 10px", borderRadius: 12, background: "#f1f5f9", border: "1px solid #e2e8f0", fontSize: 12 }}>
                        <span style={{ fontWeight: 700 }}>{plate}</span>
                        <span style={{ marginLeft: 6, opacity: 0.7 }}>{count} смен</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 14 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>Маршруты</span>
                <div style={{ marginTop: 6 }}>
                  {Object.entries(stat.routes).sort((a,b) => b[1] - a[1]).slice(0, 5).map(([r, count]) => (
                    <div key={r} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                      <span>{r}</span>
                      <span style={{ opacity: 0.7 }}>{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
