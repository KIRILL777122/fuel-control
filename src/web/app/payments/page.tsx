"use client";

import React from "react";
import styles from "../page.module.css";
import { Driver, Shift, RouteRate, DriverPayment, DriverPaymentDetail, CustomList } from "../types";

const API_BASE = "";

function toDateString(date: Date | string) {
  return new Date(date).toISOString().split('T')[0];
}

async function getJson(url: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return { ok: false, error: res.statusText };
  return { ok: true, data: await res.json() };
}

export default function PaymentsPage() {
  const [activeTab, setActiveTab] = React.useState<"rates" | "salary" | "vehicle" | "payouts" | "balance">("salary");
  const [loading, setLoading] = React.useState(true);
  
  // Data
  const [drivers, setDrivers] = React.useState<Driver[]>([]);
  const [shifts, setShifts] = React.useState<Shift[]>([]);
  const [rates, setRates] = React.useState<RouteRate[]>([]);
  const [payouts, setPayouts] = React.useState<DriverPayment[]>([]);
  const [driverLists, setDriverLists] = React.useState<CustomList[]>([]);

  // Filters
  const [dateFrom, setDateFrom] = React.useState<string>(() => {
    const d = new Date();
    d.setDate(1); // Start of month
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = React.useState<string>(() => new Date().toISOString().split('T')[0]);
  const [selectedDrivers, setSelectedDrivers] = React.useState<string[]>([]);
  const [selectedListId, setSelectedListId] = React.useState<string>("");

  // Rate Form
  const [newRouteName, setNewRouteName] = React.useState("");
  const [newRate, setNewRate] = React.useState("");
  const [editRateId, setEditRateId] = React.useState<string | null>(null);

  // Payout Form
  const [payDriverId, setPayDriverId] = React.useState("");
  const [payAmount, setPayAmount] = React.useState("");
  const [payDate, setPayDate] = React.useState(() => new Date().toISOString().split('T')[0]);
  const [payAccountedDate, setPayAccountedDate] = React.useState(() => new Date().toISOString().split('T')[0]);
  const [payType, setPayType] = React.useState("CASH");
  const [payComment, setPayComment] = React.useState("");

  const loadData = React.useCallback(async () => {
    setLoading(true);
    try {
      const [dr, sh, rt, py, ls] = await Promise.all([
        getJson("/api/drivers"),
        getJson(`/api/shifts?dateFrom=${dateFrom}&dateTo=${dateTo}&limit=2000`),
        getJson("/api/route-rates"),
        getJson("/api/driver-payments"),
        getJson("/api/lists?type=DRIVER")
      ]);
      
      if (dr.ok) setDrivers(dr.data);
      if (sh.ok) setShifts(sh.data.items || []);
      if (rt.ok) setRates(rt.data);
      if (py.ok) setPayouts(py.data);
      if (ls.ok) setDriverLists(ls.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const uniqueRouteNames = React.useMemo(() => {
    const names = new Set(shifts.map(s => s.routeName));
    // Also include names from existing rates that might not be in shifts for current period
    rates.forEach(r => names.add(r.routeName));
    return Array.from(names).sort();
  }, [shifts, rates]);

  const handleListChange = (listId: string) => {
    setSelectedListId(listId);
    if (!listId) {
      setSelectedDrivers([]);
      return;
    }
    const list = driverLists.find(l => l.id === listId);
    if (list) {
      const ids = list.items.map(i => i.driverId);
      const names = drivers
        .filter(d => ids.includes(d.id))
        .map(d => d.fullName || d.telegramUserId);
      setSelectedDrivers(names);
    }
  };

  const salaryAnalytics = React.useMemo(() => {
    const rateMap: Record<string, number> = {};
    rates.forEach(r => rateMap[r.routeName] = parseFloat(r.rate));

    const stats: Record<string, { driverName: string; shifts: number; earned: number; paid: number; routes: Record<string, number> }> = {};
    
    shifts.forEach(s => {
      if (!stats[s.driverName]) {
        stats[s.driverName] = { driverName: s.driverName, shifts: 0, earned: 0, paid: 0, routes: {} };
      }
      const st = stats[s.driverName];
      st.shifts++;
      const r = rateMap[s.routeName] || 0;
      st.earned += r;
      st.routes[s.routeName] = (st.routes[s.routeName] || 0) + 1;
    });

    payouts.forEach(p => {
      const driver = drivers.find(d => d.id === p.driverId);
      if (!driver) return;
      const name = driver.fullName || driver.telegramUserId;
      
      const accDate = p.accountedDate ? toDateString(p.accountedDate) : toDateString(p.paymentDate);
      if (accDate >= dateFrom && accDate <= dateTo) {
        if (!stats[name]) {
          stats[name] = { driverName: name, shifts: 0, earned: 0, paid: 0, routes: {} };
        }
        stats[name].paid += parseFloat(p.amount);
      }
    });

    return Object.values(stats).filter(s => {
      if (selectedDrivers.length > 0 && !selectedDrivers.includes(s.driverName)) return false;
      return true;
    }).sort((a, b) => b.earned - a.earned);
  }, [shifts, rates, payouts, drivers, dateFrom, dateTo, selectedDrivers]);

  const saveRate = async () => {
    if (!newRouteName || !newRate) return;
    const res = await fetch("/api/route-rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ routeName: newRouteName, rate: newRate })
    });
    if (res.ok) {
      setNewRouteName("");
      setNewRate("");
      setEditRateId(null);
      loadData();
    }
  };

  const startEditRate = (r: RouteRate) => {
    setEditRateId(r.id);
    setNewRouteName(r.routeName);
    setNewRate(r.rate);
  };

  const deleteRate = async (id: string) => {
    if (!confirm("Удалить стоимость маршрута?")) return;
    await fetch(`/api/route-rates/${id}`, { method: "DELETE", credentials: "include" });
    loadData();
  };

  const savePayout = async () => {
    if (!payDriverId || !payAmount) return;
    const res = await fetch("/api/driver-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        driverId: payDriverId,
        amount: payAmount,
        paymentDate: payDate,
        accountedDate: payAccountedDate,
        payoutType: payType,
        comment: payComment
      })
    });
    if (res.ok) {
      setPayAmount("");
      setPayComment("");
      loadData();
    }
  };

  const deletePayout = async (id: string) => {
    if (!confirm("Удалить запись о выплате?")) return;
    await fetch(`/api/driver-payments/${id}`, { method: "DELETE", credentials: "include" });
    loadData();
  };

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ margin: "0 0 24px 0" }}>💰 Оплата</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, overflowX: "auto", paddingBottom: 8 }}>
        {[
          { id: "rates", label: "Стоимость маршрутов" },
          { id: "salary", label: "Расчет зарплаты" },
          { id: "vehicle", label: "Маршруты по машинам" },
          { id: "payouts", label: "История выплат" },
          { id: "balance", label: "Общий баланс" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as any)}
            className={styles.button}
            style={{ 
              background: activeTab === t.id ? "#eef2ff" : "#fff",
              borderColor: activeTab === t.id ? "#4338ca" : "#d7d7e0",
              whiteSpace: "nowrap"
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filter Bar */}
      {(activeTab === "salary" || activeTab === "vehicle" || activeTab === "balance") && (
        <div style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e9e9f2", marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
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

            <button className={styles.button} onClick={loadData} disabled={loading}>
              Обновить
            </button>
          </div>
          
          {selectedListId === "" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", maxHeight: 80, overflowY: "auto", padding: 8, border: "1px solid #eee", borderRadius: 8 }}>
              {drivers.filter(d => d.fullName || d.telegramUserId).map(d => {
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
          )}
        </div>
      )}

      {/* Salary Analytics Tab */}
      {activeTab === "salary" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: 16 }}>
          {salaryAnalytics.length === 0 ? (
            <div style={{ gridColumn: "1/-1", padding: 40, textAlign: "center", opacity: 0.5 }}>Нет данных за период</div>
          ) : (
            salaryAnalytics.map(s => (
              <div key={s.driverName} style={{ background: "#fff", padding: 20, borderRadius: 16, border: "1px solid #e9e9f2", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)" }}>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, borderBottom: "1px solid #f1f5f9", paddingBottom: 12 }}>{s.driverName}</div>
                
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ color: "#64748b" }}>Смен:</span>
                  <span style={{ fontWeight: 600 }}>{s.shifts}</span>
                </div>
                
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ color: "#64748b" }}>Заработано:</span>
                  <span style={{ fontWeight: 700, color: "#0f172a" }}>{s.earned.toLocaleString()} ₽</span>
                </div>
                
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                  <span style={{ color: "#64748b" }}>Выплачено:</span>
                  <span style={{ fontWeight: 700, color: "#ef4444" }}>-{s.paid.toLocaleString()} ₽</span>
                </div>
                
                <div style={{ background: "#f8fafc", padding: "12px 16px", borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#64748b" }}>Остаток:</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: s.earned - s.paid > 0 ? "#10b981" : "#0f172a" }}>
                    {(s.earned - s.paid).toLocaleString()} ₽
                  </span>
                </div>
              </div>
            ))
          )}
          
          <div style={{ gridColumn: "1/-1", background: "#1e293b", color: "#fff", padding: 24, borderRadius: 16, textAlign: "center", marginTop: 16 }}>
            <div style={{ fontSize: 14, opacity: 0.7, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Итого за период</div>
            <div style={{ fontSize: 32, fontWeight: 900 }}>
              {salaryAnalytics.reduce((sum, s) => sum + s.earned, 0).toLocaleString()} ₽
            </div>
          </div>
        </div>
      )}

      {/* Route Rates Tab */}
      {activeTab === "rates" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 24 }}>
          <div style={{ background: "#fff", padding: 20, borderRadius: 16, border: "1px solid #e9e9f2", height: "fit-content" }}>
            <h3 style={{ marginTop: 0, marginBottom: 16 }}>{editRateId ? "Редактировать" : "Добавить / Обновить"}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={{ fontSize: 12, opacity: 0.7 }}>Маршрут</label>
              <select 
                value={newRouteName} 
                onChange={e => setNewRouteName(e.target.value)} 
                style={{ padding: 10, borderRadius: 8, border: "1px solid #d7d7e0" }}
              >
                <option value="">-- Выберите из списка --</option>
                {uniqueRouteNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <input 
                value={newRouteName} 
                onChange={e => setNewRouteName(e.target.value)} 
                placeholder="Или введите вручную" 
                style={{ padding: 10, borderRadius: 8, border: "1px solid #d7d7e0" }} 
              />
              
              <label style={{ fontSize: 12, opacity: 0.7 }}>Стоимость (₽)</label>
              <input value={newRate} onChange={e => setNewRate(e.target.value)} placeholder="Стоимость (₽)" type="number" style={{ padding: 10, borderRadius: 8, border: "1px solid #d7d7e0" }} />
              
              <div style={{ display: "flex", gap: 8 }}>
                <button className={styles.button} onClick={saveRate} style={{ flex: 2, background: "#4338ca", color: "#fff", border: "none" }}>Сохранить</button>
                {editRateId && <button onClick={() => { setEditRateId(null); setNewRouteName(""); setNewRate(""); }} className={styles.button} style={{ flex: 1 }}>Отмена</button>}
              </div>
            </div>
          </div>
          
          <div className={styles.tableWrap} style={{ background: "#fff", borderRadius: 16, border: "1px solid #e9e9f2" }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Маршрут</th>
                  <th className={styles.th}>Стоимость</th>
                  <th className={styles.th}>Действие</th>
                </tr>
              </thead>
              <tbody>
                {rates.map(r => (
                  <tr key={r.id}>
                    <td className={styles.td}>{r.routeName}</td>
                    <td className={styles.td}>{parseFloat(r.rate).toLocaleString()} ₽</td>
                    <td className={styles.td}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => startEditRate(r)} className={styles.button} style={{ padding: "4px 8px", fontSize: 12 }}>✏️</button>
                        <button onClick={() => deleteRate(r.id)} style={{ color: "#ef4444", background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* History Payouts Tab */}
      {activeTab === "payouts" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 24 }}>
          <div style={{ background: "#fff", padding: 20, borderRadius: 16, border: "1px solid #e9e9f2", height: "fit-content" }}>
            <h3 style={{ marginTop: 0, marginBottom: 16 }}>Записать выплату</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <select value={payDriverId} onChange={e => setPayDriverId(e.target.value)} style={{ padding: 10, borderRadius: 8, border: "1px solid #d7d7e0" }}>
                <option value="">-- Выберите водителя --</option>
                {drivers.filter(d => d.fullName || d.telegramUserId).map(d => <option key={d.id} value={d.id}>{d.fullName || d.telegramUserId}</option>)}
              </select>
              <input value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder="Сумма (₽)" type="number" style={{ padding: 10, borderRadius: 8, border: "1px solid #d7d7e0" }} />
              <label style={{ fontSize: 12, opacity: 0.7 }}>Дата учета (в какой период попадет)</label>
              <input value={payAccountedDate} onChange={e => setPayAccountedDate(e.target.value)} type="date" style={{ padding: 10, borderRadius: 8, border: "1px solid #d7d7e0" }} />
              <select value={payType} onChange={e => setPayType(e.target.value)} style={{ padding: 10, borderRadius: 8, border: "1px solid #d7d7e0" }}>
                <option value="CASH">Наличные</option>
                <option value="SBP">СБП</option>
                <option value="CARD">На карту</option>
              </select>
              <input value={payComment} onChange={e => setPayComment(e.target.value)} placeholder="Комментарий" style={{ padding: 10, borderRadius: 8, border: "1px solid #d7d7e0" }} />
              <button className={styles.button} onClick={savePayout} style={{ background: "#10b981", color: "#fff", border: "none" }}>Записать</button>
            </div>
          </div>
          
          <div className={styles.tableWrap} style={{ background: "#fff", borderRadius: 16, border: "1px solid #e9e9f2" }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Дата учета</th>
                  <th className={styles.th}>Водитель</th>
                  <th className={styles.th}>Сумма</th>
                  <th className={styles.th}>Тип</th>
                  <th className={styles.th}>Действие</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map(p => (
                  <tr key={p.id}>
                    <td className={styles.td}>{toDateString(p.accountedDate || p.paymentDate)}</td>
                    <td className={styles.td}>{drivers.find(d => d.id === p.driverId)?.fullName || p.driverId}</td>
                    <td className={styles.td} style={{ color: "#ef4444", fontWeight: 600 }}>{parseFloat(p.amount).toLocaleString()} ₽</td>
                    <td className={styles.td}>{p.payoutType}</td>
                    <td className={styles.td}>
                      <button onClick={() => deletePayout(p.id)} style={{ color: "#ef4444", background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>🗑️</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Balance Tab */}
      {activeTab === "balance" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {salaryAnalytics.map(s => (
            <div key={s.driverName} style={{ background: "#fff", padding: 24, borderRadius: 20, border: "1px solid #e9e9f2", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }}>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 20, color: "#1e293b" }}>{s.driverName}</div>
              <div style={{ background: "#f8fafc", padding: 16, borderRadius: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 14, color: "#64748b" }}>Всего заработано:</span>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{s.earned.toLocaleString()} ₽</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 14, color: "#64748b" }}>Всего выплачено:</span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: "#ef4444" }}>{s.paid.toLocaleString()} ₽</span>
                </div>
                <div style={{ height: 1, background: "#e2e8f0", margin: "4px 0" }}></div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "#1e293b" }}>Текущий баланс:</span>
                  <span style={{ fontSize: 22, fontWeight: 900, color: s.earned - s.paid > 0 ? "#10b981" : "#ef4444" }}>
                    {(s.earned - s.paid).toLocaleString()} ₽
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
