import { db } from './db';
import { SystemState, setNextShortId, recalculateUsersRoundState, recalcRoundAgg } from './game-state';
import type { UserState, BettingRound, BettingOdds, BetStatus, RoundStatus, RoundResult, TransactionType, AllowedGroup, SystemStats, BankAccount } from '../types';

// UPSERT แทน INSERT OR REPLACE — ป้องกัน DELETE+INSERT ที่ทำให้ rowid เปลี่ยนและ index rebuild
// สำคัญโดยเฉพาะตอน settlement transaction ที่เรียก saveUser N ครั้งพร้อมกัน
const stmtUpsertUser = db.prepare(`
    INSERT INTO users (id, short_id, role, credit, platform, display_name, profile_picture_url, is_in_group, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
        short_id            = excluded.short_id,
        role                = excluded.role,
        credit              = excluded.credit,
        platform            = excluded.platform,
        display_name        = excluded.display_name,
        profile_picture_url = excluded.profile_picture_url,
        is_in_group         = excluded.is_in_group,
        is_active           = excluded.is_active
`);
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

const stmtUpsertBank = db.prepare(
    `INSERT OR REPLACE INTO bank_accounts (short_id, bank, name, number, image_url, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const stmtDeleteBank   = db.prepare(`DELETE FROM bank_accounts WHERE short_id = ?`);
const stmtDeactivateAllBanks = db.prepare(`UPDATE bank_accounts SET is_active = 0`);
const stmtUpsertConfig = db.prepare(`INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)`);

const stmtUpsertGroup = db.prepare(
    `INSERT OR REPLACE INTO allowed_groups (id, platform, type, name, created_at) VALUES (?, ?, ?, ?, ?)`
);

const stmtUpsertOdds = db.prepare(`
    INSERT OR REPLACE INTO odds_history
        (round_id, odds_index, red_loss_ratio, red_win_ratio, blue_loss_ratio, blue_win_ratio,
         status, max_bet, min_bet, user_limit, vig, fixed_odds_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtGetLastTx = db.prepare(
    `SELECT id, user_id, amount, type, ref_id, created_at
     FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
);
const stmtGetUserDepositWithdraw = db.prepare(`
    SELECT
        COALESCE(SUM(CASE WHEN type = 'DEPOSIT'  THEN amount      ELSE 0 END), 0) as total_deposit,
        COALESCE(SUM(CASE WHEN type = 'WITHDRAW' THEN ABS(amount) ELSE 0 END), 0) as total_withdraw
    FROM transactions WHERE user_id = ?
`);
const stmtGetMaxRoundId          = db.prepare(`SELECT MAX(id) as max_id FROM rounds`);
const stmtGetRoundById            = db.prepare(`SELECT id, status, result, created_at FROM rounds WHERE id = ?`);
const stmtGetLastCompletedRound   = db.prepare(
    `SELECT id, status, result, created_at FROM rounds WHERE status = 'COMPLETED' ORDER BY id DESC LIMIT 1`
);
const stmtGetAllBetsForRound      = db.prepare(
    `SELECT user_id, side, amount, win_amount, loss_amount, status, odds_index, created_at
     FROM bets WHERE round_id = ? ORDER BY created_at`
);
const stmtGetSettledBets          = db.prepare(
    `SELECT user_id, side, amount, win_amount, loss_amount, status, odds_index
     FROM bets WHERE round_id = ? AND status IN ('WON', 'LOST', 'DRAW')`
);
const stmtGetOddsForRound         = db.prepare(
    `SELECT odds_index, red_loss_ratio, red_win_ratio, blue_loss_ratio, blue_win_ratio,
            status, max_bet, min_bet, user_limit, vig, fixed_odds_key
     FROM odds_history WHERE round_id = ? ORDER BY odds_index`
);

export function loadSystemStats(): SystemStats {
    const { v: globalTurnover } = db.query(
        `SELECT COALESCE(SUM(amount), 0) as v FROM bets WHERE status != 'VOID'`
    ).get() as { v: number };

    const { v: globalDeposit }  = db.query(
        `SELECT COALESCE(SUM(amount), 0) as v FROM transactions WHERE type = 'DEPOSIT'`
    ).get() as { v: number };
    const { v: globalWithdraw } = db.query(
        `SELECT COALESCE(SUM(ABS(amount)), 0) as v FROM transactions WHERE type = 'WITHDRAW'`
    ).get() as { v: number };

    type RoundPnl = { house_net: number };
    const roundPnl = db.query(`
        SELECT -SUM(amount) as house_net
        FROM transactions
        WHERE type IN ('BET_WIN', 'BET_LOSS', 'BET_DRAW') AND ref_id != ''
        GROUP BY ref_id
    `).all() as RoundPnl[];

    let houseWin = 0, houseLoss = 0;
    for (const { house_net } of roundPnl) {
        if (house_net >= 0) houseWin  += house_net;
        else                houseLoss += -house_net;
    }

    return { globalTurnover, globalDeposit, globalWithdraw, houseWin, houseLoss };
}

export function saveUser(user: UserState): void {
    stmtUpsertUser.run(user.userId, user.shortId, user.role, user.credit, user.platform, user.displayName ?? null, user.profilePictureUrl ?? null, user.isInGroup ? 1 : 0, user.isActive ? 1 : 0);
}

export function resetAllUsersActiveDB(): void {
    db.run(`UPDATE users SET is_active = 0`);
}

export function markUserActive(user: UserState): void {
    if (!user.isActive) {
        user.isActive = true;
        saveUser(user);
    }
}

export function saveOdds(roundId: number, oddsIndex: number, odds: import('../types').BettingOdds): void {
    stmtUpsertOdds.run(
        roundId, oddsIndex,
        odds.redLossRatio, odds.redWinRatio, odds.blueLossRatio, odds.blueWinRatio,
        odds.status, odds.maxBet, odds.minBet, odds.userLimit, odds.vig,
        odds.fixedOddsKey ?? null,
        Date.now(),
    );
}

type OddsRow = {
    odds_index: number;
    red_loss_ratio: number; red_win_ratio: number;
    blue_loss_ratio: number; blue_win_ratio: number;
    status: string; max_bet: number; min_bet: number; user_limit: number; vig: number;
    fixed_odds_key: string | null;
};

export function getOddsForRound(roundId: number): OddsRow[] {
    return stmtGetOddsForRound.all(roundId) as OddsRow[];
}

export function saveGroup(group: AllowedGroup): void {
    stmtUpsertGroup.run(group.id, group.platform, group.type, group.name, group.createdAt);
}

export function getNotifyGroups(platform: 'TELEGRAM' | 'LINE'): { id: string; platform: string }[] {
    return db.query(
        `SELECT id, platform FROM allowed_groups WHERE platform = ? AND type = 'NOTIFY'`
    ).all(platform) as { id: string; platform: string }[];
}

export function saveRound(round: BettingRound): void {
    stmtUpsertRound.run(round.id, round.status, round.result ?? null, round.startedAt);
}

export function saveBet(
    userId: string, roundId: number, oddsIndex: number, side: string,
    amount: number, winAmount: number, lossAmount: number
): void {
    stmtInsertBet.run(userId, roundId, oddsIndex, side, amount, winAmount, lossAmount, Date.now());
}

// ลบข้อมูล betting ทั้งหมด ยกเว้น users (credit คงอยู่)
export function clearBettingDataDB(): void {
    db.transaction(() => {
        db.run(`DELETE FROM bets`);
        db.run(`DELETE FROM rounds`);
        db.run(`DELETE FROM transactions`);
    })();
}

// ยกเลิก bets ใน odds index ที่ถูกยก
export function voidBetsInOdds(roundId: number, oddsIndex: number): void {
    db.run(`UPDATE bets SET status = 'VOID' WHERE round_id = ? AND odds_index = ?`, [roundId, oddsIndex]);
}

export function restoreBetsInOdds(roundId: number, oddsIndex: number): void {
    db.run(`UPDATE bets SET status = 'PENDING' WHERE round_id = ? AND odds_index = ? AND status = 'VOID'`, [roundId, oddsIndex]);
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

export function logTransaction(userId: string, amount: number, type: TransactionType, refId: string = ''): void {
    stmtLogTx.run(userId, amount, type, refId, Date.now());
}

type TxRow = { id: number; user_id: string; amount: number; type: string; ref_id: string; created_at: number };

export function getLastTransactions(userId: string, limit: number): TxRow[] {
    return stmtGetLastTx.all(userId, limit) as TxRow[];
}

export type TxExportRow = {
    id: number;
    created_at: number;
    short_id: number | null;
    display_name: string | null;
    platform: string | null;
    type: string;
    amount: number;
    ref_id: string;
};

export function getAllTransactionsForExport(): TxExportRow[] {
    return db.query(`
        SELECT t.id, t.created_at, u.short_id, u.display_name, u.platform,
               t.type, t.amount, t.ref_id
        FROM transactions t
        LEFT JOIN users u ON t.user_id = u.id
        ORDER BY t.created_at ASC
    `).all() as TxExportRow[];
}

export function getUserDepositWithdraw(userId: string): { totalDeposit: number; totalWithdraw: number } {
    const row = stmtGetUserDepositWithdraw.get(userId) as { total_deposit: number; total_withdraw: number };
    return { totalDeposit: row.total_deposit, totalWithdraw: row.total_withdraw };
}

export function saveBankAccount(account: BankAccount): void {
    stmtUpsertBank.run(
        account.shortId, account.bank, account.name, account.number,
        account.imageUrl ?? null, account.isActive ? 1 : 0, Date.now(),
    );
}

export function deleteBankAccountDB(shortId: number): void {
    stmtDeleteBank.run(shortId);
}

export function deactivateAllBankAccountsDB(): void {
    stmtDeactivateAllBanks.run();
}

export function getNextBankShortId(): number {
    const row = db.query(`SELECT COALESCE(MAX(short_id), 0) + 1 as next_id FROM bank_accounts`).get() as { next_id: number };
    return row.next_id;
}

export function saveSystemConfig(key: string, value: string): void {
    stmtUpsertConfig.run(key, value);
}

type RoundRow = { id: number; status: string; result: string | null; created_at: number };

export function getMaxRoundId(): number {
    const row = stmtGetMaxRoundId.get() as { max_id: number | null };
    return row?.max_id ?? 0;
}

export function getRoundById(roundId: number): RoundRow | null {
    return stmtGetRoundById.get(roundId) as RoundRow ?? null;
}

export type BetViewRow = {
    user_id: string; side: string; amount: number;
    win_amount: number; loss_amount: number; status: string; odds_index: number; created_at: number;
};

export function getAllBetsForRound(roundId: number): BetViewRow[] {
    return stmtGetAllBetsForRound.all(roundId) as BetViewRow[];
}

export function getRoundForReversal(roundId?: number): RoundRow | null {
    if (roundId !== undefined) {
        return stmtGetRoundById.get(roundId) as RoundRow ?? null;
    }
    return stmtGetLastCompletedRound.get() as RoundRow ?? null;
}

type BetReverseRow = { user_id: string; side: string; amount: number; win_amount: number; loss_amount: number; status: string; odds_index: number };

export function getSettledBetsForRound(roundId: number): BetReverseRow[] {
    return stmtGetSettledBets.all(roundId) as BetReverseRow[];
}

export function reverseRoundInDB(roundId: number): void {
    db.run(`UPDATE bets SET status = 'PENDING' WHERE round_id = ? AND status IN ('WON', 'LOST', 'DRAW')`, [roundId]);
    db.run(`UPDATE rounds SET status = 'CLOSED', result = NULL WHERE id = ?`, [roundId]);
}

type UserRow = { id: string; short_id: number; role: string; credit: number; platform: string; display_name: string | null; profile_picture_url: string | null; is_in_group: number; is_active: number };
type GroupRow = { id: string; platform: string; type: string; name: string; created_at: number };

export function loadSystemState(): { usersLoaded: number; roundLoaded: boolean } {
    SystemState.stats = loadSystemStats();

    const userTurnoverMap = new Map(
        (db.query(`SELECT user_id, COALESCE(SUM(amount), 0) as v FROM bets WHERE status != 'VOID' GROUP BY user_id`).all() as { user_id: string; v: number }[])
            .map(r => [r.user_id, r.v])
    );
    const isBettingSet = new Set(
        (db.query(`SELECT DISTINCT user_id FROM bets WHERE status != 'VOID'`).all() as { user_id: string }[])
            .map(r => r.user_id)
    );

    const userWinLossMap = new Map(
        (db.query(`
            SELECT user_id,
                COALESCE(SUM(CASE WHEN type = 'BET_WIN'  THEN amount       ELSE 0 END), 0) as total_win,
                COALESCE(SUM(CASE WHEN type = 'BET_LOSS' THEN ABS(amount)  ELSE 0 END), 0) as total_loss
            FROM transactions WHERE type IN ('BET_WIN', 'BET_LOSS') GROUP BY user_id
        `).all() as { user_id: string; total_win: number; total_loss: number }[])
            .map(r => [r.user_id, r])
    );

    const users = db.query(`SELECT id, short_id, role, credit, platform, display_name, profile_picture_url, is_in_group, is_active FROM users`).all() as UserRow[];
    let maxShortId = 0;
    for (const u of users) {
        const wl = userWinLossMap.get(u.id);
        const user: UserState = {
            userId: u.id,
            shortId: u.short_id,
            role: u.role as UserState['role'],
            platform: (u.platform ?? 'LINE') as UserState['platform'],
            credit: u.credit,
            creditHold: 0, currentRoundRedNet: 0, currentRoundBlueNet: 0,
            oddsBetCounts: new Map(),
            totalTurnover: userTurnoverMap.get(u.id) ?? 0,
            totalWin:      wl?.total_win  ?? 0,
            totalLoss:     wl?.total_loss ?? 0,
            isInGroup: u.is_in_group !== 0,
            isActive:  u.is_active  !== 0,
            isBetting: isBettingSet.has(u.id),
            isProfileLoaded: u.display_name != null,
            wasJustCreated: false,
            displayName: u.display_name ?? undefined,
            profilePictureUrl: u.profile_picture_url ?? undefined,
        };
        SystemState.users.set(u.id, user);
        SystemState.shortIdIndex.set(u.short_id, user);
        if (u.short_id > maxShortId) maxShortId = u.short_id;
    }
    if (maxShortId > 0) setNextShortId(maxShortId + 1);

    const groups = db.query(`SELECT id, platform, type, name, created_at FROM allowed_groups`).all() as GroupRow[];
    for (const g of groups) {
        SystemState.allowedGroups.set(g.id, {
            type: g.type as 'BETTING' | 'NOTIFY',
            platform: g.platform as 'LINE' | 'TELEGRAM',
        });
    }

    const row = db
        .query(`SELECT id, status, result, created_at FROM rounds WHERE status != 'COMPLETED' ORDER BY id DESC LIMIT 1`)
        .get() as RoundRow | null;

    if (row) {
        const oddsRows = getOddsForRound(row.id);
        const oddsHistory: BettingOdds[] = oddsRows.map(o => ({
            redLossRatio:  o.red_loss_ratio,
            redWinRatio:   o.red_win_ratio,
            blueLossRatio: o.blue_loss_ratio,
            blueWinRatio:  o.blue_win_ratio,
            status: o.status as BettingOdds['status'],
            maxBet: o.max_bet,
            minBet: o.min_bet,
            userLimit: o.user_limit,
            vig: o.vig,
            fixedOddsKey: o.fixed_odds_key ?? undefined,
        }));

        type BetLoadRow = { user_id: string; odds_index: number; side: string; amount: number; win_amount: number; loss_amount: number; status: string; created_at: number };
        const betRows = db.query(
            `SELECT user_id, odds_index, side, amount, win_amount, loss_amount, status, created_at
             FROM bets WHERE round_id = ? ORDER BY created_at`
        ).all(row.id) as BetLoadRow[];

        const bets = betRows.map(b => ({
            userId:     b.user_id,
            oddsIndex:  b.odds_index,
            side:       b.side as 'RED' | 'BLUE',
            amount:     b.amount,
            winAmount:  b.win_amount,
            lossAmount: b.loss_amount,
            timestamp:  b.created_at,
            status:     b.status as BetStatus,
        }));

        SystemState.currentRound = {
            id: row.id,
            bets,
            oddsHistory,
            status: row.status as RoundStatus,
            startedAt: row.created_at,
            result: (row.result ?? undefined) as RoundResult | undefined,
        };

        const lastOdds = oddsHistory[oddsHistory.length - 1];
        if (lastOdds?.status === 'OPEN') {
            SystemState.currentOdds = lastOdds;
        }

        recalculateUsersRoundState(SystemState.currentRound);
        recalcRoundAgg(); // คำนวณ aggregate cache จาก bets ใน RAM หลัง restart
    }

    type BankRow = { short_id: number; bank: string; name: string; number: string; image_url: string | null; is_active: number };
    const bankRows = db.query(
        `SELECT short_id, bank, name, number, image_url, is_active FROM bank_accounts ORDER BY short_id`
    ).all() as BankRow[];
    for (const r of bankRows) {
        SystemState.bankAccounts.set(r.short_id, {
            shortId: r.short_id, bank: r.bank, name: r.name, number: r.number,
            imageUrl: r.image_url ?? undefined, isActive: r.is_active !== 0,
        });
    }

    const configRows = db.query(`SELECT key, value FROM system_config WHERE key IN ('admin_link', 'flex_compact', 'bet_compact', 'tx_compact', 'round_compact', 'ac_compact', 'sum_compact', 'xcap', 'def_maxbet', 'def_minbet', 'def_lim', 'def_vig', 'risk_threshold', 'bet_delay_ms')`).all() as { key: string; value: string }[];
    for (const { key, value } of configRows) {
        if (key === 'admin_link')      SystemState.adminLink      = value;
        if (key === 'flex_compact')    SystemState.oddsCompact    = value === '1';
        if (key === 'bet_compact')     SystemState.betCompact     = value === '1';
        if (key === 'tx_compact')      SystemState.txCompact      = value === '1';
        if (key === 'round_compact')   SystemState.roundCompact   = value === '1';
        if (key === 'ac_compact')      SystemState.acCompact      = value === '1';
        if (key === 'sum_compact')     SystemState.sumCompact     = value === '1';
        if (key === 'xcap')            SystemState.xcap           = parseInt(value, 10) || 0;
        if (key === 'def_maxbet')    { const v = parseInt(value, 10); if (v > 0) SystemState.defMaxBet = v; }
        if (key === 'def_minbet')    { const v = parseInt(value, 10); if (v > 0) SystemState.defMinBet = v; }
        if (key === 'def_lim')       { const v = parseInt(value, 10); if (!isNaN(v) && v >= 0) SystemState.defLim = v; }
        if (key === 'def_vig')       { const v = parseInt(value, 10); if (!isNaN(v) && v >= 0) SystemState.defVig = v; }
        if (key === 'risk_threshold'){ const v = parseInt(value, 10); if (!isNaN(v) && v >= 0) SystemState.riskThreshold = v; }
        if (key === 'bet_delay_ms')  { const v = parseInt(value, 10); if (!isNaN(v) && v >= 0) SystemState.betDelayMs = v; }
    }

    return { usersLoaded: users.length, roundLoaded: !!row };
}
