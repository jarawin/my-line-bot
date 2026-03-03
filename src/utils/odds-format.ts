import type { BettingOdds } from '../types';
import { getFixedOdds } from '../config/fixed-odds';
import { SystemState } from '../store/game-state';

export function d(v: number): string {
    return v % 10 === 0 ? String(v / 10) : (v / 10).toFixed(1);
}

export interface ParsedOddsCommand {
    side: 'ด' | 'ง' | 'ส';
    isSingleSide: boolean;
    isEqualOdds?: boolean;
    underdogWin?: number;
    favLoss?: number;
    favWin?: number;
    maxBet: number;
    userLimit: number;
    minBet: number;
    vig: number;
    // Set when the command matched a fixed-odds entry with precomputed ratios
    fixedOddsKey?: string;
    fixedRedLossRatio?: number;
    fixedRedWinRatio?: number;
    fixedBlueLossRatio?: number;
    fixedBlueWinRatio?: number;
}

export function parseOddsCommand(text: string): ParsedOddsCommand {
    const parts = text.split('/');
    if (parts.length < 2) {
        throw new Error('รูปแบบ: ด/Win (ฝั่งเดียว) หรือ ด/Loss/Win/[Max]/[Limit]/[Min]/[Vig] (2 ฝั่ง)');
    }

    const side = parts[0]! as 'ด' | 'ง' | 'ส';
    if (side !== 'ด' && side !== 'ง' && side !== 'ส') {
        throw new Error('⛔ ฝั่งไม่ถูกต้อง (ใช้ ด, ง, หรือ ส)');
    }

    const RATE_RE = /^\d+(\.\d)?$/;
    const INT_RE = /^\d+$/;

    let isSingleSide = false;
    let arg2: number;
    let underdogWin: number | undefined;
    let favLoss: number | undefined;
    let favWin: number | undefined;

    if (parts.length >= 3) {
        const commandPrefix = parts.slice(0, 3).join('/');
        const fixedConfig = getFixedOdds(commandPrefix);

        if (fixedConfig) {
            const maxRaw = parts[3] ?? '';
            if (maxRaw && !INT_RE.test(maxRaw)) throw new Error('⛔ Max ต้องเป็นจำนวนเต็ม');
            const maxBet = maxRaw ? parseInt(maxRaw, 10) : SystemState.defMaxBet;
            if (maxBet < 1 || maxBet > 1_000_000) throw new Error('⛔ Max ต้องอยู่ระหว่าง 1-1,000,000');

            const limitRaw = parts[4] ?? '';
            if (limitRaw && !INT_RE.test(limitRaw)) throw new Error('⛔ Limit ต้องเป็นจำนวนเต็ม');
            const userLimit = limitRaw ? parseInt(limitRaw, 10) : SystemState.defLim;
            if (userLimit < 0 || userLimit > 100) throw new Error('⛔ Limit ต้องอยู่ระหว่าง 0-100 (0 = ไม่จำกัด)');

            const minRaw = parts[5] ?? '';
            if (minRaw && !INT_RE.test(minRaw)) throw new Error('⛔ Min ต้องเป็นจำนวนเต็ม');
            const minBet = minRaw ? parseInt(minRaw, 10) : SystemState.defMinBet;
            if (minBet < 1) throw new Error('⛔ Min ต้องมากกว่าหรือเท่ากับ 1');
            if (minBet > maxBet) throw new Error(`⛔ Min (${minBet}) ต้องไม่เกิน Max (${maxBet})`);

            // Fixed odds with precomputed ratios — bypass normal formula
            if (fixedConfig.redLossRatio !== undefined) {
                return {
                    side: fixedConfig.side,
                    isSingleSide: false,
                    maxBet,
                    userLimit,
                    minBet,
                    vig: 0,
                    fixedOddsKey: commandPrefix,
                    fixedRedLossRatio: fixedConfig.redLossRatio,
                    fixedRedWinRatio: fixedConfig.redWinRatio!,
                    fixedBlueLossRatio: fixedConfig.blueLossRatio!,
                    fixedBlueWinRatio: fixedConfig.blueWinRatio!,
                };
            }

            isSingleSide = fixedConfig.isSingleSide;
            const isEqualOdds = fixedConfig.isEqualOdds ?? false;
            underdogWin = fixedConfig.underdogWin;
            favLoss = fixedConfig.favLoss;
            favWin = fixedConfig.favWin;

            return {
                side: fixedConfig.side,
                isSingleSide,
                isEqualOdds,
                underdogWin,
                favLoss,
                favWin,
                maxBet,
                userLimit,
                minBet,
                vig: 0,
            };
        }
    }

    if (parts.length === 2) {
        isSingleSide = true;
        if (!INT_RE.test(parts[1]!)) throw new Error('⛔ Win ต้องเป็นจำนวนเต็ม');
        underdogWin = parseInt(parts[1]!, 10);
        arg2 = underdogWin;
    } else {
        if (!RATE_RE.test(parts[1]!)) throw new Error('⛔ Loss ต้องเป็นตัวเลข ทศนิยมไม่เกิน 1 ตำแหน่ง');
        const arg1 = parseFloat(parts[1]!);

        if (!RATE_RE.test(parts[2]!)) throw new Error('⛔ arg2 ต้องเป็นตัวเลข ทศนิยมไม่เกิน 1 ตำแหน่ง');
        arg2 = parseFloat(parts[2]!);

        if (arg2 >= 100) {
            isSingleSide = true;
            underdogWin = arg1;
        } else {
            isSingleSide = false;
            favLoss = arg1;
            favWin = arg2;
        }
    }

    let maxBet: number;
    let userLimit: number;
    let minBet: number;
    let vig: number;

    if (isSingleSide) {
        if (underdogWin === undefined) throw new Error('Internal error: underdogWin not set');
        if (underdogWin < 0.1 || underdogWin > 999) throw new Error('⛔ Win ต้องอยู่ระหว่าง 0.1-999');

        const startIdx = parts.length === 2 ? 2 : 3;
        const maxRaw = parts[startIdx] ?? '';
        if (maxRaw && !INT_RE.test(maxRaw)) throw new Error('⛔ Max ต้องเป็นจำนวนเต็ม');
        maxBet = maxRaw ? parseInt(maxRaw, 10) : SystemState.defMaxBet;
        if (maxBet < 1 || maxBet > 1_000_000) throw new Error('⛔ Max ต้องอยู่ระหว่าง 1-1,000,000');

        const limitRaw = parts[startIdx + 1] ?? '';
        if (limitRaw && !INT_RE.test(limitRaw)) throw new Error('⛔ Limit ต้องเป็นจำนวนเต็ม');
        userLimit = limitRaw ? parseInt(limitRaw, 10) : SystemState.defLim;
        if (userLimit < 0 || userLimit > 100) throw new Error('⛔ Limit ต้องอยู่ระหว่าง 0-100 (0 = ไม่จำกัด)');

        const minRaw = parts[startIdx + 2] ?? '';
        if (minRaw && !INT_RE.test(minRaw)) throw new Error('⛔ Min ต้องเป็นจำนวนเต็ม');
        minBet = minRaw ? parseInt(minRaw, 10) : SystemState.defMinBet;
        if (minBet < 1) throw new Error('⛔ Min ต้องมากกว่าหรือเท่ากับ 1');
        if (minBet > maxBet) throw new Error(`⛔ Min (${minBet}) ต้องไม่เกิน Max (${maxBet})`);

        vig = 0;
    } else {
        if (favLoss === undefined || favWin === undefined) {
            throw new Error('Internal error: favLoss or favWin not set');
        }
        if (favLoss < 0.1 || favLoss > 99) throw new Error('⛔ Loss ต้องอยู่ระหว่าง 0.1-99');
        if (favWin < 0.1 || favWin > 99) throw new Error('⛔ Win ต้องอยู่ระหว่าง 0.1-99');

        const maxRaw = parts[3] ?? '';
        if (maxRaw && !INT_RE.test(maxRaw)) throw new Error('⛔ Max ต้องเป็นจำนวนเต็ม');
        maxBet = maxRaw ? parseInt(maxRaw, 10) : SystemState.defMaxBet;
        if (maxBet < 1 || maxBet > 1_000_000) throw new Error('⛔ Max ต้องอยู่ระหว่าง 1-1,000,000');

        const limitRaw = parts[4] ?? '';
        if (limitRaw && !INT_RE.test(limitRaw)) throw new Error('⛔ Limit ต้องเป็นจำนวนเต็ม');
        userLimit = limitRaw ? parseInt(limitRaw, 10) : SystemState.defLim;
        if (userLimit < 0 || userLimit > 100) throw new Error('⛔ Limit ต้องอยู่ระหว่าง 0-100 (0 = ไม่จำกัด)');

        const minRaw = parts[5] ?? '';
        if (minRaw && !INT_RE.test(minRaw)) throw new Error('⛔ Min ต้องเป็นจำนวนเต็ม');
        minBet = minRaw ? parseInt(minRaw, 10) : SystemState.defMinBet;
        if (minBet < 1) throw new Error('⛔ Min ต้องมากกว่าหรือเท่ากับ 1');
        if (minBet > maxBet) throw new Error(`⛔ Min (${minBet}) ต้องไม่เกิน Max (${maxBet})`);

        vig = parts[6] ? parseInt(parts[6], 10) : SystemState.defVig;
    }

    return {
        side,
        isSingleSide,
        underdogWin,
        favLoss,
        favWin,
        maxBet,
        userLimit,
        minBet,
        vig,
    };
}

export function oddsToCommand(odds: BettingOdds): string {
    if (odds.fixedOddsKey) {
        return `${odds.fixedOddsKey}/${odds.maxBet}/${odds.userLimit}/${odds.minBet}`;
    }

    const isRedOpen = odds.redLossRatio > 0;
    const isBlueOpen = odds.blueLossRatio > 0;

    if (!isRedOpen && isBlueOpen) {
        const win = d(odds.blueWinRatio);
        return `ด/${win}/${odds.maxBet}/${odds.userLimit}/${odds.minBet}`;
    }
    if (isRedOpen && !isBlueOpen) {
        const win = d(odds.redWinRatio);
        return `ง/${win}/${odds.maxBet}/${odds.userLimit}/${odds.minBet}`;
    }

    if (odds.redLossRatio === odds.blueLossRatio && odds.redWinRatio === odds.blueWinRatio) {
        return `ส/${d(odds.redLossRatio)}/${d(odds.redWinRatio)}/${odds.maxBet}/${odds.userLimit}/${odds.minBet}`;
    }

    const redIsTor = odds.redLossRatio > odds.redWinRatio;
    const torSide = redIsTor ? 'ด' : 'ง';
    const torLoss = d(redIsTor ? odds.redLossRatio : odds.blueLossRatio);
    const torWin = d(redIsTor ? odds.redWinRatio : odds.blueWinRatio);
    return `${torSide}/${torLoss}/${torWin}/${odds.maxBet}/${odds.userLimit}/${odds.minBet}/${odds.vig}`;
}

export function oddsToText(odds: BettingOdds): string {
    if (odds.fixedOddsKey) return odds.fixedOddsKey;

    const isRedOpen = odds.redLossRatio > 0;
    const isBlueOpen = odds.blueLossRatio > 0;

    if (!isRedOpen && isBlueOpen) {
        return `ด/${d(odds.blueWinRatio)}`;
    }
    if (isRedOpen && !isBlueOpen) {
        return `ง/${d(odds.redWinRatio)}`;
    }

    if (odds.redLossRatio === odds.blueLossRatio && odds.redWinRatio === odds.blueWinRatio) {
        return `ส/${d(odds.redLossRatio)}/${d(odds.redWinRatio)}`;
    }

    const redIsTor = odds.redLossRatio > odds.redWinRatio;
    const torSide = redIsTor ? 'ด' : 'ง';
    const torLoss = redIsTor ? odds.redLossRatio : odds.blueLossRatio;
    const torWin = redIsTor ? odds.redWinRatio : odds.blueWinRatio;
    return `${torSide}/${d(torLoss)}/${d(torWin)}`;
}
