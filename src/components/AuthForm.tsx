"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AuthForm({ mode, redirectTo }: { mode: "login" | "setup"; redirectTo: string }) {
  const router = useRouter();
  const isSetup = mode === "setup";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "Fehler");
      setBusy(false);
      return;
    }
    router.push(redirectTo);
    router.refresh();
  }

  const input = "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none";

  return (
    <div className="mx-auto max-w-sm">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight">{isSetup ? "Konto einrichten" : "Anmelden"}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {isSetup ? "Lege dein Admin-Konto an. Es ist der einzige Zugang zu deiner Instanz." : "Melde dich an deiner OpenInvoice-Instanz an."}
        </p>
      </div>
      <form onSubmit={submit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
        {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">E-Mail</span>
          <input className={input} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Passwort</span>
          <input
            className={input}
            type="password"
            autoComplete={isSetup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={isSetup ? 8 : undefined}
          />
          {isSetup && <span className="text-xs text-slate-400">Mindestens 8 Zeichen.</span>}
        </label>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {busy ? "…" : isSetup ? "Konto erstellen" : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
