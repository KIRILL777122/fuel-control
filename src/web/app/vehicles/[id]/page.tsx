"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import styles from "../../page.module.css";

const API_BASE = "";

type Vehicle = {
  id: string;
  plateNumber: string;
  makeModel?: string | null;
  year?: number | null;
  vin?: string | null;
  engine?: string | null;
  color?: string | null;
  purchasedAt?: string | null;
  purchasedOdometerKm?: number | null;
  currentOdometerKm?: number | null;
  notes?: string | null;
};

type PartsSpec = {
  id: string;
  groupCode: string;
  recommendedText: string;
  preferredBrands?: string[];
  avoidBrands?: string[];
  notes?: string | null;
};

type Accident = {
  id: string;
  occurredAt: string;
  odometerKm?: number | null;
  description: string;
  damage?: string | null;
  repaired?: boolean;
};

const PARTS_GROUP_LABELS: Record<string, string> = {
  OIL_ENGINE: "Масло двигателя",
  FILTER_OIL: "Фильтр масла",
  FILTER_AIR: "Фильтр воздуха",
  FILTER_FUEL: "Фильтр топлива",
  FILTER_CABIN: "Фильтр салона",
  BRAKE_PADS: "Тормозные колодки",
  BRAKE_DISCS: "Тормозные диски",
  SPARK_PLUGS: "Свечи",
  BELTS: "Ремни",
  OTHER: "Прочее",
};

export default function VehicleCardPage() {
  const params = useParams();
  const router = useRouter();
  const vehicleId = params?.id as string;
  const [tab, setTab] = React.useState("passport");
  const [vehicle, setVehicle] = React.useState<Vehicle | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [editMode, setEditMode] = React.useState(false);
  const [partsSpecs, setPartsSpecs] = React.useState<PartsSpec[]>([]);
  const [accidents, setAccidents] = React.useState<Accident[]>([]);
  const [newSpec, setNewSpec] = React.useState({ groupCode: "OIL_ENGINE", recommendedText: "", notes: "" });
  const [newAccident, setNewAccident] = React.useState({ occurredAt: "", odometerKm: "", description: "", damage: "" });

  const load = React.useCallback(async () => {
    setLoading(true);
    const [vehicleRes, specsRes, accidentsRes] = await Promise.all([
      fetch(`${API_BASE}/api/vehicles/${vehicleId}`, { credentials: "include" }),
      fetch(`${API_BASE}/api/vehicle-parts-spec?vehicleId=${vehicleId}`, { credentials: "include" }),
      fetch(`${API_BASE}/api/accidents?vehicleId=${vehicleId}`, { credentials: "include" }),
    ]);
    const vehicleData = await vehicleRes.json();
    const specsData = await specsRes.json();
    const accidentsData = await accidentsRes.json();
    setVehicle(vehicleRes.ok ? vehicleData : null);
    setPartsSpecs(Array.isArray(specsData) ? specsData : []);
    setAccidents(Array.isArray(accidentsData) ? accidentsData : []);
    setLoading(false);
  }, [vehicleId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const saveVehicle = async () => {
    if (!vehicle) return;
    const res = await fetch(`${API_BASE}/api/vehicles/${vehicle.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(vehicle),
    });
    if (!res.ok) {
      alert("Не удалось сохранить");
      return;
    }
    setEditMode(false);
    await load();
  };

  const deleteVehicle = async () => {
    if (!vehicle) return;
    if (!window.confirm("Удалить авто?")) return;
    await fetch(`${API_BASE}/api/vehicles/${vehicle.id}`, { method: "DELETE", credentials: "include" });
    router.push("/vehicles");
  };

  const createSpec = async () => {
    const res = await fetch(`${API_BASE}/api/vehicle-parts-spec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ vehicleId, ...newSpec }),
    });
    if (res.ok) {
      setNewSpec({ groupCode: "OIL_ENGINE", recommendedText: "", notes: "" });
      load();
    }
  };

  const deleteSpec = async (id: string) => {
    if (!window.confirm("Удалить рекомендацию?")) return;
    await fetch(`${API_BASE}/api/vehicle-parts-spec/${id}`, { method: "DELETE", credentials: "include" });
    load();
  };

  const createAccident = async () => {
    const res = await fetch(`${API_BASE}/api/accidents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ vehicleId, ...newAccident, repaired: false }),
    });
    if (res.ok) {
      setNewAccident({ occurredAt: "", odometerKm: "", description: "", damage: "" });
      load();
    }
  };

  const deleteAccident = async (id: string) => {
    if (!window.confirm("Удалить запись об аварии?")) return;
    await fetch(`${API_BASE}/api/accidents/${id}`, { method: "DELETE", credentials: "include" });
    load();
  };

  if (loading) return <p>Загрузка...</p>;
  if (!vehicle) return <p>Авто не найдено</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Авто: {vehicle.plateNumber}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={styles.button} onClick={() => setEditMode((prev) => !prev)}>
            {editMode ? "Отменить" : "Редактировать"}
          </button>
          <button className={styles.button} style={{ background: "#fdd", color: "#900" }} onClick={deleteVehicle}>
            Удалить
          </button>
          <Link className={styles.button} href={`/repairs?vehicleId=${vehicle.id}`}>
            Открыть ремонты
          </Link>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[
          { id: "passport", label: "Паспорт" },
          { id: "recommendations", label: "Рекомендации" },
          { id: "accidents", label: "Аварии" },
        ].map((item) => (
          <button
            key={item.id}
            className={styles.button}
            style={{ background: tab === item.id ? "#eef2ff" : "#fff", borderColor: tab === item.id ? "#4338ca" : "#d7d7e0" }}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "passport" && (
        <div style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e9e9f2" }}>
          <div style={{ display: "grid", gap: 12 }}>
            <label>
              Марка/модель
              <input
                value={vehicle.makeModel ?? ""}
                disabled={!editMode}
                onChange={(e) => setVehicle({ ...vehicle, makeModel: e.target.value })}
                style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
              />
            </label>
            <label>
              Год
              <input
                value={vehicle.year ?? ""}
                disabled={!editMode}
                onChange={(e) => setVehicle({ ...vehicle, year: Number(e.target.value) })}
                type="number"
                style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
              />
            </label>
            <label>
              VIN
              <input
                value={vehicle.vin ?? ""}
                disabled={!editMode}
                onChange={(e) => setVehicle({ ...vehicle, vin: e.target.value })}
                style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
              />
            </label>
            <label>
              Двигатель
              <input
                value={vehicle.engine ?? ""}
                disabled={!editMode}
                onChange={(e) => setVehicle({ ...vehicle, engine: e.target.value })}
                style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
              />
            </label>
            <label>
              Цвет
              <input
                value={vehicle.color ?? ""}
                disabled={!editMode}
                onChange={(e) => setVehicle({ ...vehicle, color: e.target.value })}
                style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
              />
            </label>
            <label>
              Дата покупки
              <input
                type="date"
                value={vehicle.purchasedAt ? vehicle.purchasedAt.slice(0, 10) : ""}
                disabled={!editMode}
                onChange={(e) => setVehicle({ ...vehicle, purchasedAt: e.target.value })}
                style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
              />
            </label>
            <label>
              Пробег при покупке
              <input
                value={vehicle.purchasedOdometerKm ?? ""}
                disabled={!editMode}
                onChange={(e) => setVehicle({ ...vehicle, purchasedOdometerKm: Number(e.target.value) })}
                style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
              />
            </label>
            <label>
              Пробег (расчёт из чеков/ремонтов)
              <input
                value={vehicle.currentOdometerKm ?? ""}
                disabled
                style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
              />
            </label>
            <label>
              Заметки
              <textarea
                value={vehicle.notes ?? ""}
                disabled={!editMode}
                onChange={(e) => setVehicle({ ...vehicle, notes: e.target.value })}
                style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
              />
            </label>
          </div>
          {editMode && (
            <button className={styles.button} style={{ marginTop: 12 }} onClick={saveVehicle}>
              Сохранить
            </button>
          )}
        </div>
      )}

      {tab === "recommendations" && (
        <div style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e9e9f2" }}>
          <h3 style={{ marginTop: 0 }}>Рекомендации</h3>
          <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
            <select value={newSpec.groupCode} onChange={(e) => setNewSpec({ ...newSpec, groupCode: e.target.value })}>
              <option value="OIL_ENGINE">Масло двигателя</option>
              <option value="FILTER_OIL">Фильтр масла</option>
              <option value="FILTER_AIR">Фильтр воздуха</option>
              <option value="FILTER_FUEL">Фильтр топлива</option>
              <option value="FILTER_CABIN">Фильтр салона</option>
              <option value="BRAKE_PADS">Тормозные колодки</option>
              <option value="BRAKE_DISCS">Тормозные диски</option>
              <option value="SPARK_PLUGS">Свечи</option>
              <option value="BELTS">Ремни</option>
              <option value="OTHER">Прочее</option>
            </select>
            <input
              value={newSpec.recommendedText}
              onChange={(e) => setNewSpec({ ...newSpec, recommendedText: e.target.value })}
              placeholder="Рекомендуемые детали"
            />
            <textarea
              value={newSpec.notes}
              onChange={(e) => setNewSpec({ ...newSpec, notes: e.target.value })}
              placeholder="Заметки"
            />
            <button className={styles.button} onClick={createSpec}>
              Добавить
            </button>
          </div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {partsSpecs.map((spec) => (
              <li key={spec.id} style={{ marginBottom: 8 }}>
                <strong>{PARTS_GROUP_LABELS[spec.groupCode] ?? spec.groupCode}</strong>: {spec.recommendedText}
                <button className={styles.button} style={{ marginLeft: 8 }} onClick={() => deleteSpec(spec.id)}>
                  Удалить
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "accidents" && (
        <div style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e9e9f2" }}>
          <h3 style={{ marginTop: 0 }}>Аварии</h3>
          <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
            <input
              type="date"
              value={newAccident.occurredAt}
              onChange={(e) => setNewAccident({ ...newAccident, occurredAt: e.target.value })}
            />
            <input
              value={newAccident.odometerKm}
              onChange={(e) => setNewAccident({ ...newAccident, odometerKm: e.target.value })}
              placeholder="Пробег"
            />
            <textarea
              value={newAccident.description}
              onChange={(e) => setNewAccident({ ...newAccident, description: e.target.value })}
              placeholder="Описание"
            />
            <textarea
              value={newAccident.damage}
              onChange={(e) => setNewAccident({ ...newAccident, damage: e.target.value })}
              placeholder="Повреждения"
            />
            <button className={styles.button} onClick={createAccident}>
              Добавить
            </button>
          </div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {accidents.map((accident) => (
              <li key={accident.id} style={{ marginBottom: 8 }}>
                <strong>{new Date(accident.occurredAt).toLocaleDateString("ru-RU")}</strong> — {accident.description}
                <button className={styles.button} style={{ marginLeft: 8 }} onClick={() => deleteAccident(accident.id)}>
                  Удалить
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
