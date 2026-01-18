"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import styles from "./Sidebar.module.css";

export default function Sidebar() {
  const [collapsed, setCollapsed] = React.useState(false);
  const pathname = usePathname();
  const router = useRouter();

  React.useEffect(() => {
    if (collapsed) {
      document.body.setAttribute("data-sidebar-collapsed", "true");
    } else {
      document.body.removeAttribute("data-sidebar-collapsed");
    }
  }, [collapsed]);

  const menuItems = [
    { path: "/", label: "Сводка", icon: "📊" },
    { path: "/vehicles", label: "Авто", icon: "🚗" },
    { path: "/drivers", label: "Водители", icon: "🧑‍✈️" },
    { path: "/repairs", label: "Ремонт", icon: "🔧" },
    { path: "/compensations", label: "Компенсация", icon: "💰" },
    { path: "/receipts", label: "Чеки", icon: "🧾" },
    { path: "/late", label: "Опоздания", icon: "⏰" },
  ];

  const handleLogout = () => {
    fetch(`/api/auth/logout`, {
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
          const isActive = pathname === item.path;
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
