export type UserRole = 'CUSTOMER' | 'ADMIN' | 'MASTER';

export interface UserState {
    userId: string;
    shortId: number;
    role: UserRole;
    credit: number;
    creditHold: number;
    currentRoundRedNet: number;
    currentRoundBlueNet: number;
    oddsBetCounts: Map<string, number>;  // oddsIndex(string) → bet count (transient, RAM only)
}

export interface BettingOdds {
    redLossRatio: number;
    redWinRatio: number;
    blueLossRatio: number;
    blueWinRatio: number;
    status: 'OPEN' | 'CLOSED' | 'CANCELLED';
    maxBet: number;
    minBet: number;
    userLimit: number;
    vig: number;
}

export interface BetImpact {
    winAmount: number;
    lossAmount: number;
    newRedNet: number;
    newBlueNet: number;
    newCreditHold: number;
}

export type BetStatus = 'PENDING' | 'WON' | 'LOST' | 'DRAW' | 'VOID';

export interface Bet {
    userId: string;
    oddsIndex: number;   // index ใน round.oddsHistory ที่ bet ถูกวางตอนราคานั้น
    side: 'RED' | 'BLUE';
    amount: number;
    winAmount: number;
    lossAmount: number;
    timestamp: number;
    status: BetStatus;
}

export type RoundStatus = 'OPEN' | 'CLOSED' | 'WAITING_PAYMENT' | 'COMPLETED';
export type RoundResult = 'RED' | 'BLUE' | 'DRAW';

export interface BettingRound {
    id: number;
    bets: Bet[];
    oddsHistory: BettingOdds[];
    status: RoundStatus;
    startedAt: number;
    result?: RoundResult;
}

export interface SettlementReport {
    roundId: number;
    totalBets: number;
    totalPayout: number;
    casinoProfit: number;
}

export type TransactionType = 'DEPOSIT' | 'WITHDRAW' | 'BET_WIN' | 'BET_LOSS' | 'REFUND' | 'ADJUSTMENT';

export interface Transaction {
    id: number;
    userId: string;
    amount: number;
    type: TransactionType;
    refId: string;
    createdAt: number;
}
