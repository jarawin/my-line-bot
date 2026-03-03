import { unlinkSync, existsSync } from 'fs';
import { SystemState, resetAllUsersRoundData, clearViewingRound, recalcRoundAgg } from '../store/game-state';
import {
    saveUser, saveRound, clearBettingDataDB, logTransaction,
    getRoundForReversal, getSettledBetsForRound, reverseRoundInDB,
    getRoundById, getAllBetsForRound, getMaxRoundId,
    resetAllUsersActiveDB,
} from '../store/persistence';
import { db } from '../store/db';
import { EXPORT_DIR } from '../config/paths';
import { createBackupZip } from '../utils/backup';
import { generateBackupFlex } from '../flex/backup-flex';
import { settleRound } from '../engine/settler';
import { closeOdds, buildRoundSummaryLines } from './odds';
import type { Bet, CommandResult, GroupType, RoundResult } from '../types';
import { ReplyBuilder } from '../utils/response';
import { generateCloseRoundFlex, generateCloseRoundBubble, generateResultAnnouncementBubble, generateReverseRoundBubble } from '../flex/close-round-flex';
import { oddsToText } from '../utils/odds-format';

const fmtN   = (v: number) => Math.round(v).toLocaleString('en-US');
const fmtSgn = (v: number) => (v >= 0 ? '+' : '') + Math.round(v).toLocaleString('en-US');

// รวม 2 CommandResult เข้าด้วยกัน (ใช้ตอน auto-closeOdds + closeRound ใน reply เดียว)
function mergeCommandResults(a: CommandResult, b: CommandResult): CommandResult {
    const aLen = a.messages.length;
    return {
        messages: [...a.messages, ...b.messages],
        lineMessages: (a.lineMessages || b.lineMessages)
            ? [...(a.lineMessages ?? []), ...(b.lineMessages ?? [])]
            : undefined,
        lineMessageIndices: (a.lineMessageIndices || b.lineMessageIndices)
            ? [
                ...(a.lineMessageIndices ?? []),
                ...(b.lineMessageIndices ?? []).map(i => i + aLen),
            ]
            : undefined,
        notifications: [...(a.notifications ?? []), ...(b.notifications ?? [])],
        mentions: a.mentions,
        mentionAtIndex: a.mentionAtIndex,
        quoteIndices: a.quoteIndices,
    };
}

const REVERSE_RE = /^[rR](\d+)?$/;

export function openRound(): CommandResult {
    clearViewingRound();
    const cur = SystemState.currentRound;
    if (cur && cur.status !== 'COMPLETED') throw new Error(`ต้องเคลียร์รอบเก่าก่อน (สถานะ: ${cur.status})`);

    const newId = (cur?.id ?? getMaxRoundId()) + 1;
    resetAllUsersRoundData();

    const newRound = { id: newId, bets: [], oddsHistory: [], status: 'OPEN' as const, startedAt: Date.now() };
    SystemState.currentRound = newRound;
    recalcRoundAgg(); // reset aggregate cache สำหรับรอบใหม่
    saveRound(newRound);

    return ReplyBuilder.create()
        .textQuoted(`✅ เปิดรอบ #r${newId} แล้ว!`)
        .mentionEveryone(`{everyone} เตรียมเดิมพันได้เลย!`)
        .notify('เปิดรอบ', `#r${newId} เปิดแล้ว`, 'INFO')
        .build();
}

export function closeRound(): CommandResult {
    const round = SystemState.currentRound;
    if (!round || round.status !== 'OPEN') throw new Error('ไม่มีรอบที่ OPEN อยู่');

    const oddsResult = SystemState.currentOdds ? closeOdds() : null;

    round.status = 'CLOSED';
    saveRound(round);

    const activeBets = round.bets.filter(b => b.status !== 'VOID');

    // per-odds breakdown สำหรับ notify
    const oddsLines: string[] = [];
    for (let i = 0; i < round.oddsHistory.length; i++) {
        const odds = round.oddsHistory[i]!;
        if (odds.status === 'CANCELLED') continue;
        const oddsBets = activeBets.filter(b => b.oddsIndex === i);
        if (oddsBets.length === 0) continue;
        const oRed  = oddsBets.filter(b => b.side === 'RED').reduce((s, b) => s + b.amount, 0);
        const oBlue = oddsBets.filter(b => b.side === 'BLUE').reduce((s, b) => s + b.amount, 0);
        const parts: string[] = [];
        if (oRed > 0)  parts.push(`ด${fmtN(oRed)}`);
        if (oBlue > 0) parts.push(`ง${fmtN(oBlue)}`);
        oddsLines.push(`#o${i + 1} ${oddsToText(odds)} ${parts.join(' ')}`);
    }

    const closeRoundBubble = generateCloseRoundBubble(round.id);
    const builder = ReplyBuilder.create()
        .flex(closeRoundBubble, `⛔ ปิดรอบ #r${round.id} แล้ว รอประกาศผล`);

    if (activeBets.length > 0) {
        const { flexes, userNets, userOrder } = generateCloseRoundFlex(round.id, activeBets, SystemState.users, false, undefined, false, true);
        const userLines: string[] = [`สรุปผลแพ้ชนะ (คาดการณ์) ปิดรอบที่ ${round.id}`, ''];
        for (const userId of userOrder) {
            const user = SystemState.users.get(userId);
            const { redNet, blueNet } = userNets.get(userId)!;
            userLines.push(`#u${user?.shortId ?? userId} ด${fmtSgn(redNet)} ง${fmtSgn(blueNet)}`);
        }
        for (const [i, f] of flexes.entries()) builder.flex(f.contents, i === 0 ? userLines.join('\n') : (f.altText ?? ''));
    }

    const roundResult = builder
        .notify(`ปิดรอบ #r${round.id}`, [...oddsLines, ...buildRoundSummaryLines()].join('\n'), 'INFO')
        .build();

    return oddsResult ? mergeCommandResults(oddsResult, roundResult) : roundResult;
}

export function reopenRound(): CommandResult {
    clearViewingRound();
    const round = SystemState.currentRound;
    if (!round) throw new Error('❌ ไม่มีรอบที่เปิดอยู่');
    if (round.status === 'OPEN') throw new Error('❌ รอบกำลังเปิดอยู่แล้ว');
    if (round.status === 'COMPLETED') throw new Error('❌ ไม่สามารถเปิดรอบที่จบแล้วได้ (ใช้ reverse แทน)');

    round.status = 'OPEN';
    saveRound(round);

    return ReplyBuilder.create()
        .text(`✅ ยกเลิกการปิดรอบ #r${round.id} แล้ว\nสามารถเปิดราคาและรับเดิมพันต่อได้`)
        .notify(`เปิดรอบ #r${round.id} ต่อจากเดิม`, 'แอดมินเปิดราคาต่อได้เลย', 'WARN')
        .build();
}

export function setResult(winner: RoundResult): CommandResult {
    clearViewingRound();
    const round = SystemState.currentRound;
    if (!round) throw new Error('ไม่มีรอบที่เปิดอยู่');
    if (round.status === 'OPEN') throw new Error('ต้องปิดรอบก่อน (พิมพ์ X)');
    if (round.status === 'COMPLETED') throw new Error('รอบนี้เคลียร์แล้ว ไม่สามารถเปลี่ยนผลได้');

    const previousResult = round.result;
    const isChangingResult = previousResult !== undefined;

    round.result = winner;
    round.status = 'WAITING_PAYMENT';
    saveRound(round);

    const label = winner === 'RED' ? '🔴 แดง' : winner === 'BLUE' ? '🔵 น้ำเงิน' : '🤝 เสมอ';
    const winnerThai = winner === 'RED' ? 'แดงชนะ' : winner === 'BLUE' ? 'น้ำเงินชนะ' : 'เสมอ';

    // คำนวณ P&L คาดการณ์ตามผลที่เลือก
    const activeBets = round.bets.filter(b => b.status !== 'VOID');
    let grossWin = 0, grossLoss = 0;
    if (winner === 'RED') {
        for (const bet of activeBets) {
            if (bet.side === 'BLUE') grossWin  += bet.lossAmount;
            else                     grossLoss += bet.winAmount;
        }
    } else if (winner === 'BLUE') {
        for (const bet of activeBets) {
            if (bet.side === 'RED') grossWin  += bet.lossAmount;
            else                    grossLoss += bet.winAmount;
        }
    }
    const net = grossWin - grossLoss;

    const notifyLines: string[] = [];
    if (winner !== 'DRAW') {
        notifyLines.push(`ยอดเราได้ +${fmtN(grossWin)}`);
        notifyLines.push(`ยอดเราเสีย -${fmtN(grossLoss)}`);
        notifyLines.push(`รวมรอบนี้เรา ${fmtSgn(net)}`);
        notifyLines.push('');
    }
    notifyLines.push('โปรดยืนยันผลลัพธ์ด้วยคำสั่ง Y');

    const resultBubble = generateResultAnnouncementBubble(round.id, winner);
    const fallbackText = `🏁 รอบ #r${round.id} ผู้ชนะ: ${label}`;

    if (isChangingResult) {
        const prevLabel = previousResult === 'RED' ? '🔴 แดง' : previousResult === 'BLUE' ? '🔵 น้ำเงิน' : '🤝 เสมอ';
        return ReplyBuilder.create()
            .flex(resultBubble, fallbackText)
            .text(`🔄 เปลี่ยนผลรอบ #r${round.id}\n${prevLabel} → ${label}\nแอดมินกด Y เพื่อจ่ายเงิน`)
            .notify(`รับผล${winnerThai} รอบ #r${round.id}`, notifyLines.join('\n'), 'INFO')
            .build();
    }

    return ReplyBuilder.create()
        .flex(resultBubble, fallbackText)
        .text(`แอดมินกด Y เพื่อจ่ายเงิน`)
        .notify(`รับผล${winnerThai} รอบ #r${round.id}`, notifyLines.join('\n'), 'INFO')
        .build();
}

export function confirmSettlement(): CommandResult {
    clearViewingRound();

    const round = SystemState.currentRound;
    if (!round || !round.result) throw new Error('❌ ยังไม่มีผลการแข่งขัน');
    const winner = round.result;
    const activeBets = round.bets.filter(b => b.status !== 'VOID');

    const report = settleRound();

    const { flexes } = generateCloseRoundFlex(report.roundId, activeBets, SystemState.users, false, winner, false, true);

    // per-user actual net หลัง settle (bets ถูกเปลี่ยน status เป็น WON/LOST แล้ว)
    const userNetMap = new Map<string, number>();
    const userOrder: string[] = [];
    let houseGrossWin = 0, houseGrossLoss = 0;
    for (const bet of activeBets) {
        if (!userNetMap.has(bet.userId)) { userNetMap.set(bet.userId, 0); userOrder.push(bet.userId); }
        if (bet.status === 'WON') {
            userNetMap.set(bet.userId, userNetMap.get(bet.userId)! + bet.winAmount);
            houseGrossLoss += bet.winAmount;
        } else if (bet.status === 'LOST') {
            userNetMap.set(bet.userId, userNetMap.get(bet.userId)! - bet.lossAmount);
            houseGrossWin += bet.lossAmount;
        }
    }
    userOrder.sort((a, b) => (userNetMap.get(b) ?? 0) - (userNetMap.get(a) ?? 0));

    const winnerLabel = winner === 'RED' ? 'แดงชนะ' : winner === 'BLUE' ? 'น้ำเงินชนะ' : 'เสมอ';
    const stats = SystemState.stats;
    const vig = SystemState.defVig;
    const holdPctNum = stats.globalTurnover > 0
        ? Math.round((stats.houseWin - stats.houseLoss) / stats.globalTurnover * 100)
        : 0;
    const holdEmo = holdPctNum >= 0 ? '✅' : holdPctNum >= -vig ? '⚠️' : '🚨';
    const totalPlayers = [...SystemState.users.values()].filter(u => u.totalTurnover > 0).length;
    const uniquePlayers = new Set(activeBets.map(b => b.userId)).size;
    const uniqueOdds    = new Set(activeBets.map(b => b.oddsIndex)).size;

    const perUserLines = userOrder.map(uid => {
        const user = SystemState.users.get(uid);
        return `#u${user?.shortId ?? uid} ${fmtSgn(userNetMap.get(uid) ?? 0)}`;
    });

    const notifyLines = [
        ...perUserLines,
        '',
        'สรุปรอบนี้',
        `คนเล่น: ${uniquePlayers}`,
        `จำนวนราคา: ${uniqueOdds}`,
        `จำนวนเดิมพัน: ${report.totalBets}`,
        `เราได้: ${fmtSgn(houseGrossWin)}`,
        `เราเสีย: -${fmtN(houseGrossLoss)}`,
        `แพ้ชนะรอบนี้: ${fmtSgn(report.casinoProfit)}`,
        '',
        'ยอดสะสมวันนี้',
        `จำนวนคนเล่น: ${totalPlayers}`,
        `เทิร์นโอเวอร์รวม: ${fmtN(stats.globalTurnover)}`,
        `ยอดฝากรวม: ${fmtN(stats.globalDeposit)}`,
        `ยอดถอนรวม: ${fmtN(stats.globalWithdraw)}`,
        `แพ้ชนะทุกรอบ: ${fmtSgn(stats.houseWin - stats.houseLoss)}`,
        `ประสิทธิภาพรวม: ${holdPctNum >= 0 ? '+' : ''}${holdPctNum}% ${holdEmo}`,
    ];

    const rb = ReplyBuilder.create();
    for (const f of flexes) rb.flex(f.contents, f.altText ?? `ผลการจ่ายเงินรอบ ${report.roundId}`);
    return rb.notify(`ยืนยัน${winnerLabel} รอบ #r${report.roundId}`, notifyLines.join('\n'), report.casinoProfit < 0 ? 'WARN' : 'INFO').build();
}

export function warnResetSystem(): CommandResult {
    return ReplyBuilder.create()
        .text(
            '⚠️ คำเตือน: Reset ระบบ\n\n' +
            '❌ จะลบข้อมูล:\n' +
            '- รอบทั้งหมด\n' +
            '- ราคาทั้งหมด\n' +
            '- เดิมพันทั้งหมด\n' +
            '- ธุรกรรมทั้งหมด\n\n' +
            '✅ จะเก็บไว้:\n' +
            '- ยอดเครดิต user ทั้งหมด\n' +
            '- บทบาท user (admin/customer)\n\n' +
            '🔴 หากต้องการยืนยัน ให้พิมพ์: RSCF'
        )
        .build();
}

export function confirmResetSystem(): CommandResult {
    let backupFlex: ReturnType<typeof generateBackupFlex> | null = null;
    try {
        const { filename, rowCounts } = createBackupZip();
        const base = (process.env.SERVER_URL ?? '').replace(/\/$/, '');
        if (!base) throw new Error('⛔ ยังไม่ได้ตั้งค่า SERVER_URL');
        // ตัด .zip ออก — LINE ปฏิเสธ URI action ที่ชี้ไปยังไฟล์ .zip
        const urlName = filename.replace(/\.zip$/, '');
        const fileUrl = `${base}/backup/${urlName}?t=${Date.now()}`;
        const summary = [
            `${rowCounts.users} users`,
            `${rowCounts.rounds} รอบ`,
            `${rowCounts.bets.toLocaleString('en-US')} ไม้`,
            `${rowCounts.transactions.toLocaleString('en-US')} tx`,
        ].join(' | ');
        backupFlex = generateBackupFlex(filename, summary, fileUrl);
    } catch (err) {
        console.error('[BACKUP] createBackupZip failed:', err);
    }

    SystemState.currentRound = null;
    SystemState.currentOdds = null;
    SystemState.roundsHistory = [];
    SystemState.viewingRoundId = null;

    for (const user of SystemState.users.values()) {
        user.creditHold = 0;
        user.currentRoundRedNet = 0;
        user.currentRoundBlueNet = 0;
        user.oddsBetCounts.clear();
        user.totalTurnover = 0;
        user.totalWin = 0;
        user.totalLoss = 0;
        user.isBetting = false;
        user.isActive = false;
    }
    resetAllUsersActiveDB();

    SystemState.stats = { globalTurnover: 0, globalDeposit: 0, globalWithdraw: 0, houseWin: 0, houseLoss: 0 };
    SystemState.riskAlertSentOddsIdx = null;

    // ลบไฟล์ Excel ก่อน transaction (file ops ไม่สามารถ rollback ได้)
    for (const fname of ['transactions.xlsx', 'active-credit.xlsx', 'betting.xlsx', 'betting-summary.xlsx']) {
        const exportFile = `${EXPORT_DIR}/${fname}`;
        if (existsSync(exportFile)) {
            try { unlinkSync(exportFile); } catch { /* ignore */ }
        }
    }

    let carryCount = 0;
    db.transaction(() => {
        clearBettingDataDB();
        for (const user of SystemState.users.values()) {
            if (user.credit > 0) {
                logTransaction(user.userId, user.credit, 'ADJUSTMENT', 'ยอดยกมา');
                carryCount++;
            }
        }
    })();

    const rb = ReplyBuilder.create();
    if (backupFlex) rb.flex(backupFlex.contents, backupFlex.altText ?? 'backup');
    rb.text('✅ Reset แล้ว! ยอดเงิน user ยังอยู่ ลบ bet/round/transaction ทั้งหมดแล้ว')
      .notify(
          'รีเซ็ตระบบ',
          `ล้างข้อมูล bet/round/tx ทั้งหมด | ยอดยกมา ${carryCount} คน`,
          'DANGER',
      );
    return rb.build();
}

export function cmdViewRoundFlex(roundId?: number, groupType?: GroupType): CommandResult {
    const cur = SystemState.currentRound;

    let bets: Bet[];
    let resolvedId: number;
    let isOpen: boolean;
    let winner: 'RED' | 'BLUE' | 'DRAW' | undefined;

    if (roundId === undefined) {
        if (cur) {
            resolvedId = cur.id;
            bets = cur.bets.filter(b => b.status !== 'VOID');
            isOpen = cur.status === 'OPEN';
            winner = cur.result;
        } else {
            const maxId = getMaxRoundId();
            if (maxId === 0) throw new Error('ไม่มีรอบในระบบ');
            const row = getRoundById(maxId);
            if (!row) throw new Error(`ไม่พบรอบ #r${maxId}`);
            const dbBets = getAllBetsForRound(maxId);
            bets = dbBets
                .filter(b => b.status !== 'VOID')
                .map(b => ({
                    userId: b.user_id,
                    oddsIndex: b.odds_index,
                    side: b.side as 'RED' | 'BLUE',
                    amount: b.amount,
                    winAmount: b.win_amount,
                    lossAmount: b.loss_amount,
                    timestamp: 0,
                    status: b.status as import('../types').BetStatus,
                }));
            resolvedId = maxId;
            isOpen = false;
            winner = row.result as 'RED' | 'BLUE' | 'DRAW' | undefined;
        }
    } else if (cur && cur.id === roundId) {
        resolvedId = cur.id;
        bets = cur.bets.filter(b => b.status !== 'VOID');
        isOpen = cur.status === 'OPEN';
        winner = cur.result;
    } else {
        const row = getRoundById(roundId);
        if (!row) throw new Error(`ไม่พบรอบ #r${roundId}`);
        const dbBets = getAllBetsForRound(roundId);
        bets = dbBets
            .filter(b => b.status !== 'VOID')
            .map(b => ({
                userId: b.user_id,
                oddsIndex: b.odds_index,
                side: b.side as 'RED' | 'BLUE',
                amount: b.amount,
                winAmount: b.win_amount,
                lossAmount: b.loss_amount,
                timestamp: 0,
                status: b.status as import('../types').BetStatus,
            }));
        resolvedId = roundId;
        isOpen = false;
        winner = row.result as 'RED' | 'BLUE' | 'DRAW' | undefined;
    }

    if (bets.length === 0) {
        throw new Error(`รอบ #r${resolvedId} ไม่มีเดิมพัน`);
    }

    const fmtSign = (n: number) => (n >= 0 ? '+' : '-') + Math.round(Math.abs(n)).toLocaleString('en-US');
    const hideFooter = groupType === 'BETTING';
    const { flexes, houseRedNet, houseBlueNet, userNets, userOrder } = generateCloseRoundFlex(resolvedId, bets, SystemState.users, isOpen, winner, false, hideFooter);

    const userLines: string[] = [`${isOpen ? 'เปิดอยู่' : 'ปิดแล้ว'}รอบที่ ${resolvedId}`, ''];
    for (const userId of userOrder) {
        const user = SystemState.users.get(userId);
        const label = `#u${user?.shortId ?? userId}`;
        const { redNet, blueNet } = userNets.get(userId)!;
        userLines.push(`${label} ด${fmtSign(redNet)} ง${fmtSign(blueNet)}`);
    }
    userLines.push('');
    userLines.push(`เจ้ามือ: แดงชนะ ${fmtSign(houseRedNet)} น้ำเงินชนะ ${fmtSign(houseBlueNet)}`);

    const rb = ReplyBuilder.create();
    for (const [i, f] of flexes.entries()) rb.flex(f.contents, i === 0 ? userLines.join('\n') : (f.altText ?? ''));
    return rb.build();
}

export function cmdReverseRound(text: string): CommandResult {
    const cur = SystemState.currentRound;
    if (cur && cur.status !== 'COMPLETED') {
        throw new Error(
            `มีรอบ #r${cur.id} ที่ยังไม่เสร็จ (สถานะ: ${cur.status})\n` +
            `ต้องเคลียร์รอบปัจจุบันให้เป็น COMPLETED ก่อนย้อนกลับรอบเก่า`
        );
    }

    const m = text.match(REVERSE_RE)!;
    const roundId = m[1] ? parseInt(m[1], 10) : undefined;

    const roundRow = getRoundForReversal(roundId);
    if (!roundRow) throw new Error(roundId ? `ไม่พบรอบ #r${roundId}` : 'ไม่มีรอบที่สามารถย้อนกลับได้');
    if (roundRow.status !== 'COMPLETED') throw new Error(`รอบ #r${roundRow.id} ไม่ได้อยู่ในสถานะ COMPLETED (สถานะ: ${roundRow.status})`);

    const settledBets = getSettledBetsForRound(roundRow.id);
    const roundRef = `#r${roundRow.id}`;

    const userReverseMap = new Map<string, number>();
    for (const bet of settledBets) {
        const user = SystemState.users.get(bet.user_id);
        if (!user) continue;

        if (bet.status === 'WON') {
            user.credit -= bet.win_amount;
            userReverseMap.set(bet.user_id, (userReverseMap.get(bet.user_id) ?? 0) - bet.win_amount);
        } else if (bet.status === 'LOST') {
            user.credit += bet.loss_amount;
            userReverseMap.set(bet.user_id, (userReverseMap.get(bet.user_id) ?? 0) + bet.loss_amount);
        }
    }
    db.transaction(() => {
        for (const [userId, net] of userReverseMap) {
            const user = SystemState.users.get(userId);
            if (user) saveUser(user);
            logTransaction(userId, net, 'REFUND', roundRef);
        }
        reverseRoundInDB(roundRow.id);
    })();

    const restoredBets: Bet[] = settledBets.map(b => ({
        userId: b.user_id,
        oddsIndex: b.odds_index,
        side: b.side as 'RED' | 'BLUE',
        amount: b.amount,
        winAmount: b.win_amount,
        lossAmount: b.loss_amount,
        timestamp: 0,
        status: 'PENDING' as const,
    }));

    SystemState.roundsHistory = SystemState.roundsHistory.filter(r => r.id !== roundRow.id);

    SystemState.currentRound = {
        id: roundRow.id,
        bets: restoredBets,
        oddsHistory: [],
        status: 'CLOSED',
        startedAt: roundRow.created_at,
        result: undefined,
    };

    const resultText = roundRow.result === 'RED' ? 'แดงชนะ' : roundRow.result === 'BLUE' ? 'น้ำเงินชนะ' : 'เสมอ';
    const reverseBubble = generateReverseRoundBubble(roundRow.id, resultText);
    const { flexes } = generateCloseRoundFlex(roundRow.id, restoredBets, SystemState.users, false, undefined, true, true);

    // per-user reversal lines — เรียงจากได้เงินคืนน้อยสุด (ลบ) → มากสุด (บวก)
    const reverseLines = [...userReverseMap.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([uid, net]) => {
            const user = SystemState.users.get(uid);
            return `#u${user?.shortId ?? uid} ${fmtSgn(net)}`;
        });

    const notifyLines = [
        ...reverseLines,
        '',
        'ระบบไล่คืนเงินและดึงเงินคืน พร้อมคำนวณยอดกันวงเงินเดิมไปยังทุกคนแล้ว โปรดสรุปผลลัพธ์ใหม่โดยเร็วที่สุด',
    ];

    const rb = ReplyBuilder.create().flex(reverseBubble, `♻️ ย้อนกลับรอบ #r${roundRow.id}`);
    for (const f of flexes) rb.flex(f.contents, f.altText ?? `ย้อนกลับรอบ ${roundRow.id}`);
    return rb.notify(`ย้อนผลและคืนเงิน รอบ #r${roundRow.id}`, notifyLines.join('\n'), 'WARN').build();
}
