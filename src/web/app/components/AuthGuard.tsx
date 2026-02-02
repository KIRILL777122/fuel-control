"use client";

import React from "react";

type Props = { children: React.ReactNode };

export default function AuthGuard({ children }: Props) {
  const [authed, setAuthed] = React.useState(false);
  const [show, setShow] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`/api/auth/me`, { credentials: "include" });
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
    setError(null);
    try {
      const res = await fetch(`/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ login, password: pass }),
      });
      if (res.status === 401) {
        setError("Неверный логин/пароль");
        return;
      }
      if (!res.ok) {
        setError(`Ошибка входа: ${res.status}`);
        return;
      }
      const me = await fetch(`/api/auth/me`, { credentials: "include" });
      if (me.ok) {
        setAuthed(true);
        window.location.reload();
      } else {
        setError("Сессия не установлена");
      }
    } catch (err: any) {
      setError(`Ошибка: ${err?.message ?? err}`);
    }
  };

  if (!show) return null;
  if (authed) return <>{children}</>;

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--background)" }}>
      <form
        onSubmit={submit}
        style={{ background: "var(--card-bg)", color: "var(--text)", padding: 20, borderRadius: 12, boxShadow: "var(--card-shadow)", border: "1px solid var(--card-border)", width: 320 }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>Вход</h3>
        {error && <div style={{ color: "var(--error-color)", marginBottom: 8 }}>{error}</div>}
        <label style={{ display: "block", marginBottom: 8 }}>
          Логин
          <input name="login" defaultValue="" style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }} autoComplete="username" />
        </label>
        <label style={{ display: "block", marginBottom: 8 }}>
          Пароль
          <input
            name="password"
            type="password"
            defaultValue=""
            style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--text)" }}
            autoComplete="current-password"
          />
        </label>
        <button type="submit" style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--primary-bg)", color: "var(--primary-text)" }}>
          Войти
        </button>
      </form>
    </div>
  );
}
