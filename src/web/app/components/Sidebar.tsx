"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import styles from "./Sidebar.module.css";

export default function Sidebar() {
  const [collapsed, setCollapsed] = React.useState(false);
  const [theme, setTheme] = React.useState<"light" | "dark">("light");
  const pathname = usePathname();
  const router = useRouter();

  React.useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as "light" | "dark" | null;
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.setAttribute("data-theme", savedTheme);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
      document.documentElement.setAttribute("data-theme", "dark");
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("theme", newTheme);
  };

  React.useEffect(() => {
    if (collapsed) {
      document.body.setAttribute("data-sidebar-collapsed", "true");
    } else {
      document.body.removeAttribute("data-sidebar-collapsed");
    }
  }, [collapsed]);

  const menuItems = [
    { path: "/add", label: "Авто и водители", icon: "🧑‍✈️" },
    { path: "/receipts", label: "Чеки", icon: "🧾" },
    { path: "/finance", label: "Финансы", icon: "📊" },
    { path: "/releases", label: "Выпуски", icon: "🗂️" },
    { path: "/compensations", label: "Компенсация", icon: "💰" },
    { path: "/late", label: "Опоздания", icon: "⏰" },
    { path: "/shifts", label: "График смен", icon: "📅" },
    { path: "/payments", label: "Оплата", icon: "💵" },
    { path: "/repair", label: "Ремонт", icon: "🔧" },
  ];

  const handleLogout = () => {
    fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    })
      .catch(() => {})
      .finally(() => {
        localStorage.removeItem("fuel-token");
        window.location.reload();
      });
  };

  return (
    <div className={`${styles.sidebar} ${collapsed ? styles.collapsed : ""}`}>
      <div className={styles.header}>
        {!collapsed && <h2 className={styles.title}>Топливо</h2>}
        <button
          className={styles.toggle}
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Развернуть" : "Свернуть"}
        >
          {collapsed ? "→" : "←"}
        </button>
      </div>
      <nav className={styles.nav}>
        {menuItems.map((item) => {
          // Highlight "Чеки" for root path too
          const isActive = pathname === item.path || (item.path === "/receipts" && pathname === "/");
          return (
            <button
              key={item.path}
              className={`${styles.menuItem} ${isActive ? styles.active : ""}`}
              onClick={() => router.push(item.path)}
            >
              <span className={styles.icon}>{item.icon}</span>
              {!collapsed && <span className={styles.label}>{item.label}</span>}
            </button>
          );
        })}
      </nav>
      <div className={styles.footer}>
        <button
          className={styles.themeToggle}
          onClick={toggleTheme}
          title={theme === "light" ? "Темная тема" : "Светлая тема"}
        >
          <span className={styles.icon}>{theme === "light" ? "🌙" : "☀️"}</span>
          {!collapsed && <span className={styles.label}>{theme === "light" ? "Ночной режим" : "Дневной режим"}</span>}
        </button>
        <button
          className={styles.menuItem}
          onClick={handleLogout}
          style={{ width: "100%" }}
        >
          <span className={styles.icon}>🚪</span>
          {!collapsed && <span className={styles.label}>Выйти</span>}
        </button>
      </div>
    </div>
  );
}
