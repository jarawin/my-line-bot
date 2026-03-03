import { SystemState } from '../store/game-state';
import { ReplyBuilder } from '../utils/response';
import type { CommandResult } from '../types';

export function cmdUserList(): CommandResult {
    const users = [...SystemState.users.values()].sort((a, b) => a.shortId - b.shortId);
    if (users.length === 0) {
        return ReplyBuilder.create()
            .text('ไม่มี user ในระบบ')
            .build();
    }

    const roleIcon = (r: string) => r === 'MASTER' ? '👑' : r === 'ADMIN' ? '🔑' : '👤';
    const lines = users.map(u =>
        `#u${u.shortId} ${roleIcon(u.role)}[${u.role}] 💰${u.credit} | 🔒${u.creditHold}`
    );
    return ReplyBuilder.create()
        .text(`👥 Users (${users.length})\n` + lines.join('\n'))
        .build();
}

export function cmdListAdmins(): CommandResult {
    const admins = [...SystemState.users.values()]
        .filter(u => u.role === 'ADMIN' || u.role === 'MASTER')
        .sort((a, b) => a.shortId - b.shortId);

    if (admins.length === 0) {
        return ReplyBuilder.create()
            .text('ไม่มี Admin ในระบบ')
            .build();
    }

    const roleIcon = (r: string) => r === 'MASTER' ? '👑' : '🔑';
    const lines = admins.map(u => `${roleIcon(u.role)} #u${u.shortId} [${u.role}]`);
    return ReplyBuilder.create()
        .text(`🔐 Admins (${admins.length})\n` + lines.join('\n'))
        .build();
}

export function cmdBettingBoard(): CommandResult {
    const round = SystemState.currentRound;
    if (!round) {
        return ReplyBuilder.create()
            .text('❌ ไม่มีรอบที่เปิดอยู่')
            .build();
    }

    const statusIcon = round.status === 'OPEN' ? '🟢' : round.status === 'CLOSED' ? '🔴' : '⏳';
    const lines: string[] = [`${statusIcon} Round #r${round.id} [${round.status}]`];

    if (round.oddsHistory.length === 0) {
        lines.push('ยังไม่มีราคาในรอบนี้');
        return ReplyBuilder.create()
            .text(lines.join('\n'))
            .build();
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

    return ReplyBuilder.create()
        .text(lines.join('\n'))
        .build();
}

export function cmdHelp(): CommandResult {
    const helpText = `📖 คำสั่งแอดมิน

🎮 รอบ [กลุ่มเดิมพัน]
o - เปิดรอบใหม่
x / xx - ปิดรอบ / เปิดรอบต่อ
sด / sง / sส - ตั้งผล แดง/น้ำเงิน/เสมอ
y - ยืนยันจ่ายเงิน
r / r12 - ย้อนกลับรอบ

💰 ราคา [กลุ่มเดิมพัน]
ด/10/2 หรือ ง/4/10 - เปิดราคา
ป - ปิดราคาปัจจุบัน
ยก / ยก2 - ยกเลิกราคา
ยกยก - คืนราคาที่ยกล่าสุด

📊 ดูข้อมูล [หลังบ้าน]
#r / #r12 - ดูรอบ  |  #o / #o2 - ดูราคา
b - กระดานแทง  |  u - รายชื่อ user
a - รายชื่อแอดมิน  |  stats - สถิติรวม
ac - Active credit  |  sum - สรุปเดิมพัน

👤 จัดการ User [หลังบ้าน]
#u12 - ดูข้อมูล user
#u12+500 / -500 / =500 - จัดการเครดิต
admin / customer / master #u12 - ตั้ง role
c #u12 / c12 #u12 - ดูเครดิต user อื่น

🏦 บัญชีธนาคาร [หลังบ้าน]
บช - ดูบัญชีทั้งหมด  |  #b0 - วิธีเพิ่มบัญชี
#b1 / #b1=active/delete/image - ดู/จัดการบัญชี

⚙️ ตั้งค่า [หลังบ้าน]
st - Settings  |  cp - Compact mode
xcap / maxbet / minbet / lim / vig / risk / delay
  → พิมชื่อดูค่า  หรือ ชื่อ=ค่า เพื่อตั้ง
al=https://... - ตั้ง Admin Link

📤 Export [หลังบ้าน]
tx / extx - ประวัติธุรกรรม / export
exac / exab / exsum - export ac / betting / summary

⚠️ ระบบ [หลังบ้าน]
rs - รีเซ็ตระบบ (ยืนยันด้วย rscf)`;

    return ReplyBuilder.create()
        .text(helpText)
        .build();
}

export function cmdHowToPlay(): CommandResult {
    const adminLink = SystemState.adminLink;
    const adminLine = adminLink ? `\nมีข้อสังสัยติดต่อแอดมินได้เลย: ${adminLink}` : '';

    const howToText = `🏦 การฝากเงิน
1. กดคำสั่ง บช จะแสดงเลขบัญชี
2. กดทักหาแอดมิน เพื่อส่งสลิปยืนยัน
3. กดคำสั่ง C เพื่อตรวจสอบยอดเงินที่เข้า

💰 การแทง
ด100 - แทงฝั่งแดง 100 บาท
ง200 - แทงฝั่งน้ำเงิน 200 บาท

📋 การคำนวณ
ราคา: แดงเสีย10 ได้2 น้ำเงินเสีย4 ได้10
- แทง ด100 → ชนะได้ +20, แพ้เสีย -100
- แทง ง100 → ชนะได้ +100, แพ้เสีย -40

💵 คำสั่งเดิมพัน
c - ดูเครดิต และประวัติฝากถอน
cc - ดูเครดิต และประวัติเดิมพัน
c3 - ดูประวัติรอบที่ 3
บช - เช็คบัญชีฝากเงิน

✨ เสมอคืนเงิน
ถ้าผลเสมอจะคืนเงินทั้งหมด${adminLine}`;

    return ReplyBuilder.create()
        .text(howToText)
        .build();
}
