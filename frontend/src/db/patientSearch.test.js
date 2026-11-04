import { describe, it, expect, beforeEach } from "vitest";
import { db, initDb } from "./db";
import { saveLocal } from "./saveLocal";
import { uuid } from "../lib/uuid";
import { searchPatients, findDuplicates } from "./patientSearch";

async function add(last_name, first_name = "") {
  const id = uuid();
  await saveLocal({
    entity: "patients",
    mode: "create",
    id,
    changes: { last_name, first_name, sex: "F" },
  });
  return id;
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await initDb();
});

describe("searchPatients", () => {
  it("sans saisie : tous les patients, triés par nom", async () => {
    await add("Rabe", "Zo");
    await add("Andria", "Lala");
    const r = await searchPatients("");
    expect(r.items.map((p) => p.last_name)).toEqual(["Andria", "Rabe"]);
  });

  it("insensible aux accents et à la casse", async () => {
    await add("Ravao", "Élise");
    expect((await searchPatients("elise")).total).toBe(1);
    expect((await searchPatients("RAVAO él")).total).toBe(1);
  });

  it("plusieurs mots : tous doivent correspondre", async () => {
    await add("Rakoto", "Jean");
    await add("Rakoto", "Marie");
    const r = await searchPatients("rakoto jean");
    expect(r.total).toBe(1);
    expect(r.items[0].first_name).toBe("Jean");
  });

  it("limite : total complet, liste tronquée", async () => {
    for (let i = 0; i < 5; i++) await add(`Nom${i}`);
    const r = await searchPatients("", 2);
    expect(r.total).toBe(5);
    expect(r.items).toHaveLength(2);
  });
});

describe("findDuplicates", () => {
  it("trouve le même nom et prénom, sans accent ni casse", async () => {
    await add("Rakoto", "Élise");
    const d = await findDuplicates({
      last_name: "RAKOTO",
      first_name: "elise",
    });
    expect(d).toHaveLength(1);
  });

  it("ne confond pas Rakoto et Rakotomalala", async () => {
    await add("Rakotomalala", "Jean");
    expect(
      await findDuplicates({ last_name: "Rakoto", first_name: "Jean" }),
    ).toHaveLength(0);
  });

  it("insensible à l’ordre, exclut l’enregistrement en cours, ignore un nom trop court", async () => {
    const id = await add("Rakoto", "Jean");
    expect(
      await findDuplicates({ last_name: "Jean", first_name: "Rakoto" }),
    ).toHaveLength(1);
    expect(
      await findDuplicates({
        last_name: "Rakoto",
        first_name: "Jean",
        excludeId: id,
      }),
    ).toHaveLength(0);
    expect(
      await findDuplicates({ last_name: "R", first_name: "" }),
    ).toHaveLength(0);
  });
});
