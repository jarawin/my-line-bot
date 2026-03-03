import { Database } from 'bun:sqlite';
import { DB_PATH } from '../config/paths';

export const db = new Database(DB_PATH);

db.run(`PRAGMA journal_mode = WAL`);
db.run(`PRAGMA synchronous = NORMAL`);
db.run(`PRAGMA busy_timeout = 5000`);    // รอสูงสุด 5s ถ้า DB locked (สำคัญหลังเพิ่ม transactions)
db.run(`PRAGMA cache_size = -32000`);    // 32 MB page cache (default ~2 MB)
db.run(`PRAGMA temp_store = MEMORY`);    // temp tables/indexes ใน RAM
db.run(`PRAGMA mmap_size = 268435456`);  // 256 MB memory-mapped I/O สำหรับ sequential reads

db.run(`CREATE TABLE IF NOT EXISTS users (
    id        TEXT PRIMARY KEY,
    short_id  INTEGER NOT NULL DEFAULT 0,
    role      TEXT NOT NULL DEFAULT 'CUSTOMER',
    credit    REAL NOT NULL
)`);

db.run(`CREATE TABLE IF NOT EXISTS rounds (
    id          INTEGER PRIMARY KEY,
    status      TEXT NOT NULL,
    result      TEXT,
    created_at  INTEGER NOT NULL
)`);

db.run(`CREATE TABLE IF NOT EXISTS bets (
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
)`);

db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    amount      REAL NOT NULL,
    type        TEXT NOT NULL,
    ref_id      TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
)`);

db.run(`CREATE TABLE IF NOT EXISTS allowed_groups (
    id         TEXT PRIMARY KEY,
    platform   TEXT NOT NULL,
    type       TEXT NOT NULL,
    name       TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
)`);

db.run(`CREATE TABLE IF NOT EXISTS odds_history (
    round_id         INTEGER NOT NULL,
    odds_index       INTEGER NOT NULL,
    red_loss_ratio   REAL NOT NULL,
    red_win_ratio    REAL NOT NULL,
    blue_loss_ratio  REAL NOT NULL,
    blue_win_ratio   REAL NOT NULL,
    status           TEXT NOT NULL,
    max_bet          REAL NOT NULL,
    min_bet          REAL NOT NULL,
    user_limit       INTEGER NOT NULL,
    vig              REAL NOT NULL,
    created_at       INTEGER NOT NULL,
    PRIMARY KEY (round_id, odds_index)
)`);

db.run(`CREATE TABLE IF NOT EXISTS bank_accounts (
    short_id   INTEGER PRIMARY KEY,
    bank       TEXT NOT NULL,
    name       TEXT NOT NULL,
    number     TEXT NOT NULL,
    image_url  TEXT,
    is_active  INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
)`);

db.run(`CREATE TABLE IF NOT EXISTS system_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
)`);

db.run(`CREATE INDEX IF NOT EXISTS idx_tx_user   ON transactions (user_id, created_at)`);
// bets: settleBetsInRound, voidBetsInOdds, getAllBetsForRound ใช้ round_id + status ทุกครั้ง
db.run(`CREATE INDEX IF NOT EXISTS idx_bets_round ON bets (round_id, status)`);
// bets: ดูบิล per-user ใน round (credit flex, cmdUserInfo)
db.run(`CREATE INDEX IF NOT EXISTS idx_bets_user  ON bets (user_id, round_id)`);
// transactions: loadSystemStats ทำ GROUP BY type + ref_id ทั้ง table
db.run(`CREATE INDEX IF NOT EXISTS idx_tx_type    ON transactions (type, ref_id)`);

// Migration: เพิ่ม column ที่ขาดหายไปจาก schema เก่า (idempotent)
const betsCols = (db.query(`PRAGMA table_info(bets)`).all() as { name: string }[]).map(r => r.name);
if (!betsCols.includes('status')) db.run(`ALTER TABLE bets ADD COLUMN status TEXT NOT NULL DEFAULT 'PENDING'`);
if (!betsCols.includes('odds_index')) db.run(`ALTER TABLE bets ADD COLUMN odds_index INTEGER NOT NULL DEFAULT 0`);

const usersCols = (db.query(`PRAGMA table_info(users)`).all() as { name: string }[]).map(r => r.name);
if (!usersCols.includes('short_id')) {
    db.run(`ALTER TABLE users ADD COLUMN short_id INTEGER NOT NULL DEFAULT 0`);
}
if (!usersCols.includes('role')) {
    db.run(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'CUSTOMER'`);
}
if (!usersCols.includes('platform')) {
    db.run(`ALTER TABLE users ADD COLUMN platform TEXT NOT NULL DEFAULT 'LINE'`);
}
if (!usersCols.includes('display_name')) {
    db.run(`ALTER TABLE users ADD COLUMN display_name TEXT`);
}
if (!usersCols.includes('profile_picture_url')) {
    db.run(`ALTER TABLE users ADD COLUMN profile_picture_url TEXT`);
}
if (!usersCols.includes('total_turnover')) db.run(`ALTER TABLE users ADD COLUMN total_turnover REAL NOT NULL DEFAULT 0`);
if (!usersCols.includes('total_win'))      db.run(`ALTER TABLE users ADD COLUMN total_win      REAL NOT NULL DEFAULT 0`);
if (!usersCols.includes('total_loss'))     db.run(`ALTER TABLE users ADD COLUMN total_loss     REAL NOT NULL DEFAULT 0`);
// DEFAULT 1: existing users in DB are assumed to already be in the group
if (!usersCols.includes('is_in_group'))    db.run(`ALTER TABLE users ADD COLUMN is_in_group    INTEGER NOT NULL DEFAULT 1`);
// DEFAULT 0: existing users haven't been observed active since the last reset point
if (!usersCols.includes('is_active'))      db.run(`ALTER TABLE users ADD COLUMN is_active      INTEGER NOT NULL DEFAULT 0`);

const oddsHistoryCols = (db.query(`PRAGMA table_info(odds_history)`).all() as { name: string }[]).map(r => r.name);
if (!oddsHistoryCols.includes('fixed_odds_key')) db.run(`ALTER TABLE odds_history ADD COLUMN fixed_odds_key TEXT`);

// WAL checkpoint ทุก 5 นาที (PASSIVE = ไม่บล็อค readers/writers)
// ป้องกัน WAL file โตเรื่อยๆ ซึ่งทำให้ read ช้าลงเมื่อเวลาผ่านไป
const walTimer = setInterval(() => { db.run(`PRAGMA wal_checkpoint(PASSIVE)`); }, 5 * 60 * 1000);

// เรียกตอน shutdown — flush WAL → main file แล้วปิด DB
export function closeDb(): void {
    clearInterval(walTimer);
    // TRUNCATE ต้องการ exclusive lock — ถ้า fail (mmap ค้าง / readers อยู่) ให้ fallback
    // db.close() จะ checkpoint ให้เองอยู่แล้วเมื่อ connection สุดท้ายปิด
    try { db.run(`PRAGMA wal_checkpoint(TRUNCATE)`); } catch { /* ignore */ }
    try { db.close(); } catch { /* ignore */ }
}
