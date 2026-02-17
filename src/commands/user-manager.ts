import { getUserByShortId, SystemState, getOrCreateUser } from '../store/game-state';
import { saveUser, logTransaction } from '../store/persistence';
import type { UserRole } from '../types';

const CREDIT_RE = /^#u(\d+)([+\-=])(\d+)$/;
const ROLE_RE   = /^(admin|master|customer)\s+#u(\d+)$/i;

export function manageCredit(text: string): string {
    const m = text.match(CREDIT_RE)!;
    const shortId = parseInt(m[1]!, 10);
    const op      = m[2]! as '+' | '-' | '=';
    const amount  = parseInt(m[3]!, 10);

    const user = getUserByShortId(shortId);
    if (!user) throw new Error(`ไม่พบ user #u${shortId}`);

    const oldCredit = user.credit;
    if (op === '+')      user.credit += amount;
    else if (op === '-') user.credit -= amount;
    else                 user.credit  = amount;

    const diff = user.credit - oldCredit;
    const txType = op === '+' ? 'DEPOSIT' : op === '-' ? 'WITHDRAW' : 'ADJUSTMENT';
    logTransaction(user.userId, diff, txType);
    saveUser(user);
    return `✅ #u${shortId} เครดิต: ${oldCredit} → ${user.credit}`;
}

export function claimFoundingMaster(userId: string): string {
    let masterCount = 0;
    let adminCount  = 0;
    for (const u of SystemState.users.values()) {
        if (u.role === 'MASTER') masterCount++;
        else if (u.role === 'ADMIN') adminCount++;
    }

    if (masterCount > 0)
        return '⛔ ระบบมี Master อยู่แล้ว ไม่สามารถใช้คำสั่งนี้ได้';

    const user = getOrCreateUser(userId);

    if (adminCount > 0 && user.role !== 'ADMIN')
        return '⛔ มี Admin ในระบบแล้ว เฉพาะ Admin เท่านั้นที่สามารถเลื่อนขั้นเป็น Master ได้';

    const isFirst = adminCount === 0;
    user.role = 'MASTER';
    saveUser(user);
    return isFirst
        ? '👑 Server เริ่มต้นใหม่! คุณคือ Founding Master คนแรกของระบบ'
        : '👑 คุณได้รับเลื่อนขั้นเป็น Founding Master แล้ว!';
}

export function setRole(text: string): string {
    const m = text.match(ROLE_RE)!;
    const roleStr = m[1]!.toLowerCase();
    const shortId = parseInt(m[2]!, 10);

    const role: UserRole =
        roleStr === 'admin'   ? 'ADMIN'    :
        roleStr === 'master'  ? 'MASTER'   : 'CUSTOMER';

    const user = getUserByShortId(shortId);
    if (!user) throw new Error(`ไม่พบ user #u${shortId}`);

    user.role = role;
    saveUser(user);
    return `✅ #u${shortId} role: ${role}`;
}
