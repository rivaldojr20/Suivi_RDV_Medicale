import { navigate } from "../lib/router";
import { useSyncStatus } from "../hooks/useSyncStatus";

// F4b ajoutera ici l'onglet Rendez-vous
const TABS = [
  { seg: "", path: "/", label: "Accueil" },
  { seg: "patients", path: "/patients", label: "Patients" },
];

function StatusBar() {
  const s = useSyncStatus();
  return (
    <div
      className={`sticky top-0 z-10 px-3 py-2 text-sm text-white ${s.online ? "bg-green-600" : "bg-gray-600"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          {s.online ? "En ligne" : "Hors ligne"}
          {s.phase !== "idle" && " · Synchronisation..."}
        </span>
        {s.pending > 0 && <span>{s.pending} modification(s) en attente</span>}
      </div>
      {s.failed > 0 && (
        <button onClick={() => navigate("/")} className="mt-1 underline">
          {s.failed} élément(s) à vérifier
        </button>
      )}
    </div>
  );
}

export default function Layout({ path, children }) {
  const current = path.split("/")[1] ?? "";
  return (
    <div className="mx-auto min-h-screen max-w-md bg-slate-50">
      <StatusBar />
      <main className="p-3 pb-24">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 mx-auto flex max-w-md border-t bg-white">
        {TABS.map((t) => (
          <button
            key={t.path}
            onClick={() => navigate(t.path)}
            className={`flex-1 py-3 text-sm ${current === t.seg ? "font-bold text-blue-700" : "text-slate-600"}`}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
