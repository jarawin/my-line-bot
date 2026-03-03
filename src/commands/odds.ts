import { SystemState, recalcRoundAgg } from '../store/game-state';
import { saveUser, voidBetsInOdds, restoreBetsInOdds, saveOdds, getOddsForRound, getAllBetsForRound, getRoundById } from '../store/persistence';
import { db } from '../store/db';
import { calculateBetImpact } from '../engine/calculator';
import type { Bet, BettingOdds, CommandResult } from '../types';
import { ReplyBuilder } from '../utils/response';
import { generateOddsFlex } from '../flex/odds-flex';
import { generateCloseOddsFlex, generateStopBettingBubble, generateCancelOddsBubble } from '../flex/close-odds-flex';
import { oddsToText, parseOddsCommand } from '../utils/odds-format';
import { getFixedOdds } from '../config/fixed-odds';

const CANCEL_ODDS_RE = /^ยก(\d+)?$/;
const UNCANCEL_ODDS_RE = /^ยกยก(\d+)?$/;

// ข้อมูลการเดิมพันที่ทำให้ xcap ถูกทะลุ (ส่งมาจาก bet.ts)
export interface XCapTriggerInfo {
    userId: string;
    side: 'RED' | 'BLUE';
    amount: number;           // ยอดเดิมพัน
    projectedWorstCase: number; // worst-case ที่จะเกิดถ้า commit (ค่าลบ)
    xcap: number;             // เพดานที่ตั้งไว้
}

// ─── formatters ──────────────────────────────────────────────────────────────
const fmtN    = (v: number) => Math.round(v).toLocaleString('en-US');
const fmtSign = (v: number) => (v >= 0 ? '+' : '') + Math.round(v).toLocaleString('en-US');

// ─── ส่วน "ผลรวมทุกราคา + คาดการณ์" ที่ใช้ร่วมกันทุก notify ──────────────
export function buildRoundSummaryLines(): string[] {
    const agg = SystemState.roundAgg;
    if (!agg) return [];
    const total = agg.redTotal + agg.blueTotal;
    const toPct = (v: number) => total > 0 ? Math.round(v / total * 100) : 0;
    const fmtPct = (p: number) => (p >= 0 ? '+' : '') + `${p}%`;
    const vig = SystemState.defVig;
    const emo = (p: number) => p >= 0 ? '✅' : p >= -vig ? '⚠️' : '🚨';
    const redPct  = toPct(agg.houseIfRedWins);
    const bluePct = toPct(agg.houseIfBlueWins);
    const avgPct  = total > 0 ? Math.round((agg.houseIfRedWins + agg.houseIfBlueWins) / 2 / total * 100) : 0;
    const lines: string[] = ['', 'ผลรวมทุกราคา'];
    if (agg.blueTotal > 0) lines.push(`ยอดน้ำเงิน ${fmtN(agg.blueTotal)} (${agg.blueBetCount} ไม้ ${agg.blueBettors.size} คน)`);
    if (agg.redTotal > 0)  lines.push(`ยอดแดง ${fmtN(agg.redTotal)} (${agg.redBetCount} ไม้ ${agg.redBettors.size} คน)`);
    lines.push('', 'คาดการณ์ผลลัพธ์');
    lines.push(`แดงชนะ ${fmtSign(agg.houseIfRedWins)} (${fmtPct(redPct)} ${emo(redPct)})`);
    lines.push(`น้ำเงินชนะ ${fmtSign(agg.houseIfBlueWins)} (${fmtPct(bluePct)} ${emo(bluePct)})`);
    lines.push(`กำไรเฉลี่ย ${fmtPct(avgPct)} ${emo(avgPct)}`);
    return lines;
}

// ─── shared close logic ────────────────────────────────────────────────────
function doCloseOdds(
    closedLabel: string,
    notifyTopic: string,
    notifyLevel: 'INFO' | 'WARN',
    xcapTrigger?: XCapTriggerInfo,
): CommandResult {
    const round = SystemState.currentRound;
    const oddsIdx = round ? round.oddsHistory.indexOf(SystemState.currentOdds!) : -1;
    const n = oddsIdx >= 0 ? oddsIdx + 1 : '?';
    const betsForOdds = (round && oddsIdx >= 0)
        ? round.bets.filter(b => b.oddsIndex === oddsIdx && b.status !== 'VOID')
        : [];
    const closedOdds = SystemState.currentOdds!;
    closedOdds.status = 'CLOSED';
    SystemState.riskAlertSentOddsIdx = null;
    if (round && oddsIdx >= 0) saveOdds(round.id, oddsIdx, closedOdds);
    SystemState.currentOdds = null;

    const roundId = round?.id ?? '?';
    const headerLine = `${closedLabel} ${roundId}/${n}`;
    const stopBubble = generateStopBettingBubble(roundId, n);

    if (betsForOdds.length === 0) {
        const emptyNotifyBody: string[] = [];
        if (xcapTrigger) {
            const triggerUser = SystemState.users.get(xcapTrigger.userId);
            const shortId = triggerUser?.shortId ?? xcapTrigger.userId;
            const sideLabel = xcapTrigger.side === 'RED' ? 'ด' : 'ง';
            emptyNotifyBody.push(
                `เดิมพัน #u${shortId} ${sideLabel}${fmtN(xcapTrigger.amount)} ทำให้ยอดเสียสูงสุดต่อราคาเท่ากับ ${fmtSign(xcapTrigger.projectedWorstCase)} ซึ่งจะเกินเพดานตั้งไว้ไม่เกิน -${fmtN(xcapTrigger.xcap)}`,
                '',
            );
        }
        emptyNotifyBody.push('(ไม่มีเดิมพันในราคานี้)');
        return ReplyBuilder.create()
            .flex(stopBubble, `${headerLine} หยุดเดิมพัน`)
            .text(`${headerLine}\n(ไม่มีเดิมพันในราคานี้)`)
            .notify(`${notifyTopic} #o${n} รอบ #r${roundId}`, emptyNotifyBody.join('\n'), notifyLevel)
            .build();
    }

    // per-user bets สำหรับราคานี้
    const userOrder: string[] = [];
    const userTotals = new Map<string, { red: number; blue: number }>();
    for (const bet of betsForOdds) {
        if (!userTotals.has(bet.userId)) {
            userTotals.set(bet.userId, { red: 0, blue: 0 });
            userOrder.push(bet.userId);
        }
        const t = userTotals.get(bet.userId)!;
        if (bet.side === 'RED') t.red += bet.amount;
        else t.blue += bet.amount;
    }
    const notifyUserLines: string[] = [];
    const fallbackLines: string[] = [headerLine, ''];
    for (const userId of userOrder) {
        const user = SystemState.users.get(userId);
        const label = `#u${user?.shortId ?? userId}`;
        const { red, blue } = userTotals.get(userId)!;
        const parts: string[] = [];
        if (red > 0) parts.push(`ด${fmtN(red)}`);
        if (blue > 0) parts.push(`ง${fmtN(blue)}`);
        const line = `${label} ${parts.join(' ')}`;
        notifyUserLines.push(line);
        fallbackLines.push(line);
    }

    // สร้าง notify body
    const notifyBody: string[] = [];
    if (xcapTrigger) {
        const triggerUser = SystemState.users.get(xcapTrigger.userId);
        const shortId = triggerUser?.shortId ?? xcapTrigger.userId;
        const sideLabel = xcapTrigger.side === 'RED' ? 'ด' : 'ง';
        notifyBody.push(
            `เดิมพัน #u${shortId} ${sideLabel}${fmtN(xcapTrigger.amount)} ทำให้ยอดเสียสูงสุดต่อราคาเท่ากับ ${fmtSign(xcapTrigger.projectedWorstCase)} ซึ่งจะเกินเพดานตั้งไว้ไม่เกิน -${fmtN(xcapTrigger.xcap)}`,
        );
        notifyBody.push('');
    }
    notifyBody.push(...notifyUserLines);
    notifyBody.push(...buildRoundSummaryLines());

    const summaryFlexes = generateCloseOddsFlex(roundId, n, oddsToText(closedOdds), false, betsForOdds, SystemState.users);
    const rb = ReplyBuilder.create().flex(stopBubble, `${headerLine} หยุดเดิมพัน`);
    for (const msg of summaryFlexes) rb.flex(msg.contents, msg.altText ?? fallbackLines.join('\n'));
    return rb.notify(`${notifyTopic} #o${n} รอบ #r${roundId}`, notifyBody.join('\n'), notifyLevel).build();
}

// เรียกจาก bet.ts เมื่อ xcap ถูกทะลุ — ใช้ logic เดียวกับ closeOdds แต่ label ต่างกัน
export function autoCloseForXCap(trigger?: XCapTriggerInfo): CommandResult | null {
    if (!SystemState.currentOdds || SystemState.currentOdds.status !== 'OPEN') return null;
    if (!SystemState.currentRound) return null;
    return doCloseOdds('⚡ ปิดรับแทงอัตโนมัติ ราคา', '⚡ ปิดราคาอัตโนมัติ', 'WARN', trigger);
}

export function openOdds(text: string): CommandResult {
    if (SystemState.currentOdds?.status === 'OPEN')
        throw new Error("⛔ ราคาปัจจุบันยังเปิดอยู่ครับ ต้องปิดก่อนเปิดใหม่ (พิมพ์ 'ป')");

    const round = SystemState.currentRound;
    if (!round || round.status !== 'OPEN') throw new Error('เปิดราคาได้เฉพาะตอนรอบ OPEN เท่านั้น');

    const parsed = parseOddsCommand(text);
    const { side, isSingleSide, isEqualOdds, underdogWin, favLoss, favWin, maxBet, userLimit, minBet, vig } = parsed;

    let newOdds: BettingOdds;

    if (parsed.fixedOddsKey && parsed.fixedRedLossRatio !== undefined) {
        // Fixed odds with precomputed ratios — use directly without any scaling
        newOdds = {
            redLossRatio: parsed.fixedRedLossRatio,
            redWinRatio: parsed.fixedRedWinRatio!,
            blueLossRatio: parsed.fixedBlueLossRatio!,
            blueWinRatio: parsed.fixedBlueWinRatio!,
            status: 'OPEN',
            maxBet,
            minBet,
            userLimit,
            vig: 0,
            fixedOddsKey: parsed.fixedOddsKey,
        };

    } else if (isSingleSide && underdogWin !== undefined) {
        const underdogWinRatio = Math.round(underdogWin * 10);
        const underdogLossRatio = 10;

        newOdds = side === 'ด'
            ? { redLossRatio: 0, redWinRatio: 0, blueLossRatio: underdogLossRatio, blueWinRatio: underdogWinRatio, status: 'OPEN', maxBet, minBet, userLimit, vig }
            : { blueLossRatio: 0, blueWinRatio: 0, redLossRatio: underdogLossRatio, redWinRatio: underdogWinRatio, status: 'OPEN', maxBet, minBet, userLimit, vig };

    } else if (!isSingleSide && isEqualOdds && favLoss !== undefined && favWin !== undefined) {
        const lossRatio = Math.round(favLoss * 10);
        const winRatio = Math.round(favWin * 10);

        newOdds = {
            redLossRatio: lossRatio,
            redWinRatio: winRatio,
            blueLossRatio: lossRatio,
            blueWinRatio: winRatio,
            status: 'OPEN',
            maxBet,
            minBet,
            userLimit,
            vig,
        };

    } else if (!isSingleSide && favLoss !== undefined && favWin !== undefined) {
        const favLossRatio = Math.round(favLoss * 10);
        const favWinRatio = Math.round(favWin * 10);

        const underdogLossRatio = favWinRatio + vig;
        const underdogWinRatio = favLossRatio;

        newOdds = side === 'ด'
            ? { redLossRatio: favLossRatio, redWinRatio: favWinRatio, blueLossRatio: underdogLossRatio, blueWinRatio: underdogWinRatio, status: 'OPEN', maxBet, minBet, userLimit, vig }
            : { blueLossRatio: favLossRatio, blueWinRatio: favWinRatio, redLossRatio: underdogLossRatio, redWinRatio: underdogWinRatio, status: 'OPEN', maxBet, minBet, userLimit, vig };
    } else {
        throw new Error('Internal error: invalid parsed odds command');
    }

    SystemState.riskAlertSentOddsIdx = null;
    SystemState.currentOdds = newOdds;
    round.oddsHistory.push(newOdds);
    saveOdds(round.id, round.oddsHistory.length - 1, newOdds);

    const d = (v: number) => v === 0 ? 'X' : (v % 10 === 0 ? v / 10 : (v / 10).toFixed(1));
    const n = round.oddsHistory.length;
    const limitLabel = userLimit === 0 ? 'ไม่จำกัด' : `${userLimit} ไม้`;
    const fmt = (v: number) => Math.round(v).toLocaleString('en-US');
    const dSide = (loss: number, win: number) => loss === 0 ? 'X' : `${d(loss)}/${d(win)}`;

    const replyLines: string[] = [`✅ เปิดราคา #o${n} (รอบ #r${round.id})`];
    if (newOdds.fixedOddsKey) {
        const cfg = getFixedOdds(newOdds.fixedOddsKey);
        replyLines.push(`🔴 แดง  เสีย ${cfg?.redLossLabel ?? '?'} | ได้ ${cfg?.redWinLabel ?? '?'}`);
        replyLines.push(`🔵 น้ำเงิน เสีย ${cfg?.blueLossLabel ?? '?'} | ได้ ${cfg?.blueWinLabel ?? '?'}`);
    } else {
        if (newOdds.redLossRatio > 0) {
            replyLines.push(`🔴 แดง  เสีย ${d(newOdds.redLossRatio)} | ได้ ${d(newOdds.redWinRatio)}`);
        } else {
            replyLines.push(`🔴 แดง  ❌ ปิดรับเดิมพัน`);
        }
        if (newOdds.blueLossRatio > 0) {
            replyLines.push(`🔵 น้ำเงิน เสีย ${d(newOdds.blueLossRatio)} | ได้ ${d(newOdds.blueWinRatio)}`);
        } else {
            replyLines.push(`🔵 น้ำเงิน ❌ ปิดรับเดิมพัน`);
        }
    }
    replyLines.push(`📊 Max: ${maxBet} | Limit: ${limitLabel} | Min: ${minBet}${vig > 0 ? ` | Vig: ${vig}` : ''}`);
    const replyText = replyLines.join('\n');

    const flexContent = generateOddsFlex(newOdds, round.id, n).contents;

    const oddsText = oddsToText(newOdds);
    const notifyOddsText = newOdds.fixedOddsKey
        ? newOdds.fixedOddsKey
        : `ด[${dSide(newOdds.redLossRatio, newOdds.redWinRatio)}] ง[${dSide(newOdds.blueLossRatio, newOdds.blueWinRatio)}]`;
    return ReplyBuilder.create()
        .mentionEveryone(`{everyone} ราคา ${oddsText} เปิดแล้ว!`, true)
        .flex(flexContent, replyText)
        .notify(
            `เปิดราคา #o${n} รอบ #r${round.id}`,
            `${notifyOddsText}\n\nสูงสุด ${fmt(maxBet)} | ขั้นต่ำ ${fmt(minBet)}\nจำกัด ${limitLabel} | ค่าน้ำ ${vig}%`,
            'INFO',
        )
        .build();
}

export function closeOdds(): CommandResult {
    if (!SystemState.currentOdds) throw new Error('ไม่มีราคาที่เปิดอยู่');
    return doCloseOdds('⛔ ปิดราคาที่', 'ปิดราคา', 'INFO');
}

function rowFromOddsRow(o: ReturnType<typeof getOddsForRound>[number]): BettingOdds {
    return {
        redLossRatio: o.red_loss_ratio, redWinRatio: o.red_win_ratio,
        blueLossRatio: o.blue_loss_ratio, blueWinRatio: o.blue_win_ratio,
        status: o.status as BettingOdds['status'],
        maxBet: o.max_bet, minBet: o.min_bet, userLimit: o.user_limit, vig: o.vig,
        fixedOddsKey: o.fixed_odds_key ?? undefined,
    };
}

export function cmdViewOdds(oddsN: number | undefined, roundId?: number): CommandResult {
    const cur = SystemState.currentRound;

    if (oddsN === undefined) {
        if (!cur) throw new Error('ไม่มีรอบที่เปิดอยู่');
        if (cur.oddsHistory.length === 0) throw new Error('ไม่มีราคาในรอบนี้');
        oddsN = cur.oddsHistory.length;
    }

    if (!roundId || (cur && cur.id === roundId)) {
        if (!cur) throw new Error('ไม่มีรอบที่เปิดอยู่');
        const oddsIdx = oddsN - 1;
        const odds = cur.oddsHistory[oddsIdx];
        if (!odds) throw new Error(`ไม่พบราคา #o${oddsN} ในรอบ #r${cur.id}`);

        const isCancelled = odds.status === 'CANCELLED';
        const bets = cur.bets.filter(b => b.oddsIndex === oddsIdx && (isCancelled || b.status !== 'VOID'));
        const flexes = generateCloseOddsFlex(cur.id, oddsN, oddsToText(odds), odds.status === 'OPEN', bets, SystemState.users, isCancelled);
        const rb = ReplyBuilder.create();
        for (const msg of flexes) rb.flex(msg.contents, msg.altText!);
        return rb.build();
    }

    const roundRow = getRoundById(roundId);
    if (!roundRow) throw new Error(`ไม่พบรอบ #r${roundId}`);

    const oddsRows = getOddsForRound(roundId);
    const oddsRow = oddsRows[oddsN - 1];
    if (!oddsRow) throw new Error(`ไม่พบราคา #o${oddsN} ในรอบ #r${roundId}`);

    const odds = rowFromOddsRow(oddsRow);
    const isCancelled = odds.status === 'CANCELLED';
    const allBets = getAllBetsForRound(roundId);
    const bets: Bet[] = allBets
        .filter(b => b.odds_index === oddsN - 1 && (isCancelled || b.status !== 'VOID'))
        .map(b => ({
            userId: b.user_id, oddsIndex: b.odds_index,
            side: b.side as 'RED' | 'BLUE', amount: b.amount,
            winAmount: b.win_amount, lossAmount: b.loss_amount,
            timestamp: 0, status: b.status as Bet['status'],
        }));

    const flexes = generateCloseOddsFlex(roundId, oddsN, oddsToText(odds), false, bets, SystemState.users, isCancelled);
    const rb = ReplyBuilder.create();
    for (const msg of flexes) rb.flex(msg.contents, msg.altText!);
    return rb.build();
}

export function cmdCancelOdds(text: string): CommandResult {
    const round = SystemState.currentRound;
    if (!round) throw new Error('ไม่มีรอบที่เปิดอยู่');

    const m = text.match(CANCEL_ODDS_RE)!;
    const requestedN = m[1] ? parseInt(m[1], 10) - 1 : -1;

    let oddsIdx = -1;
    if (requestedN === -1) {
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

    round.oddsHistory[oddsIdx]!.status = 'CANCELLED';
    if (SystemState.currentOdds === round.oddsHistory[oddsIdx]) {
        SystemState.currentOdds = null;
    }

    const affectedBets = round.bets.filter(b => b.oddsIndex === oddsIdx);
    for (const bet of affectedBets) bet.status = 'VOID';

    const affectedUserIds = new Set(affectedBets.map(b => b.userId));
    for (const userId of affectedUserIds) {
        const user = SystemState.users.get(userId);
        if (!user) continue;

        user.creditHold = 0;
        user.currentRoundRedNet = 0;
        user.currentRoundBlueNet = 0;

        const validBets = round.bets.filter(b => b.userId === userId && b.status === 'PENDING');
        for (const bet of validBets) {
            const betOdds = round.oddsHistory[bet.oddsIndex];
            if (!betOdds || betOdds.status === 'CANCELLED') continue;
            const impact = calculateBetImpact(user, bet.side, bet.amount, betOdds);
            user.currentRoundRedNet = impact.newRedNet;
            user.currentRoundBlueNet = impact.newBlueNet;
            user.creditHold = impact.newCreditHold;
        }
    }

    db.transaction(() => {
        saveOdds(round.id, oddsIdx, round.oddsHistory[oddsIdx]!);
        voidBetsInOdds(round.id, oddsIdx);
        for (const userId of affectedUserIds) {
            const user = SystemState.users.get(userId);
            if (user) saveUser(user);
        }
    })();

    // อัพเดต roundAgg หลังยกเลิก (bets ถูก VOID แล้ว)
    recalcRoundAgg();

    const cancelBubble = generateCancelOddsBubble(round.id, oddsIdx + 1);
    const cancelledOdds = round.oddsHistory[oddsIdx]!;
    const fallbackText = `ยกเลิกราคา #o${oddsIdx + 1} รอบ #r${round.id} คืนวงเงิน ${affectedUserIds.size} คน`;

    // per-user lines สำหรับราคาที่ถูกยก
    const userOrder: string[] = [];
    const userTotals = new Map<string, { red: number; blue: number }>();
    for (const b of affectedBets) {
        if (!userTotals.has(b.userId)) { userTotals.set(b.userId, { red: 0, blue: 0 }); userOrder.push(b.userId); }
        const t = userTotals.get(b.userId)!;
        if (b.side === 'RED') t.red += b.amount; else t.blue += b.amount;
    }
    const cancelUserLines: string[] = [];
    for (const userId of userOrder) {
        const user = SystemState.users.get(userId);
        const { red, blue } = userTotals.get(userId)!;
        const parts: string[] = [];
        if (red > 0) parts.push(`ด${fmtN(red)}`);
        if (blue > 0) parts.push(`ง${fmtN(blue)}`);
        cancelUserLines.push(`#u${user?.shortId ?? userId} ${parts.join(' ')}`);
    }

    const cancelNotifyLines = [
        `คืนเครดิต ${affectedBets.length} ไม้ ${affectedUserIds.size} คน`,
        '',
        ...cancelUserLines,
        ...buildRoundSummaryLines(),
    ];

    const builder = ReplyBuilder.create()
        .flex(cancelBubble, fallbackText)
        .notify(
            `ยกเลิกราคา #o${oddsIdx + 1} รอบ #r${round.id}`,
            cancelNotifyLines.join('\n'),
            'WARN',
        );

    if (affectedBets.length > 0) {
        const summaryFlexes = generateCloseOddsFlex(round.id, oddsIdx + 1, oddsToText(cancelledOdds), false, affectedBets, SystemState.users, true);
        for (const msg of summaryFlexes) builder.flex(msg.contents, msg.altText!);
    }

    return builder.build();
}

export function cmdUncancelOdds(text: string): CommandResult {
    const round = SystemState.currentRound;
    if (!round) throw new Error('ไม่มีรอบที่เปิดอยู่');

    const m = text.match(UNCANCEL_ODDS_RE)!;
    const requestedN = m[1] ? parseInt(m[1], 10) - 1 : -1;

    let oddsIdx = -1;
    if (requestedN === -1) {
        for (let i = round.oddsHistory.length - 1; i >= 0; i--) {
            if (round.oddsHistory[i]!.status === 'CANCELLED') { oddsIdx = i; break; }
        }
        if (oddsIdx === -1) throw new Error('ไม่มีราคาที่ถูกยกเลิกให้ restore');
    } else {
        oddsIdx = requestedN;
        if (oddsIdx < 0 || oddsIdx >= round.oddsHistory.length)
            throw new Error(`ไม่พบราคา #o${requestedN + 1}`);
        const targetStatus = round.oddsHistory[oddsIdx]!.status;
        if (targetStatus !== 'CANCELLED')
            throw new Error(`ราคา #o${oddsIdx + 1} ไม่ได้ถูกยกเลิก (สถานะ: ${targetStatus})`);
    }

    round.oddsHistory[oddsIdx]!.status = 'CLOSED';

    const affectedBets = round.bets.filter(b => b.oddsIndex === oddsIdx && b.status === 'VOID');
    for (const bet of affectedBets) bet.status = 'PENDING';

    const affectedUserIds = new Set(affectedBets.map(b => b.userId));
    for (const userId of affectedUserIds) {
        const user = SystemState.users.get(userId);
        if (!user) continue;

        user.creditHold = 0;
        user.currentRoundRedNet = 0;
        user.currentRoundBlueNet = 0;

        const validBets = round.bets.filter(b => b.userId === userId && b.status === 'PENDING');
        for (const bet of validBets) {
            const betOdds = round.oddsHistory[bet.oddsIndex];
            if (!betOdds || betOdds.status === 'CANCELLED') continue;
            const impact = calculateBetImpact(user, bet.side, bet.amount, betOdds);
            user.currentRoundRedNet = impact.newRedNet;
            user.currentRoundBlueNet = impact.newBlueNet;
            user.creditHold = impact.newCreditHold;
        }
    }

    db.transaction(() => {
        saveOdds(round.id, oddsIdx, round.oddsHistory[oddsIdx]!);
        restoreBetsInOdds(round.id, oddsIdx);
        for (const userId of affectedUserIds) {
            const user = SystemState.users.get(userId);
            if (user) saveUser(user);
        }
    })();

    // อัพเดต roundAgg หลังย้อนกลับ (bets กลับมาเป็น PENDING แล้ว)
    recalcRoundAgg();

    const restoredOdds = round.oddsHistory[oddsIdx]!;
    const fallbackText = `ย้อนกลับราคา #o${oddsIdx + 1} รอบ #r${round.id} คืนสถานะ ${affectedUserIds.size} คน`;

    // per-user lines สำหรับราคาที่ย้อนกลับ
    const userOrder: string[] = [];
    const userTotals = new Map<string, { red: number; blue: number }>();
    for (const b of affectedBets) {
        if (!userTotals.has(b.userId)) { userTotals.set(b.userId, { red: 0, blue: 0 }); userOrder.push(b.userId); }
        const t = userTotals.get(b.userId)!;
        if (b.side === 'RED') t.red += b.amount; else t.blue += b.amount;
    }
    const uncancelUserLines: string[] = [];
    for (const userId of userOrder) {
        const user = SystemState.users.get(userId);
        const { red, blue } = userTotals.get(userId)!;
        const parts: string[] = [];
        if (red > 0) parts.push(`ด${fmtN(red)}`);
        if (blue > 0) parts.push(`ง${fmtN(blue)}`);
        uncancelUserLines.push(`#u${user?.shortId ?? userId} ${parts.join(' ')}`);
    }

    const uncancelNotifyLines = [
        ...uncancelUserLines,
        ...buildRoundSummaryLines(),
    ];

    const summaryFlex = generateCloseOddsFlex(
        round.id, oddsIdx + 1, oddsToText(restoredOdds), false, affectedBets, SystemState.users, false,
    );
    const rbRestore = ReplyBuilder.create();
    for (const msg of summaryFlex) rbRestore.flex(msg.contents, msg.altText ?? fallbackText);
    return rbRestore
        .notify(
            `ย้อนกลับราคา #o${oddsIdx + 1} รอบ #r${round.id}`,
            uncancelNotifyLines.join('\n'),
            'WARN',
        )
        .build();
}
