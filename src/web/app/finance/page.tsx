"use client";

import React from "react";
import styles from "../page.module.css";

type FinanceData = {
  source: string;
  filename?: string;
  updatedAt?: string;
  columns: string[];
  rows: string[][];
  error?: string;
};

const API_BASE = "";

function parseFinanceDate(value: string) {
  const match = value.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return null;
  const date = new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function parseInputDate(value: string) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toLocalDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toCSVTable(columns: string[], rows: string[][]) {
  const header = columns.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";");
  const body = rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
        .join(";")
    )
    .join("\n");
  return header + "\n" + body;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toExcelTable(columns: string[], rows: string[][]) {
  const header = `<tr>${columns
    .map(
      (c) =>
        `<th style="border:1px solid #e5e7eb;padding:6px 8px;text-align:center;background:#eef2ff;">${escapeHtml(
          String(c)
        )}</th>`
    )
    .join("")}</tr>`;
  const body = rows
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell) =>
              `<td style="border:1px solid #e5e7eb;padding:6px 8px;text-align:center;">${escapeHtml(
                String(cell ?? "")
              )}</td>`
          )
          .join("")}</tr>`
    )
    .join("");
  return `<html><head><meta charset="UTF-8"></head><body><table style="border-collapse:collapse;">${header}${body}</table></body></html>`;
}

function formatTotalNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function buildFinanceOptions(
  data: FinanceData,
  routeMapByDate: Record<string, string>,
  routeMap?: Record<string, string>
) {
  const rows = data.rows || [];
  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => String(cell).toLowerCase().includes("№ марш"))
  );
  const headerRow = headerIndex >= 0 ? rows[headerIndex] : data.columns || [];
  const columnDefs = headerRow
    .map((name, index) => ({ name: String(name || "").trim(), index }))
    .filter(
      (col) =>
        col.name &&
        col.name !== "Таб №" &&
        !col.name.toLowerCase().startsWith("unnamed")
    );
  const routeNumberIdx =
    columnDefs.find((col) => col.name === "№ марш.")?.index ??
    columnDefs.find((col) => {
      const n = col.name.toLowerCase();
      return n.includes("марш") && !n.includes("ездк");
    })?.index;
  const routeDateIdx = columnDefs.find((col) => col.name === "Дата марш.")?.index;
  const vehicleIdx = columnDefs.find((col) => col.name.toLowerCase().includes("гар"))?.index;
  const driverIdx = columnDefs.find((col) => col.name.toLowerCase().includes("водител"))?.index;

  const routeSet = new Set<string>();
  const vehicleSet = new Set<string>();
  const driverSet = new Set<string>();

  const dataRows = rows.filter((_, idx) => idx !== headerIndex);
  for (const row of dataRows) {
    // Filter out rows that are headers, metadata, or garbage
    const rowStr = row.map((c) => String(c).toLowerCase()).join(" ");
    if (
      rowStr.includes("№ марш") ||
      rowStr.includes("тариф основной") ||
      rowStr.includes("транспортная орг") ||
      rowStr.includes("период") ||
      rowStr.includes("unnamed") ||
      rowStr.includes("итого") ||
      rowStr.includes("рублей") ||
      rowStr.includes("спецмаршруты")
    ) {
      continue;
    }

    if (vehicleIdx !== undefined) {
      const v = String(row[vehicleIdx] || "").trim();
      if (v && !v.toLowerCase().includes("гаражный номер") && v.length < 50) vehicleSet.add(v);
    }
    if (driverIdx !== undefined) {
      const d = String(row[driverIdx] || "").trim();
      if (d && !d.toLowerCase().includes("водитель") && !d.toLowerCase().includes("фио") && d.length < 100) driverSet.add(d);
    }
    if (routeNumberIdx !== undefined) {
      const routeValue = String(row[routeNumberIdx] || "");
      if (routeValue.toLowerCase().includes("марш")) continue;
      
      const trimmedRoute = routeValue.split("|")[0].trim();
      const match = trimmedRoute.match(/\d+/);
      const routeNumber = match ? match[0] : "";
      const rawDate = routeDateIdx !== undefined ? String(row[routeDateIdx] || "").trim() : "";
      const date = parseFinanceDate(rawDate);
      const dateKey = date ? toLocalDateKey(date) : "";
      const byDateKey = routeNumber && dateKey ? `${routeNumber}|${dateKey}` : "";
      const name = byDateKey && routeMapByDate[byDateKey] ? routeMapByDate[byDateKey] : "";
      const fallbackName = !name && routeNumber && routeMap ? routeMap[routeNumber] : "";
      const routeLabel = name || fallbackName;
      if (routeLabel) routeSet.add(routeLabel);
    }
  }

  return {
    ROUTE: Array.from(routeSet).sort((a, b) => a.localeCompare(b)),
    DRIVER: Array.from(driverSet).sort((a, b) => a.localeCompare(b)),
    VEHICLE: Array.from(vehicleSet).sort((a, b) => a.localeCompare(b)),
  };
}

function normalizeKey(val: string) {
  // Remove whitespace/punctuation, replace ё -> е, remove leading zeros (e.g. 0304 -> 304)
  return String(val || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]/gi, "")
    .replace(/^0+/, "");
}

function normalizeDriverKey(val: string) {
  const base = normalizeKey(val);
  const firstToken = String(val || "").trim().split(/\s+/)[0] || "";
  const surname = normalizeKey(firstToken);
  return { base, surname };
}

function normalizeVehicleKey(val: string) {
  const base = normalizeKey(val);
  const match = String(val || "").match(/\d+/);
  const digits = match ? match[0].replace(/^0+/, "") : "";
  return { base, digits };
}

function resolveDriverIp(raw: string, ipRecords: Array<{ id: string; name: string; drivers: string[] }>) {
  const keys = normalizeDriverKey(raw);
  for (const ip of ipRecords) {
    for (const d of ip.drivers) {
      const candidate = normalizeDriverKey(d);
      const baseMatch = keys.base && candidate.base && keys.base === candidate.base;
      const surnameMatch =
        keys.surname &&
        candidate.surname &&
        (keys.surname === candidate.surname ||
          candidate.base.includes(keys.surname) ||
          keys.base.includes(candidate.surname));
      if (baseMatch || surnameMatch) return ip.name;
    }
  }
  return undefined;
}

function resolveVehicleIp(raw: string, ipRecords: Array<{ id: string; name: string; vehicles: string[] }>) {
  const keys = normalizeVehicleKey(raw);
  for (const ip of ipRecords) {
    for (const v of ip.vehicles) {
      const candidate = normalizeVehicleKey(v);
      const digitsMatch =
        keys.digits && candidate.digits && keys.digits === candidate.digits;
      const baseMatch =
        keys.base && candidate.base && (keys.base === candidate.base || keys.base.includes(candidate.base) || candidate.base.includes(keys.base));
      if (digitsMatch || baseMatch) return ip.name;
    }
  }
  return undefined;
}

export default function FinancePage() {
  const [activeTab, setActiveTab] = React.useState<"afina" | "nika">("afina");
  const [subTab, setSubTab] = React.useState<"reports" | "analytics" | "ip" | "docs" | "cards">("reports");
  const [data, setData] = React.useState<FinanceData | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [refreshNote, setRefreshNote] = React.useState<string | null>(null);
  const [routeMap, setRouteMap] = React.useState<Record<string, string>>({});
  const [routeMapByDate, setRouteMapByDate] = React.useState<Record<string, string>>({});
  const [activePeriod, setActivePeriod] = React.useState<string | null>(null);
  const [analyticsSources, setAnalyticsSources] = React.useState<{ afina?: FinanceData; nika?: FinanceData }>({});
  const [filters, setFilters] = React.useState<Record<string, string[]>>({});
  const [dateRange, setDateRange] = React.useState<{ from: string; to: string }>({ from: "", to: "" });
  const [sort, setSort] = React.useState<{ key: string | null; dir: "asc" | "desc" | null }>({
    key: null,
    dir: null,
  });
  const [activeFilter, setActiveFilter] = React.useState<string | null>(null);
  const [lists, setLists] = React.useState<Array<{ id: string; name: string; type: "ROUTE" | "DRIVER" | "VEHICLE"; items: string[] }>>([]);
  const [selectedList, setSelectedList] = React.useState<{ route?: string; driver?: string; vehicle?: string }>({});
  const [newListName, setNewListName] = React.useState("");
  const [newListType, setNewListType] = React.useState<"ROUTE" | "DRIVER" | "VEHICLE">("ROUTE");
  const [editingListId, setEditingListId] = React.useState<string | null>(null);
  const [editingListName, setEditingListName] = React.useState("");
  const [ipRecords, setIpRecords] = React.useState<
    Array<{ id: string; name: string; drivers: string[]; vehicles: string[]; routes: string[] }>
  >([]);
  const [newIpName, setNewIpName] = React.useState("");
  const [editingIpId, setEditingIpId] = React.useState<string | null>(null);
  const [ipDrafts, setIpDrafts] = React.useState<Record<string, { drivers: string[]; vehicles: string[]; routes: string[] }>>({});
  const [ipOptions, setIpOptions] = React.useState<{ ROUTE: string[]; DRIVER: string[]; VEHICLE: string[] }>({
    ROUTE: [],
    DRIVER: [],
    VEHICLE: [],
  });
  const [exportIps, setExportIps] = React.useState<string[]>([]);
  const [exportMode, setExportMode] = React.useState<"DRIVER" | "VEHICLE" | "ROUTE" | "ALL">("ALL");
  const [routeView, setRouteView] = React.useState<"main" | "special">("main");
  const [analyticsDate, setAnalyticsDate] = React.useState<{ from: string; to: string }>({ from: "", to: "" });
  const [analyticsRouteListId, setAnalyticsRouteListId] = React.useState("");
  const [analyticsRoute, setAnalyticsRoute] = React.useState("");
  const [analyticsView, setAnalyticsView] = React.useState<"general" | "ip">("general");
  const [rentalLessor, setRentalLessor] = React.useState("");
  const [rentalVehicle, setRentalVehicle] = React.useState("");
  const [rentalLessee, setRentalLessee] = React.useState("");
  const [employmentIpId, setEmploymentIpId] = React.useState("");
  const [employmentDriver, setEmploymentDriver] = React.useState("");
  const [driverCards, setDriverCards] = React.useState<
    Array<{
      id: string;
      name: string;
      passport: { series: string; number: string; issuedBy: string; issuedAt: string; code: string; address: string };
      license: { series: string; number: string; issuedBy: string; issuedAt: string; categories: string };
      patent: { number: string; issuedAt: string; validTo: string };
      medbook: { number: string; issuedAt: string; validTo: string };
    }>
  >([]);
  const [vehicleCards, setVehicleCards] = React.useState<
    Array<{
      id: string;
      name: string;
      sts: { number: string; issuedAt: string; issuedBy: string; vin: string; regNumber: string };
      pts: { number: string; issuedAt: string; issuedBy: string; vin: string; regNumber: string };
    }>
  >([]);
  const [ipCards, setIpCards] = React.useState<
    Array<{
      id: string;
      ipId: string;
      ipName: string;
      ip: { inn: string; ogrnip: string; address: string; phone: string; email: string };
      bank: { account: string; bankName: string; bik: string; corrAccount: string };
    }>
  >([]);
  const [newDriverCard, setNewDriverCard] = React.useState("");
  const [newVehicleCard, setNewVehicleCard] = React.useState("");
  const [newIpCardId, setNewIpCardId] = React.useState("");
  const [driverModalId, setDriverModalId] = React.useState<string | null>(null);
  const [vehicleModalId, setVehicleModalId] = React.useState<string | null>(null);
  const [ipModalId, setIpModalId] = React.useState<string | null>(null);

  const loadData = React.useCallback(async (source: "afina" | "nika") => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/finance?source=${source}`, { credentials: "include" });
      const text = await res.text();
      let json: any = {};
      try {
        json = JSON.parse(text);
      } catch {
        json = { error: text };
      }
      if (!res.ok) {
        setError(json?.error || "Не удалось загрузить данные");
        setData(null);
      } else {
        setData(json as FinanceData);
        setAnalyticsSources((prev) => ({ ...prev, [source]: json as FinanceData }));
      }
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить данные");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadData(activeTab);
  }, [activeTab, loadData]);

  React.useEffect(() => {
    let cancelled = false;
    const fetchSource = async (source: "afina" | "nika") => {
      try {
        const res = await fetch(`${API_BASE}/api/finance?source=${source}`, { credentials: "include" });
        const text = await res.text();
        if (!res.ok) return;
        const json = JSON.parse(text) as FinanceData;
        if (!cancelled) {
          setAnalyticsSources((prev) => ({ ...prev, [source]: json }));
        }
      } catch {
        // ignore
      }
    };
    fetchSource("afina");
    fetchSource("nika");
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (subTab !== "analytics") return;
    if (!analyticsSources.afina) {
      fetch(`${API_BASE}/api/finance?source=afina`, { credentials: "include" })
        .then((res) => res.text().then((text) => ({ res, text })))
        .then(({ res, text }) => {
          if (!res.ok) return;
          const json = JSON.parse(text) as FinanceData;
          setAnalyticsSources((prev) => ({ ...prev, afina: json }));
        })
        .catch(() => {});
    }
    if (!analyticsSources.nika) {
      fetch(`${API_BASE}/api/finance?source=nika`, { credentials: "include" })
        .then((res) => res.text().then((text) => ({ res, text })))
        .then(({ res, text }) => {
          if (!res.ok) return;
          const json = JSON.parse(text) as FinanceData;
          setAnalyticsSources((prev) => ({ ...prev, nika: json }));
        })
        .catch(() => {});
    }
  }, [subTab, analyticsSources.afina, analyticsSources.nika]);

  React.useEffect(() => {
    fetch("/api/shifts/routes", { credentials: "include" })
      .then((res) => res.json())
      .then((json) => {
        if (!json || typeof json !== "object") return;
        const map: Record<string, string> = {};
        const items = Array.isArray(json.items) ? json.items : [];
        for (const item of items) {
          const routeNumber = String(item?.routeNumber || "").trim();
          const routeName = String(item?.routeName || "").trim();
          if (!routeNumber || !routeName) continue;
          const keys = [routeNumber, routeNumber.replace(/\s+/g, " ")];
          const firstPart = routeNumber.split("|")[0]?.trim();
          if (firstPart) keys.push(firstPart);
          const match = routeNumber.match(/\d+/);
          if (match) keys.push(match[0]);
          for (const key of keys) {
            if (key && !(key in map)) map[key] = routeName;
          }
        }
        const apiMap =
          json.mapNormalized && typeof json.mapNormalized === "object"
            ? (json.mapNormalized as Record<string, string>)
            : json.map && typeof json.map === "object"
            ? (json.map as Record<string, string>)
            : null;
        if (apiMap) {
          for (const [k, v] of Object.entries(apiMap)) {
            if (k && v && !(k in map)) map[k] = v;
          }
        }
        setRouteMap(map);
        if (json.mapByDate && typeof json.mapByDate === "object") {
          setRouteMapByDate(json.mapByDate as Record<string, string>);
        } else {
          setRouteMapByDate({});
        }
      })
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem("financeLists");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setLists(parsed);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem("financeLists", JSON.stringify(lists));
    } catch {
      // ignore
    }
  }, [lists]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem("financeIpRecords");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setIpRecords(parsed);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem("financeIpRecords", JSON.stringify(ipRecords));
    } catch {
      // ignore
    }
  }, [ipRecords]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem("financeCards");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          if (Array.isArray(parsed.driverCards)) {
            const hydrated = parsed.driverCards.map((card: any) => ({
              id: String(card?.id || crypto.randomUUID()),
              name: String(card?.name || ""),
              passport: {
                series: String(card?.passport?.series || ""),
                number: String(card?.passport?.number || ""),
                issuedBy: String(card?.passport?.issuedBy || ""),
                issuedAt: String(card?.passport?.issuedAt || ""),
                code: String(card?.passport?.code || ""),
                address: String(card?.passport?.address || ""),
              },
              license: {
                series: String(card?.license?.series || ""),
                number: String(card?.license?.number || ""),
                issuedBy: String(card?.license?.issuedBy || ""),
                issuedAt: String(card?.license?.issuedAt || ""),
                categories: String(card?.license?.categories || ""),
              },
              patent: {
                number: String(card?.patent?.number || ""),
                issuedAt: String(card?.patent?.issuedAt || ""),
                validTo: String(card?.patent?.validTo || ""),
              },
              medbook: {
                number: String(card?.medbook?.number || ""),
                issuedAt: String(card?.medbook?.issuedAt || ""),
                validTo: String(card?.medbook?.validTo || ""),
              },
            }));
            setDriverCards(hydrated);
          }
          if (Array.isArray(parsed.vehicleCards)) {
            const hydrated = parsed.vehicleCards.map((card: any) => ({
              id: String(card?.id || crypto.randomUUID()),
              name: String(card?.name || ""),
              sts: {
                number: String(card?.sts?.number || ""),
                issuedAt: String(card?.sts?.issuedAt || ""),
                issuedBy: String(card?.sts?.issuedBy || ""),
                vin: String(card?.sts?.vin || ""),
                regNumber: String(card?.sts?.regNumber || ""),
              },
              pts: {
                number: String(card?.pts?.number || ""),
                issuedAt: String(card?.pts?.issuedAt || ""),
                issuedBy: String(card?.pts?.issuedBy || ""),
                vin: String(card?.pts?.vin || ""),
                regNumber: String(card?.pts?.regNumber || ""),
              },
            }));
            setVehicleCards(hydrated);
          }
          if (Array.isArray(parsed.ipCards)) {
            const hydrated = parsed.ipCards.map((card: any) => ({
              id: String(card?.id || crypto.randomUUID()),
              ipId: String(card?.ipId || ""),
              ipName: String(card?.ipName || ""),
              ip: {
                inn: String(card?.ip?.inn || ""),
                ogrnip: String(card?.ip?.ogrnip || ""),
                address: String(card?.ip?.address || ""),
                phone: String(card?.ip?.phone || ""),
                email: String(card?.ip?.email || ""),
              },
              bank: {
                account: String(card?.bank?.account || ""),
                bankName: String(card?.bank?.bankName || ""),
                bik: String(card?.bank?.bik || ""),
                corrAccount: String(card?.bank?.corrAccount || ""),
              },
            }));
            setIpCards(hydrated);
          }
        }
      }
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(
        "financeCards",
        JSON.stringify({ driverCards, vehicleCards, ipCards })
      );
    } catch {
      // ignore
    }
  }, [driverCards, vehicleCards, ipCards]);

  React.useEffect(() => {
    const loadIpOptions = async () => {
      try {
        const [afinaRes, nikaRes] = await Promise.all([
          fetch("/api/finance?source=afina", { credentials: "include" }),
          fetch("/api/finance?source=nika", { credentials: "include" }),
        ]);
        const afinaText = await afinaRes.text();
        const nikaText = await nikaRes.text();
        const afinaData = afinaRes.ok ? (JSON.parse(afinaText) as FinanceData) : null;
        const nikaData = nikaRes.ok ? (JSON.parse(nikaText) as FinanceData) : null;
        const sets = { ROUTE: new Set<string>(), DRIVER: new Set<string>(), VEHICLE: new Set<string>() };
        if (afinaData) {
          const opts = buildFinanceOptions(afinaData, routeMapByDate, routeMap);
          opts.ROUTE.forEach((v) => sets.ROUTE.add(v));
          opts.DRIVER.forEach((v) => sets.DRIVER.add(v));
          opts.VEHICLE.forEach((v) => sets.VEHICLE.add(v));
        }
        if (nikaData) {
          const opts = buildFinanceOptions(nikaData, routeMapByDate, routeMap);
          opts.ROUTE.forEach((v) => sets.ROUTE.add(v));
          opts.DRIVER.forEach((v) => sets.DRIVER.add(v));
          opts.VEHICLE.forEach((v) => sets.VEHICLE.add(v));
        }
        setIpOptions({
          ROUTE: Array.from(sets.ROUTE).sort((a, b) => a.localeCompare(b)),
          DRIVER: Array.from(sets.DRIVER).sort((a, b) => a.localeCompare(b)),
          VEHICLE: Array.from(sets.VEHICLE).sort((a, b) => a.localeCompare(b)),
        });
      } catch {
        // ignore
      }
    };
    if (Object.keys(routeMapByDate).length > 0) {
      loadIpOptions();
    }
  }, [routeMapByDate, routeMap]);

  const requestRefresh = React.useCallback(async () => {
    setRefreshing(true);
    setRefreshNote(null);
    try {
      const res = await fetch(`/api/finance/refresh?source=${activeTab}`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        setRefreshNote(text || "Не удалось запустить обновление");
      } else {
        setRefreshNote("Обновление запрошено. Обновите страницу через минуту.");
      }
    } catch (e: any) {
      setRefreshNote(e?.message || "Не удалось запустить обновление");
    } finally {
      setRefreshing(false);
    }
  }, [activeTab]);

  const parsed = React.useMemo(() => {
    const rows = data?.rows ?? [];
    const orgRow = rows.find((row) =>
      row.some((cell) => String(cell).toLowerCase().includes("транспортная орг"))
    );
    const organization = orgRow
      ? String(orgRow.find((cell) => String(cell).toLowerCase().includes("транспортная орг")) || "")
          .replace(/\s+/g, " ")
          .trim()
      : null;
    const periodRows = rows
      .map((row, index) => {
        const cell = row.find((c) => String(c).toLowerCase().includes("период"));
        return cell ? { index, value: String(cell).replace(/\s+/g, " ").trim() } : null;
      })
      .filter(Boolean) as { index: number; value: string }[];
    const periods = periodRows.map((p) => p.value);
    const uniquePeriods: string[] = [];
    for (const p of periods) {
      if (!uniquePeriods.includes(p)) uniquePeriods.push(p);
    }
    const parsePeriodEnd = (value: string) => {
      const match = value.match(/по\s+(\d{2})\.(\d{2})\.(\d{4})/i);
      if (!match) return 0;
      const date = new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00`);
      return Number.isNaN(date.getTime()) ? 0 : date.getTime();
    };
    const displayPeriods = [...uniquePeriods].sort((a, b) => parsePeriodEnd(b) - parsePeriodEnd(a));
    const selectedPeriod = activePeriod && displayPeriods.includes(activePeriod) ? activePeriod : displayPeriods[0] || null;
    let visibleRows = rows;
    if (periodRows.length > 0 && selectedPeriod) {
      const currentIndex = periodRows.find((p) => p.value === selectedPeriod)?.index ?? periodRows[0].index;
      const nextIndex =
        periodRows.find((p) => p.index > currentIndex && p.value !== selectedPeriod)?.index ?? rows.length;
      visibleRows = rows.slice(currentIndex + 1, nextIndex);
    }
    visibleRows = visibleRows.filter((row) => {
      const normalized = row.map((cell) => String(cell || "").replace(/\s+/g, " ").trim().toLowerCase());
      if (normalized.every((cell) => !cell)) return false;
      if (normalized.some((cell) => cell.includes("транспортная орг"))) return false;
      if (normalized.some((cell) => cell.includes("период"))) return false;
      if (normalized.some((cell) => cell.includes("тариф основной"))) return false;
      return true;
    });
    return { organization, periods: displayPeriods, selectedPeriod, visibleRows };
  }, [data, activePeriod]);

  React.useEffect(() => {
    if (parsed.selectedPeriod && parsed.selectedPeriod !== activePeriod) {
      setActivePeriod(parsed.selectedPeriod);
    }
    if (!parsed.selectedPeriod && activePeriod) {
      setActivePeriod(null);
    }
  }, [parsed.selectedPeriod, activePeriod]);

  const usedItems = React.useMemo(() => {
    const drivers = new Map<string, string>();
    const vehicles = new Map<string, string>();

    const addKey = (map: Map<string, string>, key: string, ipName: string) => {
      if (!key) return;
      if (!map.has(key)) map.set(key, ipName);
    };

    for (const ip of ipRecords) {
      for (const d of ip.drivers) {
        const { base, surname } = normalizeDriverKey(d);
        addKey(drivers, base, ip.name);
        addKey(drivers, surname, ip.name);
      }
      for (const v of ip.vehicles) {
        const { base, digits } = normalizeVehicleKey(v);
        addKey(vehicles, base, ip.name);
        addKey(vehicles, digits, ip.name);
      }
    }
    return { drivers, vehicles };
  }, [ipRecords]);

  const driverCardCompleteness = React.useMemo(() => {
    const map = new Map<string, boolean>();
    const isFilled = (v: string) => Boolean(String(v || "").trim());
    for (const card of driverCards) {
      const complete =
        isFilled(card.passport.series) &&
        isFilled(card.passport.number) &&
        isFilled(card.passport.issuedBy) &&
        isFilled(card.passport.issuedAt) &&
        isFilled(card.passport.code) &&
        isFilled(card.passport.address) &&
        isFilled(card.license.series) &&
        isFilled(card.license.number) &&
        isFilled(card.license.issuedBy) &&
        isFilled(card.license.issuedAt) &&
        isFilled(card.license.categories) &&
        isFilled(card.patent.number) &&
        isFilled(card.patent.issuedAt) &&
        isFilled(card.patent.validTo) &&
        isFilled(card.medbook.number) &&
        isFilled(card.medbook.issuedAt) &&
        isFilled(card.medbook.validTo);
      map.set(normalizeKey(card.name), complete);
    }
    return map;
  }, [driverCards]);

  const vehicleCardCompleteness = React.useMemo(() => {
    const map = new Map<string, boolean>();
    const isFilled = (v: string) => Boolean(String(v || "").trim());
    for (const card of vehicleCards) {
      const complete =
        isFilled(card.sts.number) &&
        isFilled(card.sts.issuedAt) &&
        isFilled(card.sts.issuedBy) &&
        isFilled(card.sts.vin) &&
        isFilled(card.sts.regNumber) &&
        isFilled(card.pts.number) &&
        isFilled(card.pts.issuedAt) &&
        isFilled(card.pts.issuedBy) &&
        isFilled(card.pts.vin) &&
        isFilled(card.pts.regNumber);
      map.set(normalizeKey(card.name), complete);
    }
    return map;
  }, [vehicleCards]);

  const tableMeta = React.useMemo(() => {
    const allRows = parsed.visibleRows || [];
    const headerIndices: number[] = [];
    for (let i = 0; i < allRows.length; i++) {
      const str = allRows[i].map((c) => String(c).toLowerCase()).join(" ");
      if (str.includes("№ марш")) headerIndices.push(i);
    }
    const findHeaderIndex = (kind: "main" | "special") => {
      for (const idx of headerIndices) {
        const str = allRows[idx].map((c) => String(c).toLowerCase()).join(" ");
        const isSpecial = str.includes("спец/м");
        if (kind === "special" && isSpecial) return idx;
        if (kind === "main" && !isSpecial) return idx;
      }
      return -1;
    };
    const headerIndex = findHeaderIndex(routeView);
    const headerRow = headerIndex >= 0 ? allRows[headerIndex] : data?.columns || [];

    const columnDefs = headerRow
      .map((name, index) => ({ name: String(name || "").trim(), index }))
      .filter(
        (col) =>
          col.name &&
          col.name !== "Таб №" &&
          !col.name.toLowerCase().startsWith("unnamed")
      );
    const routeNumberIdx = columnDefs.find((col) => col.name === "№ марш." || col.name.toLowerCase().includes("маршрут"))?.index;
    const routeDateIdx = columnDefs.find((col) => col.name === "Дата марш." || col.name.toLowerCase().includes("дата"))?.index;
    const driverIdx =
      columnDefs.find((col) => col.name.trim().toLowerCase() === "фио водителя")?.index ??
      columnDefs.find((col) => {
        const n = col.name.toLowerCase();
        return n.includes("водит") || n.includes("фио") || n.includes("фамилия");
      })?.index;
    const vehicleIdx =
      columnDefs.find((col) => col.name.trim().toLowerCase() === "гар. №")?.index ??
      columnDefs.find((col) => {
        const n = col.name.toLowerCase();
        return n.includes("гар") || n.includes("гос") || n.includes("авто") || n.includes("номер машины");
      })?.index;
    
    let baseRows = allRows;
    if (headerIndex >= 0) {
      const nextHeader = headerIndices.find((idx) => idx > headerIndex) ?? allRows.length;
      baseRows = allRows.slice(headerIndex + 1, nextHeader);
    }

    const numericKeyMap = new Map<number, string>();
    for (const col of columnDefs) {
      const name = col.name.toLowerCase();
      if (name.includes("стоимость продукции")) numericKeyMap.set(col.index, "cost_products");
      if (name.includes("вес нетто")) numericKeyMap.set(col.index, "weight_net");
      if (name.includes("кол. заезд") || name.includes("количество заезд")) numericKeyMap.set(col.index, "trips_count");
      if (name.includes("пробег")) numericKeyMap.set(col.index, "mileage");
      if (name.includes("стоимость маршрута")) numericKeyMap.set(col.index, "route_cost");
      if (name.includes("доплата по маршруту")) numericKeyMap.set(col.index, "route_bonus");
    }

    const displayColumns: { key: string; label: string; sourceIndex?: number; isRouteName?: boolean; hidden?: boolean }[] = [];
    for (const col of columnDefs) {
      displayColumns.push({ key: `col-${col.index}`, label: col.name, sourceIndex: col.index });
      if (routeNumberIdx !== undefined && col.index === routeNumberIdx) {
        displayColumns.push({ key: "route-name", label: "Название маршрута", isRouteName: true });
      }
      if (vehicleIdx !== undefined && col.index === vehicleIdx) {
        displayColumns.push({ key: "vehicle-ip", label: "ИП авто", hidden: true });
      }
      if (driverIdx !== undefined && col.index === driverIdx) {
        displayColumns.push({ key: "driver-ip", label: "ИП водителя", hidden: true });
      }
    }
    let totalsFromFile: Record<string, number> = {};
    const isTotalsRow = (row: string[]) => {
      let numericCells = 0;
      let textCells = 0;
      numericKeyMap.forEach((key, idx) => {
        const raw = String(row[idx] ?? "").trim();
        if (!raw) return;
        const normalized = raw.replace(/\s+/g, "").replace(",", ".");
        const num = Number(normalized);
        if (!Number.isNaN(num)) numericCells += 1;
        else textCells += 1;
      });
      const hasOtherText = row.some((cell, idx) => {
        if (numericKeyMap.has(idx)) return false;
        const v = String(cell ?? "").trim();
        const low = v.toLowerCase();
        // Allow "итого" or small descriptive text in the totals row itself
        if (low.includes("итого") || low.includes("рублей")) return false;
        return v.length > 0;
      });
      return numericCells > 0 && !hasOtherText;
    };

    if (baseRows.length > 0) {
      // Look for the last row that looks like totals
      for (let i = baseRows.length - 1; i >= 0; i--) {
        const row = baseRows[i];
        if (isTotalsRow(row)) {
          numericKeyMap.forEach((key, idx) => {
            const raw = String(row[idx] ?? "").trim();
            const normalized = raw.replace(/\s+/g, "").replace(",", ".");
            const num = Number(normalized);
            if (!Number.isNaN(num)) totalsFromFile[key] = (totalsFromFile[key] || 0) + num;
          });
          // Also look for "Итого X рублей" in the row or subsequent rows
          const rowStr = row.join(" ").toLowerCase();
          const match = rowStr.match(/итого\s*([\d\s,]+)\s*руб/);
          if (match) {
            const val = Number(match[1].replace(/\s+/g, "").replace(",", "."));
            if (!Number.isNaN(val)) totalsFromFile["total_sum_text"] = val;
          }
        }
      }
      // Filter out garbage rows like "Спецмаршруты", "Итого ... рублей", or rows that are just totals
      baseRows = baseRows.filter(row => {
        const str = row.join(" ").toLowerCase();
        if (str.includes("спецмаршруты")) return false;
        if (str.includes("итого") && str.includes("рублей")) return false;
        if (isTotalsRow(row)) return false;
        return true;
      });
    }

    const displayRows = baseRows.map((row) => {
      const record: Record<string, string> = {};
      if (driverIdx !== undefined) {
        record.__driverRaw = String(row[driverIdx] ?? "");
      }
      if (vehicleIdx !== undefined) {
        record.__vehicleRaw = String(row[vehicleIdx] ?? "");
      }
      const driverRaw = record.__driverRaw ? String(record.__driverRaw) : "";
      const vehicleRaw = record.__vehicleRaw ? String(record.__vehicleRaw) : "";
      const driverIp = resolveDriverIp(driverRaw, ipRecords);
      const vehicleIp = resolveVehicleIp(vehicleRaw, ipRecords);
      for (const col of displayColumns) {
        if (col.isRouteName) {
          const routeValue = routeNumberIdx !== undefined ? String(row[routeNumberIdx] || "") : "";
          const trimmedRoute = routeValue.split("|")[0].trim();
          const match = trimmedRoute.match(/\d+/);
          const routeNumber = match ? match[0] : "";
          const rawDate = routeDateIdx !== undefined ? String(row[routeDateIdx] || "").trim() : "";
          const date = parseFinanceDate(rawDate);
          const dateKey = date ? toLocalDateKey(date) : "";
          const byDateKey = routeNumber && dateKey ? `${routeNumber}|${dateKey}` : "";
          record[col.key] = byDateKey && routeMapByDate[byDateKey] ? routeMapByDate[byDateKey] : "";
          continue;
        }
        if (col.key === "vehicle-ip") {
          record[col.key] = vehicleIp ?? "";
          continue;
        }
        if (col.key === "driver-ip") {
          record[col.key] = driverIp ?? "";
          continue;
        }
        let value = col.sourceIndex !== undefined ? row[col.sourceIndex] ?? "" : "";
        if (col.label === "№ марш.") {
          value = String(value || "")
            .split("|")[0]
            .trim();
        }
        record[col.key] = String(value ?? "");
      }
      return record;
    });
    const driverColKey =
      displayColumns.find((c) => c.label.trim().toLowerCase() === "фио водителя")?.key ??
      displayColumns.find((c) => {
        const n = c.label.toLowerCase();
        return n.includes("водит") || n.includes("фио") || n.includes("фамилия");
      })?.key;

    const vehicleColKey =
      displayColumns.find((c) => c.label.trim().toLowerCase() === "гар. №")?.key ??
      displayColumns.find((c) => {
        const n = c.label.toLowerCase();
        return n.includes("гар") || n.includes("гос") || n.includes("авто") || n.includes("номер машины");
      })?.key;

    return {
      displayColumns,
      displayRows,
      routeDateIdx,
      driverColKey,
      vehicleColKey,
      globalHeaderIndex: headerIndex,
      columnDefs,
      totalsFromFile,
    };
  }, [parsed.visibleRows, data?.columns, data?.rows, routeMapByDate, ipRecords, routeView]);

  const unassignedItems = React.useMemo(() => {
    const driverCol = tableMeta.displayColumns.find((c) => c.label.toLowerCase().includes("водител"));
    const vehicleCol = tableMeta.displayColumns.find((c) => c.label.toLowerCase().includes("гар"));
    const drivers = new Set<string>();
    const vehicles = new Set<string>();
    for (const row of tableMeta.displayRows) {
      if (driverCol) {
        const raw = String(row[driverCol.key] || "").trim();
        if (raw) {
          const ip = resolveDriverIp(raw, ipRecords);
          if (!ip) drivers.add(raw);
        }
      }
      if (vehicleCol) {
        const raw = String(row[vehicleCol.key] || "").trim();
        if (raw) {
          const ip = resolveVehicleIp(raw, ipRecords);
          if (!ip) vehicles.add(raw);
        }
      }
    }
    return {
      drivers: Array.from(drivers).sort((a, b) => a.localeCompare(b)),
      vehicles: Array.from(vehicles).sort((a, b) => a.localeCompare(b)),
    };
  }, [tableMeta.displayRows, tableMeta.displayColumns, ipRecords]);

  const uniqueOptions = React.useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const col of tableMeta.displayColumns) {
      if (col.hidden || col.label === "Дата марш.") continue;
      const values = new Set<string>();
      for (const row of tableMeta.displayRows) {
        const v = String(row[col.key] ?? "").trim();
        if (v) values.add(v);
      }
      result[col.key] = Array.from(values).sort((a, b) => a.localeCompare(b));
    }
    return result;
  }, [tableMeta.displayColumns, tableMeta.displayRows]);

  const listOptionsByType = React.useMemo(() => {
    const routeCol = tableMeta.displayColumns.find((c) => c.label === "Название маршрута");
    const driverCol = tableMeta.displayColumns.find((c) => c.label.toLowerCase().includes("водител"));
    const vehicleCol = tableMeta.displayColumns.find((c) => c.label.toLowerCase().includes("гар"));
    return {
      ROUTE: routeCol ? uniqueOptions[routeCol.key] || [] : [],
      DRIVER: driverCol ? uniqueOptions[driverCol.key] || [] : [],
      VEHICLE: vehicleCol ? uniqueOptions[vehicleCol.key] || [] : [],
    };
  }, [tableMeta.displayColumns, uniqueOptions]);

  const filteredRows = React.useMemo(() => {
    const routeList = lists.find((l) => l.id === selectedList.route);
    const driverList = lists.find((l) => l.id === selectedList.driver);
    const vehicleList = lists.find((l) => l.id === selectedList.vehicle);

    const normalize = (v: string) => v.trim().toLowerCase();
    const routeNames = new Set((routeList?.items || []).map((i: any) => normalize(String(i))));
    const driverNames = new Set((driverList?.items || []).map((i: any) => normalize(String(i))));
    const vehicleNumbers = new Set((vehicleList?.items || []).map((i: any) => normalize(String(i))));

    const routeCol = tableMeta.displayColumns.find((c) => c.label === "Название маршрута");
    const driverCol = tableMeta.displayColumns.find((c) => c.label.toLowerCase().includes("водител"));
    const vehicleCol = tableMeta.displayColumns.find((c) => c.label.toLowerCase().includes("гар"));

    return tableMeta.displayRows.filter((row) => {
      if (routeList && routeCol && routeNames.size > 0 && !routeNames.has(normalize(String(row[routeCol.key] || "")))) {
        return false;
      }
      if (driverList && driverCol && driverNames.size > 0 && !driverNames.has(normalize(String(row[driverCol.key] || "")))) {
        return false;
      }
      if (vehicleList && vehicleCol && vehicleNumbers.size > 0 && !vehicleNumbers.has(normalize(String(row[vehicleCol.key] || "")))) {
        return false;
      }

      for (const col of tableMeta.displayColumns) {
        const value = String(row[col.key] ?? "").trim();
        if (col.label === "Дата марш.") {
          if (dateRange.from || dateRange.to) {
            const date = parseFinanceDate(value);
            if (!date) return false;
            if (dateRange.from && date < new Date(dateRange.from)) return false;
            if (dateRange.to) {
              const to = new Date(dateRange.to);
              to.setHours(23, 59, 59, 999);
              if (date > to) return false;
            }
          }
          continue;
        }
        const selected = filters[col.key] || [];
        if (selected.length > 0 && !selected.includes(value)) return false;
      }
      return true;
    });
  }, [tableMeta.displayRows, tableMeta.displayColumns, filters, dateRange, lists, selectedList]);

  const sortedRows = React.useMemo(() => {
    if (!sort.key || !sort.dir) return filteredRows;
    const column = tableMeta.displayColumns.find((c) => c.key === sort.key);
    if (!column) return filteredRows;
    return [...filteredRows].sort((a, b) => {
      const valA = String(a[sort.key] ?? "");
      const valB = String(b[sort.key] ?? "");
      if (column.label === "Дата марш.") {
        const dateA = parseFinanceDate(valA)?.getTime() ?? 0;
        const dateB = parseFinanceDate(valB)?.getTime() ?? 0;
        return sort.dir === "asc" ? dateA - dateB : dateB - dateA;
      }
      const numA = Number(valA.replace(",", "."));
      const numB = Number(valB.replace(",", "."));
      const bothNumeric = !Number.isNaN(numA) && !Number.isNaN(numB);
      if (bothNumeric) {
        return sort.dir === "asc" ? numA - numB : numB - numA;
      }
      return sort.dir === "asc"
        ? valA.localeCompare(valB, "ru")
        : valB.localeCompare(valA, "ru");
    });
  }, [filteredRows, sort, tableMeta.displayColumns]);

  const summaryTotals = React.useMemo(() => {
    const allRows = parsed.visibleRows || [];
    const headerIndices: number[] = [];
    for (let i = 0; i < allRows.length; i++) {
      const str = allRows[i].map((c) => String(c).toLowerCase()).join(" ");
      if (str.includes("№ марш")) headerIndices.push(i);
    }

    const numericKeyMap = new Map<number, string>();
    // Note: We need a generic way to find columns because main and special tables have different structures
    
    let mainRouteCost = 0;
    let specialRouteCost = 0;
    let totalFromText = 0;

    const parseNum = (val: any) => {
      const s = String(val ?? "").replace(/\s+/g, "").replace(",", ".");
      const n = Number(s);
      return isNaN(n) ? 0 : n;
    };

    // Find main table and its total row
    const mainHeaderIdx = headerIndices.find(idx => !allRows[idx].map(c => String(c).toLowerCase()).join(" ").includes("спец/м"));
    if (mainHeaderIdx !== undefined && mainHeaderIdx >= 0) {
      const nextHeaderIdx = headerIndices.find(idx => idx > mainHeaderIdx) ?? allRows.length;
      const sectionRows = allRows.slice(mainHeaderIdx, nextHeaderIdx);
      const headerRow = allRows[mainHeaderIdx];
      const costIdx = headerRow.findIndex(c => String(c).toLowerCase().includes("стоимость маршрута"));
      
      if (costIdx >= 0) {
        // Look for the totals row at the end of the section
        for (let i = sectionRows.length - 1; i >= 1; i--) {
          const row = sectionRows[i];
          const val = parseNum(row[costIdx]);
          // Check if it's a totals row (mostly empty except numbers)
          const nonNumbers = row.filter((c, idx) => idx !== costIdx && String(c).trim() && isNaN(Number(String(c).replace(/\s+/g, "").replace(",", "."))));
          if (val > 0 && nonNumbers.length <= 1) { // 1 for "Итого" label
            mainRouteCost = val;
            break;
          }
        }
      }
    }

    // Find special table and its total row
    const specHeaderIdx = headerIndices.find(idx => allRows[idx].map(c => String(c).toLowerCase()).join(" ").includes("спец/м"));
    if (specHeaderIdx !== undefined && specHeaderIdx >= 0) {
      const nextHeaderIdx = headerIndices.find(idx => idx > specHeaderIdx) ?? allRows.length;
      const sectionRows = allRows.slice(specHeaderIdx, nextHeaderIdx);
      const headerRow = allRows[specHeaderIdx];
      const bonusIdx = headerRow.findIndex(c => String(c).toLowerCase().includes("доплата по маршруту"));
      
      if (bonusIdx >= 0) {
        for (let i = sectionRows.length - 1; i >= 1; i--) {
          const row = sectionRows[i];
          const val = parseNum(row[bonusIdx]);
          const nonNumbers = row.filter((c, idx) => idx !== bonusIdx && String(c).trim() && isNaN(Number(String(c).replace(/\s+/g, "").replace(",", "."))));
          if (val > 0 && nonNumbers.length <= 1) {
            specialRouteCost = val;
            break;
          }
        }
      }
    }

    // Look for global "Итого ... руб" text in the whole visible range
    for (const row of allRows) {
      const str = row.join(" ").toLowerCase();
      const match = str.match(/итого\s*([\d\s,]+)\s*руб/);
      if (match) {
        totalFromText = parseNum(match[1]);
        break;
      }
    }

    return {
      mainRouteCost,
      specialRouteCost,
      totalCalculated: mainRouteCost + specialRouteCost,
      totalFromText
    };
  }, [parsed.visibleRows]);

  const totalsRow = React.useMemo(() => {
    const totals: Record<string, number> = {};
    const counts: Record<string, number> = {};
    if (tableMeta.totalsFromFile && Object.keys(tableMeta.totalsFromFile).length > 0) {
      return { totals: tableMeta.totalsFromFile, counts };
    }
    for (const row of sortedRows) {
      for (const col of tableMeta.displayColumns) {
        if (col.hidden) continue;
        const raw = String(row[col.key] ?? "").replace(/\s+/g, "");
        if (!raw) continue;
        const normalized = raw.replace(",", ".");
        const num = Number(normalized);
        if (Number.isNaN(num)) continue;
        totals[col.key] = (totals[col.key] || 0) + num;
        counts[col.key] = (counts[col.key] || 0) + 1;
      }
    }
    return { totals, counts };
  }, [sortedRows, tableMeta.displayColumns, tableMeta.totalsFromFile]);

  const analyticsMeta = React.useMemo(() => {
    const allRows = [
      ...(analyticsSources.afina?.rows ?? []),
      ...(analyticsSources.nika?.rows ?? []),
      ...(!(analyticsSources.afina?.rows || analyticsSources.nika?.rows) ? (data?.rows ?? []) : []),
    ];
    const headerIndices: number[] = [];
    for (let i = 0; i < allRows.length; i++) {
      const str = allRows[i].map((c) => String(c).toLowerCase()).join(" ");
      if (str.includes("№ марш")) headerIndices.push(i);
    }
    const findHeaderIndex = (kind: "main" | "special") => {
      for (const idx of headerIndices) {
        const str = allRows[idx].map((c) => String(c).toLowerCase()).join(" ");
        const isSpecial = str.includes("спец/м");
        if (kind === "special" && isSpecial) return idx;
        if (kind === "main" && !isSpecial) return idx;
      }
      return -1;
    };
    const headerIndex = findHeaderIndex(routeView);
    const headerRow = headerIndex >= 0 ? allRows[headerIndex] : data?.columns || [];

    const columnDefs = headerRow
      .map((name, index) => ({ name: String(name || "").trim(), index }))
      .filter(
        (col) =>
          col.name &&
          col.name !== "Таб №" &&
          !col.name.toLowerCase().startsWith("unnamed")
      );

    const routeNumberIdx = columnDefs.find((col) => col.name === "№ марш." || col.name.toLowerCase().includes("маршрут"))?.index;
    const routeDateIdx = columnDefs.find((col) => col.name === "Дата марш." || col.name.toLowerCase().includes("дата"))?.index;
    const driverIdx =
      columnDefs.find((col) => col.name.trim().toLowerCase() === "фио водителя")?.index ??
      columnDefs.find((col) => {
        const n = col.name.toLowerCase();
        return n.includes("водит") || n.includes("фио") || n.includes("фамилия");
      })?.index;
    const vehicleIdx =
      columnDefs.find((col) => col.name.trim().toLowerCase() === "гар. №")?.index ??
      columnDefs.find((col) => {
        const n = col.name.toLowerCase();
        return n.includes("гар") || n.includes("гос") || n.includes("авто") || n.includes("номер машины");
      })?.index;

    const displayColumns: { key: string; label: string; sourceIndex?: number; isRouteName?: boolean; hidden?: boolean }[] = [];
    for (const col of columnDefs) {
      displayColumns.push({ key: `col-${col.index}`, label: col.name, sourceIndex: col.index });
      if (routeNumberIdx !== undefined && col.index === routeNumberIdx) {
        displayColumns.push({ key: "route-name", label: "Название маршрута", isRouteName: true });
      }
      if (vehicleIdx !== undefined && col.index === vehicleIdx) {
        displayColumns.push({ key: "vehicle-ip", label: "ИП авто", hidden: true });
      }
      if (driverIdx !== undefined && col.index === driverIdx) {
        displayColumns.push({ key: "driver-ip", label: "ИП водителя", hidden: true });
      }
    }

    let baseRows: string[][] = [];
    if (headerIndices.length > 0) {
      const sorted = [...headerIndices].sort((a, b) => a - b);
      for (let i = 0; i < sorted.length; i++) {
        const idx = sorted[i];
        const str = allRows[idx].map((c) => String(c).toLowerCase()).join(" ");
        const isSpecial = str.includes("спец/м");
        if ((routeView === "special" && !isSpecial) || (routeView === "main" && isSpecial)) continue;
        const nextIdx = sorted.find((h) => h > idx) ?? allRows.length;
        baseRows = baseRows.concat(allRows.slice(idx + 1, nextIdx));
      }
    } else {
      baseRows = allRows;
    }

    baseRows = baseRows.filter((row) => {
      const normalized = row.map((cell) => String(cell || "").replace(/\s+/g, " ").trim().toLowerCase());
      if (normalized.every((cell) => !cell)) return false;
      if (normalized.some((cell) => cell.includes("транспортная орг"))) return false;
      if (normalized.some((cell) => cell.includes("период"))) return false;
      if (normalized.some((cell) => cell.includes("тариф основной"))) return false;
      const rowStr = row.join(" ").toLowerCase();
      if (rowStr.includes("спецмаршруты")) return false;
      if (rowStr.includes("итого") && rowStr.includes("рублей")) return false;
      return true;
    });

    const displayRows = baseRows.map((row) => {
      const record: Record<string, string> = {};
      if (driverIdx !== undefined) {
        record.__driverRaw = String(row[driverIdx] ?? "");
      }
      if (vehicleIdx !== undefined) {
        record.__vehicleRaw = String(row[vehicleIdx] ?? "");
      }
      const driverRaw = record.__driverRaw ? String(record.__driverRaw) : "";
      const vehicleRaw = record.__vehicleRaw ? String(record.__vehicleRaw) : "";
      const driverIp = resolveDriverIp(driverRaw, ipRecords);
      const vehicleIp = resolveVehicleIp(vehicleRaw, ipRecords);
      for (const col of displayColumns) {
        if (col.isRouteName) {
          const routeValue = routeNumberIdx !== undefined ? String(row[routeNumberIdx] || "") : "";
          const trimmedRoute = routeValue.split("|")[0].trim();
          const match = trimmedRoute.match(/\d+/);
          const routeNumber = match ? match[0] : "";
          const rawDate = routeDateIdx !== undefined ? String(row[routeDateIdx] || "").trim() : "";
          const date = parseFinanceDate(rawDate);
          const dateKey = date ? toLocalDateKey(date) : "";
          const byDateKey = routeNumber && dateKey ? `${routeNumber}|${dateKey}` : "";
          record[col.key] = byDateKey && routeMapByDate[byDateKey] ? routeMapByDate[byDateKey] : "";
          continue;
        }
        if (col.key === "vehicle-ip") {
          record[col.key] = vehicleIp ?? "";
          continue;
        }
        if (col.key === "driver-ip") {
          record[col.key] = driverIp ?? "";
          continue;
        }
        let value = col.sourceIndex !== undefined ? row[col.sourceIndex] ?? "" : "";
        if (col.label === "№ марш.") {
          value = String(value || "")
            .split("|")[0]
            .trim();
        }
        record[col.key] = String(value ?? "");
      }
      return record;
    });

    return { displayColumns, displayRows };
  }, [data, ipRecords, routeMapByDate, routeView]);

  const routeAnalytics = React.useMemo(() => {
    const routeCol = analyticsMeta.displayColumns.find((c) => c.label === "Название маршрута");
    const dateCol = analyticsMeta.displayColumns.find((c) => c.label === "Дата марш.");
    const costCol = analyticsMeta.displayColumns.find((c) => c.label.toLowerCase().includes("стоимость продукции"));
    const weightCol = analyticsMeta.displayColumns.find((c) => c.label.toLowerCase().includes("вес нетто"));
    const tripsCol = analyticsMeta.displayColumns.find((c) => c.label.toLowerCase().includes("кол. заезд"));
    const mileageCol = analyticsMeta.displayColumns.find((c) => c.label.toLowerCase().includes("пробег"));
    const routeCostCol = analyticsMeta.displayColumns.find((c) => c.label.toLowerCase().includes("стоимость маршрута"));

    if (!routeCol) return [];

    const fromDate = analyticsDate.from ? parseInputDate(analyticsDate.from) : null;
    const toDate = analyticsDate.to ? parseInputDate(analyticsDate.to) : null;
    if (toDate) toDate.setHours(23, 59, 59, 999);

    const parseNum = (value: string) => {
      const normalized = String(value ?? "").replace(/\s+/g, "").replace(",", ".");
      const num = Number(normalized);
      return Number.isNaN(num) ? null : num;
    };

    const normalizeRouteName = (value: string) =>
      String(value || "")
        .replace(/\u00a0/g, " ")
        .replace(/[‐‑‒–—]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    const map = new Map<
      string,
      {
        routeName: string;
        routeCount: number;
        costSum: number;
        costCount: number;
        weightSum: number;
        weightCount: number;
        tripsSum: number;
        tripsCount: number;
        mileageSum: number;
        mileageCount: number;
        routeCostSum: number;
        routeCostCount: number;
      }
    >();

    for (const row of analyticsMeta.displayRows) {
      const routeNameRaw = String(row[routeCol.key] ?? "").trim();
      if (!routeNameRaw) continue;
      const routeKey = normalizeRouteName(routeNameRaw);
      if (!routeKey) continue;

      if (dateCol) {
        const dateValue = String(row[dateCol.key] ?? "").trim();
        const date = parseFinanceDate(dateValue);
        if (fromDate && (!date || date < fromDate)) continue;
        if (toDate && (!date || date > toDate)) continue;
      }

      if (!map.has(routeKey)) {
        map.set(routeKey, {
          routeName: routeNameRaw,
          routeCount: 0,
          costSum: 0,
          costCount: 0,
          weightSum: 0,
          weightCount: 0,
          tripsSum: 0,
          tripsCount: 0,
          mileageSum: 0,
          mileageCount: 0,
          routeCostSum: 0,
          routeCostCount: 0,
        });
      }

      const entry = map.get(routeKey)!;
      entry.routeCount += 1;

      if (costCol) {
        const num = parseNum(String(row[costCol.key] ?? ""));
        if (num !== null) {
          entry.costSum += num;
          entry.costCount += 1;
        }
      }
      if (weightCol) {
        const num = parseNum(String(row[weightCol.key] ?? ""));
        if (num !== null) {
          entry.weightSum += num;
          entry.weightCount += 1;
        }
      }
      if (tripsCol) {
        const num = parseNum(String(row[tripsCol.key] ?? ""));
        if (num !== null) {
          entry.tripsSum += num;
          entry.tripsCount += 1;
        }
      }
      if (mileageCol) {
        const num = parseNum(String(row[mileageCol.key] ?? ""));
        if (num !== null) {
          entry.mileageSum += num;
          entry.mileageCount += 1;
        }
      }
      if (routeCostCol) {
        const num = parseNum(String(row[routeCostCol.key] ?? ""));
        if (num !== null) {
          entry.routeCostSum += num;
          entry.routeCostCount += 1;
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => a.routeName.localeCompare(b.routeName, "ru"));
  }, [analyticsMeta.displayRows, analyticsMeta.displayColumns, analyticsDate]);

  const filteredRouteAnalytics = React.useMemo(() => {
    const list = analyticsRouteListId ? lists.find((l) => l.id === analyticsRouteListId) : null;
    const listSet = list ? new Set(list.items.map((item) => normalizeKey(item))) : null;
    return routeAnalytics.filter((r) => {
      if (listSet && !listSet.has(normalizeKey(r.routeName))) return false;
      if (analyticsRoute && normalizeKey(r.routeName) !== normalizeKey(analyticsRoute)) return false;
      return true;
    });
  }, [routeAnalytics, lists, analyticsRouteListId, analyticsRoute]);

  const ipAnalytics = React.useMemo(() => {
    const routeCol = analyticsMeta.displayColumns.find((c) => c.label === "Название маршрута");
    const dateCol = analyticsMeta.displayColumns.find((c) => c.label === "Дата марш.");
    const routeCostCol = analyticsMeta.displayColumns.find((c) => c.label.toLowerCase().includes("стоимость маршрута"));
    const driverIpKey = analyticsMeta.displayColumns.find((c) => c.label === "ИП водителя")?.key ?? "driver-ip";
    const vehicleIpKey = analyticsMeta.displayColumns.find((c) => c.label === "ИП авто")?.key ?? "vehicle-ip";

    if (!routeCostCol) return [];

    const fromDate = analyticsDate.from ? parseInputDate(analyticsDate.from) : null;
    const toDate = analyticsDate.to ? parseInputDate(analyticsDate.to) : null;
    if (toDate) toDate.setHours(23, 59, 59, 999);

    const parseNum = (value: string) => {
      const normalized = String(value ?? "").replace(/\s+/g, "").replace(",", ".");
      const num = Number(normalized);
      return Number.isNaN(num) ? null : num;
    };

    const normalizeRouteName = (value: string) =>
      String(value || "")
        .replace(/\u00a0/g, " ")
        .replace(/[‐‑‒–—]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    const map = new Map<
      string,
      {
        ipName: string;
        totalSum: number;
        routeCount: number;
        routes: Map<string, { name: string; sum: number; count: number }>;
      }
    >();

    for (const row of analyticsMeta.displayRows) {
      if (dateCol) {
        const dateValue = String(row[dateCol.key] ?? "").trim();
        const date = parseFinanceDate(dateValue);
        if (fromDate && (!date || date < fromDate)) continue;
        if (toDate && (!date || date > toDate)) continue;
      }

      const driverIp = String(row[driverIpKey] ?? "").trim();
      const vehicleIp = String(row[vehicleIpKey] ?? "").trim();
      let ipName = "";
      if (driverIp && vehicleIp) {
        if (normalizeKey(driverIp) === normalizeKey(vehicleIp)) ipName = driverIp;
      } else {
        ipName = driverIp || vehicleIp;
      }
      if (!ipName) continue;

      const routeNameRaw = routeCol ? String(row[routeCol.key] ?? "").trim() : "";
      const routeNameKey = routeNameRaw ? normalizeRouteName(routeNameRaw) : "";
      const routeName = routeNameRaw;
      const amount = parseNum(String(row[routeCostCol.key] ?? ""));
      const amountValue = amount ?? 0;

      if (!map.has(ipName)) {
        map.set(ipName, { ipName, totalSum: 0, routeCount: 0, routes: new Map() });
      }

      const entry = map.get(ipName)!;
      entry.totalSum += amountValue;
      entry.routeCount += 1;

      if (routeName && routeNameKey) {
        if (!entry.routes.has(routeNameKey)) {
          entry.routes.set(routeNameKey, { name: routeName, sum: 0, count: 0 });
        }
        const r = entry.routes.get(routeNameKey)!;
        r.sum += amountValue;
        r.count += 1;
      }
    }

    return Array.from(map.values())
      .map((entry) => ({
        ...entry,
        routesList: Array.from(entry.routes.values()).sort((a, b) => b.sum - a.sum),
      }))
      .sort((a, b) => b.totalSum - a.totalSum);
  }, [analyticsMeta.displayRows, analyticsMeta.displayColumns, analyticsDate]);

  const toggleFilterValue = (key: string, value: string) => {
    setFilters((prev) => {
      const current = prev[key] || [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...prev, [key]: next };
    });
  };

  const addList = () => {
    const name = newListName.trim();
    if (!name) return;
    setLists((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name, type: newListType, items: [] },
    ]);
    setNewListName("");
  };

  const deleteList = (id: string) => {
    setLists((prev) => prev.filter((l) => l.id !== id));
    setSelectedList((prev) => ({
      route: prev.route === id ? undefined : prev.route,
      driver: prev.driver === id ? undefined : prev.driver,
      vehicle: prev.vehicle === id ? undefined : prev.vehicle,
    }));
  };

  const startEditList = (id: string, name: string) => {
    setEditingListId(id);
    setEditingListName(name);
  };

  const saveEditList = () => {
    const name = editingListName.trim();
    if (!editingListId || !name) return;
    setLists((prev) => prev.map((l) => (l.id === editingListId ? { ...l, name } : l)));
    setEditingListId(null);
    setEditingListName("");
  };

  const addListItem = (listId: string, value: string) => {
    if (!value) return;
    setLists((prev) =>
      prev.map((l) =>
        l.id === listId && !l.items.includes(value) ? { ...l, items: [...l.items, value] } : l
      )
    );
  };

  const removeListItem = (listId: string, value: string) => {
    setLists((prev) =>
      prev.map((l) => (l.id === listId ? { ...l, items: l.items.filter((i) => i !== value) } : l))
    );
  };

  const addIpRecord = () => {
    const name = newIpName.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    setIpRecords((prev) => [...prev, { id, name, drivers: [], vehicles: [], routes: [] }]);
    setIpDrafts((prev) => ({ ...prev, [id]: { drivers: [], vehicles: [], routes: [] } }));
    setEditingIpId(id);
    setNewIpName("");
  };

  const deleteIpRecord = (id: string) => {
    setIpRecords((prev) => prev.filter((r) => r.id !== id));
    setIpDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setEditingIpId((prev) => (prev === id ? null : prev));
  };

  const startEditIp = (id: string) => {
    const record = ipRecords.find((r) => r.id === id);
    if (!record) return;
    setIpDrafts((prev) => ({
      ...prev,
      [id]: {
        drivers: [...record.drivers],
        vehicles: [...record.vehicles],
        routes: [...record.routes],
      },
    }));
    setEditingIpId(id);
  };

  const cancelEditIp = (id: string) => {
    setIpDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setEditingIpId(null);
  };

  const saveEditIp = (id: string) => {
    const draft = ipDrafts[id];
    if (!draft) return;
    setIpRecords((prev) =>
      prev.map((r) => (r.id === id ? { ...r, drivers: draft.drivers, vehicles: draft.vehicles, routes: draft.routes } : r))
    );
    setIpDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setEditingIpId(null);
  };

  const toggleIpValue = (id: string, field: "drivers" | "vehicles" | "routes", value: string) => {
    setIpDrafts((prev) => {
      const draft = prev[id] || { drivers: [], vehicles: [], routes: [] };
      const current = draft[field];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...prev, [id]: { ...draft, [field]: next } };
    });
  };

  const handleSort = (key: string) => {
    setSort((prev) => ({
      key,
      dir: prev.key === key ? (prev.dir === "asc" ? "desc" : prev.dir === "desc" ? null : "asc") : "asc",
    }));
  };

  const renderFilterDropdown = (column: { key: string; label: string }) => {
    if (activeFilter !== column.key) return null;
    const close = () => setActiveFilter(null);
    return (
      <div className={styles.filterDropdown} onClick={(e) => e.stopPropagation()}>
        {column.label === "Дата марш." ? (
          <div className={styles.filterRange}>
            <label style={{ fontSize: 12 }}>От</label>
            <input
              type="date"
              value={dateRange.from}
              onChange={(e) => setDateRange((prev) => ({ ...prev, from: e.target.value }))}
            />
            <label style={{ fontSize: 12 }}>До</label>
            <input
              type="date"
              value={dateRange.to}
              onChange={(e) => setDateRange((prev) => ({ ...prev, to: e.target.value }))}
            />
          </div>
        ) : (
          <div className={styles.filterList}>
            {(uniqueOptions[column.key] || []).map((opt) => (
              <label key={opt} className={styles.filterItem}>
                <input
                  type="checkbox"
                  checked={(filters[column.key] || []).includes(opt)}
                  onChange={() => toggleFilterValue(column.key, opt)}
                />
                {opt}
              </label>
            ))}
          </div>
        )}
        <button className={styles.filterClose} onClick={close}>
          Применить
        </button>
      </div>
    );
  };

  const exportExcel = () => {
    const visibleCols = tableMeta.displayColumns.filter(c => !c.hidden);
    const columns = visibleCols.map((c) => c.label);
    const rows = sortedRows.map((row) => visibleCols.map((c) => row[c.key] ?? ""));
    const html = toExcelTable(columns, rows);
    const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "finance.xls";
    a.click();
  };

  const executeIpExport = () => {
    if (exportIps.length === 0) return;

    const routeCol = tableMeta.displayColumns.find((c) => c.label === "Название маршрута");
    const driverCol = tableMeta.displayColumns.find((c) => c.label.toLowerCase().includes("водител"));
    const vehicleCol = tableMeta.displayColumns.find((c) => c.label.toLowerCase().includes("гар"));

    const normalize = (v: string) => v.trim().toLowerCase();

    exportIps.forEach((ipId, index) => {
      const ip = ipRecords.find((r) => r.id === ipId);
      if (!ip) return;

      const ipDrivers = new Set(ip.drivers.map(normalize));
      const ipVehicles = new Set(ip.vehicles.map(normalize));
      const ipRoutes = new Set(ip.routes.map(normalize));

      const rowsToExport = tableMeta.displayRows.filter((row) => {
        let match = false;
        if (exportMode === "DRIVER" || exportMode === "ALL") {
          const val = normalize(String(row[driverCol?.key || ""] || ""));
          if (driverCol && val && ipDrivers.has(val)) match = true;
        }
        if (!match && (exportMode === "VEHICLE" || exportMode === "ALL")) {
          const val = normalize(String(row[vehicleCol?.key || ""] || ""));
          if (vehicleCol && val && ipVehicles.has(val)) match = true;
        }
        if (!match && (exportMode === "ROUTE" || exportMode === "ALL")) {
          const val = normalize(String(row[routeCol?.key || ""] || ""));
          if (routeCol && val && ipRoutes.has(val)) match = true;
        }
        return match;
      });

      if (rowsToExport.length === 0) return;
      
      const visibleCols = tableMeta.displayColumns.filter(c => !c.hidden);
      const columns = visibleCols.map((c) => c.label);
      const rows = rowsToExport.map((row) => visibleCols.map((c) => row[c.key] ?? ""));
      const html = toExcelTable(columns, rows);
      const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = url;
        a.download = `finance_${activeTab}_${ip.name.replace(/\s+/g, "_")}.xls`;
        a.click();
      }, index * 1000);
    });
  };

  const downloadDoc = (filename: string, html: string) => {
    const blob = new Blob([html], { type: "application/msword;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  };

  const createRentalDoc = () => {
    if (!rentalLessor || !rentalVehicle || !rentalLessee) return;
    const today = new Date().toLocaleDateString("ru-RU");
    const html = `
      <html><head><meta charset="UTF-8"></head><body>
      <h2>Договор аренды автотранспортного средства</h2>
      <p>Дата: ${escapeHtml(today)}</p>
      <p>Арендодатель: ${escapeHtml(rentalLessor)}</p>
      <p>Автомобиль: ${escapeHtml(rentalVehicle)}</p>
      <p>Арендатор: ${escapeHtml(rentalLessee)}</p>
      <p>Подписи сторон:</p>
      <p>____________________ / ${escapeHtml(rentalLessor)}</p>
      <p>____________________ / ${escapeHtml(rentalLessee)}</p>
      </body></html>
    `;
    downloadDoc(`Договор_аренды_${rentalVehicle.replace(/\s+/g, "_")}.doc`, html);
  };

  const createEmploymentDoc = () => {
    if (!employmentIpId || !employmentDriver) return;
    const ipName = ipRecords.find((ip) => ip.id === employmentIpId)?.name || "";
    const today = new Date().toLocaleDateString("ru-RU");
    const html = `
      <html><head><meta charset="UTF-8"></head><body>
      <h2>Трудовой договор</h2>
      <p>Дата: ${escapeHtml(today)}</p>
      <p>Работодатель (ИП): ${escapeHtml(ipName)}</p>
      <p>Работник: ${escapeHtml(employmentDriver)}</p>
      <p>Подписи сторон:</p>
      <p>____________________ / ${escapeHtml(ipName)}</p>
      <p>____________________ / ${escapeHtml(employmentDriver)}</p>
      </body></html>
    `;
    downloadDoc(`Трудовой_договор_${employmentDriver.replace(/\s+/g, "_")}.doc`, html);
  };

  const addDriverCard = () => {
    const name = newDriverCard.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    setDriverCards((prev) => [
      ...prev,
      {
        id,
        name,
        passport: { series: "", number: "", issuedBy: "", issuedAt: "", code: "", address: "" },
        license: { series: "", number: "", issuedBy: "", issuedAt: "", categories: "" },
        patent: { number: "", issuedAt: "", validTo: "" },
        medbook: { number: "", issuedAt: "", validTo: "" },
      },
    ]);
    setNewDriverCard("");
    setDriverModalId(id);
  };

  const addVehicleCard = () => {
    const name = newVehicleCard.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    setVehicleCards((prev) => [
      ...prev,
      {
        id,
        name,
        sts: { number: "", issuedAt: "", issuedBy: "", vin: "", regNumber: "" },
        pts: { number: "", issuedAt: "", issuedBy: "", vin: "", regNumber: "" },
      },
    ]);
    setNewVehicleCard("");
    setVehicleModalId(id);
  };

  const addIpCard = () => {
    if (!newIpCardId) return;
    const ip = ipRecords.find((r) => r.id === newIpCardId);
    if (!ip) return;
    const id = crypto.randomUUID();
    setIpCards((prev) => [
      ...prev,
      {
        id,
        ipId: ip.id,
        ipName: ip.name,
        ip: { inn: "", ogrnip: "", address: "", phone: "", email: "" },
        bank: { account: "", bankName: "", bik: "", corrAccount: "" },
      },
    ]);
    setNewIpCardId("");
    setIpModalId(id);
  };

  const removeCard = (type: "driver" | "vehicle" | "ip", id: string) => {
    if (type === "driver") setDriverCards((prev) => prev.filter((c) => c.id !== id));
    if (type === "vehicle") setVehicleCards((prev) => prev.filter((c) => c.id !== id));
    if (type === "ip") setIpCards((prev) => prev.filter((c) => c.id !== id));
  };

  const updateDriverCard = (
    id: string,
    section: "passport" | "license" | "patent" | "medbook",
    field: string,
    value: string
  ) => {
    setDriverCards((prev) =>
      prev.map((card) =>
        card.id === id
          ? { ...card, [section]: { ...card[section], [field]: value } }
          : card
      )
    );
  };

  const updateVehicleCard = (id: string, section: "sts" | "pts", field: string, value: string) => {
    setVehicleCards((prev) =>
      prev.map((card) =>
        card.id === id ? { ...card, [section]: { ...card[section], [field]: value } } : card
      )
    );
  };

  const updateIpCard = (id: string, section: "ip" | "bank", field: string, value: string) => {
    setIpCards((prev) =>
      prev.map((card) =>
        card.id === id ? { ...card, [section]: { ...card[section], [field]: value } } : card
      )
    );
  };

  return (
    <div>
      <h1 className={styles.pageTitle}>Финансы</h1>

      <div className={styles.tabBar} style={{ marginBottom: 12 }}>
        <button
          className={`${styles.tabButton} ${subTab === "reports" ? styles.tabButtonActive : ""}`}
          onClick={() => setSubTab("reports")}
        >
          Отчеты
        </button>
        <button
          className={`${styles.tabButton} ${subTab === "analytics" ? styles.tabButtonActive : ""}`}
          onClick={() => setSubTab("analytics")}
        >
          Аналитика
        </button>
        <button
          className={`${styles.tabButton} ${subTab === "ip" ? styles.tabButtonActive : ""}`}
          onClick={() => setSubTab("ip")}
        >
          Создание ИП
        </button>
        <button
          className={`${styles.tabButton} ${subTab === "docs" ? styles.tabButtonActive : ""}`}
          onClick={() => setSubTab("docs")}
        >
          Документы
        </button>
        <button
          className={`${styles.tabButton} ${subTab === "cards" ? styles.tabButtonActive : ""}`}
          onClick={() => setSubTab("cards")}
        >
          Карточки
        </button>
      </div>

      {subTab === "reports" && (
        <div className={styles.tabBar} style={{ alignItems: "center" }}>
          <button
            className={`${styles.tabButton} ${activeTab === "afina" ? styles.tabButtonActive : ""}`}
            onClick={() => setActiveTab("afina")}
          >
            Афина
          </button>
          <button
            className={`${styles.tabButton} ${activeTab === "nika" ? styles.tabButtonActive : ""}`}
            onClick={() => setActiveTab("nika")}
          >
            Ника
          </button>
          <div style={{ flex: 1 }} />
          <button
            className={styles.button}
            onClick={requestRefresh}
            disabled={refreshing}
          >
            {refreshing ? "Обновление..." : "Обновить"}
          </button>
          <button className={styles.button} onClick={exportExcel}>
            Экспорт Excel
          </button>
        </div>
      )}

      <div className={styles.card}>
        {loading && <div style={{ padding: 12 }}>Загрузка...</div>}
        {error && <div style={{ padding: 12, color: "var(--error-color)" }}>{error}</div>}

        {refreshNote && <div style={{ padding: "8px 12px", color: "var(--text)" }}>{refreshNote}</div>}

        {!loading && !error && data && subTab === "reports" && (
          <div>
            <div className={styles.muted} style={{ marginBottom: 8 }}>
              {data.filename ? `Файл: ${data.filename}` : ""} {data.updatedAt ? `• Обновлено: ${new Date(data.updatedAt).toLocaleString()}` : ""} • ИП: {ipRecords.length}
            </div>
            {parsed.organization && (
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                {parsed.organization.replace(/^Транспортная орг-ия\s*/i, "")}
              </div>
            )}
            {parsed.periods.length > 0 && (
              <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <div className={styles.muted} style={{ fontSize: 12 }}>Период</div>
                <select
                  className={styles.select}
                  value={parsed.selectedPeriod || ""}
                  onChange={(e) => setActivePeriod(e.target.value)}
                >
                  {parsed.periods.map((p) => (
                    <option key={p} value={p}>
                      {p.replace(/^Период\s*/i, "")}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {ipRecords.length > 0 && (
              <div
                style={{
                  marginBottom: 12,
                  padding: 12,
                  background: "var(--card-bg)",
                  borderRadius: 8,
                  border: "1px solid var(--card-border)",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Экспорт по ИП</div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
                  {ipRecords.map((ip) => (
                    <label key={ip.id} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={exportIps.includes(ip.id)}
                        onChange={(e) => {
                          if (e.target.checked) setExportIps((prev) => [...prev, ip.id]);
                          else setExportIps((prev) => prev.filter((id) => id !== ip.id));
                        }}
                      />
                      {ip.name}
                    </label>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 12 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="exportMode"
                        value="ALL"
                        checked={exportMode === "ALL"}
                        onChange={() => setExportMode("ALL")}
                      />
                      Всё вместе
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="exportMode"
                        value="VEHICLE"
                        checked={exportMode === "VEHICLE"}
                        onChange={() => setExportMode("VEHICLE")}
                      />
                      По авто
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="exportMode"
                        value="DRIVER"
                        checked={exportMode === "DRIVER"}
                        onChange={() => setExportMode("DRIVER")}
                      />
                      По водителям
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="exportMode"
                        value="ROUTE"
                        checked={exportMode === "ROUTE"}
                        onChange={() => setExportMode("ROUTE")}
                      />
                      По маршрутам
                    </label>
                  </div>
                  <button
                    className={styles.button}
                    onClick={executeIpExport}
                    disabled={exportIps.length === 0}
                  >
                    Экспортировать выбранные ({exportIps.length})
                  </button>
                </div>
              </div>
            )}

            <div style={{ marginBottom: 10 }}>
              <div className={styles.tabBar} style={{ alignItems: "center" }}>
                <button
                  className={`${styles.tabButton} ${routeView === "main" ? styles.tabButtonActive : ""}`}
                  onClick={() => setRouteView("main")}
                >
                  Основные маршруты
                </button>
                <button
                  className={`${styles.tabButton} ${routeView === "special" ? styles.tabButtonActive : ""}`}
                  onClick={() => setRouteView("special")}
                >
                  Спецмаршруты
                </button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
              <div className={styles.filters} style={{ marginBottom: 0, flex: 1 }}>
                <select
                  className={styles.select}
                  value={selectedList.route || ""}
                  onChange={(e) => setSelectedList((prev) => ({ ...prev, route: e.target.value || undefined }))}
                >
                  <option value="">Маршруты: все списки</option>
                  {lists.filter((l) => l.type === "ROUTE").map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
                <select
                  className={styles.select}
                  value={selectedList.driver || ""}
                  onChange={(e) => setSelectedList((prev) => ({ ...prev, driver: e.target.value || undefined }))}
                >
                  <option value="">Водители: все списки</option>
                  {lists.filter((l) => l.type === "DRIVER").map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
                <select
                  className={styles.select}
                  value={selectedList.vehicle || ""}
                  onChange={(e) => setSelectedList((prev) => ({ ...prev, vehicle: e.target.value || undefined }))}
                >
                  <option value="">Авто: все списки</option>
                  {lists.filter((l) => l.type === "VEHICLE").map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              {(unassignedItems.drivers.length > 0 || unassignedItems.vehicles.length > 0) && (
                <div
                  style={{
                    minWidth: 260,
                    maxWidth: 360,
                    padding: 10,
                    border: "1px solid var(--card-border)",
                    borderRadius: 10,
                    background: "var(--card-bg)",
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Новые без ИП</div>
                  {unassignedItems.drivers.length > 0 && (
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>Водители</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {unassignedItems.drivers.map((d) => (
                          <span key={d} className={styles.badge}>{d}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {unassignedItems.vehicles.length > 0 && (
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>Авто</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {unassignedItems.vehicles.map((v) => (
                          <span key={v} className={styles.badge}>{v}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            {totalsRow && Object.keys(totalsRow.totals).length > 0 && (
              <div
                style={{
                  marginBottom: 15,
                  padding: 16,
                  border: "1px solid var(--card-border)",
                  borderRadius: 12,
                  background: "var(--card-bg)",
                  boxShadow: "var(--card-shadow)",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 18, color: "var(--text)" }}>📊 Общие итоги периода</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
                  <div style={{ padding: 12, borderRadius: 10, background: "var(--background)", border: "1px solid var(--table-border)" }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, marginBottom: 4, textTransform: "uppercase" }}>Основные маршруты</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
                      {formatTotalNumber(summaryTotals.mainRouteCost)} <span style={{ fontSize: 14, fontWeight: 500 }}>₽</span>
                    </div>
                  </div>
                  <div style={{ padding: 12, borderRadius: 10, background: "var(--background)", border: "1px solid var(--table-border)" }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, marginBottom: 4, textTransform: "uppercase" }}>Спецмаршруты</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
                      {formatTotalNumber(summaryTotals.specialRouteCost)} <span style={{ fontSize: 14, fontWeight: 500 }}>₽</span>
                    </div>
                  </div>
                  <div style={{ padding: 12, borderRadius: 10, background: "var(--accent-light-bg)", border: "1px solid var(--card-border)" }}>
                    <div style={{ fontSize: 12, color: "var(--accent-color)", fontWeight: 600, marginBottom: 4, textTransform: "uppercase" }}>Итого к оплате</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: "var(--accent-color)" }}>
                      {formatTotalNumber(summaryTotals.totalFromText || summaryTotals.totalCalculated)} <span style={{ fontSize: 16, fontWeight: 600 }}>₽</span>
                    </div>
                  </div>
                </div>
                
                <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap", borderTop: "1px solid var(--table-border)", paddingTop: 12 }}>
                  {tableMeta.displayColumns.filter(c => !c.hidden).map((col) => {
                    const key = col.label.toLowerCase();
                    let mapKey = "";
                    if (key.includes("стоимость продукции")) mapKey = "cost_products";
                    else if (key.includes("вес нетто")) mapKey = "weight_net";
                    else if (key.includes("кол. заезд") || key.includes("количество заезд")) mapKey = "trips_count";
                    else if (key.includes("пробег")) mapKey = "mileage";
                    if (!mapKey) return null;
                    const val = totalsRow.totals[mapKey];
                    if (val === undefined) return null;
                    return (
                      <div key={mapKey} className={styles.badge} style={{ fontSize: 13, padding: "4px 10px" }}>
                        {col.label}: {String(val.toFixed(2)).replace(".", ",")}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className={styles.tableWrap}>
              <table className={styles.table} style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {tableMeta.displayColumns.filter(c => !c.hidden).map((col) => (
                      <th
                        key={col.key}
                        className={styles.th}
                        style={{
                          textAlign: "center",
                          background: "var(--accent-light-bg)",
                          borderRight: "1px solid var(--table-border)",
                          position: "relative",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center" }}>
                          <span onClick={() => handleSort(col.key)} style={{ cursor: "pointer" }}>
                            {col.label}
                            {sort.key === col.key && (sort.dir === "asc" ? " ↑" : sort.dir === "desc" ? " ↓" : "")}
                          </span>
                          <span
                            className={styles.filterToggle}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveFilter(activeFilter === col.key ? null : col.key);
                            }}
                          >
                            ▼
                          </span>
                        </div>
                        {renderFilterDropdown({ key: col.key, label: col.label })}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.length === 0 ? (
                    <tr>
                      <td colSpan={tableMeta.displayColumns.filter(c => !c.hidden).length} style={{ padding: "8px 12px", textAlign: "center", opacity: 0.7 }}>
                        Нет данных
                      </td>
                    </tr>
                  ) : (
                    <>
                      {sortedRows.map((row, idx) => {
                        const driverRaw =
                          (row.__driverRaw as string) ??
                          (tableMeta.driverColKey ? String(row[tableMeta.driverColKey] || "") : "");
                        const vehicleRaw =
                          (row.__vehicleRaw as string) ??
                          (tableMeta.vehicleColKey ? String(row[tableMeta.vehicleColKey] || "") : "");

                        const driverKeys = normalizeDriverKey(driverRaw);
                        const vehicleKeys = normalizeVehicleKey(vehicleRaw);

                        const driverIp =
                          (driverKeys.base && usedItems.drivers.get(driverKeys.base)) ||
                          (driverKeys.surname && usedItems.drivers.get(driverKeys.surname)) ||
                          resolveDriverIp(driverRaw, ipRecords);

                        const vehicleIp =
                          (vehicleKeys.base && usedItems.vehicles.get(vehicleKeys.base)) ||
                          (vehicleKeys.digits && usedItems.vehicles.get(vehicleKeys.digits)) ||
                          resolveVehicleIp(vehicleRaw, ipRecords);
                        
                        const rowVehicleIp = String(row["vehicle-ip"] ?? vehicleIp ?? "");
                        const rowDriverIp = String(row["driver-ip"] ?? driverIp ?? "");
                        const rowVehicleKey = normalizeKey(rowVehicleIp);
                        const rowDriverKey = normalizeKey(rowDriverIp);
                        
                        const isConflict = rowVehicleKey && rowDriverKey && rowVehicleKey !== rowDriverKey;
                        const rowStyle = isConflict ? { backgroundColor: "var(--conflict-bg)" } : undefined;
                        const rowTitle = isConflict
                          ? `Авто ИП: ${rowVehicleIp}, Водитель ИП: ${rowDriverIp}`
                          : undefined;

                        return (
                          <tr key={idx} style={rowStyle} title={rowTitle} className={isConflict ? styles.rowConflict : undefined}>
                            {tableMeta.displayColumns.filter(c => !c.hidden).map((col) => {
                              const cellStyle: React.CSSProperties = { textAlign: "center", borderRight: "1px solid var(--table-border)" };
                              if (isConflict) {
                                  cellStyle.backgroundColor = "var(--conflict-bg)";
                              }
                              return (
                                <td
                                  key={`${idx}-${col.key}`}
                                  className={styles.td}
                                  style={cellStyle}
                                >
                                  {row[col.key]}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                      {/* Итоговая строка внизу таблицы */}
                      <tr>
                        {tableMeta.displayColumns.filter(c => !c.hidden).map((col, idx, arr) => {
                          const key = col.label.toLowerCase();
                          let mapKey = "";
                          if (key.includes("стоимость продукции")) mapKey = "cost_products";
                          else if (key.includes("вес нетто")) mapKey = "weight_net";
                          else if (key.includes("кол. заезд") || key.includes("количество заезд")) mapKey = "trips_count";
                          else if (key.includes("пробег")) mapKey = "mileage";
                          else if (key.includes("стоимость маршрута")) mapKey = "route_cost";
                          else if (key.includes("доплата по маршруту")) mapKey = "route_bonus";

                          const isNumericCol = mapKey !== "";
                          
                          // Находим первый не скрытый столбец для надписи "Итого"
                          const firstVisibleIdx = 0; 
                          
                          if (idx === firstVisibleIdx) {
                            // Объединяем ячейки до первой числовой колонки
                            let span = 1;
                            for (let j = idx + 1; j < arr.length; j++) {
                              const nextCol = arr[j];
                              const nextKey = nextCol.label.toLowerCase();
                              if (nextKey.includes("стоимость продукции") || 
                                  nextKey.includes("вес нетто") || 
                                  nextKey.includes("кол. заезд") || 
                                  nextKey.includes("пробег") || 
                                  nextKey.includes("стоимость маршрута") || 
                                  nextKey.includes("доплата по маршруту")) break;
                              span++;
                            }
                            return (
                              <td 
                                key="total-label" 
                                colSpan={span} 
                                className={styles.td} 
                                style={{ fontWeight: 700, textAlign: "center", background: "var(--accent-light-bg)" }}
                              >
                                Итого
                              </td>
                            );
                          }

                          // Пропускаем ячейки, которые поглощены colSpan
                          let isSpanned = false;
                          for (let j = 0; j < idx; j++) {
                            const prevCol = arr[j];
                            const prevKey = prevCol.label.toLowerCase();
                            if (!(prevKey.includes("стоимость продукции") || 
                                  prevKey.includes("вес нетто") || 
                                  prevKey.includes("кол. заезд") || 
                                  prevKey.includes("пробег") || 
                                  prevKey.includes("стоимость маршрута") || 
                                  prevKey.includes("доплата по маршруту"))) {
                              // Это потенциальный старт span. Нам нужно проверить, поглощает ли он текущий idx.
                              // Но проще: если текущая колонка не числовая, и мы уже вывели "Итого", то она spanned.
                              if (!isNumericCol) isSpanned = true;
                            } else {
                              // Как только встретили числовую, span закончился.
                              break;
                            }
                          }
                          if (isSpanned) return null;

                          if (isNumericCol) {
                            const val = totalsRow.totals[mapKey];
                            return (
                              <td 
                                key={`total-val-${col.key}`} 
                                className={styles.td} 
                                style={{ fontWeight: 700, textAlign: "center", background: "var(--accent-light-bg)" }}
                              >
                                {val !== undefined ? String(val.toFixed(2)).replace(".", ",") : ""}
                              </td>
                            );
                          }

                          return (
                            <td 
                              key={`total-empty-${col.key}`} 
                              className={styles.td} 
                              style={{ background: "var(--accent-light-bg)" }}
                            />
                          );
                        })}
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && !error && data && subTab === "analytics" && (
          <div>
            <div className={styles.tabBar} style={{ marginBottom: 12 }}>
              <button
                className={`${styles.tabButton} ${analyticsView === "general" ? styles.tabButtonActive : ""}`}
                onClick={() => setAnalyticsView("general")}
              >
                Общая аналитика
              </button>
              <button
                className={`${styles.tabButton} ${analyticsView === "ip" ? styles.tabButtonActive : ""}`}
                onClick={() => setAnalyticsView("ip")}
              >
                Аналитика по ИП
              </button>
            </div>

            <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div className={styles.muted} style={{ fontSize: 12 }}>Период</div>
              <input
                type="date"
                className={styles.input}
                value={analyticsDate.from}
                onChange={(e) => setAnalyticsDate((prev) => ({ ...prev, from: e.target.value }))}
              />
              <input
                type="date"
                className={styles.input}
                value={analyticsDate.to}
                onChange={(e) => setAnalyticsDate((prev) => ({ ...prev, to: e.target.value }))}
              />
              {analyticsView === "general" && (
                <>
                  <select
                    className={styles.select}
                    value={analyticsRouteListId}
                    onChange={(e) => setAnalyticsRouteListId(e.target.value)}
                  >
                    <option value="">Список маршрутов</option>
                    {lists.filter((l) => l.type === "ROUTE").map((list) => (
                      <option key={list.id} value={list.id}>{list.name}</option>
                    ))}
                  </select>
                  <select
                    className={styles.select}
                    value={analyticsRoute}
                    onChange={(e) => setAnalyticsRoute(e.target.value)}
                  >
                    <option value="">Маршрут</option>
                    {routeAnalytics.map((r) => (
                      <option key={r.routeName} value={r.routeName}>{r.routeName}</option>
                    ))}
                  </select>
                </>
              )}
            </div>

            {analyticsView === "general" ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>Маршрут</th>
                      <th className={styles.th}>Кол-во маршрутов</th>
                      <th className={styles.th}>Средняя стоимость продукции</th>
                      <th className={styles.th}>Средний вес нетто, т</th>
                      <th className={styles.th}>Среднее кол-во заездов</th>
                      <th className={styles.th}>Средний пробег, км</th>
                      <th className={styles.th}>Средняя стоимость маршрута</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRouteAnalytics.length === 0 ? (
                      <tr>
                        <td colSpan={7} className={styles.td} style={{ textAlign: "center", opacity: 0.7 }}>
                          Нет данных
                        </td>
                      </tr>
                    ) : (
                      filteredRouteAnalytics.map((r) => (
                        <tr key={r.routeName}>
                          <td className={styles.td}>{r.routeName}</td>
                          <td className={styles.td}>{r.routeCount}</td>
                          <td className={styles.td}>
                            {r.costCount ? formatTotalNumber(r.costSum / r.costCount) : "—"}
                          </td>
                          <td className={styles.td}>
                            {r.weightCount ? formatTotalNumber(r.weightSum / r.weightCount) : "—"}
                          </td>
                          <td className={styles.td}>
                            {r.tripsCount ? formatTotalNumber(r.tripsSum / r.tripsCount) : "—"}
                          </td>
                          <td className={styles.td}>
                            {r.mileageCount ? formatTotalNumber(r.mileageSum / r.mileageCount) : "—"}
                          </td>
                          <td className={styles.td}>
                            {r.routeCostCount ? formatTotalNumber(r.routeCostSum / r.routeCostCount) : "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div>
                {ipAnalytics.length > 0 && (
                  <div className={styles.card} style={{ marginBottom: 20, padding: "20px 24px" }}>
                    <div style={{ fontWeight: 700, marginBottom: 20, fontSize: 16 }}>Сравнение ИП по доходу</div>
                    <div style={{ 
                      display: "flex", 
                      alignItems: "flex-end", 
                      gap: 20, 
                      height: 240, 
                      paddingBottom: 8,
                      borderBottom: "1px solid var(--table-border)"
                    }}>
                      {(() => {
                        const max = Math.max(...ipAnalytics.map((i) => i.totalSum), 1);
                        return ipAnalytics.map((ip) => (
                          <div 
                            key={`ip-col-${ip.ipName}`} 
                            style={{ 
                              flex: 1, 
                              display: "flex", 
                              flexDirection: "column", 
                              alignItems: "center", 
                              gap: 8,
                              height: "100%",
                              justifyContent: "flex-end"
                            }}
                          >
                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textAlign: "center" }}>
                              {formatTotalNumber(ip.totalSum)} ₽
                            </div>
                            <div
                              style={{
                                width: "100%",
                                maxWidth: 60,
                                height: `${Math.round((ip.totalSum / max) * 100)}%`,
                                background: "linear-gradient(180deg, #93c5fd 0%, #60a5fa 100%)",
                                borderRadius: "6px 6px 0 0",
                                minHeight: 4,
                                transition: "height 0.3s ease"
                              }}
                              title={`${ip.ipName}: ${formatTotalNumber(ip.totalSum)} ₽`}
                            />
                            <div style={{ 
                              fontSize: 11, 
                              fontWeight: 600, 
                              color: "var(--text)",
                              textAlign: "center",
                              whiteSpace: "nowrap",
                              maxWidth: 90,
                              overflow: "hidden",
                              textOverflow: "ellipsis"
                            }}>
                              {ip.ipName}
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                )}

                <div style={{ display: "grid", gap: 16 }}>
                  {ipAnalytics.length === 0 ? (
                    <div className={styles.card} style={{ textAlign: "center", opacity: 0.7 }}>
                      Нет данных по ИП за выбранный период
                    </div>
                  ) : (
                    ipAnalytics.map((ip) => (
                      <div key={`ip-detail-${ip.ipName}`} className={styles.card} style={{ marginTop: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>{ip.ipName}</div>
                            <div className={styles.muted}>{ip.routeCount} маршрутов всего</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontWeight: 800, fontSize: 18, color: "var(--accent-color)" }}>{formatTotalNumber(ip.totalSum)} ₽</div>
                            <div className={styles.muted}>общий доход</div>
                          </div>
                        </div>
                        
                        <div style={{ borderTop: "1px solid var(--table-border)", paddingTop: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.025em" }}>
                            Детализация по маршрутам
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
                            {ip.routesList.map((r) => (
                              <div key={`${ip.ipName}-${r.name}`} style={{ 
                                background: "var(--background)", 
                                border: "1px solid var(--table-border)", 
                                borderRadius: 10, 
                                padding: "10px 12px",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center"
                              }}>
                                <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
                                  <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {r.name}
                                  </div>
                                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.count} поездок</div>
                                </div>
                                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-muted)" }}>
                                  {formatTotalNumber(r.sum)} ₽
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {!loading && !error && data && subTab === "docs" && (
          <div className={styles.card} style={{ marginTop: 0, padding: 12 }}>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ padding: 12, border: "1px solid var(--card-border)", borderRadius: 10, background: "var(--card-bg)" }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Договор аренды автотранспортного средства</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <select
                    className={styles.select}
                    value={rentalLessor}
                    onChange={(e) => setRentalLessor(e.target.value)}
                  >
                    <option value="">ФИО арендодателя</option>
                    {ipOptions.DRIVER.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                  <select
                    className={styles.select}
                    value={rentalVehicle}
                    onChange={(e) => setRentalVehicle(e.target.value)}
                  >
                    <option value="">Номер авто</option>
                    {ipOptions.VEHICLE.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                  <select
                    className={styles.select}
                    value={rentalLessee}
                    onChange={(e) => setRentalLessee(e.target.value)}
                  >
                    <option value="">ФИО арендатора</option>
                    {ipOptions.DRIVER.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                  <button className={styles.button} onClick={createRentalDoc} disabled={!rentalLessor || !rentalVehicle || !rentalLessee}>
                    Создать
                  </button>
                </div>
              </div>

              <div style={{ padding: 12, border: "1px solid var(--card-border)", borderRadius: 10, background: "var(--card-bg)" }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Трудовой договор</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <select
                    className={styles.select}
                    value={employmentIpId}
                    onChange={(e) => setEmploymentIpId(e.target.value)}
                  >
                    <option value="">Выберите ИП</option>
                    {ipRecords.map((ip) => (
                      <option key={ip.id} value={ip.id}>{ip.name}</option>
                    ))}
                  </select>
                  <select
                    className={styles.select}
                    value={employmentDriver}
                    onChange={(e) => setEmploymentDriver(e.target.value)}
                  >
                    <option value="">ФИО водителя</option>
                    {ipOptions.DRIVER.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                  <button className={styles.button} onClick={createEmploymentDoc} disabled={!employmentIpId || !employmentDriver}>
                    Создать
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {!loading && !error && data && subTab === "cards" && (
          <div className={styles.card} style={{ marginTop: 0, padding: 12 }}>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ padding: 12, border: "1px solid var(--card-border)", borderRadius: 10, background: "var(--card-bg)" }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Карточка водителя</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <select
                    className={styles.select}
                    value={newDriverCard}
                    onChange={(e) => setNewDriverCard(e.target.value)}
                  >
                    <option value="">ФИО водителя</option>
                    {ipOptions.DRIVER.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                  <button className={styles.button} onClick={addDriverCard} disabled={!newDriverCard.trim()}>
                    Создать
                  </button>
                </div>
                <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {driverCards.length === 0 ? (
                    <span className={styles.muted}>Карточек нет</span>
                  ) : (
                    driverCards.map((card) => (
                      <span key={card.id} className={styles.badge} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        {card.name}
                        <button
                          onClick={() => setDriverModalId(card.id)}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12 }}
                        >
                          Редактировать
                        </button>
                        <button
                          onClick={() => removeCard("driver", card.id)}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12 }}
                        >
                          ✕
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div style={{ padding: 12, border: "1px solid var(--card-border)", borderRadius: 10, background: "var(--card-bg)" }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Карточка авто</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <select
                    className={styles.select}
                    value={newVehicleCard}
                    onChange={(e) => setNewVehicleCard(e.target.value)}
                  >
                    <option value="">Номер авто</option>
                    {ipOptions.VEHICLE.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                  <button className={styles.button} onClick={addVehicleCard} disabled={!newVehicleCard.trim()}>
                    Создать
                  </button>
                </div>
                <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {vehicleCards.length === 0 ? (
                    <span className={styles.muted}>Карточек нет</span>
                  ) : (
                    vehicleCards.map((card) => (
                      <span key={card.id} className={styles.badge} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        {card.name}
                        <button
                          onClick={() => setVehicleModalId(card.id)}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12 }}
                        >
                          Редактировать
                        </button>
                        <button
                          onClick={() => removeCard("vehicle", card.id)}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12 }}
                        >
                          ✕
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div style={{ padding: 12, border: "1px solid var(--card-border)", borderRadius: 10, background: "var(--card-bg)" }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Карточка ИП</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <select
                    className={styles.select}
                    value={newIpCardId}
                    onChange={(e) => setNewIpCardId(e.target.value)}
                  >
                    <option value="">Выберите ИП</option>
                    {ipRecords.map((ip) => (
                      <option key={ip.id} value={ip.id}>{ip.name}</option>
                    ))}
                  </select>
                  <button className={styles.button} onClick={addIpCard} disabled={!newIpCardId}>
                    Создать
                  </button>
                </div>
                <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {ipCards.length === 0 ? (
                    <span className={styles.muted}>Карточек нет</span>
                  ) : (
                    ipCards.map((card) => (
                      <span key={card.id} className={styles.badge} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        {card.ipName}
                        <button
                          onClick={() => setIpModalId(card.id)}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12 }}
                        >
                          Редактировать
                        </button>
                        <button
                          onClick={() => removeCard("ip", card.id)}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12 }}
                        >
                          ✕
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>
            {driverModalId && (
              <div
                onClick={() => setDriverModalId(null)}
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(17, 24, 39, 0.45)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 50,
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: "min(920px, 92vw)",
                    maxHeight: "85vh",
                    overflow: "auto",
                    background: "var(--card-bg)",
                    borderRadius: 12,
                    border: "1px solid var(--card-border)",
                    padding: 16,
                  }}
                >
                  {(() => {
                    const card = driverCards.find((c) => c.id === driverModalId);
                    if (!card) return null;
                    return (
                      <div style={{ display: "grid", gap: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ fontWeight: 700 }}>Карточка водителя: {card.name}</div>
                          <button className={styles.button} onClick={() => setDriverModalId(null)}>
                            Закрыть
                          </button>
                        </div>

                        <div style={{ padding: 12, border: "1px solid var(--card-border)", borderRadius: 10 }}>
                          <div style={{ fontWeight: 600, marginBottom: 8 }}>Паспорт РФ</div>
                          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                            <input className={styles.input} placeholder="Серия" value={card.passport.series} onChange={(e) => updateDriverCard(card.id, "passport", "series", e.target.value)} />
                            <input className={styles.input} placeholder="Номер" value={card.passport.number} onChange={(e) => updateDriverCard(card.id, "passport", "number", e.target.value)} />
                            <input className={styles.input} placeholder="Кем выдан" value={card.passport.issuedBy} onChange={(e) => updateDriverCard(card.id, "passport", "issuedBy", e.target.value)} />
                            <input className={styles.input} type="date" value={card.passport.issuedAt} onChange={(e) => updateDriverCard(card.id, "passport", "issuedAt", e.target.value)} />
                            <input className={styles.input} placeholder="Код подразделения" value={card.passport.code} onChange={(e) => updateDriverCard(card.id, "passport", "code", e.target.value)} />
                            <input className={styles.input} placeholder="Адрес регистрации" value={card.passport.address} onChange={(e) => updateDriverCard(card.id, "passport", "address", e.target.value)} />
                          </div>
                        </div>

                        <div style={{ padding: 12, border: "1px solid var(--card-border)", borderRadius: 10 }}>
                          <div style={{ fontWeight: 600, marginBottom: 8 }}>Водительское удостоверение</div>
                          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                            <input className={styles.input} placeholder="Серия" value={card.license.series} onChange={(e) => updateDriverCard(card.id, "license", "series", e.target.value)} />
                            <input className={styles.input} placeholder="Номер" value={card.license.number} onChange={(e) => updateDriverCard(card.id, "license", "number", e.target.value)} />
                            <input className={styles.input} placeholder="Кем выдано" value={card.license.issuedBy} onChange={(e) => updateDriverCard(card.id, "license", "issuedBy", e.target.value)} />
                            <input className={styles.input} type="date" value={card.license.issuedAt} onChange={(e) => updateDriverCard(card.id, "license", "issuedAt", e.target.value)} />
                            <input className={styles.input} placeholder="Категории" value={card.license.categories} onChange={(e) => updateDriverCard(card.id, "license", "categories", e.target.value)} />
                          </div>
                        </div>

                        <div style={{ padding: 12, border: "1px solid var(--card-border)", borderRadius: 10 }}>
                          <div style={{ fontWeight: 600, marginBottom: 8 }}>Патент</div>
                          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                            <input className={styles.input} placeholder="Номер" value={card.patent.number} onChange={(e) => updateDriverCard(card.id, "patent", "number", e.target.value)} />
                            <input className={styles.input} type="date" value={card.patent.issuedAt} onChange={(e) => updateDriverCard(card.id, "patent", "issuedAt", e.target.value)} />
                            <input className={styles.input} type="date" value={card.patent.validTo} onChange={(e) => updateDriverCard(card.id, "patent", "validTo", e.target.value)} />
                          </div>
                        </div>

                        <div style={{ padding: 12, border: "1px solid var(--card-border)", borderRadius: 10 }}>
                          <div style={{ fontWeight: 600, marginBottom: 8 }}>Санкнижка</div>
                          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                            <input className={styles.input} placeholder="Номер" value={card.medbook.number} onChange={(e) => updateDriverCard(card.id, "medbook", "number", e.target.value)} />
                            <input className={styles.input} type="date" value={card.medbook.issuedAt} onChange={(e) => updateDriverCard(card.id, "medbook", "issuedAt", e.target.value)} />
                            <input className={styles.input} type="date" value={card.medbook.validTo} onChange={(e) => updateDriverCard(card.id, "medbook", "validTo", e.target.value)} />
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
            {vehicleModalId && (
              <div
                onClick={() => setVehicleModalId(null)}
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(17, 24, 39, 0.45)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 50,
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: "min(920px, 92vw)",
                    maxHeight: "85vh",
                    overflow: "auto",
                    background: "var(--card-bg)",
                    borderRadius: 12,
                    border: "1px solid var(--card-border)",
                    padding: 16,
                  }}
                >
                  {(() => {
                    const card = vehicleCards.find((c) => c.id === vehicleModalId);
                    if (!card) return null;
                    return (
                      <div style={{ display: "grid", gap: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ fontWeight: 700 }}>Карточка авто: {card.name}</div>
                          <button className={styles.button} onClick={() => setVehicleModalId(null)}>
                            Закрыть
                          </button>
                        </div>

                        <div style={{ padding: 12, border: "1px solid var(--card-border)", borderRadius: 10 }}>
                          <div style={{ fontWeight: 600, marginBottom: 8 }}>СТС</div>
                          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                            <input className={styles.input} placeholder="Номер" value={card.sts.number} onChange={(e) => updateVehicleCard(card.id, "sts", "number", e.target.value)} />
                            <input className={styles.input} type="date" value={card.sts.issuedAt} onChange={(e) => updateVehicleCard(card.id, "sts", "issuedAt", e.target.value)} />
                            <input className={styles.input} placeholder="Кем выдано" value={card.sts.issuedBy} onChange={(e) => updateVehicleCard(card.id, "sts", "issuedBy", e.target.value)} />
                            <input className={styles.input} placeholder="VIN" value={card.sts.vin} onChange={(e) => updateVehicleCard(card.id, "sts", "vin", e.target.value)} />
                            <input className={styles.input} placeholder="Госномер" value={card.sts.regNumber} onChange={(e) => updateVehicleCard(card.id, "sts", "regNumber", e.target.value)} />
                          </div>
                        </div>

                        <div style={{ padding: 12, border: "1px solid var(--card-border)", borderRadius: 10 }}>
                          <div style={{ fontWeight: 600, marginBottom: 8 }}>ПТС</div>
                          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                            <input className={styles.input} placeholder="Номер" value={card.pts.number} onChange={(e) => updateVehicleCard(card.id, "pts", "number", e.target.value)} />
                            <input className={styles.input} type="date" value={card.pts.issuedAt} onChange={(e) => updateVehicleCard(card.id, "pts", "issuedAt", e.target.value)} />
                            <input className={styles.input} placeholder="Кем выдано" value={card.pts.issuedBy} onChange={(e) => updateVehicleCard(card.id, "pts", "issuedBy", e.target.value)} />
                            <input className={styles.input} placeholder="VIN" value={card.pts.vin} onChange={(e) => updateVehicleCard(card.id, "pts", "vin", e.target.value)} />
                            <input className={styles.input} placeholder="Госномер" value={card.pts.regNumber} onChange={(e) => updateVehicleCard(card.id, "pts", "regNumber", e.target.value)} />
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
            {ipModalId && (
              <div
                onClick={() => setIpModalId(null)}
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(17, 24, 39, 0.45)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 50,
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: "min(920px, 92vw)",
                    maxHeight: "85vh",
                    overflow: "auto",
                    background: "var(--card-bg)",
                    borderRadius: 12,
                    border: "1px solid var(--card-border)",
                    padding: 16,
                  }}
                >
                  {(() => {
                    const card = ipCards.find((c) => c.id === ipModalId);
                    if (!card) return null;
                    return (
                      <div style={{ display: "grid", gap: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ fontWeight: 700 }}>Карточка ИП: {card.ipName}</div>
                          <button className={styles.button} onClick={() => setIpModalId(null)}>
                            Закрыть
                          </button>
                        </div>

                        <div style={{ padding: 12, border: "1px solid var(--card-border)", borderRadius: 10 }}>
                          <div style={{ fontWeight: 600, marginBottom: 8 }}>Данные ИП</div>
                          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                            <input className={styles.input} placeholder="ИНН" value={card.ip.inn} onChange={(e) => updateIpCard(card.id, "ip", "inn", e.target.value)} />
                            <input className={styles.input} placeholder="ОГРНИП" value={card.ip.ogrnip} onChange={(e) => updateIpCard(card.id, "ip", "ogrnip", e.target.value)} />
                            <input className={styles.input} placeholder="Адрес" value={card.ip.address} onChange={(e) => updateIpCard(card.id, "ip", "address", e.target.value)} />
                            <input className={styles.input} placeholder="Телефон" value={card.ip.phone} onChange={(e) => updateIpCard(card.id, "ip", "phone", e.target.value)} />
                            <input className={styles.input} placeholder="Email" value={card.ip.email} onChange={(e) => updateIpCard(card.id, "ip", "email", e.target.value)} />
                          </div>
                        </div>

                        <div style={{ padding: 12, border: "1px solid var(--card-border)", borderRadius: 10 }}>
                          <div style={{ fontWeight: 600, marginBottom: 8 }}>Расчетный счет</div>
                          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                            <input className={styles.input} placeholder="Расчетный счет" value={card.bank.account} onChange={(e) => updateIpCard(card.id, "bank", "account", e.target.value)} />
                            <input className={styles.input} placeholder="Банк" value={card.bank.bankName} onChange={(e) => updateIpCard(card.id, "bank", "bankName", e.target.value)} />
                            <input className={styles.input} placeholder="БИК" value={card.bank.bik} onChange={(e) => updateIpCard(card.id, "bank", "bik", e.target.value)} />
                            <input className={styles.input} placeholder="Корр. счет" value={card.bank.corrAccount} onChange={(e) => updateIpCard(card.id, "bank", "corrAccount", e.target.value)} />
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        )}

        {!loading && !error && data && subTab === "ip" && (
          <div className={styles.card} style={{ marginTop: 0, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Создание списков</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <input
                className={styles.input}
                placeholder="Название списка"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
              />
              <select
                className={styles.select}
                value={newListType}
                onChange={(e) => setNewListType(e.target.value as any)}
              >
                <option value="ROUTE">Список маршрутов</option>
                <option value="DRIVER">Список водителей</option>
                <option value="VEHICLE">Список авто</option>
              </select>
              <button className={styles.button} onClick={addList}>Создать список</button>
            </div>
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              {lists.map((l) => (
                <div key={l.id} style={{ padding: 8, border: "1px solid var(--card-border)", borderRadius: 10, background: "var(--card-bg)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    {editingListId === l.id ? (
                      <input
                        className={styles.input}
                        value={editingListName}
                        onChange={(e) => setEditingListName(e.target.value)}
                        style={{ maxWidth: 240 }}
                      />
                    ) : (
                      <div style={{ fontWeight: 600 }}>{l.name}</div>
                    )}
                    <div style={{ display: "flex", gap: 6 }}>
                      {editingListId === l.id ? (
                        <button className={styles.button} onClick={saveEditList} style={{ padding: "4px 8px" }}>
                          Сохранить
                        </button>
                      ) : (
                        <button
                          className={styles.button}
                          onClick={() => startEditList(l.id, l.name)}
                          style={{ padding: "4px 8px" }}
                        >
                          Редактировать
                        </button>
                      )}
                      <button className={styles.button} onClick={() => deleteList(l.id)} style={{ padding: "4px 8px" }}>
                        Удалить
                      </button>
                    </div>
                  </div>
                  <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <select
                      className={styles.select}
                      defaultValue=""
                      onChange={(e) => {
                        addListItem(l.id, e.target.value);
                        e.currentTarget.value = "";
                      }}
                    >
                      <option value="">+ Добавить из таблицы</option>
                      {listOptionsByType[l.type].map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {l.items.map((item) => (
                        <span key={item} className={styles.badge} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          {item}
                          <button
                            onClick={() => removeListItem(l.id, item)}
                            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12 }}
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 18, borderTop: "1px solid var(--card-border)", paddingTop: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Создание ИП</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <input
                  className={styles.input}
                  placeholder="Название ИП"
                  value={newIpName}
                  onChange={(e) => setNewIpName(e.target.value)}
                />
                <button className={styles.button} onClick={addIpRecord}>Создать ИП</button>
              </div>
              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                {ipRecords.map((ip) => (
                  <div key={ip.id} style={{ padding: 10, border: "1px solid var(--card-border)", borderRadius: 10, background: "var(--card-bg)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <div style={{ fontWeight: 600 }}>{ip.name}</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {editingIpId === ip.id ? (
                          <>
                            <button className={styles.button} onClick={() => saveEditIp(ip.id)} style={{ padding: "4px 8px" }}>
                              Сохранить
                            </button>
                            <button className={styles.button} onClick={() => cancelEditIp(ip.id)} style={{ padding: "4px 8px" }}>
                              Отменить
                            </button>
                          </>
                        ) : (
                          <button className={styles.button} onClick={() => startEditIp(ip.id)} style={{ padding: "4px 8px" }}>
                            Редактировать
                          </button>
                        )}
                        <button className={styles.button} onClick={() => deleteIpRecord(ip.id)} style={{ padding: "4px 8px" }}>
                          Удалить
                        </button>
                      </div>
                    </div>
                    {editingIpId === ip.id ? (
                      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                        <div>
                          <div className={styles.muted}>Водители</div>
                          <div className={styles.filterList} style={{ maxHeight: 180 }}>
                            {(ipOptions.DRIVER || []).map((opt) => {
                              const normalized = normalizeKey(opt);
                              const ownerIp = usedItems.drivers.get(normalized);
                              // Allow if unused OR if used by current IP (when editing)
                              const isUnavailable = ownerIp && ownerIp !== ip.name;
                              const isComplete = driverCardCompleteness.get(normalized) ?? false;

                              if (isUnavailable) return null;

                              return (
                                <label
                                  key={opt}
                                  className={styles.filterItem}
                                  style={isComplete ? undefined : { background: "var(--danger-bg)", borderRadius: 6 }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={(ipDrafts[ip.id]?.drivers || []).includes(opt)}
                                    onChange={() => toggleIpValue(ip.id, "drivers", opt)}
                                  />
                                  {opt}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                        <div>
                          <div className={styles.muted}>Авто</div>
                          <div className={styles.filterList} style={{ maxHeight: 180 }}>
                            {(ipOptions.VEHICLE || []).map((opt) => {
                              const normalized = normalizeKey(opt);
                              const ownerIp = usedItems.vehicles.get(normalized);
                              const isUnavailable = ownerIp && ownerIp !== ip.name;
                              const isComplete = vehicleCardCompleteness.get(normalized) ?? false;
                              if (isUnavailable) return null;

                              return (
                                <label
                                  key={opt}
                                  className={styles.filterItem}
                                  style={isComplete ? undefined : { background: "var(--danger-bg)", borderRadius: 6 }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={(ipDrafts[ip.id]?.vehicles || []).includes(opt)}
                                    onChange={() => toggleIpValue(ip.id, "vehicles", opt)}
                                  />
                                  {opt}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                        <div>
                          <div className={styles.muted}>Маршруты</div>
                          <div className={styles.filterList} style={{ maxHeight: 180 }}>
                            {(ipOptions.ROUTE || []).map((opt) => (
                              <label key={opt} className={styles.filterItem}>
                                <input
                                  type="checkbox"
                                  checked={(ipDrafts[ip.id]?.routes || []).includes(opt)}
                                  onChange={() => toggleIpValue(ip.id, "routes", opt)}
                                />
                                {opt}
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                        <div>
                          <div className={styles.muted}>Водители</div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {(ip.drivers || []).length === 0 ? (
                              <span className={styles.muted}>Нет</span>
                            ) : (
                              ip.drivers.map((item) => (
                                <span key={item} className={styles.badge}>{item}</span>
                              ))
                            )}
                          </div>
                        </div>
                        <div>
                          <div className={styles.muted}>Авто</div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {(ip.vehicles || []).length === 0 ? (
                              <span className={styles.muted}>Нет</span>
                            ) : (
                              ip.vehicles.map((item) => (
                                <span key={item} className={styles.badge}>{item}</span>
                              ))
                            )}
                          </div>
                        </div>
                        <div>
                          <div className={styles.muted}>Маршруты</div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {(ip.routes || []).length === 0 ? (
                              <span className={styles.muted}>Нет</span>
                            ) : (
                              ip.routes.map((item) => (
                                <span key={item} className={styles.badge}>{item}</span>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
