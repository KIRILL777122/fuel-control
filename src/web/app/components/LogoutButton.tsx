"use client";

import React from "react";

export default function LogoutButton() {
  return (
    <button
      style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--card-bg)", color: "var(--text)", cursor: "pointer" }}
      onClick={() => {
        fetch(`/api/auth/logout`, {
            method: "POST",
            credentials: "include",
        })
          .catch(() => {})
          .finally(() => {
            localStorage.removeItem("fuel-token"); // cleanup старых версий
            location.reload();
          });
      }}
    >
      Выйти
    </button>
  );
}
