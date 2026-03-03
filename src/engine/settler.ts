import { SystemState } from '../store/game-state';
import { saveUser, saveRound, settleBetsInRound, logTransaction } from '../store/persistence';
import { db } from '../store/db';
import type { SettlementReport } from '../types';

export function settleRound(): SettlementReport {
    const round = SystemState.currentRound;
    if (!round || round.status !== 'WAITING_PAYMENT') throw new Error('รอบต้องอยู่ในสถานะ WAITING_PAYMENT');
    if (!round.result) throw new Error('ยังไม่มีผลการแข่งขัน');

    const result = round.result;
    const roundRef = `#r${round.id}`;
    let totalPayout  = 0;
    let casinoProfit = 0;

    const userNetMap = new Map<string, number>();

    // คำนวณ credit แต่ละ user จากบิลในรอบ (O(n bets))
    for (const bet of round.bets) {
        if (bet.status === 'VOID') continue;

        const user = SystemState.users.get(bet.userId);
        if (!user) continue;

        const betWon = (bet.side === 'RED' && result === 'RED') || (bet.side === 'BLUE' && result === 'BLUE');
        const isDraw = result === 'DRAW';

        if (isDraw) {
            bet.status = 'DRAW';
            if (!userNetMap.has(bet.userId)) userNetMap.set(bet.userId, 0);
        } else if (betWon) {
            bet.status    = 'WON';
            user.credit  += bet.winAmount;
            user.totalWin += bet.winAmount;
            totalPayout  += bet.winAmount;
            casinoProfit -= bet.winAmount;
            userNetMap.set(bet.userId, (userNetMap.get(bet.userId) ?? 0) + bet.winAmount);
        } else {
            bet.status    = 'LOST';
            user.credit  -= bet.lossAmount;
            user.totalLoss += bet.lossAmount;
            casinoProfit += bet.lossAmount;
            userNetMap.set(bet.userId, (userNetMap.get(bet.userId) ?? 0) - bet.lossAmount);
        }
    }

    for (const [userId] of userNetMap) {
        const user = SystemState.users.get(userId);
        if (!user) continue;
        user.creditHold          = 0;
        user.currentRoundRedNet  = 0;
        user.currentRoundBlueNet = 0;
    }

    if (casinoProfit >= 0) SystemState.stats.houseWin  += casinoProfit;
    else                   SystemState.stats.houseLoss  += -casinoProfit;

    round.status = 'COMPLETED';

    db.transaction(() => {
        for (const [userId, net] of userNetMap) {
            const user = SystemState.users.get(userId);
            if (!user) continue;
            saveUser(user);
            const txType = net > 0 ? 'BET_WIN' : net < 0 ? 'BET_LOSS' : 'BET_DRAW';
            logTransaction(userId, net, txType, roundRef);
        }
        settleBetsInRound(round.id, result);
        saveRound(round);
    })();

    SystemState.roundsHistory.push(round);
    SystemState.currentRound = null;

    return { roundId: round.id, totalBets: round.bets.length, totalPayout, casinoProfit };
}
