import { getUserByShortId, SystemState, getOrCreateUser } from '../store/game-state';
import { saveUser, logTransaction, getUserDepositWithdraw, markUserActive } from '../store/persistence';
import { db } from '../store/db';
import type { UserRole, CommandResult } from '../types';
import { ReplyBuilder } from '../utils/response';
import { calcRoundExposure } from './stats';

const CREDIT_RE = /^#u(\d+)([+\-=])(\d+)$/;
const ROLE_RE = /^(admin|master|customer)\s+#u(\d+)$/i;

export function manageCredit(text: string): CommandResult {
    const m = text.match(CREDIT_RE)!;
    const shortId = parseInt(m[1]!, 10);
    const op = m[2]! as '+' | '-' | '=';
    const amount = parseInt(m[3]!, 10);

    const user = getUserByShortId(shortId);
    if (!user) throw new Error(`ไม่พบ user #u${shortId}`);

    markUserActive(user);

    if (user.role === 'ADMIN' || user.role === 'MASTER') {
        throw new Error(`❌ ไม่สามารถฝาก/ถอน/ปรับยอดให้ Admin/Master ได้`);
    }

    const oldCredit = user.credit;
    if (op === '+') user.credit += amount;
    else if (op === '-') user.credit -= amount;
    else user.credit = amount;

    const diff = user.credit - oldCredit;
    const txType = op === '+' ? 'DEPOSIT' : op === '-' ? 'WITHDRAW' : 'ADJUSTMENT';

    db.transaction(() => {
        logTransaction(user.userId, diff, txType);
        saveUser(user);
    })();

    if (op === '+') {
        SystemState.stats.globalDeposit += Math.abs(diff);
    } else if (op === '-') {
        SystemState.stats.globalWithdraw += Math.abs(diff);
    }
    return ReplyBuilder.create()
        .text(`✅ #u${shortId} เครดิต: ${oldCredit} → ${user.credit}`)
        .build();
}

export function claimFoundingMaster(userId: string): CommandResult {
    // ระบบรองรับ master ได้ 1 คนต่อ platform (LINE 1 + Telegram 1)
    let lineMasterExists = false;
    let telegramMasterExists = false;
    let adminCount = 0;
    for (const u of SystemState.users.values()) {
        if (u.role === 'MASTER') {
            if (u.platform === 'LINE') lineMasterExists = true;
            else telegramMasterExists = true;
        } else if (u.role === 'ADMIN') {
            adminCount++;
        }
    }

    const user = getOrCreateUser(userId);
    const platform = user.platform;

    // ตรวจว่า platform นี้มี master แล้วหรือยัง
    const thisPlatformHasMaster = platform === 'LINE' ? lineMasterExists : telegramMasterExists;
    if (thisPlatformHasMaster) {
        return ReplyBuilder.create()
            .text(`⛔ มี Master ของ ${platform} อยู่แล้ว ไม่สามารถใช้คำสั่งนี้ได้`)
            .build();
    }

    // ถ้ามี admin อยู่แล้ว เฉพาะ admin เท่านั้นที่ใช้ fm ได้
    if (adminCount > 0 && user.role !== 'ADMIN') {
        return ReplyBuilder.create()
            .text('⛔ มี Admin ในระบบแล้ว เฉพาะ Admin เท่านั้นที่สามารถเลื่อนขั้นเป็น Master ได้')
            .build();
    }

    const isFirst = !lineMasterExists && !telegramMasterExists && adminCount === 0;
    user.role = 'MASTER';
    saveUser(user);
    return ReplyBuilder.create()
        .text(isFirst
            ? '👑 Server เริ่มต้นใหม่! คุณคือ Founding Master คนแรกของระบบ'
            : `👑 คุณได้รับเลื่อนขั้นเป็น Founding Master ฝั่ง ${platform} แล้ว!`)
        .build();
}

export function cmdUserInfo(shortId: number): CommandResult {
    const user = getUserByShortId(shortId);
    if (!user) throw new Error(`ไม่พบ user #u${shortId}`);

    const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
    const fmtS = (n: number) => (n >= 0 ? '+' : '') + fmt(n);

    let nameStr = '';
    if (user.displayName) nameStr = ` — ${user.displayName}`;
    else if (user.telegramUsername) nameStr = ` — @${user.telegramUsername}`;

    const roleLabel = user.role === 'MASTER' ? '👑 MASTER' : user.role === 'ADMIN' ? '🛡 ADMIN' : '👤 CUSTOMER';
    const inGroupStr = user.isInGroup ? '✅ อยู่ในกลุ่ม' : '❌ ออกจากกลุ่มแล้ว';
    const activeStr = user.isActive ? '🟢 Active' : '⚫ Inactive';
    const platformStr = user.platform === 'LINE' ? 'LINE' : 'Telegram';

    const available = user.credit - user.creditHold;
    const { totalDeposit, totalWithdraw } = getUserDepositWithdraw(user.userId);
    const netDeposit = totalDeposit - totalWithdraw;

    const netPL = user.totalWin - user.totalLoss;

    let roundSection = '';
    const round = SystemState.currentRound;
    if (round) {
        const userBets = round.bets.filter(b => b.userId === user.userId && b.status !== 'VOID');
        if (userBets.length > 0) {
            const { ifRedWins, ifBlueWins } = calcRoundExposure(userBets);
            const worstCase = Math.min(ifRedWins, ifBlueWins);
            roundSection = [
                ``,
                `🥊 รอบปัจจุบัน (#r${round.id})`,
                `  แดงชนะ    ${fmtS(ifRedWins)}`,
                `  น้ำเงินชนะ  ${fmtS(ifBlueWins)}`,
                `  Worst-Case ${fmtS(worstCase)}`,
            ].join('\n');
        }
    }

    const lines = [
        `👤 #u${shortId}${nameStr}`,
        `─────────────────────`,
        `Platform   ${platformStr}  ${roleLabel}`,
        `${inGroupStr}  ${activeStr}`,
        ``,
        `💳 เครดิต      ${fmt(user.credit)}`,
        `🔒 กันเครดิต    ${fmt(user.creditHold)}`,
        `✅ ใช้ได้จริง   ${fmt(available)}`,
        ``,
        `💰 การเงิน`,
        `  ฝากรวม   ${fmt(totalDeposit)}`,
        `  ถอนรวม   ${fmt(totalWithdraw)}`,
        `  Net      ${fmtS(netDeposit)}`,
        ``,
        `📊 สถิติการแทง`,
        `  Turnover ${fmt(user.totalTurnover)}`,
        `  ได้รวม   ${fmt(user.totalWin)}`,
        `  เสียรวม  ${fmt(user.totalLoss)}`,
        `  Net P/L  ${fmtS(netPL)}`,
        roundSection,
    ].filter(l => l !== undefined).join('\n').trimEnd();

    return ReplyBuilder.create().text(lines).build();
}

export function setRole(text: string): CommandResult {
    const m = text.match(ROLE_RE)!;
    const roleStr = m[1]!.toLowerCase();
    const shortId = parseInt(m[2]!, 10);

    const role: UserRole =
        roleStr === 'admin' ? 'ADMIN' :
            roleStr === 'master' ? 'MASTER' : 'CUSTOMER';

    const user = getUserByShortId(shortId);
    if (!user) throw new Error(`ไม่พบ user #u${shortId}`);

    user.role = role;
    saveUser(user);
    return ReplyBuilder.create()
        .text(`✅ #u${shortId} role: ${role}`)
        .build();
}
