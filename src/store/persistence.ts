import { db } from './db';
import { SystemState, setNextShortId } from './game-state';
import type { UserState, BettingRound, RoundStatus, RoundResult, TransactionType } from '../types';

// ---------------------------------------------------------------------------
// Prepared statements — compile ครั้งเดียว ใช้ซ้ำได้เร็ว
// ---------------------------------------------------------------------------
const stmtUpsertUser  = db.prepare(`INSERT OR REPLACE INTO users (id, short_id, role, credit) VALUES (?, ?, ?, ?)`);
const stmtUpsertRound = db.prepare(`INSERT OR REPLACE INTO rounds (id, status, result, created_at) VALUES (?, ?, ?, ?)`);
const stmtInsertBet   = db.prepare(
    `INSERT INTO bets (user_id, round_id, odds_index, side, amount, win_amount, loss_amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
// ไม่อัปเดต VOID bets ระหว่าง settlement
const stmtSettleBets  = db.prepare(`
    UPDATE bets SET status = CASE
        WHEN (side = 'RED'  AND ?) OR (side = 'BLUE' AND ?) THEN 'WON'
        WHEN ? = 'DRAW' THEN 'DRAW'
        ELSE 'LOST'
    END WHERE round_id = ? AND status != 'VOID'
`);
const stmtLogTx = db.prepare(
    `INSERT INTO transactions (user_id, amount, type, ref_id, created_at) VALUES (?, ?, ?, ?, ?)`
);

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------
export function saveUser(user: UserState): void {
    stmtUpsertUser.run(user.userId, user.shortId, user.role, user.credit);
}

// ---------------------------------------------------------------------------
// Round
// ---------------------------------------------------------------------------
export function saveRound(round: BettingRound): void {
    stmtUpsertRound.run(round.id, round.status, round.result ?? null, round.startedAt);
}

// ---------------------------------------------------------------------------
// Bet
// ---------------------------------------------------------------------------
export function saveBet(
    userId: string, roundId: number, oddsIndex: number, side: string,
    amount: number, winAmount: number, lossAmount: number
): void {
    stmtInsertBet.run(userId, roundId, oddsIndex, side, amount, winAmount, lossAmount, Date.now());
}

// ลบข้อมูล betting ทั้งหมด ยกเว้น users (credit คงอยู่)
export function clearBettingDataDB(): void {
    db.run(`DELETE FROM bets`);
    db.run(`DELETE FROM rounds`);
}

// ยกเลิก bets ใน odds index ที่ถูกยก
export function voidBetsInOdds(roundId: number, oddsIndex: number): void {
    db.run(`UPDATE bets SET status = 'VOID' WHERE round_id = ? AND odds_index = ?`, [roundId, oddsIndex]);
}

// Bulk update bet statuses หลัง settlement — 1 query แทนที่จะ N queries
export function settleBetsInRound(roundId: number, result: RoundResult): void {
    stmtSettleBets.run(
        result === 'RED'  ? 1 : 0,
        result === 'BLUE' ? 1 : 0,
        result,
        roundId
    );
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------
export function logTransaction(userId: string, amount: number, type: TransactionType, refId: string = ''): void {
    stmtLogTx.run(userId, amount, type, refId, Date.now());
}

type TxRow = { id: number; user_id: string; amount: number; type: string; ref_id: string; created_at: number };

export function getLastTransactions(userId: string, limit: number): TxRow[] {
    return db.query(
        `SELECT id, user_id, amount, type, ref_id, created_at FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
    ).all(userId, limit) as TxRow[];
}

// ---------------------------------------------------------------------------
// Reverse (Rollback) helpers
// ---------------------------------------------------------------------------
type RoundRow = { id: number; status: string; result: string | null; created_at: number };

export function getRoundForReversal(roundId?: number): RoundRow | null {
    if (roundId !== undefined) {
        return db.query(`SELECT id, status, result, created_at FROM rounds WHERE id = ?`).get(roundId) as RoundRow ?? null;
    }
    return db.query(
        `SELECT id, status, result, created_at FROM rounds WHERE status = 'COMPLETED' ORDER BY id DESC LIMIT 1`
    ).get() as RoundRow ?? null;
}

type BetReverseRow = { user_id: string; side: string; amount: number; win_amount: number; loss_amount: number; status: string; odds_index: number };

export function getSettledBetsForRound(roundId: number): BetReverseRow[] {
    return db.query(
        `SELECT user_id, side, amount, win_amount, loss_amount, status, odds_index FROM bets WHERE round_id = ? AND status IN ('WON', 'LOST')`
    ).all(roundId) as BetReverseRow[];
}

export function reverseRoundInDB(roundId: number): void {
    db.run(`UPDATE bets SET status = 'PENDING' WHERE round_id = ? AND status IN ('WON', 'LOST')`, [roundId]);
    db.run(`UPDATE rounds SET status = 'CLOSED', result = NULL WHERE id = ?`, [roundId]);
}

// ---------------------------------------------------------------------------
// Load on startup
// ---------------------------------------------------------------------------
type UserRow = { id: string; short_id: number; role: string; credit: number };

export function loadSystemState(): { usersLoaded: number; roundLoaded: boolean } {
    const users = db.query(`SELECT id, short_id, role, credit FROM users`).all() as UserRow[];
    let maxShortId = 0;
    for (const u of users) {
        const user: UserState = {
            userId: u.id,
            shortId: u.short_id,
            role: u.role as UserState['role'],
            credit: u.credit,
            creditHold: 0, currentRoundRedNet: 0, currentRoundBlueNet: 0,
            oddsBetCounts: new Map(),
        };
        SystemState.users.set(u.id, user);
        SystemState.shortIdIndex.set(u.short_id, user);
        if (u.short_id > maxShortId) maxShortId = u.short_id;
    }
    if (maxShortId > 0) setNextShortId(maxShortId + 1);

    const row = db
        .query(`SELECT id, status, result, created_at FROM rounds WHERE status != 'COMPLETED' ORDER BY id DESC LIMIT 1`)
        .get() as RoundRow | null;

    if (row) {
        SystemState.currentRound = {
            id: row.id, bets: [], oddsHistory: [],
            status: row.status as RoundStatus,
            startedAt: row.created_at,
            result: (row.result ?? undefined) as RoundResult | undefined,
        };
        console.log(`[DB] Restored round #${row.id} (${row.status})`);
    }

    console.log(`[DB] Loaded ${users.length} user(s)`);
    return { usersLoaded: users.length, roundLoaded: !!row };
}
