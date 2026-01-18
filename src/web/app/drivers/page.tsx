"use client";

import React from "react";
import { DriverForm } from "../components/Forms";
import { DriversList } from "../components/DriversList";
import { Driver } from "../types";

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

export default function DriversPage() {
  const [drivers, setDrivers] = React.useState<Driver[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    async function load() {
      setLoading(true);
      const driversRes = await getJson("/api/drivers");
      setDrivers(Array.isArray(driversRes.data) ? driversRes.data : []);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div>
      <h1 style={{ margin: "0 0 24px 0" }}>Водители</h1>
      <div style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e9e9f2", marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Добавить водителя</h3>
        <DriverForm />
      </div>
      <div style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e9e9f2" }}>
        <h3 style={{ marginTop: 0 }}>Список</h3>
        {loading ? <p>Загрузка...</p> : <DriversList items={drivers} />}
      </div>
    </div>
  );
}
