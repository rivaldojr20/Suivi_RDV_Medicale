import { describe, it, expect, beforeEach } from "vitest";
import { db, initDb } from "./db";
import { findOverlaps } from "./appointmentQueries";

const A = (
  id,
  practitioner_id,
  scheduled_at,
  duration_min = 20,
  status = "planned",
) => ({
  id,
  patient_id: "p",
  practitioner_id,
  scheduled_at,
  duration_min,
  status,
  has_conflict: false,
  version: 1,
});

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await initDb();
});

describe("findOverlaps", () => {
  it("détecte un chevauchement du même praticien", async () => {
    await db.appointments.put(A("a1", "dr1", "2025-01-06T05:00:00Z", 40)); // 08:00-08:40 locales
    const r = await findOverlaps({
      practitioner_id: "dr1",
      scheduled_at: "2025-01-06T05:20:00Z",
      duration_min: 20,
    });
    expect(r.map((x) => x.id)).toEqual(["a1"]);
  });

  it("ignore autre praticien, annulé, lui-même et RDV collé", async () => {
    await db.appointments.bulkPut([
      A("other", "dr2", "2025-01-06T05:00:00Z"),
      A("cancelled", "dr1", "2025-01-06T05:00:00Z", 20, "cancelled"),
      A("self", "dr1", "2025-01-06T05:00:00Z"),
      A("before", "dr1", "2025-01-06T04:40:00Z"), // finit à 05:00 pile
      A("after", "dr1", "2025-01-06T05:20:00Z"), // commence à 05:20 pile
    ]);
    const r = await findOverlaps({
      practitioner_id: "dr1",
      scheduled_at: "2025-01-06T05:00:00Z",
      duration_min: 20,
      excludeId: "self",
    });
    expect(r).toEqual([]);
  });
});
