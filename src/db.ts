import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface User {
  id: number;
  email: string;
  password_hash: string;
  created_at: string;
}

export interface Participant {
  userId: number;
  name: string;
  email: string;
  comment: string | null;
  joinedAt: string;
}

export interface Entry {
  id: number;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  food: string;
  place: string;
  comment: string | null;
  createdAt: string;
  creator: { userId: number; name: string; email: string };
  participants: Participant[];
}

export interface NewEntry {
  userId: number;
  date: string;
  time: string;
  food: string;
  place: string;
  comment: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  time       TEXT NOT NULL,
  food       TEXT NOT NULL,
  place      TEXT NOT NULL,
  comment    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS entries_date ON entries(date, time);
CREATE TABLE IF NOT EXISTS joins (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id   INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (entry_id, user_id)
);
`;

/** "anna.schmidt@corp.example" -> "Anna Schmidt". Avoids collecting a separate name field. */
export function displayName(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join(" ");
}

export type Db = ReturnType<typeof openDb>;

export function openDb(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);

  const q = {
    insertUser: db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)"),
    userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
    userById: db.prepare("SELECT * FROM users WHERE id = ?"),
    insertEntry: db.prepare(
      "INSERT INTO entries (user_id, date, time, food, place, comment) VALUES (?, ?, ?, ?, ?, ?)",
    ),
    entriesFrom: db.prepare(`
      SELECT e.*, u.email AS creator_email FROM entries e JOIN users u ON u.id = e.user_id
      WHERE e.date >= ? ORDER BY e.date, e.time, e.id`),
    entryById: db.prepare(`
      SELECT e.*, u.email AS creator_email FROM entries e JOIN users u ON u.id = e.user_id
      WHERE e.id = ?`),
    joinsFrom: db.prepare(`
      SELECT j.*, u.email FROM joins j JOIN users u ON u.id = j.user_id
      JOIN entries e ON e.id = j.entry_id WHERE e.date >= ? ORDER BY j.id`),
    joinsFor: db.prepare(`
      SELECT j.*, u.email FROM joins j JOIN users u ON u.id = j.user_id
      WHERE j.entry_id = ? ORDER BY j.id`),
    deleteEntry: db.prepare("DELETE FROM entries WHERE id = ? AND user_id = ?"),
    insertJoin: db.prepare("INSERT INTO joins (entry_id, user_id, comment) VALUES (?, ?, ?)"),
    deleteJoin: db.prepare("DELETE FROM joins WHERE entry_id = ? AND user_id = ?"),
  };

  type Row = Record<string, any>;

  function toEntry(row: Row, joins: Row[]): Entry {
    return {
      id: Number(row.id),
      date: row.date,
      time: row.time,
      food: row.food,
      place: row.place,
      comment: row.comment,
      createdAt: row.created_at,
      creator: { userId: Number(row.user_id), name: displayName(row.creator_email), email: row.creator_email },
      participants: joins.map((j) => ({
        userId: Number(j.user_id),
        name: displayName(j.email),
        email: j.email,
        comment: j.comment,
        joinedAt: j.created_at,
      })),
    };
  }

  const isUniqueViolation = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/.test(e.message);

  return {
    /** Returns the new user id, or null if the email is already registered. */
    createUser(email: string, passwordHash: string): number | null {
      try {
        return Number(q.insertUser.run(email, passwordHash).lastInsertRowid);
      } catch (e) {
        if (isUniqueViolation(e)) return null;
        throw e;
      }
    },
    userByEmail: (email: string) => q.userByEmail.get(email) as User | undefined,
    userById: (id: number) => q.userById.get(id) as User | undefined,

    createEntry(e: NewEntry): number {
      return Number(q.insertEntry.run(e.userId, e.date, e.time, e.food, e.place, e.comment).lastInsertRowid);
    },
    /** All entries on or after `fromDate`, ordered by date, time, id. */
    entriesFrom(fromDate: string): Entry[] {
      const joins = q.joinsFrom.all(fromDate) as Row[];
      return (q.entriesFrom.all(fromDate) as Row[]).map((row) =>
        toEntry(row, joins.filter((j) => j.entry_id === row.id)),
      );
    },
    entry(id: number): Entry | undefined {
      const row = q.entryById.get(id) as Row | undefined;
      return row ? toEntry(row, q.joinsFor.all(id) as Row[]) : undefined;
    },
    deleteEntry: (id: number, userId: number) => Number(q.deleteEntry.run(id, userId).changes) > 0,
    /** Returns false if the user already joined this entry. */
    addJoin(entryId: number, userId: number, comment: string | null): boolean {
      try {
        q.insertJoin.run(entryId, userId, comment);
        return true;
      } catch (e) {
        if (isUniqueViolation(e)) return false;
        throw e;
      }
    },
    removeJoin: (entryId: number, userId: number) => Number(q.deleteJoin.run(entryId, userId).changes) > 0,
  };
}
