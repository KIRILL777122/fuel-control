"use client";

import React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import styles from "../page.module.css";

const API_BASE = "";

type VehicleOption = { id: string; plateNumber: string };

type RepairItem = {
  id: string;
  startedAt: string;
  odometerKm: number;
  vehicle?: { plateNumber: string };
  eventType: string;
  categoryCode: string;
  symptomsText: string;
  totalCostWork: string;
  totalCostParts: string;
  totalCostOther: string;
  totalCost: string;
  serviceName?: string | null;
  attachmentsCount?: number;
  status: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  ENGINE: "Двигатель",
  COOLING: "Охлаждение",
  FUEL: "Топливо",
  ELECTRICAL: "Электрика",
  TRANSMISSION: "Трансмиссия",
  SUSPENSION: "Подвеска",
  BRAKES: "Тормоза",
  STEERING: "Рулевое",
  BODY: "Кузов",
  TIRES: "Шины/колёса",
  OTHER: "Прочее",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Черновик",
  IN_PROGRESS: "В работе",
  DONE: "Завершён",
  CANCELLED: "Отменён",
};

export default function RepairsPage() {
  const searchParams = useSearchParams();
  const [tab, setTab] = React.useState("journal");
  const [vehicles, setVehicles] = React.useState<VehicleOption[]>([]);
  const [repairs, setRepairs] = React.useState<RepairItem[]>([]);
  const [summary, setSummary] = React.useState<any>(null);
  const [maintenance, setMaintenance] = React.useState<any[]>([]);
  const [filters, setFilters] = React.useState({
    from: "",
    to: "",
    vehicleId: searchParams?.get("vehicleId") || "",
    type: "",
    status: "",
    category: "",
    hasDocs: false,
  });

  React.useEffect(() => {
    fetch(`${API_BASE}/api/vehicles`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setVehicles(Array.isArray(data) ? data : []));
  }, []);

  const loadRepairs = React.useCallback(async () => {
    const params = new URLSearchParams();
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.vehicleId) params.set("vehicleId", filters.vehicleId);
    if (filters.type) params.set("type", filters.type);
    if (filters.status) params.set("status", filters.status);
    if (filters.category) params.set("category", filters.category);
    if (filters.hasDocs) params.set("hasDocs", "true");

    const res = await fetch(`${API_BASE}/api/repairs?${params.toString()}`, { credentials: "include" });
    const data = await res.json();
    setRepairs(Array.isArray(data) ? data : []);
  }, [filters]);

  const loadSummary = React.useCallback(async () => {
    const params = new URLSearchParams();
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.vehicleId) params.set("vehicleId", filters.vehicleId);
    const res = await fetch(`${API_BASE}/api/repairs/summary?${params.toString()}`, { credentials: "include" });
    const data = await res.json();
    setSummary(data);
  }, [filters]);

  const loadMaintenance = React.useCallback(async () => {
    const params = new URLSearchParams();
    if (filters.vehicleId) params.set("vehicleId", filters.vehicleId);
    const res = await fetch(`${API_BASE}/api/maintenance?${params.toString()}`, { credentials: "include" });
    const data = await res.json();
    setMaintenance(Array.isArray(data) ? data : []);
  }, [filters.vehicleId]);

  React.useEffect(() => {
    if (tab === "journal") loadRepairs();
    if (tab === "summary") loadSummary();
    if (tab === "maintenance") loadMaintenance();
  }, [tab, loadRepairs, loadSummary, loadMaintenance]);

  const deleteRepair = async (id: string) => {
    if (!window.confirm("Удалить ремонт?")) return;
    await fetch(`${API_BASE}/api/repairs/${id}`, { method: "DELETE", credentials: "include" });
    loadRepairs();
  };

  const duplicateRepair = async (id: string) => {
    const res = await fetch(`${API_BASE}/api/repairs/${id}`, { credentials: "include" });
    const data = await res.json();
    if (!res.ok) return;
    const payload = {
      ...data,
      status: "DRAFT",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      works: data.works ?? [],
      parts: data.parts ?? [],
      expenses: data.expenses ?? [],
    };
    const created = await fetch(`${API_BASE}/api/repairs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const createdData = await created.json();
    if (created.ok) {
      window.location.href = `/repairs/${createdData.id}`;
    }
  };

  const printRepair = (id: string) => {
    window.open(`/repairs/${id}`, "_blank");
  };

  const markMaintenanceDone = async (id: string) => {
    const date = prompt("Дата выполнения (YYYY-MM-DD)", new Date().toISOString().slice(0, 10));
    if (!date) return;
    const odometerKm = prompt("Пробег", "");
    const createRepairEvent = window.confirm("Создать событие ТО в ремонтах?");
    await fetch(`${API_BASE}/api/maintenance/${id}/mark-done`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ date, odometerKm, createRepairEvent }),
    });
    loadMaintenance();
  };

  const showDrafts = async () => {
    const res = await fetch(`${API_BASE}/api/repairs/drafts?created_from=TELEGRAM_BOT`, { credentials: "include" });
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      alert("Черновики не найдены");
      return;
    }
    const summary = data.map((draft: any) => `${draft.id} — шаг ${draft.step}`).join("\n");
    alert(`Черновики:\n${summary}`);
  };

  return (
    <div>
      <h1 style={{ margin: "0 0 24px 0" }}>Ремонт</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[
          { id: "journal", label: "Журнал" },
          { id: "summary", label: "Сводка" },
          { id: "maintenance", label: "ТО и регламент" },
          { id: "catalogs", label: "Справочники" },
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

      {tab === "journal" && (
        <div>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", marginBottom: 12 }}>
            <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
            <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
            <select value={filters.vehicleId} onChange={(e) => setFilters({ ...filters, vehicleId: e.target.value })}>
              <option value="">Все авто</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plateNumber}
                </option>
              ))}
            </select>
            <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
              <option value="">Все типы</option>
              <option value="MAINTENANCE">ТО</option>
              <option value="REPAIR">Ремонт</option>
            </select>
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">Все статусы</option>
              <option value="DRAFT">Черновик</option>
              <option value="IN_PROGRESS">В работе</option>
              <option value="DONE">Завершён</option>
              <option value="CANCELLED">Отменён</option>
            </select>
            <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
              <option value="">Все категории</option>
              {Object.entries(CATEGORY_LABELS).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={filters.hasDocs} onChange={(e) => setFilters({ ...filters, hasDocs: e.target.checked })} />
              Только с документами
            </label>
            <button className={styles.button} onClick={loadRepairs}>
              Применить
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <Link className={styles.button} href="/repairs/new">
              + Добавить ремонт/ТО
            </Link>
            <button className={styles.button} onClick={showDrafts}>
              Черновики из Телеграм
            </button>
          </div>

          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e9e9f2", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8f8fb" }}>
                  <th style={{ padding: 12 }}>Дата</th>
                  <th style={{ padding: 12 }}>Пробег</th>
                  <th style={{ padding: 12 }}>Авто</th>
                  <th style={{ padding: 12 }}>Тип</th>
                  <th style={{ padding: 12 }}>Категория</th>
                  <th style={{ padding: 12 }}>Симптомы</th>
                  <th style={{ padding: 12 }}>Работы₽</th>
                  <th style={{ padding: 12 }}>Запчасти₽</th>
                  <th style={{ padding: 12 }}>Прочее₽</th>
                  <th style={{ padding: 12 }}>Итого₽</th>
                  <th style={{ padding: 12 }}>Сервис</th>
                  <th style={{ padding: 12 }}>Документы</th>
                  <th style={{ padding: 12 }}>Статус</th>
                  <th style={{ padding: 12 }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {repairs.map((item) => (
                  <tr key={item.id} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: 12 }}>{new Date(item.startedAt).toLocaleDateString("ru-RU")}</td>
                    <td style={{ padding: 12 }}>{item.odometerKm}</td>
                    <td style={{ padding: 12 }}>{item.vehicle?.plateNumber ?? "—"}</td>
                    <td style={{ padding: 12 }}>{item.eventType === "MAINTENANCE" ? "ТО" : "Ремонт"}</td>
                    <td style={{ padding: 12 }}>{CATEGORY_LABELS[item.categoryCode] ?? item.categoryCode}</td>
                    <td style={{ padding: 12 }}>{item.symptomsText}</td>
                    <td style={{ padding: 12 }}>{item.totalCostWork}</td>
                    <td style={{ padding: 12 }}>{item.totalCostParts}</td>
                    <td style={{ padding: 12 }}>{item.totalCostOther}</td>
                    <td style={{ padding: 12 }}>{item.totalCost}</td>
                    <td style={{ padding: 12 }}>{item.serviceName ?? "—"}</td>
                    <td style={{ padding: 12 }}>{item.attachmentsCount ? "Есть" : "—"}</td>
                    <td style={{ padding: 12 }}>{STATUS_LABELS[item.status] ?? item.status}</td>
                    <td style={{ padding: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <Link className={styles.button} href={`/repairs/${item.id}`}>
                        Открыть
                      </Link>
                      <button className={styles.button} onClick={() => duplicateRepair(item.id)}>
                        Копировать
                      </button>
                      <button className={styles.button} onClick={() => printRepair(item.id)}>
                        Печать
                      </button>
                      <button className={styles.button} onClick={() => deleteRepair(item.id)}>
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "summary" && (
        <div>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", marginBottom: 12 }}>
            <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
            <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
            <select value={filters.vehicleId} onChange={(e) => setFilters({ ...filters, vehicleId: e.target.value })}>
              <option value="">Все авто</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plateNumber}
                </option>
              ))}
            </select>
            <button className={styles.button} onClick={loadSummary}>
              Применить
            </button>
          </div>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            <div style={{ background: "#fff", padding: 12, borderRadius: 12, border: "1px solid #e9e9f2" }}>
              <div style={{ opacity: 0.7 }}>Всего потрачено</div>
              <div style={{ fontSize: 20 }}>{summary?.totals?.totalCost ?? "0"} ₽</div>
            </div>
            <div style={{ background: "#fff", padding: 12, borderRadius: 12, border: "1px solid #e9e9f2" }}>
              <div style={{ opacity: 0.7 }}>Событий</div>
              <div style={{ fontSize: 20 }}>{summary?.totals?.count ?? "0"}</div>
            </div>
            <div style={{ background: "#fff", padding: 12, borderRadius: 12, border: "1px solid #e9e9f2" }}>
              <div style={{ opacity: 0.7 }}>Работы</div>
              <div style={{ fontSize: 20 }}>{summary?.totals?.totalCostWork ?? "0"} ₽</div>
            </div>
            <div style={{ background: "#fff", padding: 12, borderRadius: 12, border: "1px solid #e9e9f2" }}>
              <div style={{ opacity: 0.7 }}>Запчасти</div>
              <div style={{ fontSize: 20 }}>{summary?.totals?.totalCostParts ?? "0"} ₽</div>
            </div>
          </div>

          <div style={{ marginTop: 16, background: "#fff", padding: 12, borderRadius: 12, border: "1px solid #e9e9f2" }}>
            <h3 style={{ marginTop: 0 }}>Расходы по категориям</h3>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th style={{ padding: 8 }}>Категория</th>
                  <th style={{ padding: 8 }}>Событий</th>
                  <th style={{ padding: 8 }}>Итого</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.breakdown ?? []).map((item: any) => (
                  <tr key={item.categoryCode} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: 8 }}>{CATEGORY_LABELS[item.categoryCode] ?? item.categoryCode}</td>
                    <td style={{ padding: 8 }}>{item.count}</td>
                    <td style={{ padding: 8 }}>{item.total} ₽</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 16, background: "#fff", padding: 12, borderRadius: 12, border: "1px solid #e9e9f2" }}>
            <h3 style={{ marginTop: 0 }}>Частота по узлам</h3>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th style={{ padding: 8 }}>Категория/узел</th>
                  <th style={{ padding: 8 }}>Кол-во</th>
                  <th style={{ padding: 8 }}>Последний ремонт</th>
                  <th style={{ padding: 8 }}>Средний интервал км</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.frequency ?? []).map((item: any, index: number) => (
                  <tr key={`${item.categoryCode}-${index}`} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: 8 }}>{CATEGORY_LABELS[item.categoryCode] ?? item.categoryCode}</td>
                    <td style={{ padding: 8 }}>{item.count}</td>
                    <td style={{ padding: 8 }}>{item.lastOccurrence ? new Date(item.lastOccurrence).toLocaleDateString("ru-RU") : "—"}</td>
                    <td style={{ padding: 8 }}>{item.avgIntervalKm ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "maintenance" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <select value={filters.vehicleId} onChange={(e) => setFilters({ ...filters, vehicleId: e.target.value })}>
              <option value="">Все авто</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plateNumber}
                </option>
              ))}
            </select>
            <Link className={styles.button} href="/repairs/maintenance/new">
              + Добавить пункт ТО
            </Link>
          </div>
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e9e9f2" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th style={{ padding: 8 }}>Пункт ТО</th>
                  <th style={{ padding: 8 }}>Интервал</th>
                  <th style={{ padding: 8 }}>Последнее выполнение</th>
                  <th style={{ padding: 8 }}>Следующее ТО</th>
                  <th style={{ padding: 8 }}>Статус</th>
                  <th style={{ padding: 8 }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {maintenance.map((item) => (
                  <tr key={item.id} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: 8 }}>{item.name}</td>
                    <td style={{ padding: 8 }}>{item.intervalKm ? `${item.intervalKm} км` : ""} {item.intervalDays ? `${item.intervalDays} дн.` : ""}</td>
                    <td style={{ padding: 8 }}>{item.lastDoneAt ? new Date(item.lastDoneAt).toLocaleDateString("ru-RU") : "—"}</td>
                    <td style={{ padding: 8 }}>—</td>
                    <td style={{ padding: 8 }}>{item.isActive ? "Активен" : "Отключён"}</td>
                    <td style={{ padding: 8, display: "flex", gap: 6 }}>
                      <button className={styles.button} onClick={() => markMaintenanceDone(item.id)}>
                        Отметить выполнено
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "catalogs" && (
        <div style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e9e9f2" }}>
          <h3 style={{ marginTop: 0 }}>Категории ремонтов</h3>
          <ul>
            {Object.entries(CATEGORY_LABELS).map(([code, label]) => (
              <li key={code}>
                <strong>{code}</strong> — {label}
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 16, opacity: 0.7 }}>Подсистемы: скоро</div>
        </div>
      )}
    </div>
  );
}
