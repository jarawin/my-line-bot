import { SystemState } from '../store/game-state';

export function cmdUserList(): string {
    const users = [...SystemState.users.values()].sort((a, b) => a.shortId - b.shortId);
    if (users.length === 0) return 'ไม่มี user ในระบบ';

    const roleIcon = (r: string) => r === 'MASTER' ? '👑' : r === 'ADMIN' ? '🔑' : '👤';
    const lines = users.map(u =>
        `#u${u.shortId} ${roleIcon(u.role)}[${u.role}] 💰${u.credit} | 🔒${u.creditHold}`
    );
    return `👥 Users (${users.length})\n` + lines.join('\n');
}

export function cmdListAdmins(): string {
    const admins = [...SystemState.users.values()]
        .filter(u => u.role === 'ADMIN' || u.role === 'MASTER')
        .sort((a, b) => a.shortId - b.shortId);

    if (admins.length === 0) return 'ไม่มี Admin ในระบบ';

    const roleIcon = (r: string) => r === 'MASTER' ? '👑' : '🔑';
    const lines = admins.map(u => `${roleIcon(u.role)} #u${u.shortId} [${u.role}]`);
    return `🔐 Admins (${admins.length})\n` + lines.join('\n');
}

export function cmdBettingBoard(): string {
    const round = SystemState.currentRound;
    if (!round) return '❌ ไม่มีรอบที่เปิดอยู่';

    const statusIcon = round.status === 'OPEN' ? '🟢' : round.status === 'CLOSED' ? '🔴' : '⏳';
    const lines: string[] = [`${statusIcon} Round #r${round.id} [${round.status}]`];

    if (round.oddsHistory.length === 0) {
        lines.push('ยังไม่มีราคาในรอบนี้');
        return lines.join('\n');
    }

    for (let i = 0; i < round.oddsHistory.length; i++) {
        const odds = round.oddsHistory[i]!;
        const sMark =
            odds.status === 'OPEN'      ? '🟢' :
            odds.status === 'CANCELLED' ? '⚫' : '⛔';

        lines.push('');
        const d = (v: number) => v % 10 === 0 ? v / 10 : (v / 10).toFixed(1);
        lines.push(
            `📍 Odds #o${i + 1} [${odds.status}] ` +
            `(🔴เสีย${d(odds.redLossRatio)}/ได้${d(odds.redWinRatio)} ` +
            `🔵เสีย${d(odds.blueLossRatio)}/ได้${d(odds.blueWinRatio)}) ${sMark}`
        );
        if (odds.status !== 'CANCELLED') {
            lines.push(`  📏 Max:${odds.maxBet} Lmt:${odds.userLimit}ไม้ Min:${odds.minBet} Vig:${odds.vig}`);
        }

        if (odds.status === 'CANCELLED') {
            lines.push('  ⚫ ราคานี้ถูกยกเลิก');
            continue;
        }

        // กรองเฉพาะ non-VOID bets สำหรับ display
        const activeBets = round.bets.filter(b => b.oddsIndex === i && b.status !== 'VOID');
        const voidCount  = round.bets.filter(b => b.oddsIndex === i && b.status === 'VOID').length;

        if (activeBets.length === 0 && voidCount === 0) {
            lines.push('  (ยังไม่มีการแทง)');
        } else {
            if (activeBets.length > 0) {
                const redTotal  = activeBets.filter(b => b.side === 'RED' ).reduce((s, b) => s + b.amount, 0);
                const blueTotal = activeBets.filter(b => b.side === 'BLUE').reduce((s, b) => s + b.amount, 0);
                lines.push(`  🔴 ${redTotal} | 🔵 ${blueTotal}`);

                for (const bet of activeBets) {
                    const user     = SystemState.users.get(bet.userId);
                    const uid      = user ? `#u${user.shortId}` : bet.userId.slice(-4);
                    const sideIcon = bet.side === 'RED' ? '🔴' : '🔵';
                    lines.push(`  - ${uid} ${sideIcon} ${bet.amount}`);
                }
            }
            if (voidCount > 0) lines.push(`  (ยก ${voidCount} ใบ)`);
        }
    }

    return lines.join('\n');
}
