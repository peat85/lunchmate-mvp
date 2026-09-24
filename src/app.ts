import express, { type Request, type Response, type NextFunction } from "express";
import { join } from "node:path";
import type { Db, Entry } from "./db.js";
import { displayName } from "./db.js";
import type { Mailer } from "./mail.js";
import { hashPassword, verifyPassword, createSessionToken, readSessionToken, SESSION_MAX_AGE_SECONDS } from "./auth.js";
import { seedDemo } from "./demo.js";
import { buildBoard, clockAt, isUpcoming, ANY_FOOD, type Clock } from "./matching.js";

export interface AppOptions {
  db: Db;
  mailer: Mailer;
  sessionSecret: string;
  timeZone: string;
  appUrl: string;
  secureCookies: boolean;
  /** Injectable for tests. */
  now?: () => Date;
  /** Enables one-tap sign-in as a synthetic demo user. */
  demo?: boolean;
  /** Serve ./public from the app (local dev). On Vercel the CDN serves it. */
  serveStatic?: boolean;
}

const COOKIE = "lm_session";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Optional trimmed string with a max length; empty becomes null. */
function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, `${field} must be text`);
  const v = value.trim();
  if (v.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`);
  return v || null;
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function createApp(opts: AppOptions) {
  const { db, mailer } = opts;
  const now = opts.now ?? (() => new Date());
  const clock = (): Clock => clockAt(now(), opts.timeZone);

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10kb" }));
  if (opts.serveStatic) app.use(express.static(join(import.meta.dirname, "..", "public")));

  function setSession(res: Response, userId: number) {
    res.cookie(COOKIE, createSessionToken(userId, opts.sessionSecret), {
      httpOnly: true,
      sameSite: "lax",
      secure: opts.secureCookies,
      maxAge: SESSION_MAX_AGE_SECONDS * 1000,
      path: "/",
    });
  }

  function currentUser(req: Request) {
    const id = readSessionToken(readCookie(req, COOKIE), opts.sessionSecret);
    const user = id ? db.userById(id) : undefined;
    if (!user) throw new HttpError(401, "Please sign in");
    return user;
  }

  const publicUser = (u: { id: number; email: string }) => ({ id: u.id, email: u.email, name: displayName(u.email) });

  /** Only people in the same lunch see each other's email addresses. */
  function view(e: Entry, involved: boolean) {
    return {
      ...e,
      creator: involved ? e.creator : { userId: e.creator.userId, name: e.creator.name },
      participants: e.participants.map((p) => (involved ? p : { userId: p.userId, name: p.name })),
    };
  }

  function credentials(body: any) {
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!EMAIL_RE.test(email) || email.length > 200) throw new HttpError(400, "Please enter a valid email address");
    if (password.length < 8) throw new HttpError(400, "Password must be at least 8 characters");
    if (password.length > 200) throw new HttpError(400, "Password is too long");
    return { email, password };
  }

  function entryParam(req: Request): Entry {
    const id = Number(req.params.id);
    const entry = Number.isInteger(id) ? db.entry(id) : undefined;
    if (!entry) throw new HttpError(404, "This lunch no longer exists");
    return entry;
  }

  // --- auth ---

  app.post("/api/register", (req, res) => {
    const { email, password } = credentials(req.body);
    const id = db.createUser(email, hashPassword(password));
    if (id === null) throw new HttpError(409, "An account with this email already exists. Please sign in.");
    setSession(res, id);
    res.status(201).json({ user: publicUser({ id, email }) });
  });

  app.post("/api/login", (req, res) => {
    const { email, password } = credentials(req.body);
    const user = db.userByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) throw new HttpError(401, "Wrong email or password");
    setSession(res, user.id);
    res.json({ user: publicUser(user) });
  });

  app.post("/api/logout", (_req, res) => {
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  // 200 with user: null when signed out, so the page can check without an error
  app.get("/api/me", (req, res) => {
    const id = readSessionToken(readCookie(req, COOKIE), opts.sessionSecret);
    const user = id ? db.userById(id) : undefined;
    res.json({ user: user ? publicUser(user) : null, demo: Boolean(opts.demo) });
  });

  app.post("/api/demo-login", (_req, res) => {
    if (!opts.demo) throw new HttpError(404, "Not found");
    // re-seeds if the database was wiped since startup
    const id = seedDemo(db, clock());
    setSession(res, id);
    res.json({ user: publicUser(db.userById(id)!) });
  });

  // --- lunches ---

  app.get("/api/board", (req, res) => {
    const user = currentUser(req);
    const c = clock();
    const food = typeof req.query.food === "string" ? req.query.food : undefined;
    const entries = db.entriesFrom(c.today);
    const board = buildBoard(entries, user.id, c, food);
    const allOpen = buildBoard(entries, user.id, c).open;
    res.json({
      today: c.today,
      tomorrow: c.tomorrow,
      now: c.time,
      mine: board.mine.map((e) => view(e, true)),
      open: board.open.map((e) => view(e, false)),
      // food filter chips: every food currently on offer, except the wildcard
      foods: [...new Set(allOpen.map((e) => e.food).filter((f) => f !== ANY_FOOD))].sort(),
      totalOpen: allOpen.length,
    });
  });

  app.post("/api/entries", (req, res) => {
    const user = currentUser(req);
    const c = clock();
    const b = req.body ?? {};
    if (b.day !== "today" && b.day !== "tomorrow") throw new HttpError(400, "Choose today or tomorrow");
    if (typeof b.time !== "string" || !TIME_RE.test(b.time)) throw new HttpError(400, "Choose a time (HH:MM)");
    const date = b.day === "today" ? c.today : c.tomorrow;
    if (!isUpcoming({ date, time: b.time }, c)) throw new HttpError(400, "That time has already passed");
    const id = db.createEntry({
      userId: user.id,
      date,
      time: b.time,
      food: optionalText(b.food, "Food", 40) ?? ANY_FOOD,
      place: optionalText(b.place, "Place", 60) ?? "To be decided",
      comment: optionalText(b.comment, "Comment", 280),
    });
    res.status(201).json({ entry: view(db.entry(id)!, true) });
  });

  app.delete("/api/entries/:id", (req, res) => {
    const user = currentUser(req);
    const entry = entryParam(req);
    if (entry.creator.userId !== user.id) throw new HttpError(403, "Only the creator can cancel this lunch");
    db.deleteEntry(entry.id, user.id);
    res.json({ ok: true });
  });

  app.post("/api/entries/:id/join", async (req, res) => {
    const user = currentUser(req);
    const entry = entryParam(req);
    const comment = optionalText(req.body?.comment, "Comment", 280);
    if (entry.creator.userId === user.id) throw new HttpError(400, "This is your own lunch");
    if (!isUpcoming(entry, clock())) throw new HttpError(400, "This lunch is already over");
    if (!db.addJoin(entry.id, user.id, comment)) throw new HttpError(409, "You already joined this lunch");

    const joiner = displayName(user.email);
    const lines = [
      `${joiner} (${user.email}) joined your lunch on ${entry.date} at ${entry.time}.`,
      `Food: ${entry.food} · Place: ${entry.place}`,
      comment ? `\nTheir comment: "${comment}"` : "",
      `\nSee who's coming: ${opts.appUrl}`,
    ];
    // awaited so serverless functions don't freeze before the mail is sent; never fails the join
    const notified = await mailer.send(entry.creator.email, `${joiner} joins your lunch at ${entry.time}`, lines.join("\n"));
    res.status(201).json({ entry: view(db.entry(entry.id)!, true), notified });
  });

  app.delete("/api/entries/:id/join", (req, res) => {
    const user = currentUser(req);
    const entry = entryParam(req);
    if (!db.removeJoin(entry.id, user.id)) throw new HttpError(404, "You are not part of this lunch");
    res.json({ ok: true });
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid request body" });
    console.error("[error]", err?.message ?? err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  });

  return app;
}
