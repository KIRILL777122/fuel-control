"use client";

import React from "react";
import { DriverForm, VehicleForm } from "../components/Forms";
import { DriversList } from "../components/DriversList";
import { VehiclesList } from "../components/VehiclesList";
import { Driver, Vehicle, CustomList } from "../types";
import styles from "../page.module.css";

const API_BASE = "";

async function getJson(path: string) {
  try {
    const res = await fetch(`${API_BASE}${path}`, { cache: "no-store", credentials: "include" });
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e: any) {
    return { ok: false, status: 0, data: { error: String(e?.message ?? e) } };
  }
}

export default function AddPage() {
  const [activeTab, setActiveTab] = React.useState<"drivers" | "vehicles" | "routes" | "lists">("drivers");
  const [drivers, setDrivers] = React.useState<Driver[]>([]);
  const [vehicles, setVehicles] = React.useState<Vehicle[]>([]);
  const [routes, setRoutes] = React.useState<string[]>([]);
  const [newRoute, setNewRoute] = React.useState("");
  const [lists, setLists] = React.useState<CustomList[]>([]);
  const [loading, setLoading] = React.useState(true);

  const [newListName, setNewListName] = React.useState("");
  const [newListType, setNewListType] = React.useState<"DRIVER" | "VEHICLE" | "ROUTE">("DRIVER");
  const [selectedList, setSelectedList] = React.useState<CustomList | null>(null);
  const [newRouteName, setNewRouteName] = React.useState("");
  const [listError, setListError] = React.useState<string | null>(null);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    const [driversRes, vehiclesRes, listsRes, shiftsRes] = await Promise.all([
      getJson("/api/drivers"),
      getJson("/api/vehicles"),
      getJson("/api/lists"),
      getJson("/api/shifts?limit=5000"),
    ]);
    setDrivers(Array.isArray(driversRes.data) ? driversRes.data : []);
    setVehicles(Array.isArray(vehiclesRes.data) ? vehiclesRes.data : []);
    setLists(Array.isArray(listsRes.data) ? listsRes.data : []);
    const shiftItems = Array.isArray(shiftsRes.data?.items) ? shiftsRes.data.items : [];
    const routeSet = new Set(shiftItems.map((s: any) => s.routeName).filter(Boolean));
    setRoutes(Array.from(routeSet) as string[]);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const createList = async () => {
    if (!newListName) return;
    setListError(null);
    const res = await fetch("/api/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name: newListName, type: newListType }),
    });
    if (res.ok) {
      const created = await res.json();
      setNewListName("");
      setLists((prev) => [created, ...prev]);
    } else {
      const txt = await res.text();
      setListError(txt || "Ошибка создания списка");
    }
  };

  const deleteList = async (id: string) => {
    if (!confirm("Удалить список?")) return;
    await fetch(`/api/lists/${id}`, { method: "DELETE", credentials: "include" });
    loadData();
  };

  const addRouteToList = async () => {
    if (!selectedList || !newRouteName) return;
    const res = await fetch(`/api/lists/${selectedList.id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ routeName: newRouteName }),
    });
    if (res.ok) {
      setNewRouteName("");
      const fresh = await getJson("/api/lists");
      if (fresh.ok) {
        const updated = (fresh.data as CustomList[]).find(l => l.id === selectedList.id);
        if (updated) setSelectedList(updated);
      }
    }
  };

  const removeFromList = async (itemId: string) => {
    if (!confirm("Удалить из списка?")) return;
    const res = await fetch(`/api/lists/items/${itemId}`, { method: "DELETE", credentials: "include" });
    if (res.ok) {
      await loadData();
      if (selectedList) {
        const fresh = await getJson("/api/lists");
        if (fresh.ok) {
          const updated = (fresh.data as CustomList[]).find((l) => l.id === selectedList.id);
          if (updated) setSelectedList(updated);
        }
      }
    }
  };

  if (loading) {
    return <div style={{ padding: 24, textAlign: "center" }}>Загрузка...</div>;
  }

  return (
    <div>
      <h1 style={{ margin: "0 0 24px 0" }}>Авто и водители</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[
          { id: "drivers", label: "Водители" },
          { id: "vehicles", label: "Авто" },
          { id: "routes", label: "Маршруты" },
          { id: "lists", label: "Списки (Группы)" },
        ].map((t) => (
          <button
            key={t.id}
            className={styles.button}
            onClick={() => setActiveTab(t.id as any)}
            style={{
              backgroundColor: activeTab === t.id ? "#eef2ff" : "#fff",
              borderColor: activeTab === t.id ? "#4338ca" : "#d7d7e0",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "drivers" && (
        <div style={{ background: "#fff", padding: 20, borderRadius: 16, border: "1px solid #e9e9f2" }}>
          <h3 style={{ marginTop: 0 }}>Новый водитель</h3>
          <DriverForm onSave={loadData} />
          <div style={{ marginTop: 24 }}>
            <DriversList items={drivers} allLists={lists.filter((l) => l.type === "DRIVER")} onUpdate={loadData} />
          </div>
        </div>
      )}

      {activeTab === "vehicles" && (
        <div style={{ background: "#fff", padding: 20, borderRadius: 16, border: "1px solid #e9e9f2" }}>
          <h3 style={{ marginTop: 0 }}>Новый автомобиль</h3>
          <VehicleForm onSave={loadData} />
          <div style={{ marginTop: 24 }}>
            <VehiclesList initial={vehicles} allLists={lists.filter((l) => l.type === "VEHICLE")} onUpdate={loadData} />
          </div>
        </div>
      )}
      {activeTab === "routes" && (
        <div style={{ background: "#fff", padding: 20, borderRadius: 16, border: "1px solid #e9e9f2" }}>
          <h3 style={{ marginTop: 0 }}>Маршруты</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input value={newRoute} onChange={(e) => setNewRoute(e.target.value)} placeholder="Название маршрута" style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #d7d7e0" }} />
            <button className={styles.button} onClick={() => { if (!newRoute) return; setRoutes(prev => prev.includes(newRoute) ? prev : [newRoute, ...prev].sort()); setNewRoute(""); }}>
              Добавить
            </button>
          </div>
          <div style={{ display: "grid", gap: 8, maxHeight: 360, overflowY: "auto" }}>
            {routes.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", opacity: 0.6 }}>Маршрутов пока нет</div>
            ) : (
              routes.map(r => (
                <div key={r} style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <span style={{ fontWeight: 600 }}>{r}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <select
                      defaultValue=""
                      onChange={async (e) => {
                        const listId = e.target.value;
                        if (!listId) return;
                        const res = await fetch(`/api/lists/${listId}/items`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          credentials: "include",
                          body: JSON.stringify({ routeName: r }),
                        });
                        if (res.ok) {
                          await loadData();
                        }
                        e.target.value = "";
                      }}
                      style={{ padding: "4px 8px", borderRadius: 8, border: "1px solid #d7d7e0", fontSize: 12 }}
                    >
                      <option value="">+ В список</option>
                      {lists.filter(l => l.type === "ROUTE").map(l => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                    <button onClick={() => setRoutes(prev => prev.filter(x => x !== r))} style={{ color: "#ef4444", background: "none", border: "none", cursor: "pointer" }}>
                      Удалить
                    </button>
                  </div>

                </div>
              ))
            )}
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: "#64748b" }}>
            Маршруты загружаются из графика смен. Добавленные здесь — локальный список.
          </div>
        </div>
      )}

      {activeTab === "lists" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 24 }}>
          <div style={{ background: "#fff", padding: 20, borderRadius: 16, border: "1px solid #e9e9f2", height: "fit-content" }}>
            <h3 style={{ marginTop: 0 }}>Создать список</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input value={newListName} onChange={(e) => setNewListName(e.target.value)} placeholder="Название списка" style={{ padding: 10, borderRadius: 8, border: "1px solid #d7d7e0" }} />
              <select value={newListType} onChange={(e) => setNewListType(e.target.value as any)} style={{ padding: 10, borderRadius: 8, border: "1px solid #d7d7e0" }}>
                <option value="DRIVER">Для водителей</option>
                <option value="VEHICLE">Для автомобилей</option>
                <option value="ROUTE">Для маршрутов</option>
              </select>
              <button className={styles.button} onClick={createList} style={{ background: "#4338ca", color: "#fff", border: "none" }}>Создать</button>
              {listError && <div style={{ color: "#ef4444", fontSize: 12 }}>{listError}</div>}
            </div>
          </div>

          <div style={{ background: "#fff", padding: 20, borderRadius: 16, border: "1px solid #e9e9f2" }}>
            <h3 style={{ marginTop: 0 }}>Существующие списки</h3>
            <div style={{ display: "grid", gap: 12 }}>
              {lists.map((l) => (
                <div
                  key={l.id}
                  onClick={() => setSelectedList(l)}
                  style={{ padding: 12, border: "1px solid #eee", borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>{l.name}</div>
                    <div style={{ fontSize: 11, opacity: 0.6 }}>{l.type === "DRIVER" ? "Водители" : l.type === "VEHICLE" ? "Авто" : "Маршруты"} • {l.items.length} элементов</div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); deleteList(l.id); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>🗑️</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedList && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", padding: 24, borderRadius: 20, width: "100%", maxWidth: 500, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>Группа: {selectedList.name}</h3>
              <button onClick={() => setSelectedList(null)} style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer" }}>×</button>
            </div>

            <div style={{ overflowY: "auto", flex: 1, paddingRight: 8 }}>
            {selectedList.type === "ROUTE" && (
<div style={{ marginBottom: 16, padding: 12, background: "#f8fafc", borderRadius: 12, border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Добавить маршрут</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={newRouteName} onChange={(e) => setNewRouteName(e.target.value)} placeholder="Название маршрута" style={{ flex: 1, padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }} />
                <button onClick={addRouteToList} className={styles.button} style={{ padding: "6px 12px" }}>Добавить</button>
              </div>
            </div>
            )}

              {selectedList.items.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", opacity: 0.5 }}>В этом списке пока никого нет</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {selectedList.items.map((item) => {
                    const driver = drivers.find((d) => d.id === item.driverId);
                    const vehicle = vehicles.find((v) => v.id === item.vehicleId);
                    const name = driver ? (driver.fullName || driver.telegramUserId) : vehicle ? vehicle.plateNumber : item.routeName || "???";
                    return (
                      <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: "#f8fafc", borderRadius: 12 }}>
                        <span style={{ fontWeight: 600 }}>{name}</span>
                        <button onClick={() => removeFromList(item.id)} style={{ color: "#ef4444", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>Удалить</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ marginTop: 24 }}>
              <button onClick={() => setSelectedList(null)} className={styles.button} style={{ width: "100%" }}>Закрыть</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
