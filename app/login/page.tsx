"use client";

import { useState } from "react";

export default function Login() {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");

    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase }),
    });

    if (res.ok) {
      window.location.href = "/";
    } else {
      setError("Incorrect passphrase");
      setBusy(false);
    }
  }

  return (
    <main>
      <form className="login" onSubmit={submit}>
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Passphrase"
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
        />
        <button className="action" type="submit" disabled={busy || !passphrase}>
          Enter
        </button>
        <div className="error">{error}</div>
      </form>
    </main>
  );
}
