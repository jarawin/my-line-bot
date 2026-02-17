import type { UserState, BettingOdds, BetImpact } from '../types';

export function calculateBetImpact(
    user: UserState,
    side: 'RED' | 'BLUE',
    amount: number,
    odds: BettingOdds
): BetImpact {
    const winAmount  = Math.floor(amount * (side === 'RED' ? odds.redWinRatio  : odds.blueWinRatio)  / 100);
    const lossAmount = Math.ceil (amount * (side === 'RED' ? odds.redLossRatio : odds.blueLossRatio) / 100);

    const newRedNet  = user.currentRoundRedNet  + (side === 'RED' ? winAmount  : -lossAmount);
    const newBlueNet = user.currentRoundBlueNet + (side === 'RED' ? -lossAmount : winAmount);

    // worst case = สถานการณ์ที่ user เสียมากสุด
    const worstCase     = Math.min(newRedNet, newBlueNet);
    const newCreditHold = Math.max(0, -worstCase);

    if (user.credit - newCreditHold < 0) throw new Error('เครดิตไม่พอ');

    return { winAmount, lossAmount, newRedNet, newBlueNet, newCreditHold };
}
