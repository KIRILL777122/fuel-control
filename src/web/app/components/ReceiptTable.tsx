"use client";

import React from "react";
import styles from "../page.module.css";
import { Driver, Vehicle, Receipt } from "../types";

// Use relative URLs for API requests - will be proxied by Caddy/nginx or Next.js rewrites
// For client-side, we use relative URLs which work when proxied through the web server
const getApiBase = () => {
  // In browser, use relative URL (proxied by Caddy/nginx)
  if (typeof window !== "undefined") {
    return ""; // Relative URL - will use same domain
  }
  // On server, use full URL from env
  return (
    process.env.NEXT_PUBLIC_API_BASE ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.API_BASE_URL ||
    "http://localhost:3000"
  );
};

const API_BASE = getApiBase();

function formatDate(value?: string | null) {
  if (!value) return "";
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
          return `"${s.replace(/"/g, '""')}"`;
        })
        .join(";")
    )
    .join("\n");
  return `${header}\n${body}`;
}

export default function ReceiptTable({
  receipts,
  drivers,
  vehicles,
}: {
  receipts: Receipt[];
  drivers: Driver[];
  vehicles: Vehicle[];
}) {
  const [filterStatus, setFilterStatus] = React.useState<string>("ALL");
  const [filterPayment, setFilterPayment] = React.useState<string>("ALL");
  const [filterCompensated, setFilterCompensated] = React.useState<string>("ALL");
  const [filterPaidByDriver, setFilterPaidByDriver] = React.useState<string>("ALL");
  const [search, setSearch] = React.useState<string>("");
  const [dateFrom, setDateFrom] = React.useState<string>("");
  const [dateTo, setDateTo] = React.useState<string>("");
  const [driverSearch, setDriverSearch] = React.useState<string>("");
  const [vehicleSearch, setVehicleSearch] = React.useState<string>("");
  const [selected, setSelected] = React.useState<Receipt | null>(null);
  const [exportingCsv, setExportingCsv] = React.useState(false);
  const [exportingXlsx, setExportingXlsx] = React.useState(false);

  const driverMap = React.useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);
  const vehicleMap = React.useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);

  const filtered = receipts.filter((r) => {
    const ts = new Date(r.receiptAt).getTime();
    const fromTs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toTs = dateTo ? new Date(dateTo).getTime() : null;
    if (fromTs && ts < fromTs) return false;
    if (toTs && ts > toTs) return false;
    if (filterStatus !== "ALL" && r.status !== filterStatus) return false;
    if (filterPayment !== "ALL" && r.paymentMethod !== filterPayment) return false;
    if (filterPaidByDriver === "YES" && !r.paidByDriver) return false;
    if (filterPaidByDriver === "NO" && r.paidByDriver) return false;
    if (filterCompensated === "YES" && !r.reimbursed) return false;
    if (filterCompensated === "NO" && r.reimbursed) return false;
    if (search.trim()) {
      const d = driverMap.get(r.driverId);
      const v = vehicleMap.get(r.vehicleId);
      const haystack = [d?.fullName, d?.telegramUserId, v?.plateNumber, v?.name, r.status, r.paymentMethod, r.fuelType]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search.trim().toLowerCase())) return false;
    }
    if (driverSearch.trim()) {
      const d = driverMap.get(r.driverId);
      const driverHay = [d?.fullName, d?.telegramUserId].filter(Boolean).join(" ").toLowerCase();
      if (!driverHay.includes(driverSearch.trim().toLowerCase())) return false;
    }
    if (vehicleSearch.trim()) {
      const v = vehicleMap.get(r.vehicleId);
      const vehHay = [v?.plateNumber, v?.name].filter(Boolean).join(" ").toLowerCase();
      if (!vehHay.includes(vehicleSearch.trim().toLowerCase())) return false;
    }
    return true;
  });

  const columns = [
    { key: "status", title: "Статус" },
    { key: "receiptAt", title: "Дата" },
    { key: "driver", title: "Водитель" },
    { key: "vehicle", title: "Авто" },
    { key: "mileage", title: "Пробег" },
    { key: "totalAmount", title: "Сумма" },
    { key: "liters", title: "Литры" },
    { key: "fuelType", title: "Топливо" },
    { key: "lPer100", title: "л/100" },
    { key: "dataSource", title: "Источник" },
  ];

  const rows = filtered.slice(0, 200).map((r) => {
    const driver = driverMap.get(r.driverId) ?? r.driver;
    const vehicle = vehicleMap.get(r.vehicleId) ?? r.vehicle;
    return {
      __raw: r,
      status: r.status,
      receiptAt: formatDate(r.receiptAt),
      driver: driver?.fullName ?? driver?.telegramUserId ?? "—",
      vehicle: vehicle?.plateNumber ?? vehicle?.name ?? "—",
      mileage: r.mileage ?? "—",
      totalAmount: r.totalAmount,
      liters: r.liters ? String(r.liters) : "—",
      fuelType: r.fuelType ?? "—",
      lPer100: r.derivedLPer100 !== null && r.derivedLPer100 !== undefined ? r.derivedLPer100.toFixed(1) : "—",
      dataSource: r.dataSource ?? "—",
    };
  });

  const handleExport = () => {
    const csv = toCSV(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "receipts.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleServerExport = async () => {
    setExportingCsv(true);
    try {
      const res = await fetch(`/api/reports/export`, {
        credentials: "include",
      });
      if (res.status === 401) {
        alert("Сессия истекла, войдите снова.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "receipts_server.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Ошибка выгрузки: ${err}`);
    } finally {
      setExportingCsv(false);
    }
  };

  const handleServerExportXlsx = async () => {
    setExportingXlsx(true);
    try {
      const res = await fetch(`/api/reports/export.xlsx`, {
        credentials: "include",
      });
      if (res.status === 401) {
        alert("Сессия истекла, войдите снова.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "receipts.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Ошибка выгрузки XLSX: ${err}`);
    } finally {
      setExportingXlsx(false);
    }
  };

  return (
    <section style={{ marginTop: 24 }}>
      <div className={styles.filters}>
        <h2 style={{ margin: "0 8px 0 0" }}>Чеки</h2>
        <label>
          Статус:&nbsp;
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="ALL">Все</option>
            <option value="PENDING">PENDING</option>
            <option value="DONE">DONE</option>
            <option value="FAILED">Ошибка</option>
          </select>
        </label>
        <label>
          Оплатил сам:&nbsp;
          <select value={filterPaidByDriver} onChange={(e) => setFilterPaidByDriver(e.target.value)}>
            <option value="ALL">Все</option>
            <option value="YES">Да</option>
            <option value="NO">Нет</option>
          </select>
        </label>
        <label>
          Компенсация:&nbsp;
          <select value={filterCompensated} onChange={(e) => setFilterCompensated(e.target.value)}>
            <option value="ALL">Все</option>
            <option value="YES">Выплачена</option>
            <option value="NO">Не выплачена</option>
          </select>
        </label>
        <label>
          Оплата:&nbsp;
          <select value={filterPayment} onChange={(e) => setFilterPayment(e.target.value)}>
            <option value="ALL">Все</option>
            <option value="CARD">Карта</option>
            <option value="CASH">Наличные</option>
            <option value="QR">QR</option>
            <option value="SELF">Оплатил сам</option>
          </select>
        </label>
        <input
          type="text"
          placeholder="Поиск по водителю/авто/статусу"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={styles.search}
        />
        <input
          type="text"
          placeholder="Водитель (ФИО/ID)"
          value={driverSearch}
          onChange={(e) => setDriverSearch(e.target.value)}
          className={styles.search}
          style={{ maxWidth: 180 }}
        />
        <input
          type="text"
          placeholder="Авто (госномер/название)"
          value={vehicleSearch}
          onChange={(e) => setVehicleSearch(e.target.value)}
          className={styles.search}
          style={{ maxWidth: 180 }}
        />
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
          Дата с
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
          Дата по
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        <button onClick={handleExport} className={styles.button}>
          Экспорт CSV ({rows.length})
        </button>
        <button onClick={handleServerExport} className={styles.button} disabled={exportingCsv}>
          {exportingCsv ? "Выгружаю..." : "Серверный CSV"}
        </button>
        <button onClick={handleServerExportXlsx} className={styles.button} disabled={exportingXlsx}>
          {exportingXlsx ? "Выгружаю..." : "Серверный XLSX"}
        </button>
      </div>

      <div className={styles.tableWrap} style={{ marginTop: 12 }}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={styles.th}>
                  {c.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} style={{ padding: 12, textAlign: "center", opacity: 0.7 }}>
                  Нет данных
                </td>
              </tr>
            )}
            {rows.map((r, idx) => (
              <tr key={idx} onClick={() => setSelected(r.__raw)} style={{ cursor: "pointer" }}>
                {columns.map((c) => (
                  <td key={c.key} className={styles.td}>
                    {renderCell(c.key, r, async (newVal?: boolean) => {
                      if (newVal === undefined) return;
                      try {
                        const res = await fetch(
                          `/api/receipts/${r.__raw.id}`,
                          {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ reimbursed: newVal }),
                          }
                        );
                        if (res.status === 401) {
                          alert("Сессия истекла, войдите снова.");
                          return;
                        }
                        if (!res.ok) {
                          const data = await res.json().catch(() => ({}));
                          alert(`Ошибка сохранения: ${data?.error || res.status}`);
                        } else {
                          r.__raw.reimbursed = newVal;
                          setSelected((prev) => (prev?.id === r.__raw.id ? { ...prev, reimbursed: newVal } : prev));
                        }
                      } catch (err: any) {
                        alert(`Ошибка: ${err?.message ?? err}`);
                      }
                    })}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <DetailModal
          receipt={selected}
          driver={driverMap.get(selected.driverId) ?? selected.driver ?? null}
          vehicle={vehicleMap.get(selected.vehicleId) ?? selected.vehicle ?? null}
          onClose={() => setSelected(null)}
          apiBase={API_BASE}
        />
      )}
    </section>
  );
}

function renderCell(key: string, row: any, onToggleReimbursed?: (val: boolean) => void) {
  const v = row[key];
  if (key === "status") {
    const className = v === "DONE" ? styles.statusDone : v === "PENDING" ? styles.statusPending : styles.statusFailed;
    return <span className={`${styles.pill} ${className}`}>{v}</span>;
  }
  if (key === "reimbursed") {
    return (
      <label style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={row.__raw.reimbursed ?? false} onChange={(e) => onToggleReimbursed?.(e.target.checked)} />
        {row.__raw.reimbursed ? <span className={styles.badge}>Да</span> : "Нет"}
      </label>
    );
  }
  if (key === "deltaKm" || key === "lPer100") {
    return v === "—" || v === null || v === undefined ? "—" : v;
  }
  if (key === "paymentMethod" || key === "dataSource") {
    return <span className={styles.badge}>{v}</span>;
  }
  if (key === "paidByDriver") {
    return v === "Да" ? <span className={styles.badge}>{v}</span> : v;
  }
  return v ?? "—";
}

function DetailModal({
  receipt,
  driver,
  vehicle,
  onClose,
  apiBase,
}: {
  receipt: Receipt;
  driver: Driver | null;
  vehicle: Vehicle | null;
  onClose: () => void;
  apiBase: string;
}) {
  const [status, setStatus] = React.useState(receipt.status);
  const [paymentMethod, setPaymentMethod] = React.useState(receipt.paymentMethod ?? "");
  const [mileage, setMileage] = React.useState<string | number>(receipt.mileage ?? "");
  const [total, setTotal] = React.useState<string | number>(receipt.totalAmount ?? "");
  const [paidByDriver, setPaidByDriver] = React.useState<boolean>(!!receipt.paidByDriver || receipt.paymentMethod === "SELF");
  const [reimbursed, setReimbursed] = React.useState<boolean>(!!receipt.reimbursed);
  const [paymentComment, setPaymentComment] = React.useState<string>(receipt.paymentComment ?? "");
  const [message, setMessage] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [viewing, setViewing] = React.useState<string | null>(null);
  const [viewUrl, setViewUrl] = React.useState<string | null>(null);

  // Left column: driver info and metadata
  const leftInfo = [
    { label: "Водитель", value: driver?.fullName ?? driver?.telegramUserId ?? "—" },
    { label: "Авто", value: vehicle?.plateNumber ?? vehicle?.name ?? "—" },
    { label: "Дата", value: formatDate(receipt.receiptAt) },
    { label: "Источник", value: receipt.dataSource ?? "—" },
    { label: "Статус", value: status },
    { label: "Компенсировано", value: reimbursed ? "Да" : "Нет" },
  ];

  // Right column: receipt details
  const rightInfo = [
    { label: "Сумма чека", value: total || "—" },
    { label: "Литры", value: receipt.liters ? String(receipt.liters) : "—" },
    { label: "Вид топлива", value: receipt.fuelType ?? "—" },
    { label: "Стоимость литра", value: receipt.pricePerLiter ? String(receipt.pricePerLiter) : "—" },
    { label: "Адрес заправки", value: receipt.addressShort ?? "—" },
  ];

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          status,
          paymentMethod: paymentMethod || null,
          mileage: mileage === "" ? null : Number(mileage),
          totalAmount: total === "" ? null : Number(total),
          paidByDriver,
          reimbursed,
          paymentComment,
        }),
      });
      if (res.status === 401) {
        setMessage("Сессия истекла, войдите снова.");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setMessage(`Ошибка: ${data?.error || res.status}`);
      } else {
        setMessage("Сохранено. Обновите страницу, чтобы увидеть изменения в списке.");
      }
    } catch (err: any) {
      setMessage(`Ошибка: ${err?.message ?? err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.detailOverlay} onClick={onClose}>
      <div className={styles.detailCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Чек</h3>
          <button className={styles.button} onClick={onClose}>
            Закрыть
          </button>
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
          <button
            className={styles.button}
            onClick={async () => {
              setViewing("image");
              try {
                const res = await fetch(`/api/receipts/${receipt.id}/file?type=image`, {
                  credentials: "include",
                });
                if (res.status === 401) {
                  setMessage("Сессия истекла, войдите снова.");
                  setViewing(null);
                  return;
                }
                if (!res.ok) {
                  const t = await res.text().catch(() => "");
                  throw new Error(`HTTP ${res.status} ${t}`);
                }
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                setViewUrl(url);
              } catch (err: any) {
                setMessage(`Ошибка загрузки: ${err?.message ?? err}`);
                setViewing(null);
              }
            }}
            disabled={viewing === "image"}
          >
            {viewing === "image" ? "Загружаю..." : "Посмотреть фото"}
          </button>
          <button
            className={styles.button}
            onClick={async () => {
              setViewing("pdf");
              try {
                const res = await fetch(`/api/receipts/${receipt.id}/file?type=pdf`, {
                  credentials: "include",
                });
                if (res.status === 401) {
                  setMessage("Сессия истекла, войдите снова.");
                  setViewing(null);
                  return;
                }
                if (!res.ok) {
                  const t = await res.text().catch(() => "");
                  throw new Error(`HTTP ${res.status} ${t}`);
                }
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                setViewUrl(url);
              } catch (err: any) {
                setMessage(`Ошибка загрузки: ${err?.message ?? err}`);
                setViewing(null);
              }
            }}
            disabled={viewing === "pdf"}
          >
            {viewing === "pdf" ? "Загружаю..." : "Посмотреть PDF"}
          </button>
        </div>
        {viewUrl && (
          <div className={styles.viewerOverlay} onClick={() => {
            URL.revokeObjectURL(viewUrl);
            setViewUrl(null);
            setViewing(null);
          }}>
            <div className={styles.viewerContent} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>
                  {viewing === "image" ? "Фото чека" : "PDF чек"}
                </h3>
                <button
                  className={styles.button}
                  onClick={() => {
                    URL.revokeObjectURL(viewUrl);
                    setViewUrl(null);
                    setViewing(null);
                  }}
                >
                  Закрыть
                </button>
              </div>
              {viewing === "image" ? (
                <img
                  src={viewUrl}
                  alt="Чек"
                  style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }}
                />
              ) : (
                <iframe
                  src={viewUrl}
                  style={{ width: "100%", height: "80vh", border: "none" }}
                  title="PDF чек"
                />
              )}
            </div>
          </div>
        )}
        <div className={styles.detailGrid}>
          <div>
            {leftInfo.map((i) => (
              <div className={styles.detailRow} key={i.label}>
                <span className={styles.detailLabel}>{i.label}</span>
                <span className={styles.detailValue}>{i.value}</span>
              </div>
            ))}
          </div>
          <div>
            {rightInfo.map((i) => (
              <div className={styles.detailRow} key={i.label}>
                <span className={styles.detailLabel}>{i.label}</span>
                <span className={styles.detailValue}>{i.value}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
            Статус
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="PENDING">PENDING</option>
              <option value="DONE">DONE</option>
              <option value="FAILED">Ошибка</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
            Оплата
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="">—</option>
              <option value="CARD">Карта</option>
              <option value="CASH">Наличные</option>
              <option value="QR">QR</option>
              <option value="SELF">Оплатил сам</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
            Сумма
            <input value={total} onChange={(e) => setTotal(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
            Пробег
            <input value={mileage} onChange={(e) => setMileage(e.target.value)} />
          </label>
        </div>
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignItems: "start" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={paidByDriver} onChange={(e) => setPaidByDriver(e.target.checked)} />
            Оплатил сам
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={reimbursed} onChange={(e) => setReimbursed(e.target.checked)} />
            Компенсация выплачена
          </label>
          <label style={{ gridColumn: "1 / span 2", display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
            Комментарий по оплате
            <textarea
              value={paymentComment}
              onChange={(e) => setPaymentComment(e.target.value)}
              style={{ minHeight: 60, padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
              placeholder="Например, чек оплатил водитель, требуется компенсация"
            />
          </label>
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
          <button className={styles.button} onClick={save} disabled={saving}>
            {saving ? "Сохраняю..." : "Сохранить"}
          </button>
          <button className={styles.button} onClick={onClose}>
            Закрыть
          </button>
          <button
            className={styles.button}
            onClick={async () => {
              setDeleting(true);
              setMessage(null);
              try {
                const res = await fetch(
                  `/api/receipts/${receipt.id}`,
                  {
                    method: "DELETE",
                    credentials: "include",
                  }
                );
                if (res.status === 401) {
                  setMessage("Сессия истекла, войдите снова.");
                  return;
                }
                if (res.ok || res.status === 204) {
                  setMessage("Удалено. Обновите страницу.");
                } else {
                  const data = await res.json().catch(() => ({}));
                  setMessage(`Ошибка удаления: ${data?.error || res.status}`);
                }
              } catch (err: any) {
                setMessage(`Ошибка: ${err?.message ?? err}`);
              } finally {
                setDeleting(false);
              }
            }}
            disabled={deleting}
          >
            {deleting ? "Удаляю..." : "Удалить"}
          </button>
          {message && <span style={{ fontSize: 12, opacity: 0.8 }}>{message}</span>}
        </div>
        <div style={{ marginTop: 12 }}>
          <details>
            <summary style={{ cursor: "pointer" }}>Сырой объект</summary>
            <pre style={{ maxHeight: 240, overflow: "auto", background: "#f6f6f6", padding: 12, borderRadius: 8 }}>
              {JSON.stringify(receipt, null, 2)}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}
