"use client";

import React from "react";
import { DriverForm, VehicleForm } from "../components/Forms";
import { DriversList } from "../components/DriversList";
import { VehiclesList } from "../components/VehiclesList";
import { Driver, Vehicle } from "../types";
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
  const [activeTab, setActiveTab] = React.useState<"drivers" | "vehicles">("drivers");
  const [drivers, setDrivers] = React.useState<Driver[]>([]);
  const [vehicles, setVehicles] = React.useState<Vehicle[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    async function load() {
      setLoading(true);
      const [driversRes, vehiclesRes] = await Promise.all([
        getJson("/api/drivers"),
        getJson("/api/vehicles"),
      ]);
      setDrivers(Array.isArray(driversRes.data) ? driversRes.data : []);
      setVehicles(Array.isArray(vehiclesRes.data) ? vehiclesRes.data : []);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div>
        <h1 style={{ margin: "0 0 24px 0" }}>Добавить новое</h1>
        <p>Загрузка...</p>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ margin: "0 0 24px 0" }}>Добавить новое</h1>
      
      {/* Кнопки переключения */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          className={styles.button}
          onClick={() => setActiveTab("drivers")}
          style={{
            backgroundColor: activeTab === "drivers" ? "#eef2ff" : "#fff",
            borderColor: activeTab === "drivers" ? "#4338ca" : "#d7d7e0",
          }}
        >
          Водители
        </button>
        <button
          className={styles.button}
          onClick={() => setActiveTab("vehicles")}
          style={{
            backgroundColor: activeTab === "vehicles" ? "#eef2ff" : "#fff",
            borderColor: activeTab === "vehicles" ? "#4338ca" : "#d7d7e0",
          }}
        >
          Авто
        </button>
      </div>

      {/* Вкладка Водители */}
      {activeTab === "drivers" && (
        <div style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e9e9f2" }}>
          <h3 style={{ marginTop: 0 }}>Водители</h3>
          <DriverForm />
          <div style={{ marginTop: 12 }}>
            <DriversList items={drivers} />
          </div>
        </div>
      )}

      {/* Вкладка Авто */}
      {activeTab === "vehicles" && (
        <div style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e9e9f2" }}>
          <h3 style={{ marginTop: 0 }}>Авто</h3>
          <VehicleForm />
          <div style={{ marginTop: 12 }}>
            <VehiclesList initial={vehicles as any} />
          </div>
        </div>
      )}
    </div>
  );
}
