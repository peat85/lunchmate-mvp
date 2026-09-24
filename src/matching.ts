import type { Entry } from "./db.js";

/** Current date/time as seen in the company's timezone. */
export interface Clock {
  today: string; // YYYY-MM-DD
  tomorrow: string; // YYYY-MM-DD
  time: string; // HH:MM
}

export const ANY_FOOD = "Anything";

/** Entries stay visible until this many minutes after their start time. */
export const GRACE_MINUTES = 30;

export function clockAt(date: Date, timeZone: string): Clock {
  const fmt = (d: Date) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).formatToParts(d).map((x) => [x.type, x.value]),
    );
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  };
  const now = fmt(date);
  return { today: now.date, tomorrow: fmt(new Date(date.getTime() + 86_400_000)).date, time: now.time };
}

function minusMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const total = Math.max(0, h * 60 + m - minutes);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** An entry is still relevant if it is on a future day, or today and started less than GRACE_MINUTES ago. */
export function isUpcoming(entry: Pick<Entry, "date" | "time">, clock: Clock): boolean {
  if (entry.date > clock.today) return true;
  return entry.date === clock.today && entry.time >= minusMinutes(clock.time, GRACE_MINUTES);
}

/** "Anything" on either side is compatible with every food. Comparison ignores case. */
export function foodMatches(entryFood: string, wanted: string | undefined): boolean {
  if (!wanted || wanted === ANY_FOOD) return true;
  const e = entryFood.trim().toLowerCase();
  return e === ANY_FOOD.toLowerCase() || e === wanted.trim().toLowerCase();
}

export interface Board {
  /** Lunches the user created or joined: the confirmed arrangements. */
  mine: Entry[];
  /** Other people's lunches the user can still join, filtered by food. */
  open: Entry[];
}

/**
 * Deterministic matching:
 * 1. drop lunches that are over (see isUpcoming)
 * 2. split into "mine" (created or joined) and "open" (everyone else's)
 * 3. keep open lunches whose food matches the filter
 * Input order is preserved (date, time, creation order), so identical data always yields identical output.
 */
export function buildBoard(entries: Entry[], userId: number, clock: Clock, food?: string): Board {
  const upcoming = entries.filter((e) => isUpcoming(e, clock));
  const involved = (e: Entry) => e.creator.userId === userId || e.participants.some((p) => p.userId === userId);
  return {
    mine: upcoming.filter(involved),
    open: upcoming.filter((e) => !involved(e) && foodMatches(e.food, food)),
  };
}
