import { SystemState, getOrCreateUser, addBetToRoundAgg } from '../store/game-state';
import { calculateBetImpact } from '../engine/calculator';
import { saveBet, saveUser } from '../store/persistence';
import { db } from '../store/db';
import { ReplyBuilder } from '../utils/response';
import { calcRoundExposure } from './stats';
import { autoCloseForXCap, type XCapTriggerInfo } from './odds';
import { sendRawLineReply, sendRawTelegramText } from '../platform/line-reply';
import type { BetImpact, BettingRound, CommandResult, PendingBet, ReplyContext, UserState } from '../types';

/** Effective risk threshold (negative): riskThreshold=0 → auto 80% of xcap */
function effectiveRiskThreshold(): number {
    const r = SystemState.riskThreshold;
    if (r > 0) return -r;
    const x = SystemState.xcap;
    return x > 0 ? -Math.floor(x * 0.8) : -Infinity;
}

// ตรวจสอบว่าการแทงนี้จะทำให้ worst-case exposure ของราคานี้ทะลุ xcap หรือไม่
// คืน projected worst-case (ค่าลบ) ถ้าทะลุ, null ถ้าไม่ทะลุหรือ xcap=0
function checkXCapBreach(
    round: BettingRound,
    oddsIndex: number,
    side: 'RED' | 'BLUE',
    winAmount: number,
    lossAmount: number,
): number | null {
    if (SystemState.xcap <= 0) return null;
    const existing = round.bets.filter(b => b.oddsIndex === oddsIndex && b.status !== 'VOID');
    let ifRed = 0, ifBlue = 0;
    for (const b of existing) {
        if (b.side === 'RED') { ifRed -= b.winAmount; ifBlue += b.lossAmount; }
        else { ifRed += b.lossAmount; ifBlue -= b.winAmount; }
    }
    if (side === 'RED') { ifRed -= winAmount; ifBlue += lossAmount; }
    else { ifRed += lossAmount; ifBlue -= winAmount; }
    const worst = Math.min(ifRed, ifBlue);
    return worst < -SystemState.xcap ? worst : null;
}

// แปลง CommandResult เป็น LINE message objects สำหรับ sendRawLineReply
function commandResultToLineMessages(result: CommandResult): Record<string, unknown>[] {
    const msgs: Record<string, unknown>[] = [];
    const richSlots = new Map<number, Record<string, unknown>>();
    if (result.lineMessages && result.lineMessageIndices) {
        for (let i = 0; i < result.lineMessages.length; i++) {
            const m = result.lineMessages[i]!;
            const obj: Record<string, unknown> = { type: m.type };
            if (m.altText) obj.altText = m.altText;
            if (m.contents) obj.contents = m.contents;
            if (m.text) obj.text = m.text;
            richSlots.set(result.lineMessageIndices[i]!, obj);
        }
    }
    for (let i = 0; i < result.messages.length; i++) {
        msgs.push(richSlots.has(i) ? richSlots.get(i)! : { type: 'text', text: result.messages[i]! });
    }
    return msgs;
}

// ส่ง CommandResult ผ่าน pending reply token พร้อม appendText ต่อท้าย
async function sendDelayedResult(pending: PendingBet, result: CommandResult, appendText: string): Promise<void> {
    const ctx = pending.replyContext;
    if (ctx.type === 'LINE') {
        const msgs = commandResultToLineMessages(result);
        msgs.push({ type: 'text', text: appendText });
        if (ctx.quoteToken) {
            const first = msgs.find(m => (m as Record<string, unknown>).type === 'text') as Record<string, unknown> | undefined;
            if (first) first.quoteToken = ctx.quoteToken;
        }
        await sendRawLineReply(ctx.replyToken, msgs.slice(0, 5));
    } else {
        for (const n of result.notifications) {
            const { notifyAllTelegramGroups } = await import('../platform/telegram');
            void notifyAllTelegramGroups([n]);
        }
        await sendRawTelegramText(ctx.chatId, appendText);
    }
}

let _betSeq = 0;
function nextBetId(): string { return String(++_betSeq); }

export function placeBet(
    userId: string,
    side: 'RED' | 'BLUE',
    requestedAmount: number,
    replyContext?: ReplyContext,
): CommandResult {
    const odds = SystemState.currentOdds;
    if (!odds) throw new Error('ยังไม่มีราคา');
    if (odds.status !== 'OPEN') throw new Error('ปิดรับแทงแล้ว');

    if (side === 'RED' && odds.redLossRatio === 0) throw new Error('❌ ฝั่งแดงปิดรับเดิมพันในราคานี้');
    if (side === 'BLUE' && odds.blueLossRatio === 0) throw new Error('❌ ฝั่งน้ำเงินปิดรับเดิมพันในราคานี้');

    const round = SystemState.currentRound;
    if (!round || round.status !== 'OPEN') throw new Error('ไม่มีรอบที่เปิดอยู่');

    const user = getOrCreateUser(userId);
    const oddsIndex = round.oddsHistory.length - 1;
    const oddsKey = String(oddsIndex);

    const currentCount = user.oddsBetCounts.get(oddsKey) ?? 0;
    if (odds.userLimit > 0 && currentCount >= odds.userLimit)
        throw new Error(`ครบโควต้า ${odds.userLimit} ไม้แล้วครับ`);

    if (requestedAmount < odds.minBet)
        throw new Error(`ขั้นต่ำ ${odds.minBet} ครับ`);

    let amount = requestedAmount;
    let warning: string | undefined;
    if (amount > odds.maxBet) {
        amount = odds.maxBet;
        warning = `⚠️ ปรับยอดเป็นสูงสุด ${odds.maxBet}`;
    }

    const impact = calculateBetImpact(user, side, amount, odds);

    const prevRedNet = user.currentRoundRedNet;
    const prevBlueNet = user.currentRoundBlueNet;
    const prevCreditHold = user.creditHold;
    const prevOddsCount = currentCount;

    user.currentRoundRedNet = impact.newRedNet;
    user.currentRoundBlueNet = impact.newBlueNet;
    user.creditHold = impact.newCreditHold;
    user.oddsBetCounts.set(oddsKey, currentCount + 1);

    if (replyContext) {
        const betId = nextBetId();
        const timer = setTimeout(() => { void finalizePendingBet(betId); }, SystemState.betDelayMs);
        const pending: PendingBet = {
            betId, userId, roundId: round.id, oddsIndex, side, amount,
            winAmount: impact.winAmount, lossAmount: impact.lossAmount,
            placedAt: Date.now(), warning,
            prevRedNet, prevBlueNet, prevCreditHold, prevOddsCount,
            replyContext, timer,
        };
        SystemState.pendingBets.set(betId, pending);
        return ReplyBuilder.create().build();
    }

    // Sync path: check xcap BEFORE committing — void bet + close odds if breached
    const xcapBreach = checkXCapBreach(round, oddsIndex, side, impact.winAmount, impact.lossAmount);
    if (xcapBreach !== null) {
        user.currentRoundRedNet = prevRedNet;
        user.currentRoundBlueNet = prevBlueNet;
        user.creditHold = prevCreditHold;
        user.oddsBetCounts.set(oddsKey, prevOddsCount);
        const trigger: XCapTriggerInfo = { userId, side, amount, projectedWorstCase: xcapBreach, xcap: SystemState.xcap };
        const closeResult = autoCloseForXCap(trigger) ?? ReplyBuilder.create().text('⚡ ปิดรับแทงอัตโนมัติแล้ว').build();
        closeResult.messages.push('❌ ยกเลิกการแทง ราคาปิดแล้ว');
        return closeResult;
    }

    return commitBet(userId, round, oddsIndex, side, amount, impact, user, warning);
}

function commitBet(
    userId: string,
    round: BettingRound,
    oddsIndex: number,
    side: 'RED' | 'BLUE',
    amount: number,
    impact: BetImpact,
    user: UserState,
    warning?: string,
): CommandResult {
    if (!user.isBetting) user.isBetting = true;
    const bet = {
        userId, oddsIndex, side, amount,
        winAmount: impact.winAmount, lossAmount: impact.lossAmount,
        timestamp: Date.now(), status: 'PENDING' as const,
    };
    round.bets.push(bet);
    addBetToRoundAgg(bet);

    SystemState.stats.globalTurnover += amount;
    user.totalTurnover += amount;

    const roundId = round.id;
    queueMicrotask(() => {
        db.transaction(() => {
            saveBet(userId, roundId, oddsIndex, side, amount, impact.winAmount, impact.lossAmount);
            saveUser(user);
        })();
    });

    return buildConfirmResult(side, amount, impact.winAmount, impact.lossAmount, impact.newCreditHold, user, round, oddsIndex, warning);
}

function betConfirmText(
    side: 'RED' | 'BLUE',
    amount: number,
    winAmount: number,
    lossAmount: number,
    creditHold: number,
    availableCredit: number,
    capped: boolean,
): string {
    const label = winAmount < lossAmount ? 'ต่อ' : winAmount > lossAmount ? 'รอง' : 'แทง';
    const sideName = side === 'RED' ? 'แดง' : 'น้ำเงิน';
    const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
    return `✅ ${label}${sideName} ${fmt(amount)} บาท${capped ? ' (สูงสุด)' : ''}\nกันเครดิต: -${fmt(creditHold)}/${fmt(availableCredit)} บาท`;
}

function buildConfirmResult(
    side: 'RED' | 'BLUE',
    amount: number,
    winAmount: number,
    lossAmount: number,
    creditHold: number,
    user: UserState,
    round: BettingRound,
    oddsIndex: number,
    warning?: string,
): CommandResult {
    const builder = ReplyBuilder.create().textQuoted(
        betConfirmText(side, amount, winAmount, lossAmount, creditHold, user.credit - creditHold, !!warning),
    );

    // Risk alert (fires only when xcap=0 or odds not auto-closed)
    if (SystemState.riskAlertSentOddsIdx !== oddsIndex) {
        const exp = calcRoundExposure(round.bets);
        const worstCase = Math.min(exp.ifRedWins, exp.ifBlueWins);
        if (worstCase <= effectiveRiskThreshold()) {
            SystemState.riskAlertSentOddsIdx = oddsIndex;
            const worstSide = exp.ifRedWins <= exp.ifBlueWins ? 'แดง' : 'น้ำเงิน';
            builder.notify(
                '🚨 HIGH RISK ALERT',
                `ยอดความเสี่ยงทะลุเพดาน!\nรอบ #r${round.id} ราคา #o${oddsIndex + 1}\nหาก${worstSide}ชนะ เจ้ามือจะขาดทุน: ${Math.abs(worstCase).toLocaleString('en-US')} บาท\nพิจารณาปรับราคา หรือปิดรับแทงด่วน!`,
                'DANGER',
            );
        }
    }

    return builder.build();
}

async function finalizePendingBet(betId: string): Promise<void> {
    const pending = SystemState.pendingBets.get(betId);
    if (!pending) return;
    SystemState.pendingBets.delete(betId);

    const round = SystemState.currentRound;
    const currentOdds = SystemState.currentOdds;
    const currentOddsIdx = round ? round.oddsHistory.length - 1 : -1;

    const shouldVoid =
        !round ||
        round.id !== pending.roundId ||
        round.status !== 'OPEN' ||
        !currentOdds ||
        currentOdds.status !== 'OPEN' ||
        currentOddsIdx !== pending.oddsIndex;

    if (shouldVoid) {
        const user = SystemState.users.get(pending.userId);
        if (user) recalculateUserStateFromBets(user, pending.userId);
        await sendDelayedReply(pending, '❌ ราคาปิดแล้ว บิลถูก Void');
        return;
    }

    const user = SystemState.users.get(pending.userId)!;

    // Async path: check xcap BEFORE committing — void bet + send close odds result
    const xcapBreach = checkXCapBreach(round, pending.oddsIndex, pending.side, pending.winAmount, pending.lossAmount);
    if (xcapBreach !== null) {
        recalculateUserStateFromBets(user, pending.userId);
        const trigger: XCapTriggerInfo = {
            userId: pending.userId, side: pending.side, amount: pending.amount,
            projectedWorstCase: xcapBreach, xcap: SystemState.xcap,
        };
        const closeResult = autoCloseForXCap(trigger) ?? ReplyBuilder.create().text('⚡ ปิดรับแทงอัตโนมัติแล้ว').build();
        await sendDelayedResult(pending, closeResult, '❌ ยกเลิกการแทง ราคาปิดแล้ว');
        if (closeResult.notifications.length > 0) {
            const { notifyAllTelegramGroups } = await import('../platform/telegram');
            void notifyAllTelegramGroups(closeResult.notifications);
        }
        return;
    }

    if (!user.isBetting) user.isBetting = true;
    const bet = {
        userId: pending.userId,
        oddsIndex: pending.oddsIndex,
        side: pending.side,
        amount: pending.amount,
        winAmount: pending.winAmount,
        lossAmount: pending.lossAmount,
        timestamp: Date.now(),
        status: 'PENDING' as const,
    };
    round.bets.push(bet);
    addBetToRoundAgg(bet);

    SystemState.stats.globalTurnover += pending.amount;
    user.totalTurnover += pending.amount;

    queueMicrotask(() => {
        db.transaction(() => {
            saveBet(pending.userId, pending.roundId, pending.oddsIndex, pending.side,
                pending.amount, pending.winAmount, pending.lossAmount);
            saveUser(user);
        })();
    });

    await sendDelayedReply(pending, betConfirmText(
        pending.side, pending.amount, pending.winAmount, pending.lossAmount,
        user.creditHold, user.credit - user.creditHold, !!pending.warning,
    ));

    // Risk alert — O(n) scan only until alert fires
    if (SystemState.riskAlertSentOddsIdx !== pending.oddsIndex) {
        const exp = calcRoundExposure(round.bets);
        const worstCase = Math.min(exp.ifRedWins, exp.ifBlueWins);
        if (worstCase <= effectiveRiskThreshold()) {
            SystemState.riskAlertSentOddsIdx = pending.oddsIndex;
            const worstSide = exp.ifRedWins <= exp.ifBlueWins ? 'แดง' : 'น้ำเงิน';
            const { notifyAllTelegramGroups } = await import('../platform/telegram');
            void notifyAllTelegramGroups([{
                topic: '🚨 HIGH RISK ALERT',
                message: `ยอดความเสี่ยงทะลุเพดาน!\nรอบ #r${round.id} ราคา #o${pending.oddsIndex + 1}\nหาก${worstSide}ชนะ เจ้ามือจะขาดทุน: ${Math.abs(worstCase).toLocaleString('en-US')} บาท\nพิจารณาปรับราคา หรือปิดรับแทงด่วน!`,
                level: 'DANGER',
            }]);
        }
    }
}

function recalculateUserStateFromBets(user: UserState, userId: string): void {
    const round = SystemState.currentRound;
    let redNet = 0, blueNet = 0;
    const newCounts = new Map<string, number>();

    if (round) {
        for (const bet of round.bets) {
            if (bet.userId !== userId || bet.status === 'VOID') continue;
            const betOdds = round.oddsHistory[bet.oddsIndex];
            if (!betOdds || betOdds.status === 'CANCELLED') continue;
            const k = String(bet.oddsIndex);
            newCounts.set(k, (newCounts.get(k) ?? 0) + 1);
            if (bet.side === 'RED') { redNet += bet.winAmount; blueNet -= bet.lossAmount; }
            else { redNet -= bet.lossAmount; blueNet += bet.winAmount; }
        }
    }

    for (const p of SystemState.pendingBets.values()) {
        if (p.userId !== userId) continue;
        const k = String(p.oddsIndex);
        newCounts.set(k, (newCounts.get(k) ?? 0) + 1);
        if (p.side === 'RED') { redNet += p.winAmount; blueNet -= p.lossAmount; }
        else { redNet -= p.lossAmount; blueNet += p.winAmount; }
    }

    user.currentRoundRedNet = redNet;
    user.currentRoundBlueNet = blueNet;
    user.creditHold = Math.max(0, -Math.min(redNet, blueNet));
    user.oddsBetCounts.clear();
    for (const [k, v] of newCounts) user.oddsBetCounts.set(k, v);
}

async function sendDelayedReply(pending: PendingBet, text: string): Promise<void> {
    const ctx = pending.replyContext;
    if (ctx.type === 'LINE') {
        const main: Record<string, unknown> = { type: 'text', text };
        if (ctx.quoteToken) main.quoteToken = ctx.quoteToken;
        await sendRawLineReply(ctx.replyToken, [main]);
    } else {
        await sendRawTelegramText(ctx.chatId, text);
    }
}
