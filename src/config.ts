import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { openDb } from "./db.js";
import { mailerFromEnv } from "./mail.js";
import { createApp } from "./app.js";
import { seedDemo } from "./demo.js";
import { clockAt } from "./matching.js";

/** Builds the app from environment variables. Shared by the local server and the Vercel function. */
export function appFromEnv(env: NodeJS.ProcessEnv, { serveStatic = false } = {}) {
  const onVercel = Boolean(env.VERCEL);
  const production = onVercel || env.NODE_ENV === "production";
  let sessionSecret = env.SESSION_SECRET;
  if (!sessionSecret) {
    if (production) throw new Error("SESSION_SECRET must be set in production");
    sessionSecret = randomBytes(32).toString("hex");
    console.warn("[config] SESSION_SECRET not set, using a random one (sessions reset on restart)");
  }
  const dbPath = env.DATABASE_PATH || (onVercel ? "/tmp/lunchmatch.db" : join(process.cwd(), "data", "lunchmatch.db"));
  const db = openDb(dbPath);
  const timeZone = env.APP_TIMEZONE || "Europe/Berlin";
  const demo = env.DEMO_MODE !== "0"; // on by default; set DEMO_MODE=0 for real use
  if (demo) seedDemo(db, clockAt(new Date(), timeZone));
  return createApp({
    db,
    demo,
    mailer: mailerFromEnv(env),
    sessionSecret,
    timeZone,
    appUrl: env.APP_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000"),
    secureCookies: production,
    serveStatic,
  });
}
