import { SystemState } from '../store/game-state';
import { saveUser, saveRound, settleBetsInRound, logTransaction } from '../store/persistence';
import type { SettlementReport } from '../types';

export function settleRound(): SettlementReport {
    const round = SystemState.currentRound;
    if (!round || round.status !== 'WAITING_PAYMENT') throw new Error('รอบต้องอยู่ในสถานะ WAITING_PAYMENT');
    if (!round.result) throw new Error('ยังไม่มีผลการแข่งขัน');

    const result = round.result;
    const roundRef = `#r${round.id}`;
    let totalPayout  = 0;
    let casinoProfit = 0;

    // คำนวณ credit แต่ละ user จากบิลในรอบ (O(n bets))
    for (const bet of round.bets) {
        if (bet.status === 'VOID') continue; // ข้ามบิลที่ถูกยกเลิก

        const user = SystemState.users.get(bet.userId);
        if (!user) continue;

        const betWon = (bet.side === 'RED' && result === 'RED') || (bet.side === 'BLUE' && result === 'BLUE');
        const isDraw = result === 'DRAW';

        if (isDraw) {
            bet.status = 'DRAW';
        } else if (betWon) {
            bet.status    = 'WON';
            user.credit  += bet.winAmount;
            totalPayout  += bet.winAmount;
            casinoProfit -= bet.winAmount;
            logTransaction(bet.userId, bet.winAmount, 'BET_WIN', roundRef);
        } else {
            bet.status    = 'LOST';
            user.credit  -= bet.lossAmount;
            casinoProfit += bet.lossAmount;
            logTransaction(bet.userId, -bet.lossAmount, 'BET_LOSS', roundRef);
        }
    }

    // Reset round data + persist credit ทุก user ที่ร่วมแทง
    const settledUserIds = new Set(round.bets.map(b => b.userId));
    for (const userId of settledUserIds) {
        const user = SystemState.users.get(userId);
        if (!user) continue;
        user.creditHold          = 0;
        user.currentRoundRedNet  = 0;
        user.currentRoundBlueNet = 0;
        saveUser(user);
    }

    // Bulk update bet statuses ใน DB — 1 query (excludes VOID)
    settleBetsInRound(round.id, result);

    // Close round
    round.status = 'COMPLETED';
    saveRound(round);

    SystemState.roundsHistory.push(round);
    SystemState.currentRound = null;

    return { roundId: round.id, totalBets: round.bets.length, totalPayout, casinoProfit };
}
