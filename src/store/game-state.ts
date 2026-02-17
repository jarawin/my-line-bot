import type { UserState, BettingRound, BettingOdds } from '../types';

interface SystemStateType {
    users: Map<string, UserState>;
    shortIdIndex: Map<number, UserState>;  // O(1) lookup by shortId
    currentRound: BettingRound | null;
    currentOdds: BettingOdds | null;
    roundsHistory: BettingRound[];
}

export const SystemState: SystemStateType = {
    users: new Map(),
    shortIdIndex: new Map(),
    currentRound: null,
    currentOdds: null,
    roundsHistory: [],
};

export let nextShortId = 1;

export function setNextShortId(n: number): void {
    nextShortId = n;
}

export function getOrCreateUser(userId: string): UserState {
    let user = SystemState.users.get(userId);
    if (!user) {
        user = {
            userId,
            shortId: nextShortId++,
            role: 'CUSTOMER',
            credit: 1000,
            creditHold: 0,
            currentRoundRedNet: 0,
            currentRoundBlueNet: 0,
            oddsBetCounts: new Map(),
        };
        SystemState.users.set(userId, user);
        SystemState.shortIdIndex.set(user.shortId, user);
    }
    return user;
}

export function getUserByShortId(shortId: number): UserState | undefined {
    return SystemState.shortIdIndex.get(shortId);
}

export function resetAllUsersRoundData(): void {
    for (const user of SystemState.users.values()) {
        user.creditHold          = 0;
        user.currentRoundRedNet  = 0;
        user.currentRoundBlueNet = 0;
        user.oddsBetCounts.clear();
    }
}

