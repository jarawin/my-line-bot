import { SystemState, resetAllUsersRoundData } from '../store/game-state';
import {
    saveUser, saveRound, clearBettingDataDB,
    voidBetsInOdds, logTransaction,
    getRoundForReversal, getSettledBetsForRound, reverseRoundInDB,
} from '../store/persistence';
import { settleRound } from '../engine/settler';
import { calculateBetImpact } from '../engine/calculator';
import type { BettingOdds, RoundResult, Bet } from '../types';

const CANCEL_ODDS_RE = /^ยก(\d+)?$/;
const REVERSE_RE = /^[rR](\d+)?$/;

export function openRound(): string {
    const cur = SystemState.currentRound;
    if (cur && cur.status !== 'COMPLETED') throw new Error(`ต้องเคลียร์รอบเก่าก่อน (สถานะ: ${cur.status})`);

    const newId = (cur?.id ?? 0) + 1;
    resetAllUsersRoundData();

    const newRound = { id: newId, bets: [], oddsHistory: [], status: 'OPEN' as const, startedAt: Date.now() };
    SystemState.currentRound = newRound;
    saveRound(newRound);
    console.log(`[ADMIN] เปิดรอบ #${newId}`);
    return `✅ เปิดรอบ #r${newId} สำเร็จ`;
}

export function closeRound(): string {
    const round = SystemState.currentRound;
    if (!round || round.status !== 'OPEN') throw new Error('ไม่มีรอบที่ OPEN อยู่');

    if (SystemState.currentOdds) {
        SystemState.currentOdds.status = 'CLOSED';
        SystemState.currentOdds = null;
    }
    round.status = 'CLOSED';
    saveRound(round);

    console.log(`[ADMIN] ปิดรอบ #${round.id} — รอผล`);
    return `⛔ ปิดรอบ #r${round.id} แล้ว รอประกาศผล`;
}

export function setResult(winner: RoundResult): string {
    const round = SystemState.currentRound;
    if (!round || round.status !== 'CLOSED') throw new Error('รอบต้องอยู่ในสถานะ CLOSED ก่อน');

    round.result = winner;
    round.status = 'WAITING_PAYMENT';
    saveRound(round);

    const label = winner === 'RED' ? '🔴 แดง' : winner === 'BLUE' ? '🔵 น้ำเงิน' : '🤝 เสมอ';
    console.log(`[ADMIN] รอบ #${round.id} ผล: ${label}`);
    return `🏁 รอบ #r${round.id} ผู้ชนะ: ${label}\nรอจ่ายเงิน...`;
}

export function openOdds(text: string): string {
    // Strict sequencing: ห้ามเปิดราคาใหม่ขณะราคาปัจจุบันยังเปิดอยู่
    if (SystemState.currentOdds?.status === 'OPEN')
        throw new Error("⛔ ราคาปัจจุบันยังเปิดอยู่ครับ ต้องปิดก่อนเปิดใหม่ (พิมพ์ 'ป')");

    const round = SystemState.currentRound;
    if (!round || round.status !== 'OPEN') throw new Error('เปิดราคาได้เฉพาะตอนรอบ OPEN เท่านั้น');

    // Format: Side/Loss/Win/[Max]/[Limit]/[Min]/[Vig]
    const parts = text.split('/');
    if (parts.length < 3) throw new Error('รูปแบบ: ด/Loss/Win/[Max]/[Limit]/[Min]/[Vig]');

    // --- Validate Side (Part 0) ---
    const side = parts[0]!;
    if (side === 'ส') throw new Error('⛔ ราคาส่วนกลาง (ส) ยังไม่เปิดให้บริการ');
    if (side !== 'ด' && side !== 'ง') throw new Error('⛔ ฝั่งไม่ถูกต้อง (ใช้ ด หรือ ง)');

    // --- Validate Loss & Win (Parts 1-2): range 0.1-99, max 1 decimal ---
    const RATE_RE = /^\d+(\.\d)?$/;
    if (!RATE_RE.test(parts[1]!)) throw new Error('⛔ Loss ต้องเป็นตัวเลข ทศนิยมไม่เกิน 1 ตำแหน่ง');
    const favLossInput = parseFloat(parts[1]!);
    if (favLossInput < 0.1 || favLossInput > 99) throw new Error('⛔ Loss ต้องอยู่ระหว่าง 0.1-99');

    if (!RATE_RE.test(parts[2]!)) throw new Error('⛔ Win ต้องเป็นตัวเลข ทศนิยมไม่เกิน 1 ตำแหน่ง');
    const favWinInput = parseFloat(parts[2]!);
    if (favWinInput < 0.1 || favWinInput > 99) throw new Error('⛔ Win ต้องอยู่ระหว่าง 0.1-99');

    // x10 scaling: "2.5" → 25, "10" → 100
    const favLoss = Math.round(favLossInput * 10);
    const favWin = Math.round(favWinInput * 10);

    // --- Validate Max (Part 3) - Default 20000 ---
    const maxRaw = parts[3] ?? '';
    if (maxRaw && !/^\d+$/.test(maxRaw)) throw new Error('⛔ Max ต้องเป็นจำนวนเต็ม');
    const maxBet = maxRaw ? parseInt(maxRaw, 10) : 20000;
    if (maxBet < 1 || maxBet > 1_000_000) throw new Error('⛔ Max ต้องอยู่ระหว่าง 1-1,000,000');

    // --- Validate Limit (Part 4) - Default 2, 0 = ไม่จำกัด ---
    const limitRaw = parts[4] ?? '';
    if (limitRaw && !/^\d+$/.test(limitRaw)) throw new Error('⛔ Limit ต้องเป็นจำนวนเต็ม');
    const userLimit = limitRaw ? parseInt(limitRaw, 10) : 2;
    if (userLimit < 0 || userLimit > 100) throw new Error('⛔ Limit ต้องอยู่ระหว่าง 0-100 (0 = ไม่จำกัด)');

    // --- Validate Min (Part 5) - Default 20 ---
    const minRaw = parts[5] ?? '';
    if (minRaw && !/^\d+$/.test(minRaw)) throw new Error('⛔ Min ต้องเป็นจำนวนเต็ม');
    const minBet = minRaw ? parseInt(minRaw, 10) : 20;
    if (minBet < 1) throw new Error('⛔ Min ต้องมากกว่าหรือเท่ากับ 1');
    if (minBet > maxBet) throw new Error(`⛔ Min (${minBet}) ต้องไม่เกิน Max (${maxBet})`);

    // --- Vig (Part 6) - Default 20 (raw, added to stored favWin) ---
    const vig = parts[6] ? parseInt(parts[6], 10) : 20;

    // Vigorish: Underdog loss = FavoriteWin(stored) + vig, Underdog win = FavoriteLoss(stored)
    const underdogLoss = favWin + vig;
    const underdogWin = favLoss;

    const newOdds: BettingOdds = side === 'ด'
        ? { redLossRatio: favLoss, redWinRatio: favWin, blueLossRatio: underdogLoss, blueWinRatio: underdogWin, status: 'OPEN', maxBet, minBet, userLimit, vig }
        : { blueLossRatio: favLoss, blueWinRatio: favWin, redLossRatio: underdogLoss, redWinRatio: underdogWin, status: 'OPEN', maxBet, minBet, userLimit, vig };

    SystemState.currentOdds = newOdds;
    round.oddsHistory.push(newOdds);

    // Display value = stored / 10
    const d = (v: number) => v % 10 === 0 ? v / 10 : (v / 10).toFixed(1);
    const n = round.oddsHistory.length;
    const limitLabel = userLimit === 0 ? 'ไม่จำกัด' : `${userLimit} ไม้`;
    console.log(`[ADMIN] เปิดราคา #${n} รอบ #${round.id} — แดง[${d(newOdds.redLossRatio)}/${d(newOdds.redWinRatio)}] vig=${vig}`);
    return [
        `✅ เปิดราคา #o${n} (รอบ #r${round.id})`,
        `🔴 แดง  เสีย ${d(newOdds.redLossRatio)} | ได้ ${d(newOdds.redWinRatio)}`,
        `🔵 น้ำเงิน เสีย ${d(newOdds.blueLossRatio)} | ได้ ${d(newOdds.blueWinRatio)}`,
        `📊 Max: ${maxBet} | Limit: ${limitLabel} | Min: ${minBet} | Vig: ${vig}`,
    ].join('\n');
}

export function closeOdds(): string {
    if (!SystemState.currentOdds) throw new Error('ไม่มีราคาที่เปิดอยู่');
    SystemState.currentOdds.status = 'CLOSED';
    SystemState.currentOdds = null;
    console.log('[ADMIN] ปิดราคา');
    return '⛔ ปิดรับแทงแล้ว (รอบยังเปิด สามารถเปิดราคาใหม่ได้)';
}

export function resetSystem(): string {
    SystemState.currentRound = null;
    SystemState.currentOdds = null;
    SystemState.roundsHistory = [];

    for (const user of SystemState.users.values()) {
        user.creditHold = 0;
        user.currentRoundRedNet = 0;
        user.currentRoundBlueNet = 0;
        user.oddsBetCounts.clear();
    }

    clearBettingDataDB();
    console.log('[ADMIN] System reset — bets/rounds cleared, users kept');
    return '✅ Reset แล้ว! ยอดเงิน user ยังอยู่ ลบ bet/round ทั้งหมดแล้ว';
}

export function confirmSettlement(): string {
    const report = settleRound();
    const profitSign = report.casinoProfit >= 0 ? '+' : '';
    console.log(`[ADMIN] Settlement รอบ #${report.roundId} — กำไร: ${report.casinoProfit}`);
    return [
        `✅ เคลียร์บิลรอบ #r${report.roundId} เรียบร้อย`,
        `📝 บิลทั้งหมด: ${report.totalBets} ใบ`,
        `💰 ยอดจ่ายลูกค้า: ${report.totalPayout}`,
        `🏦 เจ้ามือ: ${profitSign}${report.casinoProfit} (${report.casinoProfit >= 0 ? 'กำไร' : 'ขาดทุน'})`,
    ].join('\n');
}

// ---------------------------------------------------------------------------
// ยก — ยกเลิกราคา (Cancel Odds) + recalculate creditHold ของ users
// ---------------------------------------------------------------------------
export function cmdCancelOdds(text: string): string {
    const round = SystemState.currentRound;
    if (!round) throw new Error('ไม่มีรอบที่เปิดอยู่');

    const m = text.match(CANCEL_ODDS_RE)!;
    const requestedN = m[1] ? parseInt(m[1], 10) - 1 : -1; // -1 = ล่าสุด

    // หา oddsIndex เป้าหมาย
    let oddsIdx = -1;
    if (requestedN === -1) {
        // ราคาล่าสุดที่ CLOSED (ไม่ใช่ OPEN และไม่ใช่ CANCELLED)
        for (let i = round.oddsHistory.length - 1; i >= 0; i--) {
            if (round.oddsHistory[i]!.status === 'CLOSED') { oddsIdx = i; break; }
        }
        if (oddsIdx === -1) throw new Error('ไม่มีราคาที่ CLOSED ให้ยก');
    } else {
        oddsIdx = requestedN;
        if (oddsIdx < 0 || oddsIdx >= round.oddsHistory.length)
            throw new Error(`ไม่พบราคา #o${requestedN + 1}`);
        const targetStatus = round.oddsHistory[oddsIdx]!.status;
        if (targetStatus === 'OPEN') throw new Error(`ราคา #o${oddsIdx + 1} ยังเปิดอยู่ ปิดก่อนแล้วค่อยยก`);
        if (targetStatus === 'CANCELLED') throw new Error(`ราคา #o${oddsIdx + 1} ถูกยกไปแล้ว`);
    }

    // Mark odds CANCELLED
    round.oddsHistory[oddsIdx]!.status = 'CANCELLED';
    if (SystemState.currentOdds === round.oddsHistory[oddsIdx]) {
        SystemState.currentOdds = null;
    }

    // Mark bets VOID (RAM)
    const affectedBets = round.bets.filter(b => b.oddsIndex === oddsIdx);
    for (const bet of affectedBets) bet.status = 'VOID';

    // Persist VOID to DB
    voidBetsInOdds(round.id, oddsIdx);

    // Recalculate creditHold สำหรับ users ที่ได้รับผลกระทบ
    const affectedUserIds = new Set(affectedBets.map(b => b.userId));
    for (const userId of affectedUserIds) {
        const user = SystemState.users.get(userId);
        if (!user) continue;

        // Reset round state
        user.creditHold = 0;
        user.currentRoundRedNet = 0;
        user.currentRoundBlueNet = 0;

        // Re-play bets ที่ยังมีสถานะ PENDING (เรียงตาม timestamp = ลำดับเดิม)
        const validBets = round.bets.filter(b => b.userId === userId && b.status === 'PENDING');
        for (const bet of validBets) {
            const betOdds = round.oddsHistory[bet.oddsIndex];
            if (!betOdds || betOdds.status === 'CANCELLED') continue;
            const impact = calculateBetImpact(user, bet.side, bet.amount, betOdds);
            user.currentRoundRedNet = impact.newRedNet;
            user.currentRoundBlueNet = impact.newBlueNet;
            user.creditHold = impact.newCreditHold;
        }
        saveUser(user);
    }

    console.log(`[ADMIN] ยกราคา #o${oddsIdx + 1} รอบ #${round.id} — void ${affectedBets.length} bets`);
    return `✅ ยกเลิกราคา #o${oddsIdx + 1} เรียบร้อย คืนวงเงินให้ลูกค้า ${affectedUserIds.size} คน`;
}

// ---------------------------------------------------------------------------
// R — ย้อนกลับ settlement รอบที่ผ่านมา (Reverse Round)
// ---------------------------------------------------------------------------
export function cmdReverseRound(text: string): string {
    const cur = SystemState.currentRound;
    if (cur?.status === 'OPEN') throw new Error('มีรอบที่เปิดอยู่ ต้องปิดก่อน');

    const m = text.match(REVERSE_RE)!;
    const roundId = m[1] ? parseInt(m[1], 10) : undefined;

    const roundRow = getRoundForReversal(roundId);
    if (!roundRow) throw new Error(roundId ? `ไม่พบรอบ #r${roundId}` : 'ไม่มีรอบที่สามารถย้อนกลับได้');
    if (roundRow.status !== 'COMPLETED') throw new Error(`รอบ #r${roundRow.id} ไม่ได้อยู่ในสถานะ COMPLETED (สถานะ: ${roundRow.status})`);

    // Load settled bets from DB
    const settledBets = getSettledBetsForRound(roundRow.id);
    const roundRef = `#r${roundRow.id}`;

    // Rollback money (critical — synchronous, no fire-and-forget)
    for (const bet of settledBets) {
        const user = SystemState.users.get(bet.user_id);
        if (!user) continue;

        if (bet.status === 'WON') {
            user.credit -= bet.win_amount;
            logTransaction(bet.user_id, -bet.win_amount, 'ADJUSTMENT', roundRef);
        } else if (bet.status === 'LOST') {
            user.credit += bet.loss_amount;
            logTransaction(bet.user_id, bet.loss_amount, 'REFUND', roundRef);
        }
        saveUser(user);
    }

    // Update DB: bets → PENDING, round → CLOSED
    reverseRoundInDB(roundRow.id);

    // Rebuild Bet objects in RAM (oddsIndex restored from DB)
    const restoredBets: Bet[] = settledBets.map(b => ({
        userId: b.user_id,
        oddsIndex: b.odds_index,
        side: b.side as 'RED' | 'BLUE',
        amount: b.amount,
        winAmount: b.win_amount,
        lossAmount: b.loss_amount,
        timestamp: 0,
        status: 'PENDING' as const,
    }));

    // ดึงออกจาก roundsHistory (ถ้ามี)
    SystemState.roundsHistory = SystemState.roundsHistory.filter(r => r.id !== roundRow.id);

    // Restore round เป็น CLOSED (รอตั้งผลใหม่)
    SystemState.currentRound = {
        id: roundRow.id,
        bets: restoredBets,
        oddsHistory: [],
        status: 'CLOSED',
        startedAt: roundRow.created_at,
        result: undefined,
    };

    console.log(`[ADMIN] Reverse round #${roundRow.id} — rollback ${settledBets.length} bets (result: ${roundRow.result})`);
    return [
        `♻️ ย้อนกลับรอบ #r${roundRow.id} เรียบร้อย`,
        `📝 ยกเลิกผล: ${roundRow.result} (${settledBets.length} ใบ)`,
        `→ ตั้งผลใหม่ด้วย Sด / Sง / Sส แล้วกด y`,
    ].join('\n');
}
