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
  const [selectedDriverId, setSelectedDriverId] = React.useState<string>("");

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

  const [payoutSortKey, setPayoutSortKey] = React.useState<"date" | "driver" | "amount">("date");
  const [payoutSortDir, setPayoutSortDir] = React.useState<"asc" | "desc">("desc");
  const [payoutFilterDriverId, setPayoutFilterDriverId] = React.useState("");
  const [payoutFilterType, setPayoutFilterType] = React.useState("");
  const [payoutFilterFrom, setPayoutFilterFrom] = React.useState("");
  const [payoutFilterTo, setPayoutFilterTo] = React.useState("");
  const [payoutAmountMin, setPayoutAmountMin] = React.useState("");
  const [payoutAmountMax, setPayoutAmountMax] = React.useState("");

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
    rates.forEach(r => names.add(r.routeName));
    return Array.from(names).sort();
  }, [shifts, rates]);

  const handleListChange = (listId: string) => {
    setSelectedListId(listId);
    setSelectedDriverId("");
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

  const handleDriverSelect = (driverId: string) => {
    setSelectedDriverId(driverId);
    setSelectedListId("");
    if (!driverId) {
      setSelectedDrivers([]);
      return;
    }
    const d = drivers.find((x) => x.id === driverId);
    const name = d?.fullName || d?.telegramUserId;
    setSelectedDrivers(name ? [name] : []);
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

  const routeSummary = React.useMemo(() => {
    const totals: Record<string, { count: number; rate: number }> = {};
    const rateMap: Record<string, number> = {};
    rates.forEach(r => rateMap[r.routeName] = parseFloat(r.rate));
    shifts.forEach((s) => {
      if (selectedDrivers.length > 0 && !selectedDrivers.includes(s.driverName)) return;
      totals[s.routeName] = totals[s.routeName] || { count: 0, rate: rateMap[s.routeName] || 0 };
      totals[s.routeName].count += 1;
    });
    return Object.entries(totals).sort((a, b) => b[1].count - a[1].count);
  }, [shifts, selectedDrivers, rates]);

  const vehicleSummary = React.useMemo(() => {
    const totals: Record<string, Record<string, number>> = {};
    shifts.forEach((s) => {
      if (!s.plateNumber) return;
      if (selectedDrivers.length > 0 && !selectedDrivers.includes(s.driverName)) return;
      totals[s.plateNumber] = totals[s.plateNumber] || {};
      totals[s.plateNumber][s.routeName] = (totals[s.plateNumber][s.routeName] || 0) + 1;
    });
    return Object.entries(totals);
  }, [shifts, selectedDrivers]);

  const filteredPayouts = React.useMemo(() => {
    return payouts.filter((p) => {
      if (payoutFilterDriverId && p.driverId !== payoutFilterDriverId) return false;
      if (payoutFilterType && (p.payoutType || "CASH") !== payoutFilterType) return false;
      if (payoutFilterFrom) {
        const ts = new Date(p.paymentDate).getTime();
        if (ts < new Date(payoutFilterFrom).getTime()) return false;
      }
      if (payoutFilterTo) {
        const ts = new Date(p.paymentDate).getTime();
        if (ts > new Date(payoutFilterTo + "T23:59:59").getTime()) return false;
      }
      const amount = parseFloat(p.amount as any);
      if (payoutAmountMin && amount < Number(payoutAmountMin)) return false;
      if (payoutAmountMax && amount > Number(payoutAmountMax)) return false;
      return true;
    });
  }, [payouts, payoutFilterDriverId, payoutFilterType, payoutFilterFrom, payoutFilterTo, payoutAmountMin, payoutAmountMax]);

  const sortedPayouts = React.useMemo(() => {
    const list = [...filteredPayouts];
    list.sort((a, b) => {
      if (payoutSortKey === "date") {
        const cmp = new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime();
        return payoutSortDir === "asc" ? cmp : -cmp;
      }
      if (payoutSortKey === "amount") {
        const cmp = parseFloat(a.amount as any) - parseFloat(b.amount as any);
        return payoutSortDir === "asc" ? cmp : -cmp;
      }
      const aName = a.driver?.fullName || a.driver?.telegramUserId || "";
      const bName = b.driver?.fullName || b.driver?.telegramUserId || "";
      const cmp = aName.localeCompare(bName);
      return payoutSortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filteredPayouts, payoutSortKey, payoutSortDir]);

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
      <h1 className={styles.pageTitle}>💰 Оплата</h1>

      <div className={styles.tabBar} style={{ overflowX: "auto", paddingBottom: 8 }}>
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
            className={`${styles.tabButton} ${activeTab === t.id ? styles.tabButtonActive : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filter Bar */}
      {(activeTab === "salary" || activeTab === "vehicle" || activeTab === "balance") && (
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
              <label className={styles.field}>
                Водитель
                <select
                  value={selectedDriverId}
                  onChange={(e) => handleDriverSelect(e.target.value)}
                  className={styles.select}
                >
                  <option value="">-- Все --</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>{d.fullName || d.telegramUserId}</option>
                  ))}
                </select>
              </label>
              <button className={styles.button} onClick={loadData} disabled={loading} style={{ height: 38 }}>
                Обновить
              </button>
            </div>
            
            {selectedDrivers.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: 8 }}>
                {selectedDrivers.map((name) => (
                  <span key={name} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 999, background: "var(--accent-light-bg)", color: "var(--sidebar-item-active-text)", border: "1px solid var(--card-border)" }}>
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className={styles.sidePanel}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--text)" }}>Сводка маршрутов</div>
            <div style={{ display: "grid", gap: 4 }}>
              {routeSummary.map(([route, meta]) => (
                <div key={route} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--table-border)" }}>
                  <span style={{ fontWeight: 500 }}>{route}</span>
                  <span style={{ color: "var(--accent-color)", fontWeight: 700 }}>{meta.count}</span>
                </div>
              ))}
              {routeSummary.length === 0 && <div className={styles.muted}>Нет данных</div>}
            </div>
          </div>
        </div>
      )}

      {/* Rates */}
      {activeTab === "rates" && (
        <div className={styles.card}>
          <h3 style={{ marginTop: 0 }}>Стоимость маршрутов</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <select value={newRouteName} onChange={(e) => setNewRouteName(e.target.value)} className={styles.select} style={{ flex: 1 }}>
              <option value="">Маршрут</option>
              {uniqueRouteNames.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input value={newRate} onChange={(e) => setNewRate(e.target.value)} placeholder="Ставка" className={styles.input} style={{ width: 120 }} />
            <button className={styles.button} onClick={saveRate}>{editRateId ? "Обновить" : "Добавить"}</button>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Маршрут</th>
                  <th className={styles.th}>Ставка</th>
                  <th className={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.id}>
                    <td className={styles.td}>{r.routeName}</td>
                    <td className={styles.td}>{r.rate}</td>
                    <td className={styles.td}>
                      <button className={styles.button} onClick={() => startEditRate(r)}>✏️</button>
                      <button className={styles.button} style={{ marginLeft: 6, color: "var(--danger-text)" }} onClick={() => deleteRate(r.id)}>🗑️</button>
                    </td>
                  </tr>
                ))}
                {rates.length === 0 && <tr><td className={styles.td} colSpan={3}>Нет данных</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Salary */}
      {activeTab === "salary" && (
        <div>
          <div className={styles.ratingGrid}>
            {salaryAnalytics.map((d) => {
              const rateMap: Record<string, number> = {};
              rates.forEach(r => rateMap[r.routeName] = parseFloat(r.rate));
              const routeRows = Object.entries(d.routes).map(([route, cnt]) => {
                const rate = rateMap[route] || 0;
                const sum = rate * cnt;
                return { route, cnt, rate, sum };
              });
              const total = routeRows.reduce((acc, r) => acc + r.sum, 0);
              return (
                <div key={d.driverName} className={styles.ratingCard}>
                  <div className={styles.ratingHeader}>
                    <div className={styles.ratingName}>{d.driverName}</div>
                  </div>
                  <div className={styles.ratingStats}>
                    <div className={`${styles.ratingStat} ${styles.ratingAccentBlue}`}>
                      <div className={styles.ratingLabel}>Смен</div>
                      <div className={styles.ratingValue}>{d.shifts}</div>
                    </div>
                    <div className={`${styles.ratingStat} ${styles.ratingAccentBlue}`}>
                      <div className={styles.ratingLabel}>Начислено</div>
                      <div className={styles.ratingValue}>{d.earned.toFixed(2)}</div>
                    </div>
                    <div className={`${styles.ratingStat} ${styles.ratingAccentBlue}`}>
                      <div className={styles.ratingLabel}>Выплачено</div>
                      <div className={styles.ratingValue}>{d.paid.toFixed(2)}</div>
                    </div>
                    <div className={`${styles.ratingStat} ${styles.ratingAccentGreen}`}>
                      <div className={styles.ratingLabel}>Итого</div>
                      <div className={styles.ratingValue}>{total.toFixed(2)}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <div className={styles.ratingLabel} style={{ marginBottom: 6 }}>Детализация по маршрутам</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {routeRows.map((r) => (
                        <div key={r.route} className={styles.itemCard}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                            <div className={styles.itemLabel}>{r.route}</div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--success-color)" }}>{r.sum.toFixed(2)} ₽</div>
                          </div>
                          <div className={styles.itemValue}>
                            {r.cnt} смен × {r.rate.toFixed(2)} ₽
                          </div>
                        </div>
                      ))}
                      {routeRows.length === 0 && (
                        <div className={styles.muted}>Нет данных</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {salaryAnalytics.length === 0 && <div className={styles.muted}>Нет данных</div>}
          </div>
        </div>
      )}

      {/* Vehicle */}
      {activeTab === "vehicle" && (
        <div className={styles.ratingGrid}>
          {vehicleSummary.map(([plate, routes]) => (
            <div key={plate} className={styles.ratingCard}>
              <div className={styles.ratingHeader}>
                <div className={styles.ratingName}>{plate}</div>
              </div>
              <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
                <div className={styles.ratingLabel} style={{ marginBottom: 4 }}>Маршруты</div>
                {Object.entries(routes).map(([route, count]) => (
                  <div key={route} className={styles.itemCard}>
                    <div className={styles.itemLabel}>{route}</div>
                    <div className={styles.itemValue}>Смен: {count}</div>
                  </div>
                ))}
                {Object.keys(routes).length === 0 && (
                  <div className={styles.muted}>Нет данных</div>
                )}
              </div>
            </div>
          ))}
          {vehicleSummary.length === 0 && <div className={styles.muted}>Нет данных</div>}
        </div>
      )}

      {/* Payouts */}
      {activeTab === "payouts" && (
        <div className={styles.card}>
          <h3 style={{ marginTop: 0 }}>История выплат</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 12 }}>
            <select value={payDriverId} onChange={(e) => setPayDriverId(e.target.value)} className={styles.select}>
              <option value="">Водитель</option>
              {drivers.map(d => (
                <option key={d.id} value={d.id}>{d.fullName || d.telegramUserId}</option>
              ))}
            </select>
            <input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="Сумма" className={styles.input} />
            <label className={styles.field}>
              Дата оплаты
              <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className={styles.input} />
            </label>
            <label className={styles.field}>
              Дата учета
              <input type="date" value={payAccountedDate} onChange={(e) => setPayAccountedDate(e.target.value)} className={styles.input} />
            </label>
            <select value={payType} onChange={(e) => setPayType(e.target.value)} className={styles.select}>
              <option value="CASH">Наличные</option>
              <option value="CARD">Карта</option>
              <option value="SBP">СБП</option>
            </select>
            <input value={payComment} onChange={(e) => setPayComment(e.target.value)} placeholder="Комментарий" className={styles.input} />
            <button className={styles.button} onClick={savePayout}>Добавить</button>
          </div>
          <div className={styles.filterCard} style={{ marginBottom: 12 }}>
            <div className={styles.filterRow}>
              <label className={styles.field}>
                Дата с
                <input type="date" value={payoutFilterFrom} onChange={(e) => setPayoutFilterFrom(e.target.value)} className={styles.input} />
              </label>
              <label className={styles.field}>
                Дата по
                <input type="date" value={payoutFilterTo} onChange={(e) => setPayoutFilterTo(e.target.value)} className={styles.input} />
              </label>
              <label className={styles.field}>
                Водитель
                <select value={payoutFilterDriverId} onChange={(e) => setPayoutFilterDriverId(e.target.value)} className={styles.select}>
                  <option value="">Все</option>
                  {drivers.map(d => (
                    <option key={d.id} value={d.id}>{d.fullName || d.telegramUserId}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Тип оплаты
                <select value={payoutFilterType} onChange={(e) => setPayoutFilterType(e.target.value)} className={styles.select}>
                  <option value="">Все</option>
                  <option value="CASH">Наличные</option>
                  <option value="CARD">Карта</option>
                  <option value="SBP">СБП</option>
                </select>
              </label>
              <label className={styles.field}>
                Сумма от
                <input type="number" value={payoutAmountMin} onChange={(e) => setPayoutAmountMin(e.target.value)} className={styles.input} />
              </label>
              <label className={styles.field}>
                Сумма до
                <input type="number" value={payoutAmountMax} onChange={(e) => setPayoutAmountMax(e.target.value)} className={styles.input} />
              </label>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th} style={{ cursor: "pointer" }} onClick={() => {
                    setPayoutSortKey("date");
                    setPayoutSortDir(prev => (payoutSortKey === "date" && prev === "desc") ? "asc" : "desc");
                  }}>Дата {payoutSortKey === "date" ? (payoutSortDir === "desc" ? "↓" : "↑") : ""}</th>
                  <th className={styles.th} style={{ cursor: "pointer" }} onClick={() => {
                    setPayoutSortKey("driver");
                    setPayoutSortDir(prev => (payoutSortKey === "driver" && prev === "desc") ? "asc" : "desc");
                  }}>Водитель {payoutSortKey === "driver" ? (payoutSortDir === "desc" ? "↓" : "↑") : ""}</th>
                  <th className={styles.th} style={{ cursor: "pointer" }} onClick={() => {
                    setPayoutSortKey("amount");
                    setPayoutSortDir(prev => (payoutSortKey === "amount" && prev === "desc") ? "asc" : "desc");
                  }}>Сумма {payoutSortKey === "amount" ? (payoutSortDir === "desc" ? "↓" : "↑") : ""}</th>
                  <th className={styles.th}>Тип</th>
                  <th className={styles.th}>Комментарий</th>
                  <th className={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {sortedPayouts.map((p) => (
                  <tr key={p.id}>
                    <td className={styles.td}>{toDateString(p.paymentDate)}</td>
                    <td className={styles.td}>{p.driver?.fullName || p.driver?.telegramUserId || "—"}</td>
                    <td className={styles.td}>{p.amount}</td>
                    <td className={styles.td}>{p.payoutType || "—"}</td>
                    <td className={styles.td}>{p.comment || "—"}</td>
                    <td className={styles.td}>
                      <button className={styles.button} style={{ color: "var(--danger-text)" }} onClick={() => deletePayout(p.id)}>🗑️</button>
                    </td>
                  </tr>
                ))}
                {sortedPayouts.length === 0 && <tr><td className={styles.td} colSpan={6}>Нет данных</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Balance */}
      {activeTab === "balance" && (
        <div className={styles.card}>
          <h3 style={{ marginTop: 0 }}>Общий баланс</h3>
          <div className={styles.ratingGrid}>
            {salaryAnalytics.map((d) => (
              <div key={d.driverName} className={styles.ratingCard}>
                <div className={styles.ratingHeader}>
                  <div className={styles.ratingName}>{d.driverName}</div>
                </div>
                <div className={styles.ratingStats}>
                  <div className={`${styles.ratingStat} ${styles.ratingAccentBlue}`}>
                    <div className={styles.ratingLabel}>Баланс</div>
                    <div className={styles.ratingValue}>{(d.earned - d.paid).toFixed(2)}</div>
                  </div>
                </div>
              </div>
            ))}
            {salaryAnalytics.length === 0 && <div className={styles.muted}>Нет данных</div>}
          </div>
        </div>
      )}
    </div>
  );
}
