 "use client";

import React from "react";
import styles from "../page.module.css";

type ReleaseRow = {
  id: string;
  time: string;
  routeNumber: string;
  routeName: string;
  driverName: string;
  vehicleNumber: string;
  capacity: string;
  phone: string;
  comment: string;
};

type ReleaseData = {
  date: string;
  rows: ReleaseRow[];
};

type DriverItem = { id: string; name: string; phone: string };
type VehicleItem = { id: string; plate: string; capacity: string };
type RouteItem = { id: string; number: string; name: string; time: string };

const RECIPIENTS = [
  "pleshakova@karavay.spb.ru",
  "disp_spb_pp1@karavay.spb.ru",
  "kolyukha@karavay.spb.ru",
  "tek-nika@mail.ru",
  "security01@karavay.spb.ru",
];

const API_BASE = "";

const emptyRelease = (): ReleaseData => ({
  date: new Date().toISOString().slice(0, 10),
  rows: [],
});

function formatRuDate(value: string) {
  const match = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildExcelHtml(title: string, columns: string[], rows: string[][]) {
  const titleRow = `<tr><th colspan="${columns.length}" style="border:1px solid #e5e7eb;padding:8px 10px;text-align:center;background:#e5f2d8;font-weight:700;">${escapeHtml(
    title
  )}</th></tr>`;
  const header = `<tr>${columns
    .map(
      (c) =>
        `<th style="border:1px solid #e5e7eb;padding:6px 8px;text-align:center;background:#fff2cc;">${escapeHtml(
          c
        )}</th>`
    )
    .join("")}</tr>`;
  const body = rows
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell) =>
              `<td style="border:1px solid #e5e7eb;padding:6px 8px;text-align:center;">${escapeHtml(
                String(cell ?? "")
              )}</td>`
          )
          .join("")}</tr>`
    )
    .join("");
  return `<html><head><meta charset="UTF-8"></head><body><table style="border-collapse:collapse;">${titleRow}${header}${body}</table></body></html>`;
}


export default function ReleasesPage() {
  const [activeTab, setActiveTab] = React.useState<"afina" | "nika">("nika");
  const [subTab, setSubTab] = React.useState<"table" | "lists">("table");
  const [releases, setReleases] = React.useState<{ afina: ReleaseData; nika: ReleaseData }>({
    afina: emptyRelease(),
    nika: emptyRelease(),
  });
  const [lists, setLists] = React.useState<{ drivers: DriverItem[]; vehicles: VehicleItem[]; routes: RouteItem[] }>({
    drivers: [],
    vehicles: [],
    routes: [],
  });
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const listsReadyRef = React.useRef(false);
  const [newDriver, setNewDriver] = React.useState({ name: "", phone: "" });
  const [newVehicle, setNewVehicle] = React.useState({ plate: "", capacity: "" });
  const [newRoute, setNewRoute] = React.useState({ number: "", name: "", time: "" });

  const loadAll = React.useCallback(async () => {
    setLoading(true);
    setNote(null);
    try {
      const [afinaRes, nikaRes, listsRes] = await Promise.all([
        fetch(`${API_BASE}/api/releases?source=afina`, { credentials: "include" }),
        fetch(`${API_BASE}/api/releases?source=nika`, { credentials: "include" }),
        fetch(`${API_BASE}/api/releases/lists`, { credentials: "include" }),
      ]);
      const [afinaData, nikaData, listsData] = await Promise.all([
        afinaRes.json().catch(() => ({})),
        nikaRes.json().catch(() => ({})),
        listsRes.json().catch(() => ({})),
      ]);
      if (afinaRes.ok) {
        setReleases((prev) => ({
          ...prev,
          afina: {
            date: afinaData?.date || emptyRelease().date,
            rows: Array.isArray(afinaData?.rows) ? afinaData.rows : [],
          },
        }));
      }
      if (nikaRes.ok) {
        setReleases((prev) => ({
          ...prev,
          nika: {
            date: nikaData?.date || emptyRelease().date,
            rows: Array.isArray(nikaData?.rows) ? nikaData.rows : [],
          },
        }));
      }
      if (listsRes.ok) {
        setLists({
          drivers: Array.isArray(listsData?.drivers) ? listsData.drivers : [],
          vehicles: Array.isArray(listsData?.vehicles) ? listsData.vehicles : [],
          routes: Array.isArray(listsData?.routes) ? listsData.routes : [],
        });
      }
    } catch (e: any) {
      setNote(e?.message || "Не удалось загрузить данные");
    } finally {
      listsReadyRef.current = true;
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadAll();
  }, [loadAll]);

  const current = releases[activeTab];

  const updateRows = (nextRows: ReleaseRow[]) => {
    setReleases((prev) => ({ ...prev, [activeTab]: { ...prev[activeTab], rows: nextRows } }));
  };

  const updateDate = (value: string) => {
    setReleases((prev) => ({ ...prev, [activeTab]: { ...prev[activeTab], date: value } }));
  };

  const addRow = () => {
    updateRows([
      ...current.rows,
      {
        id: crypto.randomUUID(),
        time: "",
        routeNumber: "",
        routeName: "",
        driverName: "",
        vehicleNumber: "",
        capacity: "",
        phone: "",
        comment: "",
      },
    ]);
  };

  const removeRow = (id: string) => {
    updateRows(current.rows.filter((r) => r.id !== id));
  };

  const updateRow = (id: string, patch: Partial<ReleaseRow>) => {
    updateRows(
      current.rows.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  };

  const saveRelease = async () => {
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch(`${API_BASE}/api/releases?source=${activeTab}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: current.date, rows: current.rows }),
      });
      if (!res.ok) {
        const text = await res.text();
        setNote(text || "Не удалось сохранить таблицу");
      } else {
        setNote("Сохранено");
      }
    } catch (e: any) {
      setNote(e?.message || "Не удалось сохранить таблицу");
    } finally {
      setSaving(false);
    }
  };

  const saveReleaseSilent = async () => {
    const res = await fetch(`${API_BASE}/api/releases?source=${activeTab}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: current.date, rows: current.rows }),
    });
    return res.ok;
  };

  const saveLists = async () => {
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch(`${API_BASE}/api/releases/lists`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lists),
      });
      if (!res.ok) {
        const text = await res.text();
        setNote(text || "Не удалось сохранить списки");
      } else {
        setNote("Списки сохранены");
      }
    } catch (e: any) {
      setNote(e?.message || "Не удалось сохранить списки");
    } finally {
      setSaving(false);
    }
  };

  const saveListsSilent = React.useCallback(async (nextLists: typeof lists) => {
    try {
      await fetch(`${API_BASE}/api/releases/lists`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextLists),
      });
    } catch {
      // Silent autosave
    }
  }, []);

  React.useEffect(() => {
    if (!listsReadyRef.current) return;
    const timer = window.setTimeout(() => {
      void saveListsSilent(lists);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [lists, saveListsSilent]);

  const exportExcel = async () => {
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch(`${API_BASE}/api/releases/export.xlsx`, { credentials: "include" });
      if (!res.ok) {
        const text = await res.text();
        setNote(text || "Не удалось выгрузить Excel");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Выпуск_Афина_Ника.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setNote(e?.message || "Не удалось выгрузить Excel");
    } finally {
      setSaving(false);
    }
  };

  const sendEmail = async () => {
    setSaving(true);
    setNote(null);
    try {
      const saved = await saveReleaseSilent();
      if (!saved) {
        setNote("Не удалось сохранить выпуск перед отправкой");
        return;
      }
      const res = await fetch(`${API_BASE}/api/releases/email`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: activeTab, date: current.date, rows: current.rows }),
      });
      if (!res.ok) {
        const text = await res.text();
        setNote(text || "Не удалось отправить письмо");
      } else {
        setNote(`Отправлено: ${RECIPIENTS.join(", ")}`);
      }
    } catch (e: any) {
      setNote(e?.message || "Не удалось отправить письмо");
    } finally {
      setSaving(false);
    }
  };

  const onDriverChange = (rowId: string, name: string) => {
    const driver = lists.drivers.find((d) => d.name === name);
    updateRow(rowId, { driverName: name, phone: driver?.phone || "" });
  };

  const onVehicleChange = (rowId: string, plate: string) => {
    const vehicle = lists.vehicles.find((v) => v.plate === plate);
    updateRow(rowId, { vehicleNumber: plate, capacity: vehicle?.capacity || "" });
  };

  const onRouteChange = (rowId: string, name: string) => {
    const route = lists.routes.find((r) => r.name === name);
    updateRow(rowId, {
      routeName: name,
      routeNumber: route?.number || "",
      time: route?.time || "",
    });
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.pageTitle}>Выпуски</h1>
      </div>

      <div className={styles.tabBar}>
        <button
          className={`${styles.tabButton} ${activeTab === "afina" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("afina")}
        >
          Афина
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === "nika" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("nika")}
        >
          Ника
        </button>
        <button
          className={`${styles.tabButton} ${subTab === "table" ? styles.tabButtonActive : ""}`}
          onClick={() => setSubTab("table")}
        >
          Выпуск
        </button>
        <button
          className={`${styles.tabButton} ${subTab === "lists" ? styles.tabButtonActive : ""}`}
          onClick={() => setSubTab("lists")}
        >
          Списки
        </button>
      </div>

      {note && (
        <div className={styles.card} style={{ marginTop: 0, padding: "10px 12px" }}>
          {note}
        </div>
      )}

      {loading && (
        <div className={styles.card} style={{ marginTop: 0 }}>Загрузка...</div>
      )}

      {!loading && subTab === "table" && (
        <div>
          <div className={styles.card} style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 700 }}>Сводка на</div>
            <input
              type="date"
              className={styles.input}
              value={current.date}
              onChange={(e) => updateDate(e.target.value)}
            />
            <button className={styles.button} onClick={addRow}>Добавить строку</button>
            <button className={styles.button} onClick={saveRelease} disabled={saving}>Сохранить</button>
            <button className={styles.button} onClick={exportExcel}>Выгрузить в Excel</button>
            <button className={styles.button} onClick={sendEmail} disabled={saving}>Отправить по почте</button>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={`${styles.releasesTh} ${styles.releasesSubhead}`} colSpan={10}>
                    Сводка на {formatRuDate(current.date)}
                  </th>
                </tr>
                <tr>
                  <th className={styles.releasesTh}>№ п/п</th>
                  <th className={styles.releasesTh}>Время подачи</th>
                  <th className={styles.releasesTh}>Номер маршрута</th>
                  <th className={styles.releasesTh}>Наименование маршрута</th>
                  <th className={styles.releasesTh}>ФИО водителя</th>
                  <th className={styles.releasesTh}>Гос. номер а/м</th>
                  <th className={styles.releasesTh}>Вместимость а/м</th>
                  <th className={styles.releasesTh}>Номер телефона</th>
                  <th className={styles.releasesTh}>Комментарии</th>
                  <th className={styles.releasesTh}></th>
                </tr>
              </thead>
              <tbody>
                {current.rows.length === 0 ? (
                  <tr>
                    <td className={styles.td} colSpan={10} style={{ textAlign: "center", opacity: 0.7 }}>
                      Нет данных
                    </td>
                  </tr>
                ) : (
                  current.rows.map((row, idx) => (
                    <tr key={row.id}>
                      <td className={styles.td}>{idx + 1}</td>
                      <td className={styles.td}>
                        <input
                          className={styles.input}
                          value={row.time}
                          onChange={(e) => updateRow(row.id, { time: e.target.value })}
                        />
                      </td>
                      <td className={styles.td}>
                        <input className={styles.input} value={row.routeNumber} readOnly />
                      </td>
                      <td className={styles.td}>
                        <select
                          className={styles.select}
                          value={row.routeName}
                          onChange={(e) => onRouteChange(row.id, e.target.value)}
                        >
                          <option value="">Выберите маршрут</option>
                          {lists.routes.map((r) => (
                            <option key={r.id} value={r.name}>{r.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className={styles.td}>
                        <select
                          className={styles.select}
                          value={row.driverName}
                          onChange={(e) => onDriverChange(row.id, e.target.value)}
                        >
                          <option value="">Выберите водителя</option>
                          {lists.drivers.map((d) => (
                            <option key={d.id} value={d.name}>{d.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className={styles.td}>
                        <select
                          className={styles.select}
                          value={row.vehicleNumber}
                          onChange={(e) => onVehicleChange(row.id, e.target.value)}
                        >
                          <option value="">Выберите авто</option>
                          {lists.vehicles.map((v) => (
                            <option key={v.id} value={v.plate}>{v.plate}</option>
                          ))}
                        </select>
                      </td>
                      <td className={styles.td}>
                        <input className={styles.input} value={row.capacity} readOnly />
                      </td>
                      <td className={styles.td}>
                        <input className={styles.input} value={row.phone} readOnly />
                      </td>
                      <td className={styles.td}>
                        <input
                          className={styles.input}
                          value={row.comment}
                          onChange={(e) => updateRow(row.id, { comment: e.target.value })}
                        />
                      </td>
                      <td className={styles.td}>
                        <button className={styles.miniBtn} onClick={() => removeRow(row.id)}>Удалить</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && subTab === "lists" && (
        <div className={styles.card} style={{ marginTop: 0 }}>
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Водители</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <input
                  className={styles.input}
                  placeholder="ФИО водителя"
                  value={newDriver.name}
                  onChange={(e) => setNewDriver({ ...newDriver, name: e.target.value })}
                />
                <input
                  className={styles.input}
                  placeholder="Номер телефона"
                  value={newDriver.phone}
                  onChange={(e) => setNewDriver({ ...newDriver, phone: e.target.value })}
                />
                <button
                  className={styles.button}
                  onClick={() => {
                    if (!newDriver.name) return;
                    setLists((prev) => ({
                      ...prev,
                      drivers: [...prev.drivers, { id: crypto.randomUUID(), name: newDriver.name, phone: newDriver.phone }],
                    }));
                    setNewDriver({ name: "", phone: "" });
                  }}
                >
                  Добавить
                </button>
              </div>
              <div className={styles.listBox}>
                {lists.drivers.map((d) => (
                  <div key={d.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                    <div>{d.name} — {d.phone || "без номера"}</div>
                    <button className={styles.miniBtn} onClick={() => setLists((prev) => ({
                      ...prev,
                      drivers: prev.drivers.filter((x) => x.id !== d.id),
                    }))}>Удалить</button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Авто</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <input
                  className={styles.input}
                  placeholder="Гос. номер"
                  value={newVehicle.plate}
                  onChange={(e) => setNewVehicle({ ...newVehicle, plate: e.target.value })}
                />
                <input
                  className={styles.input}
                  placeholder="Вместимость"
                  value={newVehicle.capacity}
                  onChange={(e) => setNewVehicle({ ...newVehicle, capacity: e.target.value })}
                />
                <button
                  className={styles.button}
                  onClick={() => {
                    if (!newVehicle.plate) return;
                    setLists((prev) => ({
                      ...prev,
                      vehicles: [...prev.vehicles, { id: crypto.randomUUID(), plate: newVehicle.plate, capacity: newVehicle.capacity }],
                    }));
                    setNewVehicle({ plate: "", capacity: "" });
                  }}
                >
                  Добавить
                </button>
              </div>
              <div className={styles.listBox}>
                {lists.vehicles.map((v) => (
                  <div key={v.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                    <div>{v.plate} — {v.capacity || "без вместимости"}</div>
                    <button className={styles.miniBtn} onClick={() => setLists((prev) => ({
                      ...prev,
                      vehicles: prev.vehicles.filter((x) => x.id !== v.id),
                    }))}>Удалить</button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Маршруты</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <input
                  className={styles.input}
                  placeholder="Номер маршрута"
                  value={newRoute.number}
                  onChange={(e) => setNewRoute({ ...newRoute, number: e.target.value })}
                />
                <input
                  className={styles.input}
                  placeholder="Наименование маршрута"
                  value={newRoute.name}
                  onChange={(e) => setNewRoute({ ...newRoute, name: e.target.value })}
                />
                <input
                  className={styles.input}
                  placeholder="Время подачи"
                  value={newRoute.time}
                  onChange={(e) => setNewRoute({ ...newRoute, time: e.target.value })}
                />
                <button
                  className={styles.button}
                  onClick={() => {
                    if (!newRoute.name) return;
                    setLists((prev) => ({
                      ...prev,
                      routes: [...prev.routes, { id: crypto.randomUUID(), number: newRoute.number, name: newRoute.name, time: newRoute.time }],
                    }));
                    setNewRoute({ number: "", name: "", time: "" });
                  }}
                >
                  Добавить
                </button>
              </div>
              <div className={styles.listBox}>
                {lists.routes.map((r) => (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                    <div>{r.number} — {r.name} — {r.time}</div>
                    <button className={styles.miniBtn} onClick={() => setLists((prev) => ({
                      ...prev,
                      routes: prev.routes.filter((x) => x.id !== r.id),
                    }))}>Удалить</button>
                  </div>
                ))}
              </div>
            </div>

            <button className={styles.button} onClick={saveLists} disabled={saving}>
              Сохранить списки
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
