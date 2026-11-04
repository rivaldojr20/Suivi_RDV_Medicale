import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db, initDb, getMeta } from "../db/db";
import { loadSession, saveSession, getSession } from "./session";
import { apiFetch } from "./client";
import { login, logout } from "./auth";
import { API_URL } from "../config";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const USER = {
  id: "u1",
  full_name: "Dr Miora",
  role: "practitioner",
  profession: "doctor",
  center_id: "c1",
};
const OTHER = {
  id: "u2",
  full_name: "Accueil",
  role: "reception",
  profession: null,
  center_id: "c1",
};

const startSession = (over = {}) =>
  saveSession({
    access: "A1",
    refresh: "R1",
    user: USER,
    username: "dr_miora",
    reauth: false,
    ...over,
  });

const addOp = () =>
  db.outbox.add({
    op_id: "o1",
    status: "pending",
    entity: "patients",
    record_id: "p1",
  });

/** Simule le serveur : map { 'METHOD /chemin': (init) => Response }. */
function route(map) {
  const calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init = {}) => {
      const key = `${init.method || "GET"} ${String(url).replace(API_URL, "").split("?")[0]}`;
      calls.push({ key, init });
      if (!map[key]) throw new Error(`appel inattendu : ${key}`);
      return map[key](init);
    }),
  );
  return calls;
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await initDb();
  await loadSession();
});
afterEach(() => vi.unstubAllGlobals());

describe("apiFetch", () => {
  it("envoie le jeton Bearer", async () => {
    await startSession();
    const calls = route({ "GET /ping": () => json({ ok: true }) });
    await apiFetch("/ping");
    expect(calls[0].init.headers.Authorization).toBe("Bearer A1");
  });

  it("401 → refresh → rejoue la requête, jeton persisté", async () => {
    await startSession();
    route({
      "GET /ping": (init) =>
        init.headers.Authorization === "Bearer A2"
          ? json({ ok: true })
          : json({ detail: "expired" }, 401),
      "POST /auth/refresh": () => json({ access: "A2" }),
    });
    expect(await apiFetch("/ping")).toEqual({ ok: true });
    await loadSession();
    expect(getSession().access).toBe("A2");
  });

  it("3 appels concurrents en 401 → un seul refresh", async () => {
    await startSession();
    const calls = route({
      "GET /ping": (init) =>
        init.headers.Authorization === "Bearer A2"
          ? json({ ok: true })
          : json({}, 401),
      "POST /auth/refresh": async () => {
        await new Promise((r) => setTimeout(r, 20));
        return json({ access: "A2" });
      },
    });
    await Promise.all([
      apiFetch("/ping"),
      apiFetch("/ping"),
      apiFetch("/ping"),
    ]);
    expect(calls.filter((c) => c.key === "POST /auth/refresh")).toHaveLength(1);
  });

  it("refresh refusé → reconnexion requise, outbox intacte, plus aucun appel", async () => {
    await startSession();
    await addOp();
    const calls = route({
      "GET /ping": () => json({}, 401),
      "POST /auth/refresh": () => json({ detail: "invalid" }, 401),
    });
    await expect(apiFetch("/ping")).rejects.toMatchObject({
      code: "REAUTH_REQUIRED",
    });
    expect(getSession().reauth).toBe(true);
    expect(await db.outbox.count()).toBe(1);

    const n = calls.length;
    await expect(apiFetch("/ping")).rejects.toMatchObject({
      code: "REAUTH_REQUIRED",
    });
    expect(calls.length).toBe(n);
  });

  it("panne réseau → erreur network, session intacte", async () => {
    await startSession();
    route({
      "GET /ping": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await expect(apiFetch("/ping")).rejects.toMatchObject({ kind: "network" });
    expect(getSession().reauth).toBe(false);
  });

  it("refresh en panne réseau ne force PAS la reconnexion", async () => {
    await startSession();
    route({
      "GET /ping": () => json({}, 401),
      "POST /auth/refresh": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await expect(apiFetch("/ping")).rejects.toMatchObject({ kind: "network" });
    expect(getSession().reauth).toBe(false);
  });

  it("timeout", async () => {
    await startSession();
    vi.stubGlobal(
      "fetch",
      (url, init) =>
        new Promise((_, reject) =>
          init.signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        ),
    );
    await expect(apiFetch("/slow", { timeout: 20 })).rejects.toMatchObject({
      kind: "timeout",
    });
  });

  it("expose status et code des erreurs HTTP", async () => {
    await startSession();
    route({
      "POST /x": () => json({ error: { code: "VALIDATION_ERROR" } }, 400),
    });
    await expect(
      apiFetch("/x", { method: "POST", body: {} }),
    ).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
    });
  });
});

describe("login / logout", () => {
  it("login réussi → session persistée", async () => {
    route({
      "POST /auth/login": () => json({ access: "A", refresh: "R", user: USER }),
    });
    await login("dr_miora", "demo1234");
    await loadSession();
    expect(getSession().user.id).toBe("u1");
    expect(getSession().username).toBe("dr_miora");
  });

  it("mauvais mot de passe → 401, pas de session", async () => {
    route({ "POST /auth/login": () => json({ detail: "bad" }, 401) });
    await expect(login("x", "y")).rejects.toMatchObject({ status: 401 });
    expect(getSession()).toBeNull();
  });

  it("login avec un autre compte + outbox non vide → refusé", async () => {
    await startSession();
    await addOp();
    route({
      "POST /auth/login": () =>
        json({ access: "A", refresh: "R", user: OTHER }),
    });
    await expect(login("accueil", "demo1234")).rejects.toMatchObject({
      code: "OUTBOX_OTHER_USER",
    });
    expect(getSession().user.id).toBe("u1");
    expect(await db.outbox.count()).toBe(1);
  });

  it("login avec un autre compte + outbox vide → données locales effacées", async () => {
    await startSession();
    await db.patients.add({ id: "p9", last_name: "X", search: "x" });
    route({
      "POST /auth/login": () =>
        json({ access: "A", refresh: "R", user: OTHER }),
    });
    await login("accueil", "demo1234");
    expect(await db.patients.count()).toBe(0);
    expect(await getMeta("cursor")).toBe(0);
    expect(getSession().user.id).toBe("u2");
  });

  it("logout refusé si outbox non vide, puis forcé", async () => {
    await startSession();
    await addOp();
    expect(await logout()).toEqual({ ok: false, pending: 1 });
    expect(getSession()).not.toBeNull();

    expect((await logout({ force: true })).ok).toBe(true);
    expect(await db.outbox.count()).toBe(0);
    expect(getSession()).toBeNull();
  });

  it("logout normal → session et données locales effacées", async () => {
    await startSession();
    await db.patients.add({ id: "p9", last_name: "X", search: "x" });
    expect((await logout()).ok).toBe(true);
    expect(await db.patients.count()).toBe(0);
    expect(getSession()).toBeNull();
  });
});
