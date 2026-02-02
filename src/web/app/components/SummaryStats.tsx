"use client";

import React from "react";
import styles from "../page.module.css";
import { Receipt } from "../types";

export default function SummaryStats({ receipts: initialReceipts }: { receipts: Receipt[] }) {
  const [dateFrom, setDateFrom] = React.useState<string>("");
  const [dateTo, setDateTo] = React.useState<string>("");

  const filteredReceipts = React.useMemo(() => {
    let filtered = initialReceipts;

    if (dateFrom) {
      const fromTs = new Date(dateFrom).getTime();
      filtered = filtered.filter((r) => new Date(r.receiptAt).getTime() >= fromTs);
    }

    if (dateTo) {
      const toTs = new Date(dateTo + "T23:59:59").getTime();
      filtered = filtered.filter((r) => new Date(r.receiptAt).getTime() <= toTs);
    }

    return filtered;
  }, [initialReceipts, dateFrom, dateTo]);

  // Статистика по видам топлива
  const fuelStats = React.useMemo(() => {
    const stats: Record<string, { count: number; totalAmount: number; totalLiters: number }> = {};

    filteredReceipts.forEach((r) => {
      const fuelType = r.fuelType || "OTHER";
      if (!stats[fuelType]) {
        stats[fuelType] = { count: 0, totalAmount: 0, totalLiters: 0 };
      }
      stats[fuelType].count++;
      const amount = parseFloat(String(r.totalAmount)) || 0;
      stats[fuelType].totalAmount += amount;
      const liters = parseFloat(String(r.liters)) || 0;
      stats[fuelType].totalLiters += liters;
    });

    return stats;
  }, [filteredReceipts]);

  // Статистика по способам оплаты
  const paymentStats = React.useMemo(() => {
    const stats: Record<string, { count: number; totalAmount: number }> = {};

    filteredReceipts.forEach((r) => {
      const paymentMethod = r.paymentMethod || "OTHER";
      if (!stats[paymentMethod]) {
        stats[paymentMethod] = { count: 0, totalAmount: 0 };
      }
      stats[paymentMethod].count++;
      const amount = parseFloat(String(r.totalAmount)) || 0;
      stats[paymentMethod].totalAmount += amount;
    });

    return stats;
  }, [filteredReceipts]);

  // Статистика по водителям -> машинам -> топливу (с пробегом и расходом)
  const driverVehicleFuelRows = React.useMemo(() => {
    const stats: Record<string, Record<string, Record<string, { count: number; liters: number; totalAmount: number }>>> = {};
    const driverVehicleKm: Record<string, Record<string, number>> = {};

    const receiptsByVehicle: Record<string, Receipt[]> = {};
    filteredReceipts.forEach((r) => {
      const vehicleKey =
        (r as any).vehicleId ||
        r.vehicle?.plateNumber ||
        r.vehicle?.name ||
        "unknown-vehicle";
      if (!receiptsByVehicle[vehicleKey]) receiptsByVehicle[vehicleKey] = [];
      receiptsByVehicle[vehicleKey].push(r);
    });

    Object.values(receiptsByVehicle).forEach((rows) => {
      const sorted = [...rows].sort((a, b) => {
        const at = new Date(a.receiptAt).getTime();
        const bt = new Date(b.receiptAt).getTime();
        return at - bt;
      });

      let activeDriver: string | null = null;
      let activeVehicle: string | null = null;
      let segmentStartMileage: number | null = null;
      let lastMileage: number | null = null;

      for (const r of sorted) {
        const driverName =
          r.driver?.fullName ||
          r.driver?.telegramUserId ||
          "Без водителя";
        const vehicleName =
          r.vehicle?.plateNumber ||
          r.vehicle?.name ||
          "Без авто";
        const fuelType = r.fuelType || "OTHER";

        if (!stats[driverName]) stats[driverName] = {};
        if (!stats[driverName][vehicleName]) stats[driverName][vehicleName] = {};
        if (!stats[driverName][vehicleName][fuelType]) {
          stats[driverName][vehicleName][fuelType] = { count: 0, liters: 0, totalAmount: 0 };
        }
        const entry = stats[driverName][vehicleName][fuelType];
        entry.count += 1;
        entry.liters += parseFloat(String(r.liters)) || 0;
        entry.totalAmount += parseFloat(String(r.totalAmount)) || 0;

        const mileage = typeof r.mileage === "number" ? r.mileage : null;
        if (activeDriver === null) {
          activeDriver = driverName;
          activeVehicle = vehicleName;
          segmentStartMileage = mileage;
          lastMileage = mileage;
          continue;
        }

        const isSameDriver = activeDriver === driverName && activeVehicle === vehicleName;
        if (!isSameDriver) {
          if (segmentStartMileage !== null && lastMileage !== null) {
            const delta = lastMileage - segmentStartMileage;
            if (delta > 0) {
              if (!driverVehicleKm[activeDriver]) driverVehicleKm[activeDriver] = {};
              driverVehicleKm[activeDriver][activeVehicle || "Без авто"] =
                (driverVehicleKm[activeDriver]?.[activeVehicle || "Без авто"] || 0) + delta;
            }
          }
          activeDriver = driverName;
          activeVehicle = vehicleName;
          segmentStartMileage = mileage;
          lastMileage = mileage;
          continue;
        }

        if (mileage !== null) {
          lastMileage = mileage;
        }
      }

      if (activeDriver && segmentStartMileage !== null && lastMileage !== null) {
        const delta = lastMileage - segmentStartMileage;
        if (delta > 0) {
          if (!driverVehicleKm[activeDriver]) driverVehicleKm[activeDriver] = {};
          driverVehicleKm[activeDriver][activeVehicle || "Без авто"] =
            (driverVehicleKm[activeDriver]?.[activeVehicle || "Без авто"] || 0) + delta;
        }
      }
    });

    const rows: Array<{
      driver: string;
      vehicle: string;
      fuel: string;
      count: number;
      liters: number;
      totalAmount: number;
      totalKm: number;
    }> = [];
    Object.entries(stats).forEach(([driver, vehicles]) => {
      Object.entries(vehicles).forEach(([vehicle, fuels]) => {
        const totalKm = driverVehicleKm[driver]?.[vehicle] || 0;
        Object.entries(fuels).forEach(([fuel, data]) => {
          rows.push({ driver, vehicle, fuel, ...data, totalKm });
        });
      });
    });

    return rows;
  }, [filteredReceipts]);

  // Статистика по автомобилям -> топливу
  const vehicleFuelRows = React.useMemo(() => {
    const stats: Record<string, Record<string, { count: number; liters: number; totalAmount: number }>> = {};

    filteredReceipts.forEach((r) => {
      const vehicleName =
        r.vehicle?.plateNumber ||
        r.vehicle?.name ||
        "Без авто";
      const fuelType = r.fuelType || "OTHER";
      if (!stats[vehicleName]) stats[vehicleName] = {};
      if (!stats[vehicleName][fuelType]) {
        stats[vehicleName][fuelType] = { count: 0, liters: 0, totalAmount: 0 };
      }
      const entry = stats[vehicleName][fuelType];
      entry.count += 1;
      entry.liters += parseFloat(String(r.liters)) || 0;
      entry.totalAmount += parseFloat(String(r.totalAmount)) || 0;
    });

    const rows: Array<{ vehicle: string; fuel: string; count: number; liters: number; totalAmount: number }> = [];
    Object.entries(stats).forEach(([vehicle, fuels]) => {
      Object.entries(fuels).forEach(([fuel, data]) => {
        rows.push({ vehicle, fuel, ...data });
      });
    });

    return rows;
  }, [filteredReceipts]);

  const fuelTypeNames: Record<string, string> = {
    AI92: "АИ-92",
    AI95: "АИ-95",
    DIESEL: "Дизель",
    GAS: "Газ",
    OTHER: "Другое",
  };

  const paymentMethodNames: Record<string, string> = {
    CARD: "Карта",
    CASH: "Наличные",
    QR: "QR",
    SELF: "Оплатил сам",
    OTHER: "Другое",
  };

  const headerCellStyle = {
    textAlign: "center" as const,
    padding: "8px 12px",
    background: "var(--accent-light-bg)",
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div className={styles.filterCard}>
        <div className={styles.filterRow}>
          <label className={styles.field}>
            Дата от
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={styles.input} />
          </label>
          <label className={styles.field}>
            Дата до
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={styles.input} />
          </label>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div>
          <h3 className={styles.sectionTitle}>По видам топлива</h3>
          <div className={styles.tableWrap}>
            <table className={styles.table} style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                    <th className={styles.th} style={{ ...headerCellStyle, borderRight: "1px solid #e0e0e0" }}>Топливо</th>
                    <th className={styles.th} style={{ ...headerCellStyle, borderRight: "1px solid #e0e0e0" }}>Чеки</th>
                    <th className={styles.th} style={{ ...headerCellStyle, borderRight: "1px solid #e0e0e0" }}>Сумма</th>
                    <th className={styles.th} style={{ ...headerCellStyle, borderRight: "1px solid #e0e0e0" }}>Литры</th>
                    <th className={styles.th} style={headerCellStyle}>Заправок</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(fuelStats).length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: "8px 12px", textAlign: "center", opacity: 0.7 }}>
                      Нет данных
                    </td>
                  </tr>
                ) : (
                  Object.entries(fuelStats)
                    .sort(([a], [b]) => {
                      const order = ["AI92", "AI95", "DIESEL", "GAS", "OTHER"];
                      return (order.indexOf(a) || 999) - (order.indexOf(b) || 999);
                    })
                    .map(([fuelType, stats]) => (
                      <tr key={fuelType}>
                        <td className={styles.td} style={{ textAlign: "center", borderRight: "1px solid #e0e0e0", padding: "6px 12px" }}>{fuelTypeNames[fuelType] || fuelType}</td>
                        <td className={styles.td} style={{ textAlign: "center", borderRight: "1px solid #e0e0e0", padding: "6px 12px" }}>
                          {stats.count}
                        </td>
                        <td className={styles.td} style={{ textAlign: "center", borderRight: "1px solid #e0e0e0", padding: "6px 12px" }}>
                          {stats.totalAmount.toFixed(2)}
                        </td>
                        <td className={styles.td} style={{ textAlign: "center", borderRight: "1px solid #e0e0e0", padding: "6px 12px" }}>
                          {stats.totalLiters.toFixed(2)}
                        </td>
                        <td className={styles.td} style={{ textAlign: "center", padding: "6px 12px" }}>
                          {stats.count}
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <h3 className={styles.sectionTitle}>По способам оплаты</h3>
          <div className={styles.tableWrap}>
            <table className={styles.table} style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th className={styles.th} style={{ ...headerCellStyle, borderRight: "1px solid #e0e0e0" }}>Оплата</th>
                  <th className={styles.th} style={{ ...headerCellStyle, borderRight: "1px solid #e0e0e0" }}>Чеки</th>
                  <th className={styles.th} style={headerCellStyle}>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(paymentStats).length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ padding: "8px 12px", textAlign: "center", opacity: 0.7 }}>
                      Нет данных
                    </td>
                  </tr>
                ) : (
                  Object.entries(paymentStats)
                    .sort(([a], [b]) => {
                      const order = ["CARD", "CASH", "QR", "SELF", "OTHER"];
                      return (order.indexOf(a) || 999) - (order.indexOf(b) || 999);
                    })
                    .map(([paymentMethod, stats]) => (
                      <tr key={paymentMethod}>
                        <td className={styles.td} style={{ textAlign: "center", borderRight: "1px solid #e0e0e0", padding: "6px 12px" }}>{paymentMethodNames[paymentMethod] || paymentMethod}</td>
                        <td className={styles.td} style={{ textAlign: "center", borderRight: "1px solid #e0e0e0", padding: "6px 12px" }}>
                          {stats.count}
                        </td>
                        <td className={styles.td} style={{ textAlign: "center", padding: "6px 12px" }}>
                          {stats.totalAmount.toFixed(2)}
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <h3 className={styles.sectionTitle}>По водителям</h3>
          <div className={styles.tableWrap}>
            <table className={styles.table} style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th className={styles.th} style={{ ...headerCellStyle, borderRight: "1px solid #e0e0e0" }}>Водитель</th>
                  <th className={styles.th} style={{ ...headerCellStyle, borderRight: "1px solid #e0e0e0" }}>Авто</th>
                  <th className={styles.th} style={{ ...headerCellStyle, borderRight: "1px solid #e0e0e0" }}>Топливо</th>
                  <th className={styles.th} style={{ ...headerCellStyle, borderRight: "1px solid #e0e0e0" }}>Чеки</th>
                  <th className={styles.th} style={{ ...headerCellStyle, borderRight: "1px solid #e0e0e0" }}>Литры</th>
                  <th className={styles.th} style={{ ...headerCellStyle, borderRight: "1px solid #e0e0e0" }}>Сумма</th>
                  <th className={styles.th} style={{ ...headerCellStyle, borderRight: "1px solid #e0e0e0" }}>Км</th>
                  <th className={styles.th} style={headerCellStyle}>Расход, л/100</th>
                </tr>
              </thead>
              <tbody>
                {driverVehicleFuelRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: "8px 12px", textAlign: "center", opacity: 0.7 }}>
                      Нет данных
                    </td>
                  </tr>
                ) : (
                  Object.entries(
                    driverVehicleFuelRows.reduce<Record<string, Record<string, typeof driverVehicleFuelRows>>>((acc, row) => {
                      if (!acc[row.driver]) acc[row.driver] = {};
                      if (!acc[row.driver][row.vehicle]) acc[row.driver][row.vehicle] = [];
                      acc[row.driver][row.vehicle].push(row);
                      return acc;
                    }, {})
                  ).flatMap(([driver, vehicles], driverIdx) =>
                    Object.entries(vehicles).flatMap(([vehicle, rows], vehicleIdx) =>
                      rows.map((row, rowIdx) => (
                      <tr
                        key={`${driver}-${vehicle}-${row.fuel}-${rowIdx}`}
                        style={rowIdx === 0 && vehicleIdx === 0 && driverIdx > 0 ? { borderTop: "2px solid #e5e7eb" } : undefined}
                      >
                        {rowIdx === 0 && vehicleIdx === 0 && (
                          <td
                            className={styles.td}
                            rowSpan={Object.values(vehicles).reduce((sum, items) => sum + items.length, 0)}
                            style={{
                              textAlign: "center",
                              verticalAlign: "middle",
                              borderRight: "1px solid #e0e0e0",
                              padding: "6px 12px",
                              fontWeight: 600,
                              background: "var(--table-th-bg)",
                            }}
                          >
                            {driver}
                          </td>
                        )}
                        {rowIdx === 0 && (
                          <td
                            className={styles.td}
                            rowSpan={rows.length}
                            style={{
                              textAlign: "center",
                              verticalAlign: "middle",
                              borderRight: "1px solid #e0e0e0",
                              padding: "6px 12px",
                              fontWeight: 600,
                              background: "var(--table-th-bg)",
                            }}
                          >
                            {vehicle}
                          </td>
                        )}
                        <td className={styles.td} style={{ textAlign: "center", borderRight: "1px solid #e0e0e0", padding: "6px 12px" }}>{fuelTypeNames[row.fuel] || row.fuel}</td>
                        <td className={styles.td} style={{ textAlign: "center", borderRight: "1px solid #e0e0e0", padding: "6px 12px" }}>{row.count}</td>
                        <td className={styles.td} style={{ textAlign: "center", borderRight: "1px solid #e0e0e0", padding: "6px 12px" }}>{row.liters.toFixed(2)}</td>
                        <td className={styles.td} style={{ textAlign: "center", borderRight: "1px solid #e0e0e0", padding: "6px 12px" }}>{row.totalAmount.toFixed(2)}</td>
                        <td className={styles.td} style={{ textAlign: "center", borderRight: "1px solid #e0e0e0", padding: "6px 12px" }}>
                          {row.totalKm > 0 ? row.totalKm.toFixed(0) : "—"}
                        </td>
                        <td className={styles.td} style={{ textAlign: "center", padding: "6px 12px" }}>
                          {row.totalKm > 0 && row.liters > 0 ? ((row.liters / row.totalKm) * 100).toFixed(2) : "—"}
                        </td>
                      </tr>
                      ))
                    )
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <h3 className={styles.sectionTitle}>По автомобилям</h3>
          <div className={styles.tableWrap}>
            <table className={styles.table} style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th className={styles.th} style={{ ...headerCellStyle, borderRight: "1px solid #e0e0e0" }}>Авто</th>
                  <th className={styles.th} style={{ ...headerCellStyle, borderRight: "1px solid #e0e0e0" }}>Топливо</th>
                  <th className={styles.th} style={{ ...headerCellStyle, borderRight: "1px solid #e0e0e0" }}>Чеки</th>
                  <th className={styles.th} style={{ ...headerCellStyle, borderRight: "1px solid #e0e0e0" }}>Литры</th>
                  <th className={styles.th} style={headerCellStyle}>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {vehicleFuelRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: "8px 12px", textAlign: "center", opacity: 0.7 }}>
                      Нет данных
                    </td>
                  </tr>
                ) : (
                  Object.entries(
                    vehicleFuelRows.reduce<Record<string, typeof vehicleFuelRows>>((acc, row) => {
                      if (!acc[row.vehicle]) acc[row.vehicle] = [];
                      acc[row.vehicle].push(row);
                      return acc;
                    }, {})
                  ).map(([vehicle, rows], groupIdx) =>
                    rows.map((row, rowIdx) => (
                      <tr
                        key={`${vehicle}-${row.fuel}-${rowIdx}`}
                        style={rowIdx === 0 && groupIdx > 0 ? { borderTop: "2px solid #e5e7eb" } : undefined}
                      >
                        {rowIdx === 0 && (
                          <td
                            className={styles.td}
                            rowSpan={rows.length}
                            style={{
                              textAlign: "center",
                              verticalAlign: "middle",
                              borderRight: "1px solid #e0e0e0",
                              padding: "6px 12px",
                              fontWeight: 600,
                              background: "var(--table-th-bg)",
                            }}
                          >
                            {vehicle}
                          </td>
                        )}
                        <td className={styles.td} style={{ textAlign: "center", borderRight: "1px solid #e0e0e0", padding: "6px 12px" }}>
                          {fuelTypeNames[row.fuel] || row.fuel}
                        </td>
                        <td className={styles.td} style={{ textAlign: "center", borderRight: "1px solid #e0e0e0", padding: "6px 12px" }}>
                          {row.count}
                        </td>
                        <td className={styles.td} style={{ textAlign: "center", borderRight: "1px solid #e0e0e0", padding: "6px 12px" }}>
                          {row.liters.toFixed(2)}
                        </td>
                        <td className={styles.td} style={{ textAlign: "center", padding: "6px 12px" }}>
                          {row.totalAmount.toFixed(2)}
                        </td>
                      </tr>
                    ))
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
