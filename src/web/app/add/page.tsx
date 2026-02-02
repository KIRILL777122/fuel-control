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
        const updated = (fresh.data as CustomList[]).find((l) => l.id === selectedList.id);
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
      <h1 className={styles.pageTitle}>Авто и водители</h1>

      <div className={styles.tabBar}>
        {[
          { id: "drivers", label: "Водители" },
          { id: "vehicles", label: "Авто" },
          { id: "routes", label: "Маршруты" },
          { id: "lists", label: "Списки (Группы)" },
        ].map((t) => (
          <button
            key={t.id}
            className={`${styles.tabButton} ${activeTab === t.id ? styles.tabButtonActive : ""}`}
            onClick={() => setActiveTab(t.id as any)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "drivers" && (
        <div className={styles.card}>
          <h3 style={{ marginTop: 0 }}>Новый водитель</h3>
          <DriverForm onSave={loadData} />
          <div style={{ marginTop: 24 }}>
            <DriversList items={drivers} allLists={lists.filter((l) => l.type === "DRIVER")} onUpdate={loadData} />
          </div>
        </div>
      )}

      {activeTab === "vehicles" && (
        <div className={styles.card}>
          <h3 style={{ marginTop: 0 }}>Новый автомобиль</h3>
          <VehicleForm onSave={loadData} />
          <div style={{ marginTop: 24 }}>
            <VehiclesList initial={vehicles} allLists={lists.filter((l) => l.type === "VEHICLE")} onUpdate={loadData} />
          </div>
        </div>
      )}
      {activeTab === "routes" && (
        <div className={styles.card}>
          <h3 style={{ marginTop: 0 }}>Маршруты</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input value={newRoute} onChange={(e) => setNewRoute(e.target.value)} placeholder="Название маршрута" className={styles.input} style={{ flex: 1 }} />
            <button className={styles.button} onClick={() => { if (!newRoute) return; setRoutes(prev => prev.includes(newRoute) ? prev : [newRoute, ...prev].sort()); setNewRoute(""); }}>
              Добавить
            </button>
          </div>
          <div style={{ display: "grid", gap: 8, maxHeight: 360, overflowY: "auto" }}>
            {routes.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", opacity: 0.6 }}>Маршрутов пока нет</div>
            ) : (
              routes.map(r => (
                <div
                  key={r}
                  style={{
                    padding: 12,
                    border: "1px solid var(--card-border)",
                    borderRadius: 12,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    background: "var(--card-bg)",
                  }}
                >
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
                      className={styles.select}
                    >
                      <option value="">+ В список</option>
                      {lists.filter(l => l.type === "ROUTE").map(l => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => setRoutes(prev => prev.filter(x => x !== r))}
                      style={{ color: "var(--danger-text)", background: "none", border: "none", cursor: "pointer" }}
                    >
                      Удалить
                    </button>
                  </div>

                </div>
              ))
            )}
          </div>
          <div className={styles.muted} style={{ marginTop: 12 }}>
            Маршруты загружаются из графика смен. Добавленные здесь — локальный список.
          </div>
        </div>
      )}

      {activeTab === "lists" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 24 }}>
          <div className={styles.card} style={{ height: "fit-content" }}>
            <h3 style={{ marginTop: 0 }}>Создать список</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input value={newListName} onChange={(e) => setNewListName(e.target.value)} placeholder="Название списка" className={styles.input} />
              <select value={newListType} onChange={(e) => setNewListType(e.target.value as any)} className={styles.select}>
                <option value="DRIVER">Для водителей</option>
                <option value="VEHICLE">Для автомобилей</option>
                <option value="ROUTE">Для маршрутов</option>
              </select>
              <button
                className={styles.button}
                onClick={createList}
                style={{ background: "var(--primary-bg)", color: "var(--primary-text)", border: "none" }}
              >
                Создать
              </button>
              {listError && <div style={{ color: "var(--error-color)", fontSize: 12 }}>{listError}</div>}
            </div>
          </div>

          <div className={styles.card}>
            <h3 style={{ marginTop: 0 }}>Существующие списки</h3>
            <div style={{ display: "grid", gap: 12 }}>
              {lists.map((l) => (
                <div
                  key={l.id}
                  onClick={() => setSelectedList(l)}
                  style={{
                    padding: 12,
                    border: "1px solid var(--card-border)",
                    borderRadius: 12,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    cursor: "pointer",
                    background: "var(--card-bg)",
                  }}
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
        <div className={styles.detailOverlay}>
          <div className={styles.detailCard} style={{ maxWidth: 500 }}>
            <h3 style={{ marginTop: 0 }}>Список: {selectedList.name}</h3>
            <div style={{ maxHeight: 300, overflowY: "auto", marginBottom: 16 }}>
              {selectedList.items.length === 0 && <div style={{ opacity: 0.6 }}>Список пуст</div>}
              {selectedList.items.map((item) => (
                <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span>
                    {selectedList.type === "DRIVER" 
                      ? drivers.find((d) => d.id === item.driverId)?.fullName || drivers.find((d) => d.id === item.driverId)?.telegramUserId 
                      : selectedList.type === "VEHICLE" 
                      ? vehicles.find((v) => v.id === item.vehicleId)?.plateNumber 
                      : item.routeName}
                  </span>
                  <button onClick={() => removeFromList(item.id)} style={{ background: "none", border: "none", cursor: "pointer" }}>🗑️</button>
                </div>
              ))}
            </div>
            {selectedList.type === "ROUTE" && (
              <div style={{ display: "flex", gap: 8 }}>
                <input value={newRouteName} onChange={(e) => setNewRouteName(e.target.value)} placeholder="Добавить маршрут" className={styles.input} style={{ flex: 1 }} />
                <button className={styles.button} onClick={addRouteToList}>Добавить</button>
              </div>
            )}
            <button className={styles.button} onClick={() => setSelectedList(null)} style={{ marginTop: 16 }}>Закрыть</button>
          </div>
        </div>
      )}
    </div>
  );
}
