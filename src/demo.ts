import type { Db } from "./db.js";
import { hashPassword } from "./auth.js";
import { isUpcoming, type Clock } from "./matching.js";

/** Synthetic demo data. On by default; disabled with DEMO_MODE=0. */
export const DEMO_EMAIL = "demo@lunchmatch.test";
export const DEMO_PASSWORD = "demo-lunch";

/** Synthetic test accounts with a known password, for trying the flow between two people. */
export const TEST_USERS = ["patrick@example.com", "greg@example.com"];
export const TEST_PASSWORD = "12345678";

const COLLEAGUES = ["mia.demo@lunchmatch.test", "jonas.demo@lunchmatch.test", "lea.demo@lunchmatch.test"];

function ensureUser(db: Db, email: string, password: string): number {
  return db.userByEmail(email)?.id ?? db.createUser(email, hashPassword(password)) ?? db.userByEmail(email)!.id;
}

/**
 * Idempotently creates the demo account and, on an empty database, a few sample lunches.
 * Runs at every cold start, so the demo survives the ephemeral /tmp database on Vercel.
 * Returns the demo user's id.
 */
export function seedDemo(db: Db, clock: Clock): number {
  const hadEntries = db.entriesFrom("0000-00-00").length > 0;
  const demoId = ensureUser(db, DEMO_EMAIL, DEMO_PASSWORD);
  for (const email of TEST_USERS) ensureUser(db, email, TEST_PASSWORD);
  // colleagues get a random password: nobody can sign in as them
  const [mia, jonas, lea] = COLLEAGUES.map((e) => ensureUser(db, e, crypto.randomUUID())) as [number, number, number];
  if (hadEntries) return demoId;

  db.createEntry({ userId: mia, date: clock.tomorrow, time: "12:00", food: "Italian", place: "Canteen", comment: "Pasta day!" });
  const asian = db.createEntry({ userId: jonas, date: clock.tomorrow, time: "12:30", food: "Asian", place: "Nearby restaurant", comment: null });
  db.addJoin(asian, lea, "I'm in, love that place");
  if (isUpcoming({ date: clock.today, time: "13:30" }, clock)) {
    db.createEntry({ userId: lea, date: clock.today, time: "13:30", food: "Healthy", place: "Takeaway", comment: "Salad in the park?" });
  }
  return demoId;
}
