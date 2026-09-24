import { describe, it, expect } from "vitest";
import { buildBoard, clockAt, foodMatches, isUpcoming, type Clock } from "../src/matching.js";
import type { Entry } from "../src/db.js";

const clock: Clock = { today: "2026-09-24", tomorrow: "2026-09-25", time: "12:10" };

let nextId = 1;
function entry(p: Partial<Entry> & { by: number; joined?: number[] }): Entry {
  return {
    id: nextId++, date: clock.today, time: "12:30", food: "Anything", place: "Canteen", comment: null, createdAt: "",
    creator: { userId: p.by, name: `U${p.by}`, email: `u${p.by}@example.com` },
    participants: (p.joined ?? []).map((u) => ({ userId: u, name: `U${u}`, email: `u${u}@example.com`, comment: null, joinedAt: "" })),
    ...p,
  };
}

describe("isUpcoming", () => {
  it("keeps future days and today's lunches until 30 minutes after start", () => {
    expect(isUpcoming({ date: clock.tomorrow, time: "08:00" }, clock)).toBe(true);
    expect(isUpcoming({ date: clock.today, time: "11:40" }, clock)).toBe(true); // started 30 min ago
    expect(isUpcoming({ date: clock.today, time: "11:39" }, clock)).toBe(false);
    expect(isUpcoming({ date: "2026-09-23", time: "23:59" }, clock)).toBe(false);
  });
  it("does not wrap around midnight", () => {
    expect(isUpcoming({ date: clock.today, time: "00:00" }, { ...clock, time: "00:10" })).toBe(true);
  });
});

describe("foodMatches", () => {
  it("treats Anything as a wildcard on both sides and ignores case", () => {
    expect(foodMatches("Italian", undefined)).toBe(true);
    expect(foodMatches("Italian", "Anything")).toBe(true);
    expect(foodMatches("Anything", "Asian")).toBe(true);
    expect(foodMatches("italian ", "Italian")).toBe(true);
    expect(foodMatches("Italian", "Asian")).toBe(false);
  });
});

describe("buildBoard", () => {
  it("splits into my plans and open lunches, preserving order", () => {
    const a = entry({ by: 1, time: "12:00" });
    const b = entry({ by: 2, time: "12:30", joined: [1] });
    const c = entry({ by: 3, time: "13:00" });
    const board = buildBoard([a, b, c], 1, clock);
    expect(board.mine.map((e) => e.id)).toEqual([a.id, b.id]);
    expect(board.open.map((e) => e.id)).toEqual([c.id]);
  });

  it("filters open lunches by food, keeping wildcard lunches", () => {
    const it1 = entry({ by: 2, food: "Italian" });
    const as = entry({ by: 3, food: "Asian" });
    const any = entry({ by: 4, food: "Anything" });
    expect(buildBoard([it1, as, any], 1, clock, "Italian").open.map((e) => e.id)).toEqual([it1.id, any.id]);
  });

  it("returns empty lists when nothing matches (no-match)", () => {
    const board = buildBoard([entry({ by: 2, food: "Asian" })], 1, clock, "Burger");
    expect(board).toEqual({ mine: [], open: [] });
    expect(buildBoard([], 1, clock)).toEqual({ mine: [], open: [] });
  });

  it("hides lunches that are over", () => {
    expect(buildBoard([entry({ by: 2, time: "11:00" })], 1, clock).open).toEqual([]);
  });

  it("is deterministic", () => {
    const list = [entry({ by: 2 }), entry({ by: 3 }), entry({ by: 4, food: "Asian" })];
    expect(buildBoard(list, 1, clock, "Asian")).toEqual(buildBoard(list, 1, clock, "Asian"));
  });
});

describe("clockAt", () => {
  it("uses the company timezone", () => {
    const c = clockAt(new Date("2026-09-24T22:30:00Z"), "Europe/Berlin"); // 00:30 next day in Berlin
    expect(c).toEqual({ today: "2026-09-25", tomorrow: "2026-09-26", time: "00:30" });
  });
});
