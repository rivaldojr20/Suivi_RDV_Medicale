import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db, initDb, getMeta, setMeta } from "../db/db";
import {
  loadSession,
  saveSession,
  clearSession,
  getSession,
} from "../api/session";
import { setOnline } from "../api/connectivity";
import { saveLocal } from "../db/saveLocal";
import { uuid } from "../lib/uuid";
import { API_URL } from "../config";
import { syncNow } from "./syncNow";
import { pullAll } from "./pull";

const TIME = "2025-01-06T08:00:00Z";
const USER = {
  id: "u1",
  full_name: "Dr Miora",
  role: "practitioner",
  profession: "doctor",
  center_id: "c1",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Faux serveur : handlers { 'METHOD /chemin': ({body, query, n}) => Response }. */
function server(handlers) {
  const calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init = {}) => {
      const [p, query = ""] = String(url).replace(API_URL, "").split("?");
      const key = `${init.method || "GET"} ${p}`;
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ key, query, body });
      const h = handlers[key];
      if (!h) throw new Error(`appel inattendu : ${key}`);
      return h({ body, query, n: calls.filter((c) => c.key === key).length });
    }),
  );
  return calls;
}
const pushCalls = (calls) => calls.filter((c) => c.key === "POST /sync/push");

const emptyPull = (next = 80) => ({
  server_time: TIME,
  changes: { patients: [], appointments: [], consultation_notes: [] },
  reference: { practitioners: [] },
  next_cursor: next,
  has_more: false,
});
const PULL = { "GET /sync/pull": () => json(emptyPull()) };
const HEALTH = { "GET /health": () => new Response(null, { status: 204 }) };

function serverRecord(op, version = 1) {
  const base = {
    id: op.record_id,
    center_id: "c1",
    version,
    server_rev: 100 + version,
    is_deleted: op.action === "DELETE",
  };
  if (op.entity === "patients") {
    Object.assign(base, {
      last_name: "X",
      first_name: "",
      sex: "M",
      birth_year: null,
      phone: null,
      village: null,
    });
  }
  if (op.entity === "appointments")
    Object.assign(base, { has_conflict: false });
  return { ...base, ...(op.data ?? {}) };
}
const applied = (op, version = 1) => ({
  op_id: op.op_id,
  status: "applied",
  record: serverRecord(op, version),
});
const pushWith =
  (mk = applied) =>
  ({ body }) =>
    json({ server_time: TIME, results: body.operations.map((op) => mk(op)) });

async function createPatient(name = "Rakoto") {
  const id = uuid();
  await saveLocal({
    entity: "patients",
    mode: "create",
    id,
    changes: { last_name: name, first_name: "Jean", sex: "M" },
  });
  return id;
}

const mk = (id, over = {}) => ({
  id,
  center_id: "c1",
  last_name: "S",
  first_name: "F",
  sex: "M",
  birth_year: null,
  phone: null,
  village: null,
  version: 2,
  server_rev: 50,
  is_deleted: false,
  ...over,
});

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await initDb();
  await loadSession();
  await saveSession({
    access: "A1",
    refresh: "R1",
    user: USER,
    username: "dr_miora",
    reauth: false,
  });
  setOnline(true);
});
afterEach(() => vi.unstubAllGlobals());

describe("push", () => {
  it("applied : op supprimée, local remplacé par la version serveur", async () => {
    const id = await createPatient();
    const calls = server({ "POST /sync/push": pushWith(), ...PULL });
    const r = await syncNow();

    expect(r.status).toBe("ok");
    expect(pushCalls(calls)[0].body.operations[0]).toMatchObject({
      entity: "patients",
      record_id: id,
      action: "UPSERT",
      base_version: 0,
      data: { last_name: "Rakoto" },
    });
    expect(await db.outbox.count()).toBe(0);
    const p = await db.patients.get(id);
    expect(p.version).toBe(1);
    expect(p.server_rev).toBe(101);
    expect(await getMeta("cursor")).toBe(80);
    expect(await getMeta("last_sync_at")).toBeTruthy();
  });

  it("envoie par lots de 50 (120 ops → 50, 50, 20)", async () => {
    for (let i = 0; i < 120; i++) await createPatient(`P${i}`);
    const calls = server({ "POST /sync/push": pushWith(), ...PULL });
    await syncNow();
    expect(pushCalls(calls).map((c) => c.body.operations.length)).toEqual([
      50, 50, 20,
    ]);
    expect(await db.outbox.count()).toBe(0);
  });

  it("rejected : op failed + notice, jamais rejouée automatiquement", async () => {
    const id = await createPatient();
    const calls = server({
      "POST /sync/push": pushWith((op) => ({
        op_id: op.op_id,
        status: "rejected",
        error: {
          code: "VALIDATION_ERROR",
          message: "invalide",
          fields: { sex: "requis" },
        },
      })),
      ...PULL,
    });
    await syncNow();

    const [op] = await db.outbox.toArray();
    expect(op.status).toBe("failed");
    expect(op.last_error.code).toBe("VALIDATION_ERROR");
    const [n] = await db.notices.toArray();
    expect(n).toMatchObject({ type: "rejected", seen: 0 });
    expect(await db.patients.get(id)).toBeTruthy();

    await syncNow({ force: true });
    expect(pushCalls(calls)).toHaveLength(1);
  });

  it("merged : local = version serveur, notice avec les valeurs en conflit", async () => {
    await db.patients.put({
      id: "p1",
      center_id: "c1",
      last_name: "Rakoto",
      first_name: "Jean",
      sex: "M",
      birth_year: null,
      phone: "0340000000",
      village: null,
      version: 3,
      server_rev: 10,
      is_deleted: false,
      search: "rakoto jean",
    });
    await saveLocal({
      entity: "patients",
      mode: "update",
      id: "p1",
      changes: { phone: "0341111111" },
    });
    expect((await db.outbox.toArray())[0].base_version).toBe(3);

    server({
      "POST /sync/push": pushWith((op) => ({
        op_id: op.op_id,
        status: "merged",
        record: {
          ...serverRecord(op, 4),
          last_name: "Rakoto",
          first_name: "Jean",
          phone: "0349999999",
        },
        conflict: {
          replaced_values: {
            phone: { server_value: "0349999999", client_value: "0341111111" },
          },
        },
      })),
      ...PULL,
    });
    await syncNow();

    const p = await db.patients.get("p1");
    expect(p.phone).toBe("0349999999");
    expect(p.version).toBe(4);
    expect(await db.outbox.count()).toBe(0);
    const [n] = await db.notices.toArray();
    expect(n.type).toBe("merged");
    expect(n.details.phone.server_value).toBe("0349999999");
    expect(n.message).toContain("téléphone");
  });

  it("warnings SLOT_OVERLAP et OUTSIDE_HOURS → notices", async () => {
    await saveLocal({
      entity: "appointments",
      mode: "create",
      id: uuid(),
      changes: {
        patient_id: uuid(),
        practitioner_id: uuid(),
        scheduled_at: "2025-01-06T05:00:00Z",
        duration_min: 20,
        reason: "Contrôle",
        status: "planned",
      },
    });
    server({
      "POST /sync/push": pushWith((op) => ({
        ...applied(op),
        warnings: [
          { code: "SLOT_OVERLAP", with: ["x"] },
          { code: "OUTSIDE_HOURS" },
        ],
      })),
      ...PULL,
    });
    await syncNow();
    const notices = await db.notices.toArray();
    expect(notices.map((n) => n.type)).toEqual(["warning", "warning"]);
    expect(notices.map((n) => n.code)).toEqual([
      "SLOT_OVERLAP",
      "OUTSIDE_HOURS",
    ]);
  });

  it("panne réseau : op conservée, attempts++, backoff respecté puis force", async () => {
    await createPatient();
    let down = true;
    const calls = server({
      "POST /sync/push": (ctx) => {
        if (down) throw new TypeError("Failed to fetch");
        return pushWith()(ctx);
      },
      ...PULL,
      ...HEALTH,
    });

    const r1 = await syncNow();
    expect(r1.status).toBe("offline");
    const [op] = await db.outbox.toArray();
    expect(op).toMatchObject({ status: "pending", attempts: 1 });
    expect(Date.parse(op.next_try_at)).toBeGreaterThan(Date.now());

    down = false;
    await syncNow(); // non forcé : l'op attend son délai
    expect(pushCalls(calls)).toHaveLength(1);
    expect(await db.outbox.count()).toBe(1);

    const r3 = await syncNow({ force: true });
    expect(r3.status).toBe("ok");
    expect(pushCalls(calls)).toHaveLength(2);
    expect(await db.outbox.count()).toBe(0);
  });

  it("401 non rattrapable : outbox intacte, sans tentative comptée, synchro suspendue", async () => {
    await createPatient();
    server({
      "POST /sync/push": () => json({}, 401),
      "POST /auth/refresh": () => json({ detail: "x" }, 401),
    });
    const r = await syncNow();
    expect(r.status).toBe("reauth");
    const [op] = await db.outbox.toArray();
    expect(op.status).toBe("pending");
    expect(op.attempts ?? 0).toBe(0);
    expect(getSession().reauth).toBe(true);
    expect((await syncNow()).status).toBe("reauth");
  });

  it("413 : le lot est divisé par deux (4 → 2 → 2)", async () => {
    for (let i = 0; i < 4; i++) await createPatient(`P${i}`);
    const calls = server({
      "POST /sync/push": (ctx) =>
        ctx.body.operations.length > 2
          ? json({ error: { code: "PAYLOAD_TOO_LARGE" } }, 413)
          : pushWith()(ctx),
      ...PULL,
    });
    const r = await syncNow();
    expect(r.status).toBe("ok");
    expect(pushCalls(calls).map((c) => c.body.operations.length)).toEqual([
      4, 2, 2,
    ]);
    expect(await db.outbox.count()).toBe(0);
  });

  it("modification pendant l’envoi : conservée à l’écran, rebasée, envoyée ensuite", async () => {
    const id = await createPatient("Rakoto");
    let n = 0;
    const calls = server({
      "POST /sync/push": async (ctx) => {
        n++;
        if (n === 1) {
          await saveLocal({
            entity: "patients",
            mode: "update",
            id,
            changes: { phone: "0340000000" },
          });
          return pushWith()(ctx);
        }
        return pushWith((op) => applied(op, 2))(ctx);
      },
      ...PULL,
    });
    await syncNow();

    const second = pushCalls(calls)[1].body.operations[0];
    expect(second.base_version).toBe(1); // rebasée sur la version créée
    expect(second.data).toEqual({ phone: "0340000000" }); // seulement le champ modifié
    const p = await db.patients.get(id);
    expect(p.version).toBe(2);
    expect(p.phone).toBe("0340000000");
    expect(await db.outbox.count()).toBe(0);
  });
});

describe("pull", () => {
  it("règles de fusion : suppression, op en attente, version locale plus récente", async () => {
    const local = (id, over = {}) => ({
      ...mk(id, { last_name: "L", version: 1 }),
      search: "l f",
      ...over,
    });
    await db.patients.bulkPut([
      local("del"),
      local("busy"),
      local("newer", { version: 5 }),
      local("old"),
    ]);
    await saveLocal({
      entity: "patients",
      mode: "update",
      id: "busy",
      changes: { phone: "0342222222" },
    });

    server({
      "GET /sync/pull": () =>
        json({
          ...emptyPull(120),
          changes: {
            patients: [
              mk("del", { is_deleted: true }),
              mk("busy"),
              mk("newer", { version: 4 }),
              mk("old"),
              mk("fresh"),
            ],
            appointments: [],
            consultation_notes: [],
          },
          reference: {
            practitioners: [
              {
                id: "u2",
                full_name: "Dr Miora",
                role: "practitioner",
                profession: "doctor",
              },
            ],
          },
        }),
    });
    await pullAll();

    expect(await db.patients.get("del")).toBeUndefined();
    expect((await db.patients.get("busy")).last_name).toBe("L"); // op en attente : ignoré
    expect((await db.patients.get("newer")).version).toBe(5); // local plus récent : ignoré
    expect((await db.patients.get("old")).last_name).toBe("S"); // remplacé
    expect((await db.patients.get("fresh")).search).toBeTruthy(); // nouveau
    expect(await getMeta("cursor")).toBe(120);
    expect(await db.practitioners.count()).toBe(1);
  });

  it("pagination et recul du curseur (cursor 120 → since=70, puis since=200)", async () => {
    await setMeta("cursor", 120);
    const calls = server({
      "GET /sync/pull": ({ n }) =>
        json(n === 1 ? { ...emptyPull(200), has_more: true } : emptyPull(250)),
    });
    await pullAll();
    expect(calls[0].query).toContain("since=70");
    expect(calls[1].query).toContain("since=200");
    expect(await getMeta("cursor")).toBe(250);
  });

  it("`search` identique entre saveLocal et pull", async () => {
    const id = await createPatient("Rakoto");
    const created = await db.patients.get(id);
    await db.patients.clear();
    await db.outbox.clear();

    server({
      "GET /sync/pull": () =>
        json({
          ...emptyPull(10),
          changes: {
            patients: [
              mk("other", {
                last_name: "Rakoto",
                first_name: "Jean",
                sex: "M",
              }),
            ],
            appointments: [],
            consultation_notes: [],
          },
        }),
    });
    await pullAll();
    expect((await db.patients.get("other")).search).toBe(created.search);
  });
});

describe("syncNow", () => {
  it("verrou unique : deux appels simultanés = une seule synchro", async () => {
    await createPatient();
    const calls = server({ "POST /sync/push": pushWith(), ...PULL });
    const a = syncNow();
    const b = syncNow();
    expect(a).toBe(b);
    await a;
    expect(pushCalls(calls)).toHaveLength(1);
  });

  it("sans session : ignoré, aucun appel réseau", async () => {
    await clearSession();
    const calls = server({});
    const r = await syncNow();
    expect(r.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });
});
