import { useState } from "react";
import { useSession } from "../hooks/useSession";
import { useOnline } from "../hooks/useOnline";
import { loginErrorMessage } from "../api/auth";

export default function LoginPage() {
  const { status, username, login } = useSession();
  const online = useOnline();
  const reauth = status === "reauth";
  const [user, setUser] = useState(username ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(user.trim(), password);
    } catch (err) {
      setError(loginErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-md space-y-4 bg-slate-50 p-6">
      <h1 className="pt-10 text-2xl font-bold text-blue-800">
        Suivi des rendez-vous
      </h1>
      <p className="text-sm text-slate-600">Centre de santé de base</p>

      <div
        className={`rounded px-3 py-2 text-sm text-white ${online ? "bg-green-600" : "bg-gray-600"}`}
      >
        {online ? "En ligne" : "Hors ligne : la connexion nécessite du réseau"}
      </div>

      {reauth && (
        <div className="rounded bg-red-100 p-3 text-sm text-red-800">
          Reconnexion requise. Vos modifications non envoyées sont conservées
          sur ce téléphone.
        </div>
      )}

      <form onSubmit={submit} className="space-y-3">
        <input
          className="w-full rounded border p-3"
          placeholder="Identifiant"
          autoCapitalize="none"
          autoComplete="username"
          value={user}
          readOnly={reauth}
          onChange={(e) => setUser(e.target.value)}
        />
        <input
          className="w-full rounded border p-3"
          type="password"
          placeholder="Mot de passe"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button
          disabled={busy || !user || !password}
          className="w-full rounded bg-blue-700 p-3 font-medium text-white disabled:opacity-50"
        >
          {busy ? "Connexion..." : "Se connecter"}
        </button>
      </form>
    </div>
  );
}
