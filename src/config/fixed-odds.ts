export interface FixedOddsConfig {
    side: 'ด' | 'ง' | 'ส';
    isSingleSide: boolean;
    isEqualOdds?: boolean;
    underdogWin?: number;
    favLoss?: number;
    favWin?: number;
    // Precomputed ratios (percentage-based, used directly with calculator formula)
    // If these are set, they bypass the normal favLoss/favWin/underdogWin computation
    redLossRatio?: number;
    redWinRatio?: number;
    blueLossRatio?: number;
    blueWinRatio?: number;
    // Display labels for flex card (used instead of d(ratio) for fixed odds)
    redLossLabel?: string;   // e.g., "50"
    redWinLabel?: string;    // e.g., "1"
    blueLossLabel?: string;  // e.g., "1"
    blueWinLabel?: string;   // e.g., "20"
}

export const FIXED_ODDS: Record<string, FixedOddsConfig> = {
    "ส/9/9": {
        side: 'ส',
        isSingleSide: false,
        isEqualOdds: true,
        favLoss: 10,
        favWin: 9,
    },

    // ─── ด/* (RED = ต่อ/favorite) ────────────────────────────────────────────
    "ด/50/1": {
        side: 'ด',
        isSingleSide: false,
        redLossRatio: 100, redWinRatio: 2,
        blueLossRatio: 5,  blueWinRatio: 100,
        redLossLabel: '50', redWinLabel: '1',
        blueLossLabel: '1', blueWinLabel: '20',
    },
    "ด/40/1": {
        side: 'ด',
        isSingleSide: false,
        redLossRatio: 100, redWinRatio: 2.5,
        blueLossRatio: 5,  blueWinRatio: 100,
        redLossLabel: '40', redWinLabel: '1',
        blueLossLabel: '1', blueWinLabel: '20',
    },
    "ด/30/1": {
        side: 'ด',
        isSingleSide: false,
        redLossRatio: 100, redWinRatio: 100 / 30,
        blueLossRatio: 10, blueWinRatio: 100,
        redLossLabel: '30', redWinLabel: '1',
        blueLossLabel: '1', blueWinLabel: '10',
    },
    "ด/20/1": {
        side: 'ด',
        isSingleSide: false,
        redLossRatio: 100, redWinRatio: 5,
        blueLossRatio: 10, blueWinRatio: 100,
        redLossLabel: '20', redWinLabel: '1',
        blueLossLabel: '1', blueWinLabel: '10',
    },
    "ด/10/1": {
        side: 'ด',
        isSingleSide: false,
        redLossRatio: 100, redWinRatio: 10,
        blueLossRatio: 10, blueWinRatio: 100,
        redLossLabel: '10', redWinLabel: '1',
        blueLossLabel: '1', blueWinLabel: '10',
    },

    // ─── ง/* (BLUE = ต่อ/favorite) ────────────────────────────────────────────
    "ง/50/1": {
        side: 'ง',
        isSingleSide: false,
        redLossRatio: 5,   redWinRatio: 100,
        blueLossRatio: 100, blueWinRatio: 2,
        redLossLabel: '1', redWinLabel: '20',
        blueLossLabel: '50', blueWinLabel: '1',
    },
    "ง/40/1": {
        side: 'ง',
        isSingleSide: false,
        redLossRatio: 5,   redWinRatio: 100,
        blueLossRatio: 100, blueWinRatio: 2.5,
        redLossLabel: '1', redWinLabel: '20',
        blueLossLabel: '40', blueWinLabel: '1',
    },
    "ง/30/1": {
        side: 'ง',
        isSingleSide: false,
        redLossRatio: 10,  redWinRatio: 100,
        blueLossRatio: 100, blueWinRatio: 100 / 30,
        redLossLabel: '1', redWinLabel: '10',
        blueLossLabel: '30', blueWinLabel: '1',
    },
    "ง/20/1": {
        side: 'ง',
        isSingleSide: false,
        redLossRatio: 10,  redWinRatio: 100,
        blueLossRatio: 100, blueWinRatio: 5,
        redLossLabel: '1', redWinLabel: '10',
        blueLossLabel: '20', blueWinLabel: '1',
    },
    "ง/10/1": {
        side: 'ง',
        isSingleSide: false,
        redLossRatio: 10,  redWinRatio: 100,
        blueLossRatio: 100, blueWinRatio: 10,
        redLossLabel: '1', redWinLabel: '10',
        blueLossLabel: '10', blueWinLabel: '1',
    },
};

export function getFixedOdds(commandPrefix: string): FixedOddsConfig | null {
    return FIXED_ODDS[commandPrefix] ?? null;
}
