import { describe, it, expect } from "vitest";
import {
  SLOTS,
  slotIndex,
  localParts,
  toUtcIso,
  shiftDay,
  dayRange,
} from "./planning";

describe("planning", () => {
  it("conversion jour/heure Madagascar ↔ UTC", () => {
    expect(toUtcIso("2025-01-06", "07:30")).toBe("2025-01-06T04:30:00Z");
    expect(localParts("2025-01-06T04:30:00Z")).toEqual({
      day: "2025-01-06",
      time: "07:30",
    });
  });

  it("une heure UTC tardive tombe le lendemain à Madagascar", () => {
    expect(localParts("2025-01-05T21:30:00Z")).toEqual({
      day: "2025-01-06",
      time: "00:30",
    });
  });

  it("31 créneaux de 07:30 à 17:30", () => {
    expect(SLOTS).toHaveLength(31);
    expect(SLOTS[0]).toBe("07:30");
    expect(SLOTS[30]).toBe("17:30");
  });

  it("slotIndex : créneau contenant, -1 hors horaires", () => {
    expect(slotIndex("07:30")).toBe(0);
    expect(slotIndex("07:40")).toBe(0);
    expect(slotIndex("07:50")).toBe(1);
    expect(slotIndex("17:30")).toBe(30);
    expect(slotIndex("17:50")).toBe(-1);
    expect(slotIndex("07:00")).toBe(-1);
    expect(slotIndex("18:20")).toBe(-1);
  });

  it("shiftDay franchit les changements de mois", () => {
    expect(shiftDay("2025-01-31", 1)).toBe("2025-02-01");
    expect(shiftDay("2025-03-01", -1)).toBe("2025-02-28");
  });

  it("dayRange : minuit local → minuit local suivant, en UTC", () => {
    expect(dayRange("2025-01-06")).toEqual([
      "2025-01-05T21:00:00Z",
      "2025-01-06T21:00:00Z",
    ]);
  });
});
