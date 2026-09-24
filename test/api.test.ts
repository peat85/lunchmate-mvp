import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import type { Mailer } from "../src/mail.js";

// Fixed "now": 2026-09-24 11:00 in Berlin
const NOW = new Date("2026-09-24T09:00:00Z");

let app: ReturnType<typeof createApp>;
let sent: { to: string; subject: string; text: string }[];

beforeEach(() => {
  sent = [];
  const mailer: Mailer = { async send(to, subject, text) { sent.push({ to, subject, text }); return true; } };
  app = createApp({ db: openDb(":memory:"), mailer, sessionSecret: "test-secret", timeZone: "Europe/Berlin",
    appUrl: "http://test", secureCookies: false, now: () => NOW });
});

/** Registers a synthetic user and returns an agent that keeps the session cookie. */
async function user(email: string) {
  const agent = request.agent(app);
  await agent.post("/api/register").send({ email, password: "correct-horse" }).expect(201);
  return agent;
}

const lunch = { day: "today", time: "12:30", food: "Italian", place: "Canteen", comment: "Meet at the lobby" };

describe("auth", () => {
  it("registers, signs in and never exposes the password hash", async () => {
    const res = await request(app).post("/api/register").send({ email: "Anna.Test@Example.com", password: "correct-horse" }).expect(201);
    expect(res.body.user).toEqual({ id: 1, email: "anna.test@example.com", name: "Anna Test" });
    expect(JSON.stringify(res.body)).not.toContain("scrypt");
    expect(res.headers["set-cookie"]![0]).toMatch(/HttpOnly/);

    const agent = request.agent(app);
    await agent.post("/api/login").send({ email: "anna.test@example.com", password: "correct-horse" }).expect(200);
    const me = await agent.get("/api/me").expect(200);
    expect(me.body.user.email).toBe("anna.test@example.com");
  });

  it("rejects duplicate emails regardless of case", async () => {
    await user("bob@example.com");
    const res = await request(app).post("/api/register").send({ email: "BOB@example.com", password: "another-pass" }).expect(409);
    expect(res.body.error).toMatch(/already exists/);
  });

  it("rejects invalid credentials input and wrong passwords", async () => {
    await request(app).post("/api/register").send({ email: "not-an-email", password: "correct-horse" }).expect(400);
    await request(app).post("/api/register").send({ email: "c@example.com", password: "short" }).expect(400);
    await request(app).post("/api/register").send({ email: 42, password: ["x"] }).expect(400);
    await user("c@example.com");
    await request(app).post("/api/login").send({ email: "c@example.com", password: "wrong-password" }).expect(401);
    await request(app).post("/api/login").send({ email: "nobody@example.com", password: "whatever-pass" }).expect(401);
  });

  it("requires a valid session", async () => {
    expect((await request(app).get("/api/me").expect(200)).body).toEqual({ user: null, demo: false });
    await request(app).get("/api/board").expect(401);
    await request(app).get("/api/board").set("Cookie", "lm_session=1.9999999999999.forged").expect(401);
    await request(app).post("/api/entries").send(lunch).expect(401);
  });

  it("rejects malformed JSON", async () => {
    await request(app).post("/api/login").set("Content-Type", "application/json").send("{oops").expect(400);
  });
});

describe("lunches", () => {
  it("end-to-end: A offers, B discovers and joins, both see the arrangement, A is emailed", async () => {
    const a = await user("anna@example.com");
    const b = await user("ben@example.com");

    const created = await a.post("/api/entries").send(lunch).expect(201);
    const id = created.body.entry.id;
    expect(created.body.entry).toMatchObject({ date: "2026-09-24", time: "12:30", food: "Italian", place: "Canteen" });

    // B discovers A's lunch; creator email is hidden from non-participants
    const boardB = await b.get("/api/board").expect(200);
    expect(boardB.body.open).toHaveLength(1);
    expect(boardB.body.open[0].creator).toEqual({ userId: 1, name: "Anna" });
    expect(boardB.body.mine).toEqual([]);

    const joined = await b.post(`/api/entries/${id}/join`).send({ comment: "Count me in" }).expect(201);
    expect(joined.body.notified).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("anna@example.com");
    expect(sent[0]!.text).toContain("Ben");
    expect(sent[0]!.text).toContain("Count me in");

    // Both see the confirmed arrangement with each other's contact
    const boardA = await a.get("/api/board").expect(200);
    expect(boardA.body.mine).toHaveLength(1);
    expect(boardA.body.mine[0].participants).toMatchObject([{ name: "Ben", email: "ben@example.com", comment: "Count me in" }]);
    const boardB2 = await b.get("/api/board").expect(200);
    expect(boardB2.body.open).toEqual([]);
    expect(boardB2.body.mine[0]).toMatchObject({ id, creator: { name: "Anna", email: "anna@example.com" } });
  });

  it("prevents duplicate joins and joining your own lunch", async () => {
    const a = await user("anna@example.com");
    const b = await user("ben@example.com");
    const { body } = await a.post("/api/entries").send(lunch).expect(201);
    await a.post(`/api/entries/${body.entry.id}/join`).send({}).expect(400);
    await b.post(`/api/entries/${body.entry.id}/join`).send({}).expect(201);
    const dup = await b.post(`/api/entries/${body.entry.id}/join`).send({}).expect(409);
    expect(dup.body.error).toMatch(/already joined/);
    expect(sent).toHaveLength(1);
  });

  it("no-match: filtering by an unavailable food returns an empty list, not an error", async () => {
    const a = await user("anna@example.com");
    const b = await user("ben@example.com");
    expect((await b.get("/api/board").expect(200)).body).toMatchObject({ open: [], mine: [], totalOpen: 0 });
    await a.post("/api/entries").send(lunch).expect(201);
    const res = await b.get("/api/board?food=Burger").expect(200);
    expect(res.body).toMatchObject({ open: [], totalOpen: 1, foods: ["Italian"] });
  });

  it("validates entry input", async () => {
    const a = await user("anna@example.com");
    await a.post("/api/entries").send({ ...lunch, day: "yesterday" }).expect(400);
    await a.post("/api/entries").send({ ...lunch, time: "25:00" }).expect(400);
    await a.post("/api/entries").send({ ...lunch, time: "09:00" }).expect(400); // already passed today
    await a.post("/api/entries").send({ ...lunch, food: "x".repeat(41) }).expect(400);
    await a.post("/api/entries").send({ ...lunch, comment: "x".repeat(281) }).expect(400);
    await a.post("/api/entries").send({ ...lunch, place: { evil: true } }).expect(400);
    // tomorrow at 09:00 is fine; food/place default when omitted
    const ok = await a.post("/api/entries").send({ day: "tomorrow", time: "09:00" }).expect(201);
    expect(ok.body.entry).toMatchObject({ date: "2026-09-25", food: "Anything", place: "To be decided", comment: null });
  });

  it("lets people change their plans: leave, and creator-only cancel", async () => {
    const a = await user("anna@example.com");
    const b = await user("ben@example.com");
    const { body } = await a.post("/api/entries").send(lunch).expect(201);
    const id = body.entry.id;
    await b.post(`/api/entries/${id}/join`).send({}).expect(201);
    await b.delete(`/api/entries/${id}/join`).expect(200);
    await b.delete(`/api/entries/${id}/join`).expect(404);
    expect((await b.get("/api/board")).body.open).toHaveLength(1); // can rejoin later
    await b.delete(`/api/entries/${id}`).expect(403);
    await a.delete(`/api/entries/${id}`).expect(200);
    expect((await b.get("/api/board")).body.open).toEqual([]);
    await b.post(`/api/entries/${id}/join`).send({}).expect(404);
    await b.post(`/api/entries/abc/join`).send({}).expect(404);
  });

  it("joining an existing group adds to it", async () => {
    const a = await user("anna@example.com");
    const b = await user("ben@example.com");
    const c = await user("cara@example.com");
    const { body } = await a.post("/api/entries").send(lunch).expect(201);
    await b.post(`/api/entries/${body.entry.id}/join`).send({}).expect(201);
    const res = await c.post(`/api/entries/${body.entry.id}/join`).send({}).expect(201);
    expect(res.body.entry.participants.map((p: any) => p.name)).toEqual(["Ben", "Cara"]);
  });

  it("still joins when the email fails", async () => {
    const failing = createApp({ db: openDb(":memory:"), mailer: { send: async () => false }, sessionSecret: "s",
      timeZone: "Europe/Berlin", appUrl: "http://test", secureCookies: false, now: () => NOW });
    const a = request.agent(failing), b = request.agent(failing);
    await a.post("/api/register").send({ email: "a@example.com", password: "correct-horse" });
    await b.post("/api/register").send({ email: "b@example.com", password: "correct-horse" });
    const { body } = await a.post("/api/entries").send(lunch);
    const res = await b.post(`/api/entries/${body.entry.id}/join`).send({}).expect(201);
    expect(res.body.notified).toBe(false);
  });
});

describe("demo mode", () => {
  const make = (demo: boolean) => createApp({ db: openDb(":memory:"), mailer: { send: async () => false }, sessionSecret: "s",
    timeZone: "Europe/Berlin", appUrl: "http://test", secureCookies: false, now: () => NOW, demo });

  it("is off by default", async () => {
    const off = make(false);
    expect((await request(off).get("/api/me")).body.demo).toBe(false);
    await request(off).post("/api/demo-login").expect(404);
  });

  it("signs in without an account and shows synthetic sample lunches", async () => {
    const on = make(true);
    expect((await request(on).get("/api/me")).body.demo).toBe(true);
    const agent = request.agent(on);
    const res = await agent.post("/api/demo-login").expect(200);
    expect(res.body.user.email).toBe("demo@lunchmatch.test");
    const board = (await agent.get("/api/board").expect(200)).body;
    expect(board.open.length).toBeGreaterThanOrEqual(2);
    // idempotent: signing in again doesn't duplicate lunches
    await agent.post("/api/demo-login").expect(200);
    expect((await agent.get("/api/board")).body.open).toHaveLength(board.open.length);
    // the demo user can join like anyone else
    await agent.post(`/api/entries/${board.open[0].id}/join`).send({}).expect(201);
  });
});

describe("demo test accounts", () => {
  it("patrick and greg can sign in with the test password", async () => {
    const db = openDb(":memory:");
    const { seedDemo } = await import("../src/demo.js");
    const { clockAt } = await import("../src/matching.js");
    seedDemo(db, clockAt(NOW, "Europe/Berlin"));
    const demoApp = createApp({ db, mailer: { send: async () => false }, sessionSecret: "s", timeZone: "Europe/Berlin",
      appUrl: "http://test", secureCookies: false, now: () => NOW, demo: true });
    for (const email of ["patrick@example.com", "greg@example.com"]) {
      await request(demoApp).post("/api/login").send({ email, password: "12345678" }).expect(200);
    }
  });
});
