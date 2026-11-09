import { useRegisterSW } from "virtual:pwa-register/react";

const HOUR = 60 * 60 * 1000;

export default function UpdateBanner() {
  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      setInterval(() => {
        if (navigator.onLine) reg.update().catch(() => {});
      }, HOUR);
    },
  });

  if (!needRefresh && !offlineReady) return null;

  return (
    <div className="fixed inset-x-0 bottom-16 z-20 mx-auto max-w-md px-3">
      <div className="rounded border border-blue-300 bg-blue-50 p-3 text-sm shadow">
        {needRefresh ? (
          <>
            <p className="font-medium">Une nouvelle version est disponible.</p>
            <p className="text-xs text-slate-600">
              Vos données locales sont conservées.
            </p>
            <button
              onClick={() => updateServiceWorker(true)}
              className="mt-2 rounded bg-blue-700 px-3 py-1 text-white"
            >
              Mettre à jour
            </button>
          </>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span>Application prête pour le mode hors ligne.</span>
            <button
              onClick={() => setOfflineReady(false)}
              className="underline"
            >
              OK
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
