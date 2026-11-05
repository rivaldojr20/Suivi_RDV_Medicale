import { describe, it, expect, beforeEach } from "vitest";
import { db, initDb } from "./db";
import {
  parseNoteForm,
  saveNote,
  getNoteFor,
  noteSummary,
} from "./noteQueries";

const form = (over = {}) => ({
  temperature_c: "",
  bp_systolic: "",
  bp_diastolic: "",
  weight_kg: "",
  observation: "",
  next_visit_date: "",
  ...over,
});

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await initDb();
});

describe("parseNoteForm", () => {
  it("accepte la virgule et arrondit (1 décimale, 2 décimales)", () => {
    const { errors, data } = parseNoteForm(
      form({
        temperature_c: "37,54",
        weight_kg: "62,456",
        bp_systolic: "120",
        bp_diastolic: "80",
      }),
    );
    expect(errors).toEqual({});
    expect(data).toMatchObject({
      temperature_c: 37.5,
      weight_kg: 62.46,
      bp_systolic: 120,
      bp_diastolic: 80,
    });
  });

  it("refuse les valeurs hors bornes ou non numériques", () => {
    const { errors } = parseNoteForm(
      form({
        temperature_c: "50",
        bp_systolic: "20",
        bp_diastolic: "250",
        weight_kg: "abc",
      }),
    );
    expect(Object.keys(errors).sort()).toEqual([
      "bp_diastolic",
      "bp_systolic",
      "temperature_c",
      "weight_kg",
    ]);
  });

  it("tension : les deux valeurs ou aucune, diastolique < systolique", () => {
    expect(
      parseNoteForm(form({ bp_systolic: "120" })).errors.bp_diastolic,
    ).toBeTruthy();
    expect(
      parseNoteForm(form({ bp_systolic: "80", bp_diastolic: "90" })).errors
        .bp_diastolic,
    ).toBeTruthy();
    const r = parseNoteForm(form());
    expect(r.errors).toEqual({});
    expect(r.empty).toBe(true);
  });
});

describe("saveNote", () => {
  it("crée la note avec les champs renseignés", async () => {
    const { data } = parseNoteForm(
      form({ temperature_c: "37,5", observation: "RAS" }),
    );
    const r = await saveNote("appt1", data);
    expect(r.mode).toBe("create");
    const [op] = await db.outbox.toArray();
    expect(op).toMatchObject({
      entity: "consultation_notes",
      action: "UPSERT",
      base_version: 0,
    });
    expect(op.data).toMatchObject({
      appointment_id: "appt1",
      temperature_c: 37.5,
      observation: "RAS",
    });
  });

  it("une 2e saisie modifie la même note : une seule op, valeur à jour", async () => {
    await saveNote(
      "appt1",
      parseNoteForm(form({ temperature_c: "37,5" })).data,
    );
    const r = await saveNote(
      "appt1",
      parseNoteForm(form({ temperature_c: "37,5", weight_kg: "62" })).data,
    );
    expect(r.mode).toBe("update");
    expect(await db.consultation_notes.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
    expect(Number((await getNoteFor("appt1")).weight_kg)).toBe(62);
  });

  it("aucun changement : aucune op supplémentaire", async () => {
    const { data } = parseNoteForm(
      form({ temperature_c: "37,5", observation: "RAS" }),
    );
    await saveNote("appt1", data);
    const r = await saveNote("appt1", data);
    expect(r.mode).toBe("none");
    expect(await db.outbox.count()).toBe(1);
  });
});

describe("lecture", () => {
  it("getNoteFor préfère la note connue du serveur à une note locale", async () => {
    await db.consultation_notes.bulkPut([
      { id: "local", appointment_id: "a1", version: 0 },
      {
        id: "server",
        appointment_id: "a1",
        version: 1,
        created_at: "2025-01-06T08:00:00Z",
      },
    ]);
    expect((await getNoteFor("a1")).id).toBe("server");
    expect(await getNoteFor("inconnu")).toBeNull();
  });

  it("noteSummary", () => {
    expect(
      noteSummary({
        temperature_c: 37.5,
        bp_systolic: 120,
        bp_diastolic: 80,
        weight_kg: 62,
      }),
    ).toBe("37.5 °C · TA 120/80 · 62 kg");
    expect(noteSummary({})).toBe("");
  });
});
