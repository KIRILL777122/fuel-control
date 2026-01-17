"use client";

import React from "react";

export default function LogoutButton() {
  return (
    <button
      style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #d7d7e0", background: "#fff", cursor: "pointer" }}
      onClick={() => {
        fetch(
          `${
            process.env.NEXT_PUBLIC_API_BASE_URL ||
            process.env.NEXT_PUBLIC_API_BASE ||
            process.env.API_BASE_URL ||
            "http://localhost:3000"
          }/api/auth/logout`,
          {
            method: "POST",
            credentials: "include",
          }
        )
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
