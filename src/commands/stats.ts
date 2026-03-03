import * as XLSX from 'xlsx';
import { db } from '../store/db';
import { SystemState } from '../store/game-state';
import { getAllTransactionsForExport } from '../store/persistence';
import { EXPORT_DIR } from '../config/paths';
import { ReplyBuilder } from '../utils/response';
import { generateTxFlex } from '../flex/tx-flex';
import { generateCreditFlex } from '../flex/credit-flex';
import { generateCloseOddsFlex } from '../flex/close-odds-flex';
import { generateCloseRoundFlex } from '../flex/close-round-flex';
import { generateExcelFlex, txTypeTh, fmtThaiDate } from '../flex/excel-flex';
import { generateActiveCreditFlex } from '../flex/active-credit-flex';
import { generateBettingSummaryFlex } from '../flex/betting-summary-flex';
import type { Bet, BettingOdds, BettingRound, CommandResult, RoundResult, UserState } from '../types';

export function calcRoundExposure(bets: Bet[]): { ifRedWins: number; ifBlueWins: number } {
    let ifRedWins = 0;
    let ifBlueWins = 0;
    for (const b of bets) {
        if (b.status === 'VOID') continue;
        if (b.side === 'RED') {
            ifRedWins  -= b.winAmount;
            ifBlueWins += b.lossAmount;
        } else {
            ifBlueWins -= b.winAmount;
            ifRedWins  += b.lossAmount;
        }
    }
    return { ifRedWins, ifBlueWins };
}

export function cmdStats(): CommandResult {
    const s = SystemState.stats;

    const holdPct = s.globalTurnover > 0
        ? (((s.houseWin - s.houseLoss) / s.globalTurnover) * 100).toFixed(2)
        : '0.00';

    const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
    const fmtSigned = (n: number) => n >= 0 ? `+${fmt(n)}` : `-${fmt(-n)}`;

    const uniqueDep = ((db.query(`SELECT COUNT(DISTINCT user_id) as c FROM transactions WHERE type = 'DEPOSIT'`).get() as any)?.c ?? 0) as number;
    const uniqueWd  = ((db.query(`SELECT COUNT(DISTINCT user_id) as c FROM transactions WHERE type = 'WITHDRAW'`).get() as any)?.c ?? 0) as number;

    const lines: string[] = [
        `📊 House Dashboard`,
        `💰 ยอดฝากรวม: ${fmt(s.globalDeposit)} (${uniqueDep} คน)`,
        `💸 ยอดถอนรวม: ${fmt(s.globalWithdraw)} (${uniqueWd} คน)`,
        `🔄 Turnover รวม: ${fmt(s.globalTurnover)}`,
        `🏦 เจ้ามือได้: ${fmt(s.houseWin)} | เสีย: ${fmt(s.houseLoss)}`,
        `📈 Hold: ${holdPct}%`,
    ];

    const round = SystemState.currentRound;
    if (round) {
        const { ifRedWins, ifBlueWins } = calcRoundExposure(round.bets);
        const worstCase = Math.min(ifRedWins, ifBlueWins);
        lines.push(
            ``,
            `🚨 ความเสี่ยงรอบปัจจุบัน (#r${round.id})`,
            `🔴 แดงชนะ เจ้ามือ ${fmtSigned(ifRedWins)}`,
            `🔵 น้ำเงินชนะ เจ้ามือ ${fmtSigned(ifBlueWins)}`,
            `⚠️ Worst-Case: ${fmtSigned(worstCase)}`,
        );
    } else {
        lines.push(``, `ไม่มีรอบที่เปิดอยู่`);
    }

    const customers = [...SystemState.users.values()].filter(u => u.role === 'CUSTOMER');
    const top3Win  = [...customers].sort((a, b) => b.totalWin - a.totalWin).slice(0, 3).filter(u => u.totalWin > 0);
    const top3Loss = [...customers].sort((a, b) => b.totalLoss - a.totalLoss).slice(0, 3).filter(u => u.totalLoss > 0);

    lines.push(``, `🏆 Top Winners`);
    if (top3Win.length > 0) {
        top3Win.forEach((u, i) => lines.push(`  ${i + 1}. #u${u.shortId} +${fmt(u.totalWin)}`));
    } else {
        lines.push(`  (ยังไม่มีข้อมูล)`);
    }

    lines.push(``, `💀 Top Losers`);
    if (top3Loss.length > 0) {
        top3Loss.forEach((u, i) => lines.push(`  ${i + 1}. #u${u.shortId} -${fmt(u.totalLoss)}`));
    } else {
        lines.push(`  (ยังไม่มีข้อมูล)`);
    }

    return ReplyBuilder.create().text(lines.join('\n')).build();
}

export function cmdFlexTestBetHistory(n: number): CommandResult {
    const RESULT: RoundResult = 'RED';
    const AMOUNTS = [500, 1000, 2000, 500, 1500, 3000];

    const oddsCount = Math.max(1, Math.ceil(n / 2));
    const now = Date.now();

    const oddsHistory: BettingOdds[] = Array.from({ length: oddsCount }, (_, i) => ({
        redLossRatio:  1.0,
        redWinRatio:   [0.9, 0.8, 0.95][i % 3]!,
        blueLossRatio: 1.0,
        blueWinRatio:  [0.9, 1.0, 0.85][i % 3]!,
        status: 'CLOSED' as const,
        maxBet: 50000, minBet: 100, userLimit: 2, vig: 5,
    }));

    const bets: Bet[] = [];
    let betIdx = 0;
    for (let oi = 0; oi < oddsCount && bets.length < n; oi++) {
        const odds = oddsHistory[oi]!;
        for (const side of ['RED', 'BLUE'] as const) {
            if (bets.length >= n) break;
            const amount = AMOUNTS[betIdx++ % AMOUNTS.length]!;
            const isWinner = side === RESULT;
            const winRatio  = side === 'RED' ? odds.redWinRatio  : odds.blueWinRatio;
            const lossRatio = side === 'RED' ? odds.redLossRatio : odds.blueLossRatio;
            bets.push({
                userId: 'FLEXTEST', oddsIndex: oi, side, amount,
                winAmount:  Math.floor(amount * winRatio),
                lossAmount: Math.floor(amount * lossRatio),
                status: isWinner ? 'WON' : 'LOST',
                timestamp: now - (n - bets.length) * 600000,
            });
        }
    }

    const mockRound: BettingRound = {
        id: 1, bets, oddsHistory, status: 'COMPLETED',
        startedAt: now - 3600000, result: RESULT,
    };

    let credit = 10000;
    for (const b of bets) credit += b.status === 'WON' ? b.winAmount : -b.lossAmount;
    credit = Math.max(credit, 1000);

    const mockUser: UserState = {
        userId: 'FLEXTEST', shortId: 999, role: 'CUSTOMER', platform: 'LINE',
        credit, creditHold: 0, currentRoundRedNet: 0, currentRoundBlueNet: 0,
        oddsBetCounts: new Map(), totalTurnover: 0, totalWin: 0, totalLoss: 0,
        isInGroup: true, isActive: false, isBetting: false, isProfileLoaded: true, wasJustCreated: false,
        displayName: `Test (fa${n})`,
    };

    const flexes = generateCreditFlex({ user: mockUser, transactions: [], currentRound: null, settledRound: mockRound });
    const rb = ReplyBuilder.create();
    for (const f of flexes) rb.flex(f.contents, f.altText ?? `fa${n}`);
    return rb.build();
}

export function cmdFlexTestTx(n: number): CommandResult {
    const TX_TEMPLATES = [
        { type: 'DEPOSIT',    amount: +10000, ref_id: ''    },
        { type: 'BET_LOSS',   amount:  -2000, ref_id: '#r1' },
        { type: 'BET_WIN',    amount:  +1900, ref_id: '#r2' },
        { type: 'WITHDRAW',   amount:  -5000, ref_id: ''    },
        { type: 'BET_WIN',    amount:   +950, ref_id: '#r3' },
        { type: 'BET_LOSS',   amount:  -1000, ref_id: '#r4' },
        { type: 'REFUND',     amount:  +1000, ref_id: '#r4' },
        { type: 'ADJUSTMENT', amount:   +500, ref_id: ''    },
    ];

    const now = Date.now();
    const transactions = Array.from({ length: n }, (_, i) => {
        const tpl = TX_TEMPLATES[i % TX_TEMPLATES.length]!;
        return { type: tpl.type, amount: tpl.amount, ref_id: tpl.ref_id, created_at: now - (n - i) * 3600000 };
    });

    const credit = Math.max(transactions.reduce((sum, tx) => sum + tx.amount, 0), 1000);

    const mockUser: UserState = {
        userId: 'FLEXTEST', shortId: 999, role: 'CUSTOMER', platform: 'LINE',
        credit, creditHold: 0, currentRoundRedNet: 0, currentRoundBlueNet: 0,
        oddsBetCounts: new Map(), totalTurnover: 0, totalWin: 0, totalLoss: 0,
        isInGroup: true, isActive: false, isBetting: false, isProfileLoaded: true, wasJustCreated: false,
        displayName: `Test (fb${n})`,
    };

    const flexes = generateCreditFlex({ user: mockUser, transactions, currentRound: null, settledRound: null, allTransactions: true });
    const rb = ReplyBuilder.create();
    for (const f of flexes) rb.flex(f.contents, f.altText ?? `fb${n}`);
    return rb.build();
}

export function cmdFlexTestCloseRound(n: number): CommandResult {
    const AMOUNTS = [500, 1000, 2000, 3000, 5000, 1500, 2500, 800];
    const SIDES: ('RED' | 'BLUE')[] = ['RED', 'BLUE', 'RED', 'RED', 'BLUE', 'BLUE', 'RED', 'BLUE'];
    const now = Date.now();

    const users = new Map<string, UserState>();
    const bets: Bet[] = [];

    for (let i = 0; i < n; i++) {
        const uid = `USER${i + 1}`;
        users.set(uid, {
            userId: uid, shortId: i + 1, role: 'CUSTOMER', platform: 'LINE',
            credit: 10000, creditHold: 0, currentRoundRedNet: 0, currentRoundBlueNet: 0,
            oddsBetCounts: new Map(), totalTurnover: 0, totalWin: 0, totalLoss: 0,
            isInGroup: true, isActive: true, isBetting: true, isProfileLoaded: true, wasJustCreated: false,
            displayName: `ผู้ใช้ ${i + 1}`,
        });
        const side = SIDES[i % SIDES.length]!;
        const amount = AMOUNTS[i % AMOUNTS.length]!;
        bets.push({
            userId: uid, oddsIndex: 0, side, amount,
            winAmount: Math.floor(amount * 0.9),
            lossAmount: amount,
            status: 'PENDING',
            timestamp: now - (n - i) * 60000,
        });
    }

    const { flexes } = generateCloseRoundFlex(1, bets, users, false, 'RED');
    const rb = ReplyBuilder.create();
    for (const f of flexes) rb.flex(f.contents, f.altText ?? `fd${n}`);
    return rb.build();
}

export function cmdFlexTestActiveCredit(n: number): CommandResult {
    const CREDITS   = [5000, 12000, 3500, 8000, 25000, 1500, 50000, 7000];
    const TURNOVERS = [0, 5000, 12000, 3000, 0, 20000, 8500, 1000];

    const mockUsers: UserState[] = Array.from({ length: n }, (_, i) => ({
        userId: `USER${i + 1}`,
        shortId: i + 1,
        role: 'CUSTOMER' as const,
        platform: 'LINE' as const,
        credit: CREDITS[i % CREDITS.length]!,
        creditHold: 0,
        currentRoundRedNet: 0,
        currentRoundBlueNet: 0,
        oddsBetCounts: new Map(),
        totalTurnover: TURNOVERS[i % TURNOVERS.length]!,
        totalWin: 0,
        totalLoss: 0,
        isInGroup: true,
        isActive: true,
        isBetting: TURNOVERS[i % TURNOVERS.length]! > 0,
        isProfileLoaded: true,
        wasJustCreated: false,
        displayName: `ผู้ใช้ ${i + 1}`,
    }));

    const { flexes } = generateActiveCreditFlex(mockUsers);
    const rb = ReplyBuilder.create();
    for (const f of flexes) rb.flex(f.contents, f.altText ?? `fe${n}`);
    return rb.build();
}

export function cmdFlexTestCloseOdds(n: number): CommandResult {
    const AMOUNTS = [500, 1000, 2000, 3000, 5000, 1500, 2500, 800];
    const SIDES: ('RED' | 'BLUE')[] = ['RED', 'BLUE', 'RED', 'RED', 'BLUE', 'BLUE', 'RED', 'BLUE'];
    const now = Date.now();

    const users = new Map<string, UserState>();
    const bets: Bet[] = [];

    for (let i = 0; i < n; i++) {
        const uid = `USER${i + 1}`;
        users.set(uid, {
            userId: uid, shortId: i + 1, role: 'CUSTOMER', platform: 'LINE',
            credit: 10000, creditHold: 0, currentRoundRedNet: 0, currentRoundBlueNet: 0,
            oddsBetCounts: new Map(), totalTurnover: 0, totalWin: 0, totalLoss: 0,
            isInGroup: true, isActive: true, isBetting: true, isProfileLoaded: true, wasJustCreated: false,
            displayName: `ผู้ใช้ ${i + 1}`,
        });
        const side1 = SIDES[i % SIDES.length]!;
        const amount1 = AMOUNTS[i % AMOUNTS.length]!;
        bets.push({ userId: uid, oddsIndex: 0, side: side1, amount: amount1, winAmount: Math.floor(amount1 * 0.9), lossAmount: amount1, status: 'PENDING', timestamp: now - (n - i) * 60000 });
        if (i % 3 !== 0) {
            const side2: 'RED' | 'BLUE' = side1 === 'RED' ? 'BLUE' : 'RED';
            const amount2 = AMOUNTS[(i + 2) % AMOUNTS.length]!;
            bets.push({ userId: uid, oddsIndex: 0, side: side2, amount: amount2, winAmount: Math.floor(amount2 * 0.9), lossAmount: amount2, status: 'PENDING', timestamp: now - (n - i) * 60000 + 30000 });
        }
    }

    const flexes = generateCloseOddsFlex(1, 1, '1.9/1.9', false, bets, users);
    const rb = ReplyBuilder.create();
    for (const msg of flexes) rb.flex(msg.contents, msg.altText ?? `fc${n}`);
    return rb.build();
}

export function cmdTx(): CommandResult {
    const s = SystemState.stats;

    let balance = 0;
    for (const user of SystemState.users.values()) {
        balance += user.credit;
    }

    const { contents, altText } = generateTxFlex(s.globalDeposit, s.globalWithdraw, balance);
    return ReplyBuilder.create().flex(contents, altText).build();
}

export function cmdActiveCredit(): CommandResult {
    const activeUsers = [...SystemState.users.values()].filter(u => u.isActive);
    activeUsers.sort((a, b) => b.credit - a.credit);

    const { flexes } = generateActiveCreditFlex(activeUsers);
    const rb = ReplyBuilder.create();
    for (const f of flexes) rb.flex(f.contents, f.altText ?? 'สรุปยอดผู้ใช้งาน');
    return rb.build();
}

export function cmdExportAc(): CommandResult {
    const activeUsers = [...SystemState.users.values()].filter(u => u.isActive);
    activeUsers.sort((a, b) => b.credit - a.credit);

    const headers = [
        'ลำดับ', '#ID', 'ชื่อ', 'Platform', 'Role',
        'เครดิต', 'กันเครดิต', 'ใช้ได้จริง',
        'Turnover', 'ได้รวม', 'เสียรวม', 'Net P/L',
        'อยู่ในกลุ่ม', 'isBetting',
    ];
    const data = activeUsers.map((u, i) => {
        const name = u.displayName ?? (u.telegramUsername ? `@${u.telegramUsername}` : '-');
        const roleLabel = u.role === 'MASTER' ? 'Master' : u.role === 'ADMIN' ? 'Admin' : 'Customer';
        const available = u.credit - u.creditHold;
        const netPL = u.totalWin - u.totalLoss;
        return [
            i + 1,
            `#u${u.shortId}`,
            name,
            u.platform,
            roleLabel,
            u.credit,
            u.creditHold,
            available,
            u.totalTurnover,
            u.totalWin,
            u.totalLoss,
            netPL,
            u.isInGroup ? 'ใช่' : 'ไม่',
            u.isBetting ? 'ใช่' : 'ไม่',
        ];
    });

    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws['!cols'] = [
        { wch: 7 },
        { wch: 8 },
        { wch: 20 },
        { wch: 10 },
        { wch: 10 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 10 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ผู้ใช้งาน');

    const filename = 'active-credit.xlsx';
    const filepath = `${EXPORT_DIR}/${filename}`;
    XLSX.writeFile(wb, filepath);

    const base = (process.env.SERVER_URL ?? '').replace(/\/$/, '');
    if (!base) throw new Error('⛔ ยังไม่ได้ตั้งค่า SERVER_URL');
    const fileUrl = `${base}/export/${filename}?t=${Date.now()}`;

    const flex = generateExcelFlex(filename, activeUsers.length, fileUrl);
    return ReplyBuilder.create().flex(flex.contents, flex.altText ?? filename).build();
}

export function cmdExportBetting(): CommandResult {
    type RoundRow = { id: number; status: string; result: string | null; created_at: number };
    const rounds = db.query(`SELECT id, status, result, created_at FROM rounds ORDER BY id`).all() as RoundRow[];

    type BetRow = {
        id: number; round_id: number; odds_index: number; side: string;
        amount: number; win_amount: number; loss_amount: number; status: string; created_at: number;
        user_id: string; short_id: number | null; display_name: string | null; platform: string | null;
    };
    const bets = db.query(`
        SELECT b.id, b.round_id, b.odds_index, b.side, b.amount, b.win_amount, b.loss_amount, b.status, b.created_at,
               b.user_id, u.short_id, u.display_name, u.platform
        FROM bets b
        LEFT JOIN users u ON b.user_id = u.id
        ORDER BY b.round_id, b.odds_index, b.created_at
    `).all() as BetRow[];

    type OddsHistRow = {
        round_id: number; odds_index: number;
        red_loss_ratio: number; red_win_ratio: number;
        blue_loss_ratio: number; blue_win_ratio: number;
        status: string; max_bet: number; min_bet: number; user_limit: number; vig: number;
        created_at: number;
    };
    const oddsRows = db.query(`
        SELECT round_id, odds_index, red_loss_ratio, red_win_ratio, blue_loss_ratio, blue_win_ratio,
               status, max_bet, min_bet, user_limit, vig, created_at
        FROM odds_history ORDER BY round_id, odds_index
    `).all() as OddsHistRow[];

    const roundMap = new Map(rounds.map(r => [r.id, r]));
    const oddsMap = new Map(oddsRows.map(o => [`${o.round_id}_${o.odds_index}`, o]));

    const betsByRound = new Map<number, BetRow[]>();
    const betsByOdds  = new Map<string, BetRow[]>();
    for (const b of bets) {
        if (!betsByRound.has(b.round_id)) betsByRound.set(b.round_id, []);
        betsByRound.get(b.round_id)!.push(b);
        const key = `${b.round_id}_${b.odds_index}`;
        if (!betsByOdds.has(key)) betsByOdds.set(key, []);
        betsByOdds.get(key)!.push(b);
    }

    const fmt = (n: number) => Math.round(n);
    const fmtPct = (n: number, d: number): number => d > 0 ? +((n / d * 100).toFixed(2)) : 0;
    const resultTh = (r: string | null) =>
        r === 'RED' ? 'แดง' : r === 'BLUE' ? 'น้ำเงิน' : r === 'DRAW' ? 'เสมอ' : '-';
    const statusTh = (s: string) =>
        s === 'COMPLETED' ? 'สำเร็จ' : s === 'CLOSED' ? 'ปิด' : s === 'OPEN' ? 'เปิด' :
        s === 'WAITING_PAYMENT' ? 'รอจ่าย' : s === 'CANCELLED' ? 'ยกเลิก' : s;
    const betStatusTh = (s: string) =>
        s === 'WON' ? 'ชนะ' : s === 'LOST' ? 'แพ้' : s === 'DRAW' ? 'เสมอ' : s === 'VOID' ? 'ยก' : 'รอ';

    function houseNet(arr: BetRow[]): number {
        let net = 0;
        for (const b of arr) {
            if (b.status === 'WON')  net -= b.win_amount;
            if (b.status === 'LOST') net += b.loss_amount;
        }
        return net;
    }
    function exposure(arr: BetRow[]): { ifRedWins: number; ifBlueWins: number } {
        let ir = 0, ib = 0;
        for (const b of arr) {
            if (b.status === 'VOID') continue;
            if (b.side === 'RED')  { ir -= b.win_amount;  ib += b.loss_amount; }
            else                   { ib -= b.win_amount;  ir += b.loss_amount; }
        }
        return { ifRedWins: ir, ifBlueWins: ib };
    }

    const s1H = [
        'รอบที่', 'เปิดเมื่อ', 'สถานะ', 'ผลลัพธ์',
        'จำนวนราคา', 'ผู้เล่นไม่ซ้ำ', 'ไม้รวม', 'Turnover',
        'ยอดแดง', 'คนแทงแดง', 'ยอดน้ำเงิน', 'คนแทงน้ำเงิน',
        'ถ้าแดงชนะ', 'ถ้าน้ำเงินชนะ', 'Worst-Case', 'Bias(แดง-น้ำเงิน)',
        'บ้านได้จริง', 'Hold%',
        'คนชนะ', 'ยอดจ่ายออก', 'คนแพ้', 'ยอดเก็บเข้า', 'คนเสมอ', 'ยกกี่ไม้',
    ];
    const s1Tot = new Array<number>(s1H.length).fill(0);
    const s1Data: (string | number)[][] = rounds.map(round => {
        const rb  = betsByRound.get(round.id) ?? [];
        const nv  = rb.filter(b => b.status !== 'VOID');
        const red = nv.filter(b => b.side === 'RED');
        const blu = nv.filter(b => b.side === 'BLUE');
        const won  = rb.filter(b => b.status === 'WON');
        const lost = rb.filter(b => b.status === 'LOST');
        const draw = rb.filter(b => b.status === 'DRAW');
        const voids = rb.filter(b => b.status === 'VOID');

        const turnover  = nv.reduce((s, b) => s + b.amount, 0);
        const redAmt    = red.reduce((s, b) => s + b.amount, 0);
        const bluAmt    = blu.reduce((s, b) => s + b.amount, 0);
        const { ifRedWins, ifBlueWins } = exposure(nv);
        const hn  = houseNet(rb);
        const row: (string | number)[] = [
            `#r${round.id}`,
            fmtThaiDate(round.created_at),
            statusTh(round.status),
            resultTh(round.result),
            new Set(nv.map(b => b.odds_index)).size,
            new Set(nv.map(b => b.user_id)).size,
            nv.length,
            turnover,
            redAmt,
            new Set(red.map(b => b.user_id)).size,
            bluAmt,
            new Set(blu.map(b => b.user_id)).size,
            fmt(ifRedWins),
            fmt(ifBlueWins),
            fmt(Math.min(ifRedWins, ifBlueWins)),
            fmt(redAmt - bluAmt),
            fmt(hn),
            fmtPct(hn, turnover),
            new Set(won.map(b => b.user_id)).size,
            fmt(won.reduce((s, b) => s + b.win_amount, 0)),
            new Set(lost.map(b => b.user_id)).size,
            fmt(lost.reduce((s, b) => s + b.loss_amount, 0)),
            new Set(draw.map(b => b.user_id)).size,
            voids.length,
        ];
        for (let i = 4; i < row.length; i++) {
            if (i !== 17) s1Tot[i] = (s1Tot[i] ?? 0) + ((row[i] as number) || 0);
        }
        return row;
    });
    s1Tot[17] = fmtPct(s1Tot[16]!, s1Tot[7]!);
    const s1TotRow: (string | number)[] = ['รวม', '', '', '', ...s1Tot.slice(4)];

    const s2H = [
        'รอบที่', 'ราคาที่', 'เวลาเปิด(ประมาณ)', 'เวลาปิด/บันทึก', 'สถานะ',
        'แดงชนะ×', 'แดงแพ้×', 'น้ำเงินชนะ×', 'น้ำเงินแพ้×',
        'MaxBet', 'MinBet', 'UserLimit', 'Vig%',
        'ผู้เล่นไม่ซ้ำ', 'ไม้รวม', 'Turnover',
        'ยอดแดง', 'คนแดง', 'ยอดน้ำเงิน', 'คนน้ำเงิน',
        'ถ้าแดงชนะ', 'ถ้าน้ำเงินชนะ', 'Worst-Case', 'Bias(แดง-น้ำเงิน)',
        'ผลรอบ', 'บ้านได้จริง', 'Hold%',
        'คนชนะ', 'คนแพ้', 'คนเสมอ', 'ยกกี่ไม้',
    ];
    const s2Tot = new Array<number>(s2H.length).fill(0);
    const s2Data: (string | number)[][] = oddsRows.map(odds => {
        const key = `${odds.round_id}_${odds.odds_index}`;
        const ob  = betsByOdds.get(key) ?? [];
        const nv  = ob.filter(b => b.status !== 'VOID');
        const red = nv.filter(b => b.side === 'RED');
        const blu = nv.filter(b => b.side === 'BLUE');
        const won   = ob.filter(b => b.status === 'WON');
        const lost  = ob.filter(b => b.status === 'LOST');
        const draw  = ob.filter(b => b.status === 'DRAW');
        const voids = ob.filter(b => b.status === 'VOID');

        const turnover = nv.reduce((s, b) => s + b.amount, 0);
        const redAmt   = red.reduce((s, b) => s + b.amount, 0);
        const bluAmt   = blu.reduce((s, b) => s + b.amount, 0);
        const { ifRedWins, ifBlueWins } = exposure(nv);
        const hn = houseNet(ob);
        const round = roundMap.get(odds.round_id);
        const firstBetTs = nv.length > 0 ? Math.min(...nv.map(b => b.created_at)) : null;

        const row: (string | number)[] = [
            `#r${odds.round_id}`,
            `#o${odds.odds_index + 1}`,
            firstBetTs ? fmtThaiDate(firstBetTs) : '-',
            fmtThaiDate(odds.created_at),
            statusTh(odds.status),
            odds.red_win_ratio,
            odds.red_loss_ratio,
            odds.blue_win_ratio,
            odds.blue_loss_ratio,
            odds.max_bet,
            odds.min_bet,
            odds.user_limit === 0 ? 'ไม่จำกัด' : odds.user_limit,
            odds.vig,
            new Set(nv.map(b => b.user_id)).size,
            nv.length,
            turnover,
            redAmt,
            new Set(red.map(b => b.user_id)).size,
            bluAmt,
            new Set(blu.map(b => b.user_id)).size,
            fmt(ifRedWins),
            fmt(ifBlueWins),
            fmt(Math.min(ifRedWins, ifBlueWins)),
            fmt(redAmt - bluAmt),
            resultTh(round?.result ?? null),
            fmt(hn),
            fmtPct(hn, turnover),
            new Set(won.map(b => b.user_id)).size,
            new Set(lost.map(b => b.user_id)).size,
            new Set(draw.map(b => b.user_id)).size,
            voids.length,
        ];
        const skipIdx = new Set([0, 1, 2, 3, 4, 11, 24, 26]);
        for (let i = 13; i < row.length; i++) {
            if (!skipIdx.has(i) && typeof row[i] === 'number') s2Tot[i] = (s2Tot[i] ?? 0) + (row[i] as number);
        }
        return row;
    });
    s2Tot[26] = fmtPct(s2Tot[25]!, s2Tot[15]!);
    const s2TotRow: (string | number)[] = ['รวม', '', '', '', '', '', '', '', '', '', '', '', '', ...s2Tot.slice(13)];

    const s3H = [
        'ลำดับ', 'รอบที่', 'ราคาที่', 'เวลาเดิมพัน',
        '#ID', 'ชื่อ', 'Platform', 'ฝั่ง',
        'ยอดเดิมพัน', 'ได้ถ้าชนะ', 'เสียถ้าแพ้',
        'Odds(win×)', 'ผลรอบ', 'สถานะ', 'ผลจริง(+/-)', 'ROI%',
    ];
    let s3TotAmt = 0, s3TotWin = 0, s3TotLoss = 0, s3TotNet = 0;
    const s3Data: (string | number)[][] = bets.map((b, i) => {
        const round = roundMap.get(b.round_id);
        const odds  = oddsMap.get(`${b.round_id}_${b.odds_index}`);
        const winRatio: string | number = b.side === 'RED'
            ? (odds?.red_win_ratio  ?? '-')
            : (odds?.blue_win_ratio ?? '-');

        let actualNet: string | number = '-';
        let roi: string | number = '-';
        if (b.status === 'WON') {
            actualNet = b.win_amount;
            roi = +(b.amount > 0 ? (b.win_amount / b.amount * 100).toFixed(1) : 0);
            s3TotNet += b.win_amount; s3TotWin += b.win_amount;
        } else if (b.status === 'LOST') {
            actualNet = -b.loss_amount;
            roi = -100;
            s3TotNet -= b.loss_amount; s3TotLoss += b.loss_amount;
        } else if (b.status === 'DRAW') {
            actualNet = 0; roi = 0;
        }
        s3TotAmt += b.amount;

        return [
            i + 1,
            `#r${b.round_id}`,
            `#o${b.odds_index + 1}`,
            fmtThaiDate(b.created_at),
            b.short_id != null ? `#u${b.short_id}` : '-',
            b.display_name ?? '-',
            b.platform ?? '-',
            b.side === 'RED' ? 'แดง' : 'น้ำเงิน',
            b.amount,
            b.win_amount,
            b.loss_amount,
            winRatio,
            resultTh(round?.result ?? null),
            betStatusTh(b.status),
            actualNet,
            roi,
        ];
    });
    const s3TotRow: (string | number)[] = [
        'รวม', '', '', '', '', '', '', '',
        s3TotAmt, s3TotWin, s3TotLoss,
        '', '', '', s3TotNet, '',
    ];

    const makeSheet = (headers: string[], data: (string | number)[][], totRow: (string | number)[]) =>
        XLSX.utils.aoa_to_sheet([headers, ...data, totRow]);

    const ws1 = makeSheet(s1H, s1Data, s1TotRow);
    ws1['!cols'] = [
        { wch: 8 }, { wch: 22 }, { wch: 12 }, { wch: 10 },
        { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 12 },
        { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
        { wch: 12 }, { wch: 8 },
        { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 },
    ];

    const ws2 = makeSheet(s2H, s2Data, s2TotRow);
    ws2['!cols'] = [
        { wch: 8 }, { wch: 8 }, { wch: 22 }, { wch: 22 }, { wch: 10 },
        { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
        { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 8 },
        { wch: 12 }, { wch: 10 }, { wch: 12 },
        { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 10 },
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
        { wch: 10 }, { wch: 12 }, { wch: 8 },
        { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    ];

    const ws3 = makeSheet(s3H, s3Data, s3TotRow);
    ws3['!cols'] = [
        { wch: 7 }, { wch: 8 }, { wch: 8 }, { wch: 22 },
        { wch: 8 }, { wch: 18 }, { wch: 10 }, { wch: 8 },
        { wch: 12 }, { wch: 12 }, { wch: 12 },
        { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 14 }, { wch: 8 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, 'รอบ');
    XLSX.utils.book_append_sheet(wb, ws2, 'ราคา');
    XLSX.utils.book_append_sheet(wb, ws3, 'รายการเดิมพัน');

    const filename = 'betting.xlsx';
    XLSX.writeFile(wb, `${EXPORT_DIR}/${filename}`);

    const base = (process.env.SERVER_URL ?? '').replace(/\/$/, '');
    if (!base) throw new Error('⛔ ยังไม่ได้ตั้งค่า SERVER_URL');
    const fileUrl = `${base}/export/${filename}?t=${Date.now()}`;
    const flex = generateExcelFlex(filename, bets.length, fileUrl);
    return ReplyBuilder.create().flex(flex.contents, flex.altText ?? filename).build();
}

export function cmdBettingSummary(): CommandResult {
    const bettingUsers = [...SystemState.users.values()].filter(u => u.isBetting);
    bettingUsers.sort((a, b) => (b.totalWin - b.totalLoss) - (a.totalWin - a.totalLoss));

    const { flexes } = generateBettingSummaryFlex(bettingUsers);
    const rb = ReplyBuilder.create();
    for (const f of flexes) rb.flex(f.contents, f.altText ?? 'สรุปยอดแพ้ชนะ');
    return rb.build();
}

export function cmdExportSum(): CommandResult {
    const bettingUsers = [...SystemState.users.values()].filter(u => u.isBetting);
    bettingUsers.sort((a, b) => (b.totalWin - b.totalLoss) - (a.totalWin - a.totalLoss));

    type DepWdRow = { user_id: string; total_deposit: number; total_withdraw: number };
    const depWdRows = db.query(`
        SELECT user_id,
            COALESCE(SUM(CASE WHEN type = 'DEPOSIT'  THEN amount       ELSE 0 END), 0) as total_deposit,
            COALESCE(SUM(CASE WHEN type = 'WITHDRAW' THEN ABS(amount)  ELSE 0 END), 0) as total_withdraw
        FROM transactions WHERE type IN ('DEPOSIT', 'WITHDRAW') GROUP BY user_id
    `).all() as DepWdRow[];
    const depWdMap = new Map(depWdRows.map(r => [r.user_id, r]));

    const headers = [
        'ลำดับ', '#ID', 'ชื่อ', 'Platform', 'Role',
        'เครดิต', 'กันเครดิต', 'ใช้ได้จริง',
        'Turnover', 'ได้รวม', 'เสียรวม', 'Net P/L',
        'ฝากรวม', 'ถอนรวม',
        'อยู่ในกลุ่ม',
    ];
    const data = bettingUsers.map((u, i) => {
        const name = u.displayName ?? (u.telegramUsername ? `@${u.telegramUsername}` : '-');
        const roleLabel = u.role === 'MASTER' ? 'Master' : u.role === 'ADMIN' ? 'Admin' : 'Customer';
        const available = u.credit - u.creditHold;
        const netPL = u.totalWin - u.totalLoss;
        const dw = depWdMap.get(u.userId);
        return [
            i + 1,
            `#u${u.shortId}`,
            name,
            u.platform,
            roleLabel,
            u.credit,
            u.creditHold,
            available,
            u.totalTurnover,
            u.totalWin,
            u.totalLoss,
            netPL,
            dw?.total_deposit ?? 0,
            dw?.total_withdraw ?? 0,
            u.isInGroup ? 'ใช่' : 'ไม่',
        ];
    });

    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws['!cols'] = [
        { wch: 7 },  { wch: 8 },  { wch: 20 }, { wch: 10 }, { wch: 10 },
        { wch: 12 }, { wch: 12 }, { wch: 12 },
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
        { wch: 12 }, { wch: 12 },
        { wch: 12 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'สรุปแพ้ชนะ');

    const filename = 'betting-summary.xlsx';
    XLSX.writeFile(wb, `${EXPORT_DIR}/${filename}`);

    const base = (process.env.SERVER_URL ?? '').replace(/\/$/, '');
    if (!base) throw new Error('⛔ ยังไม่ได้ตั้งค่า SERVER_URL');
    const fileUrl = `${base}/export/${filename}?t=${Date.now()}`;
    const flex = generateExcelFlex(filename, bettingUsers.length, fileUrl);
    return ReplyBuilder.create().flex(flex.contents, flex.altText ?? filename).build();
}

export function cmdFlexTestBettingSummary(n: number): CommandResult {
    const CREDITS = [5000, 12000, 3500, 8000, 25000, 1500, 50000, 7000];
    const WINS    = [2000, 0,     5000, 1000, 15000, 0,    20000, 3000];
    const LOSSES  = [1000, 3000,  0,    2000, 5000,  8000, 0,     4000];

    const mockUsers: import('../types').UserState[] = Array.from({ length: n }, (_, i) => ({
        userId: `USER${i + 1}`,
        shortId: i + 1,
        role: 'CUSTOMER' as const,
        platform: 'LINE' as const,
        credit: CREDITS[i % CREDITS.length]!,
        creditHold: 0,
        currentRoundRedNet: 0,
        currentRoundBlueNet: 0,
        oddsBetCounts: new Map(),
        totalTurnover: WINS[i % WINS.length]! + LOSSES[i % LOSSES.length]!,
        totalWin:  WINS[i % WINS.length]!,
        totalLoss: LOSSES[i % LOSSES.length]!,
        isInGroup: true,
        isActive: true,
        isBetting: true,
        isProfileLoaded: true,
        wasJustCreated: false,
        displayName: `ผู้ใช้ ${i + 1}`,
    }));

    const { flexes } = generateBettingSummaryFlex(mockUsers);
    const rb = ReplyBuilder.create();
    for (const f of flexes) rb.flex(f.contents, f.altText ?? `ff${n}`);
    return rb.build();
}

export function cmdExportTx(): CommandResult {
    const rows = getAllTransactionsForExport();

    const headers = ['ลำดับ', 'วันที่เวลา', '#ID', 'ชื่อ', 'Platform', 'ประเภท', 'จำนวน', 'อ้างอิง'];
    const data = rows.map((r, i) => [
        i + 1,
        fmtThaiDate(r.created_at),
        r.short_id != null ? `#u${r.short_id}` : '-',
        r.display_name ?? '-',
        r.platform ?? '-',
        txTypeTh(r.type),
        r.amount,
        r.ref_id || '-',
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws['!cols'] = [
        { wch: 7 },
        { wch: 22 },
        { wch: 8 },
        { wch: 20 },
        { wch: 10 },
        { wch: 14 },
        { wch: 12 },
        { wch: 14 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ธุรกรรม');

    const filename = 'transactions.xlsx';
    const filepath = `${EXPORT_DIR}/${filename}`;
    XLSX.writeFile(wb, filepath);

    const base = (process.env.SERVER_URL ?? '').replace(/\/$/, '');
    if (!base) throw new Error('⛔ ยังไม่ได้ตั้งค่า SERVER_URL');
    const fileUrl = `${base}/export/${filename}?t=${Date.now()}`;

    const flex = generateExcelFlex(filename, rows.length, fileUrl);
    return ReplyBuilder.create().flex(flex.contents, flex.altText ?? filename).build();
}
