import { Database } from 'bun:sqlite';

export const db = new Database('betting.sqlite');

db.exec(`PRAGMA journal_mode = WAL;`);
db.exec(`PRAGMA synchronous = NORMAL;`);
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id        TEXT PRIMARY KEY,
        short_id  INTEGER NOT NULL DEFAULT 0,
        role      TEXT NOT NULL DEFAULT 'CUSTOMER',
        credit    REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rounds (
        id          INTEGER PRIMARY KEY,
        status      TEXT NOT NULL,
        result      TEXT,
        created_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bets (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     TEXT NOT NULL,
        round_id    INTEGER NOT NULL,
        odds_index  INTEGER NOT NULL DEFAULT 0,
        side        TEXT NOT NULL,
        amount      REAL NOT NULL,
        win_amount  REAL NOT NULL,
        loss_amount REAL NOT NULL,
        status      TEXT NOT NULL DEFAULT 'PENDING',
        created_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transactions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     TEXT NOT NULL,
        amount      REAL NOT NULL,
        type        TEXT NOT NULL,
        ref_id      TEXT NOT NULL DEFAULT '',
        created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions (user_id, created_at);
`);

// Migration: เพิ่ม column ที่ขาดหายไปจาก schema เก่า (idempotent)
const betsCols = (db.query(`PRAGMA table_info(bets)`).all() as { name: string }[]).map(r => r.name);
if (!betsCols.includes('status'))     db.run(`ALTER TABLE bets ADD COLUMN status TEXT NOT NULL DEFAULT 'PENDING'`);
if (!betsCols.includes('odds_index')) db.run(`ALTER TABLE bets ADD COLUMN odds_index INTEGER NOT NULL DEFAULT 0`);

const usersCols = (db.query(`PRAGMA table_info(users)`).all() as { name: string }[]).map(r => r.name);
if (!usersCols.includes('short_id')) {
    db.run(`ALTER TABLE users ADD COLUMN short_id INTEGER NOT NULL DEFAULT 0`);
}
if (!usersCols.includes('role')) {
    db.run(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'CUSTOMER'`);
}
