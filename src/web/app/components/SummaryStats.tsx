"use client";

import React from "react";
import styles from "../page.module.css";
import { Receipt } from "../types";

export default function SummaryStats({ receipts: initialReceipts }: { receipts: Receipt[] }) {
  const [dateFrom, setDateFrom] = React.useState<string>("");
  const [dateTo, setDateTo] = React.useState<string>("");

  const [activeTab, setActiveTab] = React.useState<"fuel" | "payment">("fuel");
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

  return (
    <div style={{ marginTop: 24 }}>
      <div className={styles.filters} style={{ marginBottom: 16 }}>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
          Дата от
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ marginTop: 4 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
          Дата до
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ marginTop: 4 }} />
        </label>
      </div>

      <div style={{ marginTop: 16 }}>
        {/* Таблица по видам топлива */}
        <div>
          <h3 className={styles.sectionTitle}>По видам топлива</h3>
          <div className={styles.tableWrap}>
            <table className={styles.table} style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th className={styles.th} style={{ textAlign: "center", borderRight: "1px solid #e0e0e0", padding: "8px 12px" }}>Топливо</th>
                    <th className={styles.th} style={{ textAlign: "center", borderRight: "1px solid #e0e0e0", padding: "8px 12px" }}>Чеки</th>
                    <th className={styles.th} style={{ textAlign: "center", borderRight: "1px solid #e0e0e0", padding: "8px 12px" }}>Сумма</th>
                    <th className={styles.th} style={{ textAlign: "center", borderRight: "1px solid #e0e0e0", padding: "8px 12px" }}>Литры</th>
                    <th className={styles.th} style={{ textAlign: "center", padding: "8px 12px" }}>Заправок</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(fuelStats).length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 12, textAlign: "center", opacity: 0.7 }}>
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

        {/* Таблица по способам оплаты */}
        <div>
          <h3 className={styles.sectionTitle}>По способам оплаты</h3>
          <div className={styles.tableWrap}>
            <table className={styles.table} style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th className={styles.th} style={{ textAlign: "center", borderRight: "1px solid #e0e0e0", padding: "8px 12px" }}>Оплата</th>
                    <th className={styles.th} style={{ textAlign: "center", borderRight: "1px solid #e0e0e0", padding: "8px 12px" }}>Чеки</th>
                    <th className={styles.th} style={{ textAlign: "center", padding: "8px 12px" }}>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(paymentStats).length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ padding: 12, textAlign: "center", opacity: 0.7 }}>
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
      </div>
    </div>
  );
}
