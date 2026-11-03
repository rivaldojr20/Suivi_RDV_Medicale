import { useEffect, useState } from "react";
import { API_URL } from "./config";
import { slotsOfDay, todayLocal, fmtDayFromLocal } from "./lib/dates";

export default function App() {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const today = todayLocal();
  return (
    <main className="mx-auto max-w-md p-4">
      <div
        className={`rounded-lg px-3 py-2 text-sm font-medium text-white ${online ? "bg-emerald-600" : "bg-slate-600"}`}
      >
        {online ? "En ligne" : "Hors ligne"}
      </div>
      <h1 className="mt-4 text-xl font-bold text-teal-800">Suivi RDV - CSB</h1>
      <p className="mt-2 text-slate-700">
        Aujourd'hui : {fmtDayFromLocal(today)}
      </p>
      <p className="text-slate-700">
        Créneaux par jour : {slotsOfDay(today).length}
      </p>
      <p className="mt-2 text-xs text-slate-500">API : {API_URL}</p>
    </main>
  );
}
