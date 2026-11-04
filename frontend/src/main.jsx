import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css"; // garde le nom de ton fichier CSS actuel
import App from "./App.jsx";
import { initDb } from "./db/db";
import { loadSession } from "./api/session";
import { startConnectivityWatch } from "./api/connectivity";
import { startSyncTriggers } from "./sync/triggers";

async function start() {
  await initDb();
  await loadSession();
  startConnectivityWatch();
  startSyncTriggers();
  createRoot(document.getElementById("root")).render(<App />);
}
start();
