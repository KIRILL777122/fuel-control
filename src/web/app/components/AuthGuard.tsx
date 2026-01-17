"use client";

import React from "react";

const LOGIN = process.env.NEXT_PUBLIC_WEB_ADMIN_LOGIN || process.env.WEB_ADMIN_LOGIN || "admin";
const PASSWORD = process.env.NEXT_PUBLIC_WEB_ADMIN_PASSWORD || process.env.WEB_ADMIN_PASSWORD || "password";
const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  process.env.API_BASE_URL ||
  "http://localhost:3000";

type Props = { children: React.ReactNode };

export default function AuthGuard({ children }: Props) {
  const [authed, setAuthed] = React.useState(false);
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: "include" });
        if (res.ok) setAuthed(true);
      } finally {
        setShow(true);
      }
    };
    check();
  }, []);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const login = (form.get("login") as string) || "";
    const pass = (form.get("password") as string) || "";
    if (login !== LOGIN || pass !== PASSWORD) {
      alert("Неверный логин/пароль");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ login, password: pass }),
      });
      const data = await res.json();
      if (res.ok && data?.token) {
        setAuthed(true);
        window.location.reload();
      } else {
        alert(`Ошибка входа: ${data?.error || res.status}`);
      }
    } catch (err: any) {
      alert(`Ошибка: ${err?.message ?? err}`);
    }
  };

  if (!show) return null;
  if (authed) return <>{children}</>;

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f5f5" }}>
      <form
        onSubmit={submit}
        style={{ background: "#fff", padding: 20, borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,0.1)", width: 320 }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>Вход</h3>
        <label style={{ display: "block", marginBottom: 8 }}>
          Логин
          <input name="login" defaultValue="" style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }} />
        </label>
        <label style={{ display: "block", marginBottom: 8 }}>
          Пароль
          <input
            name="password"
            type="password"
            defaultValue=""
            style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #d7d7e0" }}
          />
        </label>
        <button type="submit" style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #d7d7e0", background: "#4338ca", color: "#fff" }}>
          Войти
        </button>
      </form>
    </div>
  );
}
