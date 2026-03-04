import type { UserState, BettingRound, BettingOdds, Platform, GroupType, SystemStats, PendingBet, BankAccount } from '../types';

// ─── round-level aggregate cache ─────────────────────────────────────────────
// บวกต่อเรื่อยๆ ตาม bet ที่ commit — recalc เมื่อมีการยก/ย้อนราคา หรือ restart server
export interface RoundAgg {
    houseIfRedWins: number;   // บ้านได้/เสียถ้าแดงชนะ (ทั้งรอบ)
    houseIfBlueWins: number;  // บ้านได้/เสียถ้าน้ำเงินชนะ (ทั้งรอบ)
    redTotal: number;         // ยอดเดิมพันแดงรวม
    blueTotal: number;        // ยอดเดิมพันน้ำเงินรวม
    redBetCount: number;
    blueBetCount: number;
    redBettors: Set<string>;
    blueBettors: Set<string>;
}

interface AllowedGroupInfo {
    type: GroupType;
    platform: Platform;
}

interface SystemStateType {
    users: Map<string, UserState>;
    shortIdIndex: Map<number, UserState>;
    currentRound: BettingRound | null;
    currentOdds: BettingOdds | null;
    roundsHistory: BettingRound[];
    viewingRoundId: number | null;
    allowedGroups: Map<string, AllowedGroupInfo>;
    stats: SystemStats;
    riskAlertSentOddsIdx: number | null;
    pendingBets: Map<string, PendingBet>;
    bankAccounts: Map<number, BankAccount>;
    adminLink: string;
    pendingImageFor: Map<string, number>;
    oddsCompact: boolean;
    betCompact: boolean;
    txCompact: boolean;
    roundCompact: boolean;
    acCompact: boolean;
    sumCompact: boolean;
    mentionAll: boolean;
    xcap: number;           // ยอดเสียสูงสุดที่รับได้ต่อราคา (0 = ไม่จำกัด)
    defMaxBet: number;      // default สูงสุดต่อไม้
    defMinBet: number;      // default ขั้นต่ำต่อไม้
    defLim: number;         // default จำกัดไม้ต่อราคาต่อ user (0 = ไม่จำกัด)
    defVig: number;         // default ค่าน้ำ (%) สำหรับราคา 2 ฝั่ง
    riskThreshold: number;  // เพดาน risk alert (0 = ใช้ 80% ของ xcap อัตโนมัติ)
    betDelayMs: number;     // ดีเลย์ก่อน commit bet async (ms)
    roundAgg: RoundAgg | null; // aggregate cache สำหรับ round ปัจจุบัน
}

export const SystemState: SystemStateType = {
    users: new Map(),
    shortIdIndex: new Map(),
    currentRound: null,
    currentOdds: null,
    roundsHistory: [],
    viewingRoundId: null,
    allowedGroups: new Map(),
    stats: { globalTurnover: 0, globalDeposit: 0, globalWithdraw: 0, houseWin: 0, houseLoss: 0 },
    riskAlertSentOddsIdx: null,
    pendingBets: new Map(),
    bankAccounts: new Map(),
    adminLink: '',
    pendingImageFor: new Map(),
    oddsCompact: false,
    betCompact: false,
    txCompact: false,
    roundCompact: false,
    acCompact: false,
    sumCompact: false,
    mentionAll: true,
    xcap: 0,
    defMaxBet: 20000,
    defMinBet: 20,
    defLim: 2,
    defVig: 20,
    riskThreshold: 50000,
    betDelayMs: 1000,
    roundAgg: null,
};

export let nextShortId = 1;

export function setNextShortId(n: number): void {
    nextShortId = n;
}

export function getOrCreateUser(
    userId: string,
    opts?: { platform?: Platform; autoAdmin?: boolean; telegramUsername?: string },
): UserState {
    let user = SystemState.users.get(userId);
    if (!user) {
        user = {
            userId,
            shortId: nextShortId++,
            role: opts?.autoAdmin ? 'ADMIN' : 'CUSTOMER',
            platform: opts?.platform ?? 'LINE',
            credit: 0,
            creditHold: 0,
            currentRoundRedNet: 0,
            currentRoundBlueNet: 0,
            oddsBetCounts: new Map(),
            totalTurnover: 0,
            totalWin: 0,
            totalLoss: 0,
            isInGroup: true,
            isActive: false,
            isBetting: false,
            isProfileLoaded: false,
            wasJustCreated: true,
            telegramUsername: opts?.telegramUsername,
        };
        SystemState.users.set(userId, user);
        SystemState.shortIdIndex.set(user.shortId, user);
    } else if (opts?.telegramUsername && user.telegramUsername !== opts.telegramUsername) {
        user.telegramUsername = opts.telegramUsername;
    }
    return user;
}

export function getUserByShortId(shortId: number): UserState | undefined {
    return SystemState.shortIdIndex.get(shortId);
}

export function getUserByTelegramUsername(username: string): UserState | undefined {
    const normalizedUsername = username.startsWith('@') ? username.substring(1) : username;
    for (const user of SystemState.users.values()) {
        if (user.telegramUsername?.toLowerCase() === normalizedUsername.toLowerCase()) {
            return user;
        }
    }
    return undefined;
}

export function resetAllUsersRoundData(): void {
    for (const user of SystemState.users.values()) {
        user.creditHold = 0;
        user.currentRoundRedNet = 0;
        user.currentRoundBlueNet = 0;
        user.oddsBetCounts.clear();
    }
}

export function clearViewingRound(): void {
    SystemState.viewingRoundId = null;
}

export function recalculateUsersRoundState(round: BettingRound): void {
    for (const user of SystemState.users.values()) {
        user.creditHold = 0;
        user.currentRoundRedNet = 0;
        user.currentRoundBlueNet = 0;
        user.oddsBetCounts.clear();
    }

    for (const bet of round.bets) {
        if (bet.status === 'VOID') continue;

        const betOdds = round.oddsHistory[bet.oddsIndex];
        if (!betOdds || betOdds.status === 'CANCELLED') continue;

        const user = SystemState.users.get(bet.userId);
        if (!user) continue;

        const oddsKey = String(bet.oddsIndex);
        user.oddsBetCounts.set(oddsKey, (user.oddsBetCounts.get(oddsKey) ?? 0) + 1);

        if (bet.side === 'RED') {
            user.currentRoundRedNet += bet.winAmount;
            user.currentRoundBlueNet -= bet.lossAmount;
        } else {
            user.currentRoundRedNet -= bet.lossAmount;
            user.currentRoundBlueNet += bet.winAmount;
        }

        const worstCase = Math.min(user.currentRoundRedNet, user.currentRoundBlueNet);
        user.creditHold = Math.max(0, -worstCase);
    }
}

// ─── RoundAgg helpers ─────────────────────────────────────────────────────────

function applyBetToAgg(agg: RoundAgg, bet: { side: 'RED' | 'BLUE'; amount: number; winAmount: number; lossAmount: number; userId: string }): void {
    if (bet.side === 'RED') {
        agg.houseIfRedWins -= bet.winAmount;
        agg.houseIfBlueWins += bet.lossAmount;
        agg.redTotal += bet.amount;
        agg.redBetCount++;
        agg.redBettors.add(bet.userId);
    } else {
        agg.houseIfRedWins += bet.lossAmount;
        agg.houseIfBlueWins -= bet.winAmount;
        agg.blueTotal += bet.amount;
        agg.blueBetCount++;
        agg.blueBettors.add(bet.userId);
    }
}

/** คำนวณ RoundAgg ใหม่ทั้งหมดจาก round.bets ใน RAM — เรียกเมื่อ restart / ยก / ย้อนราคา */
export function recalcRoundAgg(): void {
    const round = SystemState.currentRound;
    if (!round) { SystemState.roundAgg = null; return; }

    const agg: RoundAgg = {
        houseIfRedWins: 0, houseIfBlueWins: 0,
        redTotal: 0, blueTotal: 0,
        redBetCount: 0, blueBetCount: 0,
        redBettors: new Set(), blueBettors: new Set(),
    };

    for (const bet of round.bets) {
        if (bet.status === 'VOID') continue;
        const betOdds = round.oddsHistory[bet.oddsIndex];
        if (!betOdds || betOdds.status === 'CANCELLED') continue;
        applyBetToAgg(agg, bet);
    }

    SystemState.roundAgg = agg;
}

/** เพิ่ม bet ที่เพิ่ง commit เข้า cache แบบ O(1) — เรียกหลัง round.bets.push() */
export function addBetToRoundAgg(bet: { side: 'RED' | 'BLUE'; amount: number; winAmount: number; lossAmount: number; userId: string }): void {
    if (!SystemState.roundAgg) { recalcRoundAgg(); return; }
    applyBetToAgg(SystemState.roundAgg, bet);
}
