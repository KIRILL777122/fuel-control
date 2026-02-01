"use client";

import React from "react";
import styles from "../page.module.css";
import ReceiptTable from "./ReceiptTable";
import SummaryStats from "./SummaryStats";
import { Receipt, Driver, Vehicle } from "../types";

export default function ReceiptsTabs({ receipts, drivers, vehicles }: { receipts: Receipt[]; drivers: Driver[]; vehicles: Vehicle[] }) {
  const [activeTab, setActiveTab] = React.useState<"summary" | "receipts">("summary");

  return (
    <div>
      <h1 style={{ margin: "0 0 24px 0" }}>Чеки</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          className={styles.button}
          onClick={() => setActiveTab("summary")}
          style={{
            backgroundColor: activeTab === "summary" ? "#eef2ff" : "#fff",
            borderColor: activeTab === "summary" ? "#4338ca" : "#d7d7e0",
          }}
        >
          Сводка
        </button>
        <button
          className={styles.button}
          onClick={() => setActiveTab("receipts")}
          style={{
            backgroundColor: activeTab === "receipts" ? "#eef2ff" : "#fff",
            borderColor: activeTab === "receipts" ? "#4338ca" : "#d7d7e0",
          }}
        >
          Чеки
        </button>
      </div>

      {activeTab === "summary" ? (
        <SummaryStats receipts={receipts} />
      ) : (
        <ReceiptTable receipts={receipts} drivers={drivers} vehicles={vehicles} />
      )}
    </div>
  );
}
