import { SystemState, getOrCreateUser } from '../store/game-state';
import { calculateBetImpact } from '../engine/calculator';
import { saveBet, saveUser } from '../store/persistence';
import type { BetImpact } from '../types';

export interface PlaceBetResult {
    impact: BetImpact;
    side: 'RED' | 'BLUE';
    amount: number;
    availableCredit: number;
    warning?: string;
}

export function placeBet(userId: string, side: 'RED' | 'BLUE', requestedAmount: number): PlaceBetResult {
    const odds = SystemState.currentOdds;
    if (!odds) throw new Error('ยังไม่มีราคา');
    if (odds.status !== 'OPEN') throw new Error('ปิดรับแทงแล้ว');

    const round = SystemState.currentRound;
    if (!round || round.status !== 'OPEN') throw new Error('ไม่มีรอบที่เปิดอยู่');

    const user = getOrCreateUser(userId);
    const oddsIndex = round.oddsHistory.length - 1;
    const oddsKey   = String(oddsIndex);

    // Check bet count limit — O(1) via Map (userLimit=0 means no limit)
    const currentCount = user.oddsBetCounts.get(oddsKey) ?? 0;
    if (odds.userLimit > 0 && currentCount >= odds.userLimit)
        throw new Error(`ครบโควต้า ${odds.userLimit} ไม้แล้วครับ`);

    // Check min bet
    if (requestedAmount < odds.minBet)
        throw new Error(`ขั้นต่ำ ${odds.minBet} ครับ`);

    // Cap to max bet
    let amount = requestedAmount;
    let warning: string | undefined;
    if (amount > odds.maxBet) {
        amount  = odds.maxBet;
        warning = `⚠️ ปรับยอดเป็นสูงสุด ${odds.maxBet}`;
    }

    // คำนวณ impact — throw ถ้าเครดิตไม่พอ
    const impact = calculateBetImpact(user, side, amount, odds);

    // Atomic Update: อัปเดต RAM ทันที ไม่มี await ป้องกัน race condition
    user.currentRoundRedNet  = impact.newRedNet;
    user.currentRoundBlueNet = impact.newBlueNet;
    user.creditHold          = impact.newCreditHold;
    user.oddsBetCounts.set(oddsKey, currentCount + 1);

    round.bets.push({ userId, oddsIndex, side, amount, winAmount: impact.winAmount, lossAmount: impact.lossAmount, timestamp: Date.now(), status: 'PENDING' });

    // Fire-and-forget: ดัน DB write ออกไปหลัง critical path เสร็จแล้ว
    const roundId = round.id;
    queueMicrotask(() => {
        saveBet(userId, roundId, oddsIndex, side, amount, impact.winAmount, impact.lossAmount);
        saveUser(user);
    });

    return { impact, side, amount, availableCredit: user.credit - user.creditHold, warning };
}
