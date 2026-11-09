/* global __BUILD__ */
import { useEffect, useState } from "react";
import { useInstallPrompt, isStandalone } from "../lib/pwa";
import { fmtDateTime } from "../lib/format";
const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : null;

export default function AppInfo() {
  const { canInstall, install } = useInstallPrompt();
  const [persisted, setPersisted] = useState(null);

  useEffect(() => {
    if (!navigator.storage?.persisted) {
      setPersisted(false);
      return;
    }
    navigator.storage
      .persisted()
      .then(setPersisted)
      .catch(() => setPersisted(false));
  }, []);

  return (
    <section className="space-y-1 rounded border bg-white p-3 text-xs text-slate-600">
      <p>Version : {BUILD ? fmtDateTime(BUILD) : 'inconnue'}</p>
      <p>Mode : {isStandalone() ? "application installée" : "navigateur"}</p>
      <p>
        Stockage local protégé :{" "}
        {persisted === null ? "…" : persisted ? "oui" : "non"}
      </p>
      {canInstall && (
        <button
          onClick={install}
          className="mt-1 rounded bg-blue-700 px-3 py-1 text-sm text-white"
        >
          Installer l'application
        </button>
      )}
    </section>
  );
}
