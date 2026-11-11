"use client";

import { useState } from "react";
import { Button, Card } from "@/components/ui/kit";

export function OwnerAccess() {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <main className="mx-auto max-w-md px-4 py-20">
      <Card className="p-6">
        <h1 className="text-2xl font-semibold">AgentPaL owner access</h1>
        <p className="mt-2 text-sm text-[var(--mm-muted)]">Enter the access key configured on this deployment.</p>
        <form className="mt-4 grid gap-3" onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            const response = await fetch("/api/security/session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key }),
            });
            if (!response.ok) throw new Error((await response.json()).error || "Sign-in failed.");
            window.location.reload();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Sign-in failed.");
          } finally {
            setBusy(false);
          }
        }}>
          <label className="grid gap-1 text-sm">
            Owner access key
            <input type="password" autoComplete="current-password" required value={key} maxLength={256}
              onChange={(event) => setKey(event.target.value)} className="rounded-lg border bg-transparent p-2" />
          </label>
          <Button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
          {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        </form>
      </Card>
    </main>
  );
}
