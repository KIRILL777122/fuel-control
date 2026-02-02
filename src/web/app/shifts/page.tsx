"use client";

import React from "react";
import styles from "../page.module.css";
import { Shift, Driver, Vehicle, CustomList } from "../types";

const API_BASE = "";

type ShiftDraft = {
  driverName: string;
  routeName: string;
  shiftDate: string;
  routeNumber?: string | null;
  plateNumber?: string | null;
  plannedTime?: string | null;
  assignedTime?: string | null;
  departureTime?: string | null;
  delayMinutes?: string | number | null;
};

async function getJson(url: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return { ok: false, error: res.statusText };
  return { ok: true, data: await res.json() };
}

export default function ShiftsPage() {
  const [activeTab, setActiveTab] = React.useState<"history" | "analytics">("history");
  const [shifts, setShifts] = React.useState<Shift[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<ShiftDraft | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);
  
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

  const toDateInput = (value: string) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().split("T")[0];
  };

  const shiftToDraft = (s: Shift): ShiftDraft => ({
    driverName: s.driverName || "",
    routeName: s.routeName || "",
    shiftDate: toDateInput(s.shiftDate),
    routeNumber: s.routeNumber ?? "",
    plateNumber: s.plateNumber ?? "",
    plannedTime: s.plannedTime ?? "",
    assignedTime: s.assignedTime ?? "",
    departureTime: s.departureTime ?? "",
    delayMinutes: s.delayMinutes ?? "",
  });

  const draftToRecord = (d: ShiftDraft) => ({
    driver_name: d.driverName,
    route_name: d.routeName,
    shift_date: d.shiftDate ? `${d.shiftDate}T00:00:00` : "",
    route_number: d.routeNumber || null,
    plate_number: d.plateNumber || null,
    planned_time: d.plannedTime || null,
    assigned_time: d.assignedTime || null,
    departure_time: d.departureTime || null,
    delay_minutes: d.delayMinutes === "" || d.delayMinutes === null ? null : Number(d.delayMinutes),
  });

  const startEdit = (s: Shift) => {
    setEditingId(s.id);
    setDraft(shiftToDraft(s));
    setIsCreating(false);
  };

  const startCreate = () => {
    setIsCreating(true);
    setEditingId(null);
    setDraft({
      driverName: "",
      routeName: "",
      shiftDate: dateTo || new Date().toISOString().split("T")[0],
      routeNumber: "",
      plateNumber: "",
      plannedTime: "",
      assignedTime: "",
      departureTime: "",
      delayMinutes: "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
    setIsCreating(false);
  };

  const saveDraft = async (original?: Shift) => {
    if (!draft) return;
    if (!draft.driverName || !draft.routeName || !draft.shiftDate) {
      alert("Заполните: водитель, типовой маршрут и дата.");
      return;
    }
    try {
      const payload = { records: [draftToRecord(draft)] };
      const res = await fetch("/api/shifts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Не удалось сохранить смену");

      if (original) {
        const originalDraft = shiftToDraft(original);
        const changed = JSON.stringify(originalDraft) !== JSON.stringify(draft);
        if (changed) {
          await fetch(`/api/shifts/${original.id}`, { method: "DELETE", credentials: "include" });
        }
      }
      await loadShifts();
      cancelEdit();
    } catch (err) {
      console.error(err);
      alert("Ошибка сохранения смены");
    }
  };

  const deleteShift = async (id: string) => {
    if (!confirm("Удалить смену?")) return;
    try {
      const res = await fetch(`/api/shifts/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Не удалось удалить смену");
      await loadShifts();
    } catch (err) {
      console.error(err);
      alert("Ошибка удаления смены");
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h1 className={styles.pageTitle}>📅 Графики смен</h1>

      <div className={styles.tabBar}>
        <button
          className={`${styles.tabButton} ${activeTab === "history" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("history")}
        >
          📋 История ({filteredShifts.length})
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === "analytics" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("analytics")}
        >
          📊 Аналитика
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, marginBottom: 16 }}>
        <div className={styles.filterCard} style={{ marginBottom: 0 }}>
          <div className={styles.filterRow} style={{ marginBottom: 16 }}>
            <label className={styles.field}>
              Дата от
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={styles.input} />
            </label>
            <label className={styles.field}>
              Дата до
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={styles.input} />
            </label>
            <button className={styles.button} onClick={loadShifts} disabled={loading} style={{ height: 38 }}>
              {loading ? "..." : "Обновить"}
            </button>
            {activeTab === "history" && (
              <button className={styles.button} onClick={startCreate} disabled={isCreating} style={{ height: 38 }}>
                Добавить смену
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            {/* Driver Filter */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Водители</span>
              <select
                value={selectedDriverListId}
                onChange={e => handleListChange(e.target.value)}
                className={styles.select}
              >
                <option value="">-- Все списки --</option>
                {driverLists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, opacity: 0.7 }}>Вручную:</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => { setSelectedDrivers(filterOptions.drivers); setSelectedDriverListId(""); }}
                      style={{ fontSize: 10, cursor: "pointer", border: "1px solid var(--card-border)", borderRadius: 999, padding: "2px 8px", background: "var(--card-bg)", color: "var(--text)" }}
                    >
                      Все
                    </button>
                    <button
                      onClick={() => { setSelectedDrivers([]); setSelectedDriverListId(""); }}
                      style={{ fontSize: 10, cursor: "pointer", border: "1px solid var(--card-border)", borderRadius: 999, padding: "2px 8px", background: "var(--card-bg)", color: "var(--text)" }}
                    >
                      Очистить
                    </button>
                  </div>
                </div>
                <div style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid var(--card-border)", minWidth: 150, height: 100, background: "var(--card-bg)", overflowY: "auto" }}>
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
                className={styles.select}
              >
                <option value="">-- Все списки --</option>
                {vehicleLists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, opacity: 0.7 }}>Выбор:</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => setSelectedVehicles(filterOptions.vehicles)}
                      style={{ fontSize: 10, cursor: "pointer", border: "1px solid var(--card-border)", borderRadius: 999, padding: "2px 8px", background: "var(--card-bg)", color: "var(--text)" }}
                    >
                      Все
                    </button>
                    <button
                      onClick={() => setSelectedVehicles([])}
                      style={{ fontSize: 10, cursor: "pointer", border: "1px solid var(--card-border)", borderRadius: 999, padding: "2px 8px", background: "var(--card-bg)", color: "var(--text)" }}
                    >
                      Очистить
                    </button>
                  </div>
                </div>
                <div style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid var(--card-border)", minWidth: 150, height: 100, background: "var(--card-bg)", overflowY: "auto" }}>
                  {filterOptions.vehicles.map(v => (
                    <label key={v} style={{ display: "block", fontSize: 12, padding: "2px 0", whiteSpace: "nowrap", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={selectedVehicles.includes(v)}
                        onChange={() => {
                          setSelectedVehicles(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
                          setSelectedVehicleListId("");
                        }}
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
                className={styles.select}
              >
                <option value="">-- Все списки --</option>
                {routeLists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, opacity: 0.7 }}>Выбор:</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => setSelectedRoutes(filterOptions.routes)}
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
                <div style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid var(--card-border)", minWidth: 150, height: 100, background: "var(--card-bg)", overflowY: "auto" }}>
                  {filterOptions.routes.map(r => (
                    <label key={r} style={{ display: "block", fontSize: 12, padding: "2px 0", whiteSpace: "nowrap", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={selectedRoutes.includes(r)}
                        onChange={() => {
                          setSelectedRoutes(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);
                          setSelectedRouteListId("");
                        }}
                      />
                      {r}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.sidePanel}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--text)" }}>Сводка по маршрутам</div>
          <div style={{ display: "grid", gap: 4 }}>
            {routeSummary.map(([route, cnt]) => (
              <div key={route} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--table-border)" }}>
                <span style={{ fontWeight: 500 }}>{route}</span>
                <span style={{ color: "var(--accent-color)", fontWeight: 700 }}>{cnt}</span>
              </div>
            ))}
            {routeSummary.length === 0 && <div className={styles.muted}>Нет данных</div>}
          </div>
        </div>
      </div>

      {activeTab === "history" && (
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
                <th className={styles.th}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={10} style={{ padding: 12, textAlign: "center" }}>Загрузка...</td></tr>
              )}
              {!loading && filteredShifts.length === 0 && (
                <tr><td colSpan={10} style={{ padding: 12, textAlign: "center", opacity: 0.7 }}>Нет данных</td></tr>
              )}
              {isCreating && draft && (
                <tr>
                  <td className={styles.td}>
                    <input className={styles.input} value={draft.routeNumber ?? ""} onChange={(e) => setDraft({ ...draft, routeNumber: e.target.value })} />
                  </td>
                  <td className={styles.td}>
                    <input className={styles.input} type="date" value={draft.shiftDate} onChange={(e) => setDraft({ ...draft, shiftDate: e.target.value })} />
                  </td>
                  <td className={styles.td}>
                    <input className={styles.input} list="route-options" value={draft.routeName} onChange={(e) => setDraft({ ...draft, routeName: e.target.value })} />
                  </td>
                  <td className={styles.td}>
                    <input className={styles.input} value={draft.plannedTime ?? ""} onChange={(e) => setDraft({ ...draft, plannedTime: e.target.value })} />
                  </td>
                  <td className={styles.td}>
                    <input className={styles.input} value={draft.assignedTime ?? ""} onChange={(e) => setDraft({ ...draft, assignedTime: e.target.value })} />
                  </td>
                  <td className={styles.td}>
                    <input className={styles.input} value={draft.departureTime ?? ""} onChange={(e) => setDraft({ ...draft, departureTime: e.target.value })} />
                  </td>
                  <td className={styles.td}>
                    <input className={styles.input} value={draft.delayMinutes ?? ""} onChange={(e) => setDraft({ ...draft, delayMinutes: e.target.value })} />
                  </td>
                  <td className={styles.td}>
                    <input className={styles.input} list="driver-options" value={draft.driverName} onChange={(e) => setDraft({ ...draft, driverName: e.target.value })} />
                  </td>
                  <td className={styles.td}>
                    <input className={styles.input} list="vehicle-options" value={draft.plateNumber ?? ""} onChange={(e) => setDraft({ ...draft, plateNumber: e.target.value })} />
                  </td>
                  <td className={styles.td} style={{ whiteSpace: "nowrap" }}>
                    <button className={styles.button} onClick={() => saveDraft()}>Сохранить</button>{" "}
                    <button className={styles.button} onClick={cancelEdit}>Отменить</button>
                  </td>
                </tr>
              )}
              {filteredShifts.map((s) => {
                const isEditing = editingId === s.id && draft;
                return (
                  <tr key={s.id}>
                    <td className={styles.td}>
                      {isEditing ? (
                        <input className={styles.input} value={draft.routeNumber ?? ""} onChange={(e) => setDraft({ ...draft, routeNumber: e.target.value })} />
                      ) : (
                        s.routeNumber ?? "—"
                      )}
                    </td>
                    <td className={styles.td}>
                      {isEditing ? (
                        <input className={styles.input} type="date" value={draft.shiftDate} onChange={(e) => setDraft({ ...draft, shiftDate: e.target.value })} />
                      ) : (
                        new Date(s.shiftDate).toLocaleDateString("ru-RU")
                      )}
                    </td>
                    <td className={styles.td}>
                      {isEditing ? (
                        <input className={styles.input} list="route-options" value={draft.routeName} onChange={(e) => setDraft({ ...draft, routeName: e.target.value })} />
                      ) : (
                        s.routeName
                      )}
                    </td>
                    <td className={styles.td}>
                      {isEditing ? (
                        <input className={styles.input} value={draft.plannedTime ?? ""} onChange={(e) => setDraft({ ...draft, plannedTime: e.target.value })} />
                      ) : (
                        s.plannedTime ?? "—"
                      )}
                    </td>
                    <td className={styles.td}>
                      {isEditing ? (
                        <input className={styles.input} value={draft.assignedTime ?? ""} onChange={(e) => setDraft({ ...draft, assignedTime: e.target.value })} />
                      ) : (
                        s.assignedTime ?? "—"
                      )}
                    </td>
                    <td className={styles.td}>
                      {isEditing ? (
                        <input className={styles.input} value={draft.departureTime ?? ""} onChange={(e) => setDraft({ ...draft, departureTime: e.target.value })} />
                      ) : (
                        s.departureTime ?? "—"
                      )}
                    </td>
                    <td className={styles.td}>
                      {isEditing ? (
                        <input className={styles.input} value={draft.delayMinutes ?? ""} onChange={(e) => setDraft({ ...draft, delayMinutes: e.target.value })} />
                      ) : (
                        s.delayMinutes ?? "—"
                      )}
                    </td>
                    <td className={styles.td}>
                      {isEditing ? (
                        <input className={styles.input} list="driver-options" value={draft.driverName} onChange={(e) => setDraft({ ...draft, driverName: e.target.value })} />
                      ) : (
                        s.driverName
                      )}
                    </td>
                    <td className={styles.td}>
                      {isEditing ? (
                        <input className={styles.input} list="vehicle-options" value={draft.plateNumber ?? ""} onChange={(e) => setDraft({ ...draft, plateNumber: e.target.value })} />
                      ) : (
                        s.plateNumber ?? "—"
                      )}
                    </td>
                    <td className={styles.td} style={{ whiteSpace: "nowrap" }}>
                      {isEditing ? (
                        <>
                          <button className={styles.button} onClick={() => saveDraft(s)}>Сохранить</button>{" "}
                          <button className={styles.button} onClick={cancelEdit}>Отменить</button>
                        </>
                      ) : (
                        <>
                          <button className={styles.button} onClick={() => startEdit(s)}>Редактировать</button>{" "}
                          <button className={styles.button} onClick={() => deleteShift(s.id)}>Удалить</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <datalist id="driver-options">
            {filterOptions.drivers.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <datalist id="vehicle-options">
            {filterOptions.vehicles.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <datalist id="route-options">
            {filterOptions.routes.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </div>
      )}

      {activeTab === "analytics" && (
        <div>
          <h3 className={styles.sectionTitle}>Сводка по водителям</h3>
          <div className={styles.ratingGrid}>
            {analyticsData.map((d) => (
              <div key={d.driverName} className={styles.ratingCard}>
                <div className={styles.ratingHeader}>
                  <div className={styles.ratingName}>{d.driverName}</div>
                </div>
                <div className={styles.ratingStats}>
                  <div className={`${styles.ratingStat} ${styles.ratingAccentBlue}`}>
                    <div className={styles.ratingLabel}>Смен всего</div>
                    <div className={styles.ratingValue}>{d.total}</div>
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
                      {Object.entries(d.vehicleCounts).map(([plate, cnt]) => (
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
          </div>
        </div>
      )}
    </div>
  );
}
