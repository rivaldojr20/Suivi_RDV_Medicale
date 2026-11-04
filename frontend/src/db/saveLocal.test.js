import { describe, it, expect, beforeEach } from "vitest";
import { db, initDb, getDeviceId, getMeta } from "./db";
import { createRecord, updateRecord, deleteRecord } from "./saveLocal";
import { rebasePending, retryOp, abandonOp, pendingCount } from "./outbox";

const PATIENT = {
  last_name: "RAKOTO",
  first_name: "Hery",
  sex: "M",
  birth_year: "1987",
  phone: "",
  village: "Isotry",
};
const APPT = {
  patient_id: "p1",
  practitioner_id: "d1",
  scheduled_at: "2025-03-15T05:00:00Z",
};

const ops = () => db.outbox.orderBy("seq").toArray();
const setStatus = (status, extra = {}) =>
  db.outbox.toCollection().modify({ status, ...extra });

// simule "ce record est déjà connu du serveur en version N et sa file est vide"
async function markSynced(entity, id, version = 3) {
  await db[entity].update(id, { version, server_rev: 10 });
  await db.outbox.clear();
}

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe("création", () => {
  it("enregistrement local v0 + une op pending avec les champs envoyables seulement", async () => {
    const p = await createRecord("patients", PATIENT);
    expect(p).toMatchObject({
      version: 0,
      server_rev: 0,
      is_deleted: false,
      birth_year: 1987,
      phone: null,
      search: "rakoto hery",
    });
    const [op] = await ops();
    expect(op).toMatchObject({
      entity: "patients",
      record_id: p.id,
      action: "UPSERT",
      base_version: 0,
      status: "pending",
      attempts: 0,
    });
    expect(op.op_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(op.data).toEqual({
      last_name: "RAKOTO",
      first_name: "Hery",
      sex: "M",
      birth_year: 1987,
      phone: null,
      village: "Isotry",
    });
  });

  it("RDV : valeurs par défaut locales, has_conflict jamais envoyé", async () => {
    const a = await createRecord("appointments", APPT);
    expect(a).toMatchObject({
      duration_min: 20,
      status: "planned",
      reason: "",
      has_conflict: false,
    });
    const [op] = await ops();
    expect(op.data).toEqual({
      ...APPT,
      duration_min: 20,
      reason: "",
      status: "planned",
    });
  });

  it("note : author_id local seulement, nombres convertis", async () => {
    const n = await createRecord(
      "consultation_notes",
      { appointment_id: "a1", temperature_c: "37.5", observation: "RAS" },
      { author_id: "u1" },
    );
    expect(n.author_id).toBe("u1");
    const [op] = await ops();
    expect(op.data.temperature_c).toBe(37.5);
    expect(op.data).not.toHaveProperty("author_id");
  });

  it("champ requis manquant : rien n'est écrit (tout ou rien)", async () => {
    await expect(
      createRecord("patients", { first_name: "X" }),
    ).rejects.toThrow();
    expect(await db.patients.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it("nombre invalide refusé", async () => {
    await expect(
      createRecord("patients", { ...PATIENT, birth_year: "abc" }),
    ).rejects.toThrow();
  });
});

describe("modification et coalescence", () => {
  it("T6 : création + 3 retouches = 1 seule op", async () => {
    const p = await createRecord("patients", PATIENT);
    const [first] = await ops();
    await updateRecord("patients", p.id, { village: "A" });
    await updateRecord("patients", p.id, { phone: "034 12 345 67" });
    await updateRecord("patients", p.id, { village: "B" });
    const all = await ops();
    expect(all).toHaveLength(1);
    expect(all[0].op_id).toBe(first.op_id);
    expect(all[0].base_version).toBe(0);
    expect(all[0].data).toMatchObject({
      last_name: "RAKOTO",
      village: "B",
      phone: "034 12 345 67",
    });
  });

  it("enregistrement synchronisé : base_version = version locale, champs modifiés seulement", async () => {
    const p = await createRecord("patients", PATIENT);
    await markSynced("patients", p.id, 3);
    await updateRecord("patients", p.id, {
      village: "Analakely",
      last_name: "RAKOTO",
    });
    const [op] = await ops();
    expect(op.base_version).toBe(3);
    expect(op.data).toEqual({ village: "Analakely" });
  });

  it("modification identique : aucune op", async () => {
    const p = await createRecord("patients", PATIENT);
    await markSynced("patients", p.id);
    await updateRecord("patients", p.id, { village: "Isotry" });
    expect(await ops()).toHaveLength(0);
  });

  it("champs en lecture seule ignorés", async () => {
    const p = await createRecord("patients", PATIENT);
    await markSynced("patients", p.id, 3);
    await updateRecord("patients", p.id, {
      version: 99,
      search: "zzz",
      is_deleted: true,
      village: "X",
    });
    const [op] = await ops();
    expect(op.data).toEqual({ village: "X" });
    const local = await db.patients.get(p.id);
    expect(local).toMatchObject({
      version: 3,
      is_deleted: false,
      search: "rakoto hery",
    });
  });

  it("patient_id d'un RDV non modifiable", async () => {
    const a = await createRecord("appointments", APPT);
    await expect(
      updateRecord("appointments", a.id, { patient_id: "autre" }),
    ).rejects.toThrow();
  });

  it('une op "sending" n\'est pas coalescée : nouvelle op', async () => {
    const p = await createRecord("patients", PATIENT);
    await markSynced("patients", p.id, 3);
    await updateRecord("patients", p.id, { village: "A" });
    await setStatus("sending");
    await updateRecord("patients", p.id, { phone: "1" });
    const all = await ops();
    expect(all.map((o) => o.status)).toEqual(["sending", "pending"]);
    expect(all[1]).toMatchObject({ base_version: 3, data: { phone: "1" } });
  });

  it("rebase : seules les ops pending du record passent à la nouvelle version", async () => {
    const p = await createRecord("patients", PATIENT);
    await markSynced("patients", p.id, 3);
    await updateRecord("patients", p.id, { village: "A" });
    await setStatus("sending");
    await updateRecord("patients", p.id, { phone: "1" });
    await rebasePending("patients", p.id, 5);
    const all = await ops();
    expect(all[0].base_version).toBe(3); // sending : inchangée
    expect(all[1].base_version).toBe(5); // pending : rebasée
  });
});

describe("suppression", () => {
  it("jamais synchronisé : tout est effacé, rien à envoyer", async () => {
    const p = await createRecord("patients", PATIENT);
    expect(await deleteRecord("patients", p.id)).toBeNull();
    expect(await db.patients.count()).toBe(0);
    expect(await ops()).toHaveLength(0);
  });

  it("synchronisé : suppression douce locale + op DELETE sans data", async () => {
    const p = await createRecord("patients", PATIENT);
    await markSynced("patients", p.id, 3);
    await deleteRecord("patients", p.id);
    expect((await db.patients.get(p.id)).is_deleted).toBe(true);
    const [op] = await ops();
    expect(op).toMatchObject({
      action: "DELETE",
      base_version: 3,
      status: "pending",
    });
    expect(op).not.toHaveProperty("data");
    await expect(
      updateRecord("patients", p.id, { village: "X" }),
    ).rejects.toThrow();
  });

  it("un UPSERT en attente est remplacé par le DELETE (même op_id)", async () => {
    const p = await createRecord("patients", PATIENT);
    await markSynced("patients", p.id, 3);
    await updateRecord("patients", p.id, { village: "A" });
    const [before] = await ops();
    await deleteRecord("patients", p.id);
    const all = await ops();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      op_id: before.op_id,
      action: "DELETE",
      base_version: 3,
    });
  });
});

describe("ops en échec", () => {
  it("règle 9 : corriger un enregistrement en échec = même op, nouvel op_id, pending", async () => {
    const p = await createRecord("patients", PATIENT);
    const [failed] = await ops();
    await setStatus("failed", {
      attempts: 2,
      last_error: { code: "VALIDATION_ERROR" },
    });
    await updateRecord("patients", p.id, { sex: "F" });
    const all = await ops();
    expect(all).toHaveLength(1);
    expect(all[0].op_id).not.toBe(failed.op_id);
    expect(all[0]).toMatchObject({
      status: "pending",
      attempts: 0,
      last_error: null,
    });
    expect(all[0].data.sex).toBe("F");
  });

  it("retryOp : nouvel op_id, pending", async () => {
    await createRecord("patients", PATIENT);
    const [failed] = await ops();
    await setStatus("failed", { last_error: { code: "SERVER_ERROR" } });
    await retryOp(failed.seq);
    const [op] = await ops();
    expect(op.op_id).not.toBe(failed.op_id);
    expect(op.status).toBe("pending");
  });

  it("abandon d'une création : l'orphelin local disparaît, curseur remis à 0", async () => {
    const p = await createRecord("patients", PATIENT);
    const [op] = await ops();
    await db.meta.put({ key: "cursor", value: 71 });
    await abandonOp(op.seq);
    expect(await db.patients.get(p.id)).toBeUndefined();
    expect(await ops()).toHaveLength(0);
    expect(await getMeta("cursor")).toBe(0);
  });

  it("abandon d'une modification : le record reste, curseur remis à 0", async () => {
    const p = await createRecord("patients", PATIENT);
    await markSynced("patients", p.id, 3);
    await updateRecord("patients", p.id, { village: "A" });
    const [op] = await ops();
    await db.meta.put({ key: "cursor", value: 71 });
    await abandonOp(op.seq);
    expect(await db.patients.get(p.id)).toBeDefined();
    expect(await getMeta("cursor")).toBe(0);
  });
});

describe("démarrage", () => {
  it("initDb : sending -> pending, device_id stable, curseur à 0", async () => {
    await createRecord("patients", PATIENT);
    await setStatus("sending");
    const id1 = await initDb();
    const id2 = await initDb();
    expect(id1).toBe(id2);
    expect(id1).toBe(await getDeviceId());
    expect((await ops())[0].status).toBe("pending");
    expect(await getMeta("cursor")).toBe(0);
    expect(await pendingCount()).toBe(1);
  });
});
