//import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import UpdateBanner from "./components/UpdateBanner.jsx";
import { initDb } from "./db/db";
import { loadSession } from "./api/session";
import { startConnectivityWatch } from "./api/connectivity";
import { startSyncTriggers } from "./sync/triggers";
import { requestPersistentStorage } from "./lib/pwa";

async function start() {
  await initDb();
  await loadSession();
  startConnectivityWatch();
  startSyncTriggers();
  requestPersistentStorage();

  createRoot(document.getElementById("root")).render(<App />);

  const bannerRoot = document.createElement("div");
  document.body.appendChild(bannerRoot);
  createRoot(bannerRoot).render(<UpdateBanner />);
}
start();
start();
