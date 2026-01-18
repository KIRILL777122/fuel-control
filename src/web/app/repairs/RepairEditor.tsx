"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "../page.module.css";

const API_BASE = "";

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

type VehicleOption = { id: string; plateNumber: string };

type RepairPayload = {
  id?: string;
  vehicleId: string;
  eventType: string;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  odometerKm: string;
  categoryCode: string;
  subsystemCode?: string | null;
  symptomsText: string;
  findingsText?: string | null;
  serviceName?: string | null;
  paymentStatus: string;
  works: any[];
  parts: any[];
  expenses: any[];
  attachments?: any[];
  aiParseStatus?: string;
  rawInputText?: string | null;
};

const emptyRepair: RepairPayload = {
  vehicleId: "",
  eventType: "REPAIR",
  status: "DRAFT",
  startedAt: new Date().toISOString().slice(0, 10),
  finishedAt: "",
  odometerKm: "",
  categoryCode: "OTHER",
  subsystemCode: "",
  symptomsText: "",
  findingsText: "",
  serviceName: "",
  paymentStatus: "UNPAID",
  works: [],
  parts: [],
  expenses: [],
  attachments: [],
  aiParseStatus: "NONE",
  rawInputText: "",
};

export default function RepairEditor({ id }: { id?: string }) {
  const router = useRouter();
  const [vehicles, setVehicles] = React.useState<VehicleOption[]>([]);
  const [repair, setRepair] = React.useState<RepairPayload>(emptyRepair);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const totals = React.useMemo(() => {
    const workTotal = repair.works.reduce((sum, item) => sum + Number(item.cost || 0), 0);
    const partsTotal = repair.parts.reduce((sum, item) => {
      const qty = Number(item.qty || 0);
      const price = Number(item.unitPrice || 0);
      return sum + qty * price;
    }, 0);
    const otherTotal = repair.expenses.reduce((sum, item) => sum + Number(item.cost || 0), 0);
    return {
      workTotal,
      partsTotal,
      otherTotal,
      total: workTotal + partsTotal + otherTotal,
    };
  }, [repair.works, repair.parts, repair.expenses]);

  React.useEffect(() => {
    fetch(`${API_BASE}/api/vehicles`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setVehicles(Array.isArray(data) ? data : []));
  }, []);

  React.useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    fetch(`${API_BASE}/api/repairs/${id}`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        setRepair({
          ...data,
          startedAt: data.startedAt?.slice(0, 10),
          finishedAt: data.finishedAt ? data.finishedAt.slice(0, 10) : "",
          odometerKm: data.odometerKm?.toString() ?? "",
          works: data.works ?? [],
          parts: data.parts ?? [],
          expenses: data.expenses ?? [],
          attachments: data.attachments ?? [],
        });
        setLoading(false);
      });
  }, [id]);

  const update = (key: keyof RepairPayload, value: any) => {
    setRepair((prev) => ({ ...prev, [key]: value }));
  };

  const save = async (statusOverride?: string) => {
    setSaving(true);
    try {
      const payload = {
        ...repair,
        status: statusOverride ?? repair.status,
        finishedAt: repair.finishedAt || null,
      };
      const res = await fetch(`${API_BASE}/api/repairs${id ? `/${id}` : ""}`,
        {
          method: id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || "Ошибка сохранения");
        return;
      }
      if (!id) {
        router.push(`/repairs/${data.id}`);
        return;
      }
      setRepair((prev) => ({ ...prev, status: statusOverride ?? prev.status }));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!id) return;
    if (!window.confirm("Удалить ремонт?")) return;
    await fetch(`${API_BASE}/api/repairs/${id}`, { method: "DELETE", credentials: "include" });
    router.push("/repairs");
  };

  const addWork = () => {
    update("works", [...repair.works, { workName: "", cost: "0" }]);
  };

  const addPart = () => {
    update("parts", [...repair.parts, { partName: "", qty: "1", unitPrice: "0", totalPrice: "0" }]);
  };

  const addExpense = () => {
    update("expenses", [...repair.expenses, { name: "", cost: "0" }]);
  };

  const uploadAttachment = async (file: File) => {
    if (!id) {
      alert("Сначала сохраните ремонт.");
      return;
    }
    const form = new FormData();
    form.append("file", file);
    form.append("fileType", "ORDER");
    const res = await fetch(`${API_BASE}/api/repairs/${id}/attachments`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (res.ok) {
      const attachment = await res.json();
      update("attachments", [...(repair.attachments ?? []), attachment]);
    }
  };

  const deleteAttachment = async (attachmentId: string) => {
    if (!window.confirm("Удалить документ?")) return;
    await fetch(`${API_BASE}/api/attachments/${attachmentId}`, { method: "DELETE", credentials: "include" });
    update("attachments", (repair.attachments ?? []).filter((item: any) => item.id !== attachmentId));
  };

  const fillOdometer = async () => {
    if (!repair.vehicleId) return;
    const res = await fetch(`${API_BASE}/api/vehicles/${repair.vehicleId}/odometer`, { credentials: "include" });
    const data = await res.json();
    if (data?.lastKnown) {
      update("odometerKm", data.lastKnown.toString());
    }
  };

  if (loading) return <p>Загрузка...</p>;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <Link className={styles.button} href="/repairs">Назад</Link>
        <button className={styles.button} onClick={() => save()} disabled={saving}>
          Сохранить
        </button>
        <button className={styles.button} onClick={() => save("DONE")} disabled={saving}>
          Завершить
        </button>
        {id && (
          <button className={styles.button} style={{ background: "#fdd", color: "#900" }} onClick={remove}>
            Удалить
          </button>
        )}
        <button className={styles.button} onClick={() => window.print()}>
          Печать
        </button>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        <section style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e9e9f2" }}>
          <h3 style={{ marginTop: 0 }}>Основное</h3>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            <select value={repair.vehicleId} onChange={(e) => update("vehicleId", e.target.value)}>
              <option value="">Выберите авто</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plateNumber}
                </option>
              ))}
            </select>
            <select value={repair.eventType} onChange={(e) => update("eventType", e.target.value)}>
              <option value="MAINTENANCE">ТО</option>
              <option value="REPAIR">Ремонт</option>
            </select>
            <select value={repair.status} onChange={(e) => update("status", e.target.value)}>
              <option value="DRAFT">Черновик</option>
              <option value="IN_PROGRESS">В работе</option>
              <option value="DONE">Завершён</option>
              <option value="CANCELLED">Отменён</option>
            </select>
            <input type="date" value={repair.startedAt} onChange={(e) => update("startedAt", e.target.value)} />
            <input type="date" value={repair.finishedAt ?? ""} onChange={(e) => update("finishedAt", e.target.value)} />
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={repair.odometerKm}
                onChange={(e) => update("odometerKm", e.target.value)}
                placeholder="Пробег"
              />
              <button className={styles.button} type="button" onClick={fillOdometer}>
                Подставить
              </button>
            </div>
            <select value={repair.categoryCode} onChange={(e) => update("categoryCode", e.target.value)}>
              {Object.entries(CATEGORY_LABELS).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
            <input
              value={repair.subsystemCode ?? ""}
              onChange={(e) => update("subsystemCode", e.target.value)}
              placeholder="Подсистема"
            />
            <input
              value={repair.serviceName ?? ""}
              onChange={(e) => update("serviceName", e.target.value)}
              placeholder="Сервис"
            />
            <select value={repair.paymentStatus} onChange={(e) => update("paymentStatus", e.target.value)}>
              <option value="UNPAID">Не оплачено</option>
              <option value="PAID">Оплачено</option>
            </select>
          </div>
        </section>

        <section style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e9e9f2" }}>
          <h3 style={{ marginTop: 0 }}>Описание</h3>
          <textarea
            value={repair.symptomsText}
            onChange={(e) => update("symptomsText", e.target.value)}
            placeholder="Симптомы"
            style={{ width: "100%", minHeight: 80 }}
          />
          <textarea
            value={repair.findingsText ?? ""}
            onChange={(e) => update("findingsText", e.target.value)}
            placeholder="Диагноз"
            style={{ width: "100%", minHeight: 80, marginTop: 8 }}
          />
        </section>

        <section style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e9e9f2" }}>
          <h3 style={{ marginTop: 0 }}>Работы</h3>
          {repair.works.map((work, index) => (
            <div key={index} style={{ display: "grid", gap: 8, gridTemplateColumns: "2fr 1fr auto", marginBottom: 8 }}>
              <input
                value={work.workName}
                onChange={(e) => {
                  const updated = [...repair.works];
                  updated[index].workName = e.target.value;
                  update("works", updated);
                }}
                placeholder="Работа"
              />
              <input
                value={work.cost}
                onChange={(e) => {
                  const updated = [...repair.works];
                  updated[index].cost = e.target.value;
                  update("works", updated);
                }}
                placeholder="Стоимость"
              />
              <button
                className={styles.button}
                onClick={() => update("works", repair.works.filter((_, idx) => idx !== index))}
              >
                Удалить
              </button>
            </div>
          ))}
          <button className={styles.button} onClick={addWork}>
            + Добавить работу
          </button>
        </section>

        <section style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e9e9f2" }}>
          <h3 style={{ marginTop: 0 }}>Запчасти</h3>
          {repair.parts.map((part, index) => (
            <div key={index} style={{ display: "grid", gap: 8, gridTemplateColumns: "2fr 1fr 1fr auto", marginBottom: 8 }}>
              <input
                value={part.partName}
                onChange={(e) => {
                  const updated = [...repair.parts];
                  updated[index].partName = e.target.value;
                  update("parts", updated);
                }}
                placeholder="Запчасть"
              />
              <input
                value={part.qty}
                onChange={(e) => {
                  const updated = [...repair.parts];
                  updated[index].qty = e.target.value;
                  update("parts", updated);
                }}
                placeholder="Кол-во"
              />
              <input
                value={part.unitPrice}
                onChange={(e) => {
                  const updated = [...repair.parts];
                  updated[index].unitPrice = e.target.value;
                  update("parts", updated);
                }}
                placeholder="Цена"
              />
              <button
                className={styles.button}
                onClick={() => update("parts", repair.parts.filter((_, idx) => idx !== index))}
              >
                Удалить
              </button>
            </div>
          ))}
          <button className={styles.button} onClick={addPart}>
            + Добавить запчасть
          </button>
        </section>

        <section style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e9e9f2" }}>
          <h3 style={{ marginTop: 0 }}>Прочие расходы</h3>
          {repair.expenses.map((expense, index) => (
            <div key={index} style={{ display: "grid", gap: 8, gridTemplateColumns: "2fr 1fr auto", marginBottom: 8 }}>
              <input
                value={expense.name}
                onChange={(e) => {
                  const updated = [...repair.expenses];
                  updated[index].name = e.target.value;
                  update("expenses", updated);
                }}
                placeholder="Расход"
              />
              <input
                value={expense.cost}
                onChange={(e) => {
                  const updated = [...repair.expenses];
                  updated[index].cost = e.target.value;
                  update("expenses", updated);
                }}
                placeholder="Сумма"
              />
              <button
                className={styles.button}
                onClick={() => update("expenses", repair.expenses.filter((_, idx) => idx !== index))}
              >
                Удалить
              </button>
            </div>
          ))}
          <button className={styles.button} onClick={addExpense}>
            + Добавить расход
          </button>
        </section>

        <section style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e9e9f2" }}>
          <h3 style={{ marginTop: 0 }}>Итоги</h3>
          <div>Работы: {totals.workTotal.toFixed(2)} ₽</div>
          <div>Запчасти: {totals.partsTotal.toFixed(2)} ₽</div>
          <div>Прочее: {totals.otherTotal.toFixed(2)} ₽</div>
          <div style={{ fontWeight: 700 }}>Итого: {totals.total.toFixed(2)} ₽</div>
        </section>

        <section style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e9e9f2" }}>
          <h3 style={{ marginTop: 0 }}>Документы</h3>
          <input
            type="file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadAttachment(file);
            }}
          />
          <ul>
            {(repair.attachments ?? []).map((attachment: any) => (
              <li key={attachment.id}>
                <a href={`${API_BASE}/api/attachments/${attachment.id}/file`} target="_blank" rel="noreferrer">
                  {attachment.fileName}
                </a>
                <button className={styles.button} style={{ marginLeft: 8 }} onClick={() => deleteAttachment(attachment.id)}>
                  Удалить
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e9e9f2" }}>
          <h3 style={{ marginTop: 0 }}>ИИ (V2)</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <button className={styles.button} disabled>
              🎤 Голосовой ввод (скоро)
            </button>
            <button className={styles.button} disabled>
              📄 Распознать заказ-наряд (скоро)
            </button>
          </div>
          <div style={{ marginTop: 8, opacity: 0.7 }}>Статус: {repair.aiParseStatus ?? "NONE"}</div>
        </section>
      </div>
    </div>
  );
}
