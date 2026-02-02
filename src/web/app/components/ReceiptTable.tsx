"use client";

import React from "react";
import styles from "../page.module.css";
import { Driver, Vehicle, Receipt } from "../types";

const getApiBase = () => {
  if (typeof window !== "undefined") return "";
  return process.env.NEXT_PUBLIC_API_BASE || process.env.API_BASE_URL || "http://localhost:3000";
};

const API_BASE = getApiBase();

function formatDate(value?: string | null, status?: string) {
  if (!value) return "";
  if (status && status !== "DONE" && status !== "MANUAL") return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value ?? "";
  return d.toLocaleString("ru-RU");
}

function toCSV(rows: any[]) {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const header = cols.join(";");
  const body = rows
    .map((r) =>
      cols
        .map((c) => {
          const v = r[c];
          if (v === null || v === undefined) return "";
          const s = typeof v === "object" ? JSON.stringify(v) : String(v);
          return '"' + s.replace(/"/g, '""') + '"';
        })
        .join(";")
    )
    .join("\n");
  return header + "\n" + body;
}

export default function ReceiptTable({
  receipts: initialReceipts,
  drivers,
  vehicles,
}: {
  receipts: Receipt[];
  drivers: Driver[];
  vehicles: Vehicle[];
}) {
  const [receipts, setReceipts] = React.useState<Receipt[]>(initialReceipts);
  const [selected, setSelected] = React.useState<Receipt | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [recognizingId, setRecognizingId] = React.useState<string | null>(null);
  
  const [filters, setFilters] = React.useState<Record<string, any>>({
    status: [],
    driverId: [],
    vehicleId: [],
    fuelType: [],
    dataSource: [],
    dateFrom: "",
    dateTo: "",
    totalAmountMin: "",
    totalAmountMax: "",
    litersMin: "",
    litersMax: "",
    mileageMin: "",
    mileageMax: "",
    derivedLPer100Min: "",
    derivedLPer100Max: "",
  });

  const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" | null }>({
    key: "receiptAt",
    dir: "desc",
  });

  const [activeFilter, setActiveFilter] = React.useState<string | null>(null);

  React.useEffect(() => {
    setReceipts(initialReceipts);
  }, [initialReceipts]);

  const driverMap = React.useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);
  const vehicleMap = React.useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);

  const filtered = React.useMemo(() => {
    return receipts.filter((r) => {
      if (filters.status.length > 0 && !filters.status.includes(r.status)) return false;
      if (filters.driverId.length > 0 && !filters.driverId.includes(r.driverId)) return false;
      if (filters.vehicleId.length > 0 && !filters.vehicleId.includes(r.vehicleId)) return false;
      if (filters.fuelType.length > 0 && !filters.fuelType.includes(r.fuelType)) return false;
      if (filters.dataSource.length > 0 && !filters.dataSource.includes(r.dataSource)) return false;

    const ts = new Date(r.receiptAt).getTime();
      if (filters.dateFrom && ts < new Date(filters.dateFrom).getTime()) return false;
      if (filters.dateTo) {
        const to = new Date(filters.dateTo);
        to.setHours(23, 59, 59, 999);
        if (ts > to.getTime()) return false;
      }

      const sum = Number(r.totalAmount);
      if (filters.totalAmountMin !== "" && sum < Number(filters.totalAmountMin)) return false;
      if (filters.totalAmountMax !== "" && sum > Number(filters.totalAmountMax)) return false;

      const lit = r.liters ? Number(r.liters) : null;
      if (filters.litersMin !== "" || filters.litersMax !== "") {
        if (lit === null) return false;
        if (filters.litersMin !== "" && lit < Number(filters.litersMin)) return false;
        if (filters.litersMax !== "" && lit > Number(filters.litersMax)) return false;
      }

      const mil = r.mileage ? Number(r.mileage) : null;
      if (filters.mileageMin !== "" || filters.mileageMax !== "") {
        if (mil === null) return false;
        if (filters.mileageMin !== "" && mil < Number(filters.mileageMin)) return false;
        if (filters.mileageMax !== "" && mil > Number(filters.mileageMax)) return false;
      }

      const lp = r.derivedLPer100 !== null ? r.derivedLPer100 : null;
      if (filters.derivedLPer100Min !== "" || filters.derivedLPer100Max !== "") {
        if (lp === null) return false;
        if (filters.derivedLPer100Min !== "" && lp < Number(filters.derivedLPer100Min)) return false;
        if (filters.derivedLPer100Max !== "" && lp > Number(filters.derivedLPer100Max)) return false;
      }

    return true;
  });
  }, [receipts, filters]);

  const displayRows = React.useMemo(() => {
    if (!sort.key || !sort.dir) return filtered;
    return [...filtered].sort((a: any, b: any) => {
      let valA = a[sort.key];
      let valB = b[sort.key];
      
      if (["totalAmount", "liters", "mileage", "derivedLPer100"].includes(sort.key)) {
        valA = valA ? Number(valA) : 0;
        valB = valB ? Number(valB) : 0;
      } else if (sort.key === "receiptAt") {
        valA = new Date(valA).getTime();
        valB = new Date(valB).getTime();
      } else {
        valA = String(valA || "").toLowerCase();
        valB = String(valB || "").toLowerCase();
      }

      if (valA < valB) return sort.dir === "asc" ? -1 : 1;
      if (valA > valB) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filtered, sort]);

  const sortedData = displayRows;

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleAllSelected = () => {
    const visibleIds = sortedData.map((r) => r.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : visibleIds);
  };

  const deleteSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Удалить выбранные чеки (${selectedIds.length})?`)) return;
    const res = await fetch("/api/receipts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ids: selectedIds }),
    });
    if (res.ok) {
      setReceipts((prev) => prev.filter((r) => !selectedIds.includes(r.id)));
      setSelectedIds([]);
      if (selected && selectedIds.includes(selected.id)) setSelected(null);
    }
  };

  const recognizeReceipt = async (id: string) => {
    setRecognizingId(id);
    try {
      const res = await fetch(`/api/receipts/${id}/recognize`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data?.error || "Не удалось отправить на распознавание");
        return;
      }
      setReceipts((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, status: "PENDING", receiptAt: null } : r
        )
      );
    } catch (err) {
      console.error(err);
      alert("Ошибка при отправке на распознавание");
    } finally {
      setRecognizingId(null);
    }
  };

  const columns = [
    { key: "status", title: "Статус" },
    { key: "receiptAt", title: "Дата" },
    { key: "driverId", title: "Водитель" },
    { key: "vehicleId", title: "Авто" },
    { key: "mileage", title: "Пробег" },
    { key: "totalAmount", title: "Сумма" },
    { key: "liters", title: "Литры" },
    { key: "fuelType", title: "Топливо" },
    { key: "derivedLPer100", title: "л/100" },
    { key: "dataSource", title: "Источник" },
  ];

  const handleSort = (key: string) => {
    setSort((prev) => ({
      key,
      dir: prev.key === key ? (prev.dir === "asc" ? "desc" : prev.dir === "desc" ? null : "asc") : "asc",
    }));
  };

  const toggleFilter = (key: string, val: any) => {
    setFilters((prev) => {
      const current = prev[key] as any[];
      const next = current.includes(val) ? current.filter((v) => v !== val) : [...current, val];
      return { ...prev, [key]: next };
    });
  };

  const renderFilterDropdown = (colKey: string) => {
    if (activeFilter !== colKey) return null;
    const close = () => setActiveFilter(null);

    return (
      <div className={styles.filterDropdown} onClick={(e) => e.stopPropagation()}>
        {colKey === "status" && (
          <div className={styles.filterList}>
            {["PENDING", "DONE", "FAILED", "MANUAL"].map((s) => (
              <label key={s} className={styles.filterItem}>
                <input type="checkbox" checked={filters.status.includes(s)} onChange={() => toggleFilter("status", s)} />
                {s === "PENDING" ? "В обработке" : s === "DONE" ? "Готов" : s === "FAILED" ? "Ошибка" : "Ручной"}
              </label>
            ))}
          </div>
        )}
        {colKey === "driverId" && (
          <div className={styles.filterList}>
            {drivers.map((d) => (
              <label key={d.id} className={styles.filterItem}>
                <input type="checkbox" checked={filters.driverId.includes(d.id)} onChange={() => toggleFilter("driverId", d.id)} />
                {d.fullName || d.telegramUserId}
              </label>
            ))}
          </div>
        )}
        {colKey === "vehicleId" && (
          <div className={styles.filterList}>
            {vehicles.map((v) => (
              <label key={v.id} className={styles.filterItem}>
                <input type="checkbox" checked={filters.vehicleId.includes(v.id)} onChange={() => toggleFilter("vehicleId", v.id)} />
                {v.plateNumber}
              </label>
            ))}
          </div>
        )}
        {colKey === "fuelType" && (
          <div className={styles.filterList}>
            {["AI92", "AI95", "DIESEL", "GAS", "OTHER"].map((f) => (
              <label key={f} className={styles.filterItem}>
                <input type="checkbox" checked={filters.fuelType.includes(f)} onChange={() => toggleFilter("fuelType", f)} />
                {f}
              </label>
            ))}
          </div>
        )}
        {colKey === "dataSource" && (
          <div className={styles.filterList}>
            {["TELEGRAM", "QR", "MANUAL"].map((s) => (
              <label key={s} className={styles.filterItem}>
                <input type="checkbox" checked={filters.dataSource.includes(s)} onChange={() => toggleFilter("dataSource", s)} />
                {s}
              </label>
            ))}
          </div>
        )}
        {colKey === "receiptAt" && (
          <div className={styles.filterRange}>
            <label style={{fontSize: 12}}>От</label>
            <input type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} />
            <label style={{fontSize: 12}}>До</label>
            <input type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} />
          </div>
        )}
        {["totalAmount", "liters", "mileage", "derivedLPer100"].includes(colKey) && (
          <div className={styles.filterRange}>
            <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
              <button className={styles.miniBtn} onClick={() => setSort({ key: colKey, dir: "asc" })}>Меньшее ↑</button>
              <button className={styles.miniBtn} onClick={() => setSort({ key: colKey, dir: "desc" })}>Большее ↓</button>
            </div>
            <input type="number" placeholder="От" value={filters[colKey + "Min"] || ""} onChange={(e) => setFilters({ ...filters, [colKey + "Min"]: e.target.value })} />
            <input type="number" placeholder="До" value={filters[colKey + "Max"] || ""} onChange={(e) => setFilters({ ...filters, [colKey + "Max"]: e.target.value })} />
          </div>
        )}
        <button className={styles.filterClose} onClick={close}>Применить</button>
      </div>
    );
  };

  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Чеки ({sortedData.length})</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={deleteSelected}
            className={styles.button}
            disabled={selectedIds.length === 0}
            style={{
              background: selectedIds.length ? "var(--danger-bg)" : undefined,
              color: selectedIds.length ? "var(--danger-text)" : undefined,
            }}
          >
            Удалить выбранные ({selectedIds.length})
        </button>
          <button onClick={() => setFilters({
            status: [], driverId: [], vehicleId: [], fuelType: [], dataSource: [],
            dateFrom: "", dateTo: "", totalAmountMin: "", totalAmountMax: "", litersMin: "", litersMax: "",
            mileageMin: "", mileageMax: "", derivedLPer100Min: "", derivedLPer100Max: "",
          })} className={styles.button}>Сбросить фильтры</button>
          <button onClick={() => {
            const rows = sortedData.map(r => ({
              status: r.status,
              date: formatDate(r.receiptAt, r.status),
              driver: driverMap.get(r.driverId)?.fullName || "—",
              vehicle: vehicleMap.get(r.vehicleId)?.plateNumber || "—",
              mileage: r.mileage || "—",
              amount: r.totalAmount,
              liters: r.liters || "—",
              fuel: r.fuelType || "—",
              lp100: r.derivedLPer100?.toFixed(1) || "—",
              source: r.dataSource || "—",
            }));
            const csv = toCSV(rows);
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = "receipts.csv"; a.click();
          }} className={styles.button}>Экспорт CSV</button>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th} style={{ width: 36 }}>
                <input
                  type="checkbox"
                  checked={sortedData.length > 0 && sortedData.every((r) => selectedIds.includes(r.id))}
                  onChange={toggleAllSelected}
                />
              </th>
              {columns.map((c) => (
                <th key={c.key} className={styles.th} style={{ position: "relative" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span onClick={() => handleSort(c.key)} style={{ cursor: "pointer" }}>
                  {c.title}
                      {sort.key === c.key && (sort.dir === "asc" ? " ↑" : sort.dir === "desc" ? " ↓" : "")}
                    </span>
                    <span 
                      className={styles.filterToggle} 
                      onClick={(e) => { e.stopPropagation(); setActiveFilter(activeFilter === c.key ? null : c.key); }}
                    >
                      ▼
                    </span>
                  </div>
                  {renderFilterDropdown(c.key)}
                </th>
              ))}
              <th className={styles.th}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {sortedData.map((r) => {
              const d = driverMap.get(r.driverId);
              const v = vehicleMap.get(r.vehicleId);
              return (
                <tr key={r.id} onClick={() => setSelected(r)} style={{ cursor: "pointer" }}>
                  <td className={styles.td} onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggleSelected(r.id)} />
                </td>
                  <td className={styles.td}>
                    <span className={`${styles.pill} ${r.status === "DONE" || r.status === "MANUAL" ? styles.statusDone : r.status === "PENDING" ? styles.statusPending : styles.statusFailed}`}>
                      {r.status === "PENDING" ? "В обработке" : r.status === "DONE" ? "Готов" : r.status === "FAILED" ? "Ошибка" : "Ручной"}
                    </span>
                  </td>
                  <td className={styles.td}>{formatDate(r.receiptAt, r.status)}</td>
                  <td className={styles.td}>{d?.fullName || d?.telegramUserId || "—"}</td>
                  <td className={styles.td}>{v?.plateNumber || "—"}</td>
                  <td className={styles.td}>{r.mileage || "—"}</td>
                  <td className={styles.td}>{r.totalAmount}</td>
                  <td className={styles.td}>{r.liters || "—"}</td>
                  <td className={styles.td}>{r.fuelType || "—"}</td>
                  <td className={styles.td}>{r.derivedLPer100?.toFixed(1) || "—"}</td>
                  <td className={styles.td}>{r.dataSource || "—"}</td>
                  <td className={styles.td} onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
                    <button
                      className={styles.button}
                      onClick={() => recognizeReceipt(r.id)}
                      disabled={recognizingId === r.id}
                    >
                      {recognizingId === r.id ? "Отправка..." : "Отправить на распознание"}
                    </button>
                  </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <DetailModal
          receipt={selected}
          drivers={drivers}
          vehicles={vehicles}
          onClose={() => setSelected(null)}
          onUpdate={(updated) => {
            setReceipts((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
            setSelected(updated);
          }}
          onDelete={(id) => {
            setReceipts((prev) => prev.filter((r) => r.id !== id));
            setSelected(null);
          }}
          apiBase={API_BASE}
        />
      )}
    </section>
  );
}

function DetailModal({
  receipt,
  drivers,
  vehicles,
  onClose,
  onUpdate,
  onDelete,
  apiBase,
}: {
  receipt: Receipt;
  drivers: Driver[];
  vehicles: Vehicle[];
  onClose: () => void;
  onUpdate: (updated: Receipt) => void;
  onDelete: (id: string) => void;
  apiBase: string;
}) {
  const [status, setStatus] = React.useState(receipt.status);
  const [paymentMethod, setPaymentMethod] = React.useState(receipt.paymentMethod ?? "");
  const [mileage, setMileage] = React.useState<string | number>(receipt.mileage ?? "");
  const [total, setTotal] = React.useState<string | number>(receipt.totalAmount ?? "");
  const [paidByDriver, setPaidByDriver] = React.useState<boolean>(!!receipt.paidByDriver || receipt.paymentMethod === "SELF");
  const [reimbursed, setReimbursed] = React.useState<boolean>(!!receipt.reimbursed);
  const [paymentComment, setPaymentComment] = React.useState<string>(receipt.paymentComment ?? "");
  
  const [liters, setLiters] = React.useState<string | number>(receipt.liters ?? "");
  const [fuelType, setFuelType] = React.useState(receipt.fuelType ?? "");
  const [pricePerLiter, setPricePerLiter] = React.useState<string | number>(receipt.pricePerLiter ?? "");
  const [stationName, setStationName] = React.useState(receipt.stationName ?? "");
  const [dataSource, setDataSource] = React.useState(receipt.dataSource ?? "");
  const [addressShort, setAddressShort] = React.useState(receipt.addressShort ?? "");
  const [receiptAt, setReceiptAt] = React.useState(receipt.receiptAt ? new Date(receipt.receiptAt).toISOString().slice(0, 16) : "");
  const [driverId, setDriverId] = React.useState(receipt.driverId);
  const [vehicleId, setVehicleId] = React.useState(receipt.vehicleId);

  const [message, setMessage] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [viewing, setViewing] = React.useState<string | null>(null);
  const [viewUrl, setViewUrl] = React.useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        status,
        paymentMethod: paymentMethod || null,
        mileage: mileage === "" ? null : Number(mileage),
        totalAmount: total === "" ? null : String(total),
        paidByDriver,
        reimbursed,
        paymentComment,
        liters: liters === "" ? null : String(liters),
        fuelType: fuelType || null,
        pricePerLiter: pricePerLiter === "" ? null : String(pricePerLiter),
        stationName: stationName || null,
        addressShort: addressShort || null,
        dataSource: dataSource || null,
        receiptAt: receiptAt ? new Date(receiptAt).toISOString() : null,
        driverId,
        vehicleId,
      };
      const res = await fetch(`/api/receipts/${receipt.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage("Ошибка: " + (data?.details || data?.error || res.status));
      } else {
        onUpdate(data);
        setMessage("Сохранено");
        setTimeout(() => setMessage(null), 2000);
      }
    } catch (err: any) {
      setMessage("Ошибка: " + (err?.message ?? err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Удалить этот чек навсегда?")) return;
    setDeleting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}`, { method: "DELETE", credentials: "include" });
      if (res.ok || res.status === 204) { onDelete(receipt.id); onClose(); }
      else { const data = await res.json().catch(() => ({})); setMessage("Ошибка удаления: " + (data?.error || res.status)); }
    } catch (err: any) { setMessage("Ошибка: " + (err?.message ?? err)); } finally { setDeleting(false); }
  };

  return (
    <div className={styles.detailOverlay} onClick={onClose}>
      <div className={styles.detailCard} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 800, width: "95%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Редактирование чека</h3>
          <button className={styles.button} onClick={onClose}>Закрыть</button>
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <button className={styles.button} onClick={async () => {
              setViewing("image");
            const res = await fetch(`/api/receipts/${receipt.id}/file?type=image`, { credentials: "include" });
            if (res.ok) { const blob = await res.blob(); setViewUrl(URL.createObjectURL(blob)); }
            else setViewing(null);
          }}>📷 Фото чека</button>
          <button className={styles.button} onClick={async () => {
              setViewing("pdf");
            const res = await fetch(`/api/receipts/${receipt.id}/file?type=pdf`, { credentials: "include" });
            if (res.ok) { const blob = await res.blob(); setViewUrl(URL.createObjectURL(blob)); }
            else setViewing(null);
          }}>📄 PDF чек</button>
        </div>

        {viewUrl && (
          <div className={styles.viewerOverlay} onClick={() => { URL.revokeObjectURL(viewUrl); setViewUrl(null); setViewing(null); }}>
            <div className={styles.viewerContent} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>{viewing === "image" ? "Фото" : "PDF"}</h3>
                <button className={styles.button} onClick={() => { URL.revokeObjectURL(viewUrl); setViewUrl(null); setViewing(null); }}>Закрыть</button>
              </div>
              {viewing === "image" ? <img src={viewUrl} style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }} /> : <iframe src={viewUrl} style={{ width: "100%", height: "80vh" }} />}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
              Водитель
              <select value={driverId} onChange={(e) => setDriverId(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }}>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.fullName || d.telegramUserId}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
              Автомобиль
              <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }}>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.plateNumber}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
              Дата и время
              <input type="datetime-local" value={receiptAt} onChange={(e) => setReceiptAt(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
              Статус
              <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }}>
                <option value="PENDING">В обработке</option>
                <option value="DONE">Готов</option>
                <option value="FAILED">Ошибка</option>
                <option value="MANUAL">Ручной</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
              Способ оплаты
              <select value={paymentMethod || ""} onChange={(e) => setPaymentMethod(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }}>
              <option value="">—</option>
              <option value="CARD">Карта</option>
              <option value="CASH">Наличные</option>
              <option value="QR">QR</option>
                <option value="SELF">Сам</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
              Источник
              <select value={dataSource || ""} onChange={(e) => setDataSource(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }}>
                <option value="">—</option>
                <option value="QR">QR</option>
                <option value="MANUAL">Ручной</option>
                <option value="TELEGRAM">Telegram</option>
              </select>
            </label>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
              Сумма (₽)
              <input value={total} onChange={(e) => setTotal(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
              Литры (л)
              <input value={liters} onChange={(e) => setLiters(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
              Топливо
              <select value={fuelType || ""} onChange={(e) => setFuelType(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }}>
                <option value="">—</option>
                <option value="AI92">АИ-92</option>
                <option value="AI95">АИ-95</option>
                <option value="DIESEL">ДТ</option>
                <option value="GAS">ГАЗ</option>
                <option value="OTHER">Прочее</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
            Цена за литр
            <input value={pricePerLiter} onChange={(e) => setPricePerLiter(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
            АЗС
            <input value={stationName} onChange={(e) => setStationName(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
            Адрес
            <input value={addressShort} onChange={(e) => setAddressShort(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
            Пробег
            <input value={mileage} onChange={(e) => setMileage(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }} />
          </label>
        </div>
        </div>

        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={paidByDriver} onChange={(e) => setPaidByDriver(e.target.checked)} />
            Оплатил сам
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={reimbursed} onChange={(e) => setReimbursed(e.target.checked)} />
            Компенсация выплачена
          </label>
          <label style={{ gridColumn: "1 / span 2", display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
            Комментарий
            <input value={paymentComment} onChange={(e) => setPaymentComment(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }} />
          </label>
        </div>

        <div style={{ marginTop: 24, display: "flex", gap: 12, borderTop: "1px solid var(--table-border)", paddingTop: 16 }}>
          <button className={styles.button} onClick={save} disabled={saving} style={{ background: "var(--primary-bg)", color: "var(--primary-text)" }}>
            {saving ? "Сохранение..." : "💾 Сохранить"}
          </button>
          <button className={styles.button} style={{ background: "var(--danger-bg)", color: "var(--danger-text)" }} onClick={handleDelete} disabled={deleting}>Удалить</button>
          {message && <span style={{ color: message.includes("Ошибка") ? "var(--error-color)" : "var(--success-color)" }}>{message}</span>}
        </div>
      </div>
    </div>
  );
}
