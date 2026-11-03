// src/lib/dates.test.js
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  slotsOfDay,
  todayLocal,
  addDays,
  dayRangeUtc,
  fmtTime,
  toIsoZ,
} from "./dates";
import { normalize, searchKey } from "./text";

afterEach(() => vi.useRealTimers());

describe("créneaux", () => {
  const slots = slotsOfDay("2025-03-15");
  it("31 créneaux, 07:30 à 17:30", () => {
    expect(slots).toHaveLength(31);
    expect(slots[0]).toEqual({
      label: "07:30",
      scheduled_at: "2025-03-15T04:30:00Z",
    });
    expect(slots.at(-1)).toEqual({
      label: "17:30",
      scheduled_at: "2025-03-15T14:30:00Z",
    });
  });
  it("08:00 locale = 05:00Z", () => {
    expect(slots.find((s) => s.label === "08:10").scheduled_at).toBe(
      "2025-03-15T05:10:00Z",
    );
  });
});

describe("jours", () => {
  it("'aujourd'hui' suit Antananarivo, pas l'heure UTC", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-03-14T22:00:00Z")); // 01:00 le 15 à Antananarivo
    expect(todayLocal()).toBe("2025-03-15");
    vi.setSystemTime(new Date("2025-03-15T20:59:00Z")); // 23:59 le 15
    expect(todayLocal()).toBe("2025-03-15");
    vi.setSystemTime(new Date("2025-03-15T21:00:00Z")); // minuit le 16
    expect(todayLocal()).toBe("2025-03-16");
  });
  it("addDays traverse les fins de mois", () => {
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
    expect(addDays("2025-03-01", -1)).toBe("2025-02-28");
  });
  it("bornes UTC du jour local, sans millisecondes", () => {
    expect(dayRangeUtc("2025-03-15")).toEqual({
      start: "2025-03-14T21:00:00Z",
      end: "2025-03-15T21:00:00Z",
    });
  });
  it("toIsoZ retire les millisecondes", () => {
    expect(toIsoZ(new Date("2025-03-15T05:00:00.000Z"))).toBe(
      "2025-03-15T05:00:00Z",
    );
  });
});

describe("affichage", () => {
  it("fmtTime affiche l'heure d'Antananarivo", () => {
    expect(fmtTime("2025-03-15T05:00:00Z")).toBe("08:00");
    expect(fmtTime("2025-03-15T15:00:00Z")).toBe("18:00");
  });
});

describe("texte", () => {
  it("normalize enlève accents, casse et espaces multiples", () => {
    expect(normalize("  Éloïse   RAKOTO ")).toBe("eloise rakoto");
  });
  it("searchKey combine nom et prénom", () => {
    expect(searchKey({ last_name: "RANDRIAMAHÉFA", first_name: "Hery" })).toBe(
      "randriamahefa hery",
    );
  });
});
