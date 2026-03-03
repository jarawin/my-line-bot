import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { db } from '../store/db';
import { BACKUP_DIR } from '../config/paths';

export interface BackupResult {
    filename: string;
    rowCounts: {
        users: number;
        rounds: number;
        bets: number;
        transactions: number;
        oddsHistory: number;
    };
}

function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
    const escape = (v: string | number | null | undefined): string => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    };
    const lines = [headers.join(',')];
    for (const row of rows) lines.push(row.map(escape).join(','));
    return lines.join('\n');
}

/** Returns a date tag like "1_12_68" (day_month_yearBE2digit, Bangkok TZ) */
function thaiDateTag(): string {
    const bkk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    const day       = bkk.getDate();
    const month     = bkk.getMonth() + 1;
    const yearShort = (bkk.getFullYear() + 543) % 100;
    return `${day}_${month}_${yearShort}`;
}

/** Finds a unique filename e.g. 1_12_68.zip → 1_12_68_1.zip → 1_12_68_2.zip ... */
function uniqueZipName(tag: string): string {
    let filename = `${tag}.zip`;
    let i = 0;
    while (existsSync(`${BACKUP_DIR}/${filename}`)) {
        i++;
        filename = `${tag}_${i}.zip`;
    }
    return filename;
}

/**
 * Exports all DB tables to individual CSV files, zips them, stores in BACKUP_DIR.
 * The backup is created BEFORE the reset so it captures pre-reset state.
 * Requires the `zip` binary (available on macOS and standard Linux).
 */
export function createBackupZip(): BackupResult {
    const tag      = thaiDateTag();
    const filename = uniqueZipName(tag);
    const zipPath  = `${BACKUP_DIR}/${filename}`;
    const tmpDir   = `/tmp/betting_backup_${Date.now()}`;

    mkdirSync(tmpDir, { recursive: true });
    const rowCounts = { users: 0, rounds: 0, bets: 0, transactions: 0, oddsHistory: 0 };

    try {
        // --- users ---
        type UserRow = {
            id: string; short_id: number; role: string; credit: number;
            platform: string; display_name: string | null;
            total_turnover: number; total_win: number; total_loss: number;
            is_in_group: number; is_active: number;
        };
        const users = db.query(
            `SELECT id, short_id, role, credit, platform, display_name,
                    total_turnover, total_win, total_loss, is_in_group, is_active
             FROM users ORDER BY short_id`
        ).all() as UserRow[];
        writeFileSync(`${tmpDir}/users.csv`, toCsv(
            ['id', 'short_id', 'role', 'credit', 'platform', 'display_name',
             'total_turnover', 'total_win', 'total_loss', 'is_in_group', 'is_active'],
            users.map(r => [r.id, r.short_id, r.role, r.credit, r.platform, r.display_name,
                            r.total_turnover, r.total_win, r.total_loss, r.is_in_group, r.is_active])
        ));
        rowCounts.users = users.length;

        // --- rounds ---
        type RoundRow = { id: number; status: string; result: string | null; created_at: number };
        const rounds = db.query(
            `SELECT id, status, result, created_at FROM rounds ORDER BY id`
        ).all() as RoundRow[];
        writeFileSync(`${tmpDir}/rounds.csv`, toCsv(
            ['id', 'status', 'result', 'created_at'],
            rounds.map(r => [r.id, r.status, r.result, r.created_at])
        ));
        rowCounts.rounds = rounds.length;

        // --- bets ---
        type BetRow = {
            id: number; user_id: string; round_id: number; odds_index: number;
            side: string; amount: number; win_amount: number; loss_amount: number;
            status: string; created_at: number;
        };
        const bets = db.query(
            `SELECT id, user_id, round_id, odds_index, side, amount, win_amount, loss_amount, status, created_at
             FROM bets ORDER BY id`
        ).all() as BetRow[];
        writeFileSync(`${tmpDir}/bets.csv`, toCsv(
            ['id', 'user_id', 'round_id', 'odds_index', 'side', 'amount', 'win_amount', 'loss_amount', 'status', 'created_at'],
            bets.map(r => [r.id, r.user_id, r.round_id, r.odds_index, r.side, r.amount, r.win_amount, r.loss_amount, r.status, r.created_at])
        ));
        rowCounts.bets = bets.length;

        // --- transactions ---
        type TxRow = { id: number; user_id: string; amount: number; type: string; ref_id: string; created_at: number };
        const txs = db.query(
            `SELECT id, user_id, amount, type, ref_id, created_at FROM transactions ORDER BY id`
        ).all() as TxRow[];
        writeFileSync(`${tmpDir}/transactions.csv`, toCsv(
            ['id', 'user_id', 'amount', 'type', 'ref_id', 'created_at'],
            txs.map(r => [r.id, r.user_id, r.amount, r.type, r.ref_id, r.created_at])
        ));
        rowCounts.transactions = txs.length;

        // --- odds_history ---
        type OddsRow = {
            round_id: number; odds_index: number;
            red_loss_ratio: number; red_win_ratio: number;
            blue_loss_ratio: number; blue_win_ratio: number;
            status: string; max_bet: number; min_bet: number; user_limit: number; vig: number;
            created_at: number;
        };
        const odds = db.query(
            `SELECT round_id, odds_index, red_loss_ratio, red_win_ratio, blue_loss_ratio, blue_win_ratio,
                    status, max_bet, min_bet, user_limit, vig, created_at
             FROM odds_history ORDER BY round_id, odds_index`
        ).all() as OddsRow[];
        writeFileSync(`${tmpDir}/odds_history.csv`, toCsv(
            ['round_id', 'odds_index', 'red_loss_ratio', 'red_win_ratio', 'blue_loss_ratio', 'blue_win_ratio',
             'status', 'max_bet', 'min_bet', 'user_limit', 'vig', 'created_at'],
            odds.map(r => [r.round_id, r.odds_index, r.red_loss_ratio, r.red_win_ratio,
                           r.blue_loss_ratio, r.blue_win_ratio, r.status, r.max_bet,
                           r.min_bet, r.user_limit, r.vig, r.created_at])
        ));
        rowCounts.oddsHistory = odds.length;

        // --- create zip (junk paths: store filenames only, no directory prefix) ---
        const csvFiles = [
            `${tmpDir}/users.csv`,
            `${tmpDir}/rounds.csv`,
            `${tmpDir}/bets.csv`,
            `${tmpDir}/transactions.csv`,
            `${tmpDir}/odds_history.csv`,
        ];
        const proc = Bun.spawnSync(['zip', '-j', zipPath, ...csvFiles]);
        if (proc.exitCode !== 0) {
            throw new Error(`zip command failed (exit ${proc.exitCode})`);
        }
    } finally {
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }

    return { filename, rowCounts };
}
