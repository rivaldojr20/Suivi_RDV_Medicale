export const API_URL =
  import.meta.env.VITE_API_URL ?? "http://localhost:8000/api";

export const CLINIC = {
  TZ: "Indian/Antananarivo", // UTC+3 fixe, pas d'heure d'été
  UTC_OFFSET: "+03:00",
  OPEN: "07:30",
  CLOSE: "18:00",
  SLOT_MIN: 20,
  DURATIONS: [20, 40, 60], // durées proposées dans l'interface
};

export const SYNC = {
  PUSH_BATCH: 50,
  PULL_LIMIT: 200,
  CURSOR_OVERLAP: 50, // since = max(0, cursor - 50)
  DEBOUNCE_MS: 5000, // sync 5 s après une écriture locale
  INTERVAL_MS: 60000, // sync périodique au premier plan
  BACKOFF_MS: [5000, 15000, 60000, 300000],
  HEALTH_TIMEOUT_MS: 4000,
  REQUEST_TIMEOUT_MS: 30000,
};
