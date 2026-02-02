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
      <h1 className={styles.pageTitle}>Чеки</h1>
      <div className={styles.tabBar}>
        <button
          className={`${styles.tabButton} ${activeTab === "summary" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("summary")}
        >
          Сводка
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === "receipts" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("receipts")}
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
