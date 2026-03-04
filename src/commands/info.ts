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

🎮 รอบ  [BETTING]
o — เปิดรอบใหม่
x — ปิดรอบ  (ถ้าราคายังเปิดอยู่ จะปิดราคาก่อน)
xx — เปิดรอบต่อ (ยกเลิกการปิด)
sด / sง / sส — ตั้งผล แดง / น้ำเงิน / เสมอ
y — ยืนยันจ่ายเงิน
r / r12 — ย้อนกลับรอบล่าสุด / รอบที่ 12

💰 ราคา  [BETTING]
ด/10/2 หรือ ง/4/10 — เปิดราคา
ป — ปิดราคา
ยก / ยก2 — ยกเลิกราคาล่าสุด / ราคา #2
ยกยก / ยกยก2 — คืนราคาที่ยกล่าสุด / ราคา #2

📊 ข้อมูล  [BACKOFFICE]
b — กระดานแทง
u — รายชื่อ user ทั้งหมด
a — รายชื่อแอดมิน
stats — สถิติรวม
#r / #r12 — ดูรอบปัจจุบัน / รอบที่ 12
#o / #o2 / #o2r3 — ดูราคาล่าสุด / #o2 / #o2 ของรอบ 3
tx — ประวัติธุรกรรม
ac — ยอดเครดิต Active
sum — สรุปผลแพ้ชนะ

📤 Export  [BACKOFFICE]
extx — ธุรกรรม
exac — ยอด Active credit
exab — ตารางเดิมพัน
exsum — สรุปแพ้ชนะ

👤 User  [BACKOFFICE / ทุกกลุ่ม]
#u12 — ดูข้อมูล user
#u12+500 / -500 / =500 — ฝาก / ถอน / ปรับยอด
admin #u12 / customer #u12 / master #u12 — ตั้ง role
c — เครดิตตัวเอง  |  cc — รวมประวัติเดิมพัน
c #u12 / cc #u12 — เครดิต / full ของ user อื่น
c12 — เครดิตรอบที่ 12  |  c12 #u12 — ของ user อื่น

🏦 ธนาคาร  [BACKOFFICE]
#b0 — วิธีเพิ่มบัญชี
#b1 — ดูบัญชี #1
#b1=active / delete / image — จัดการบัญชี
บช — รายการบัญชีทั้งหมด
al=https://... — ตั้ง Admin Link

⚙️ ตั้งค่า  [BACKOFFICE]
st — Settings panel  |  cp — Compact mode panel
all — สถานะ Tag @everyone
all=1 / all=0 — เปิด / ปิด Tag @everyone
xcap / maxbet / minbet / lim / vig / risk / delay
  → พิมชื่อ = ดูค่า  |  ชื่อ=ค่า = ตั้งค่า

🧪 Flex Test  [BACKOFFICE, MASTER เท่านั้น]
fa1 fb1 fc1 fd1 fe1 ff1
  → ทดสอบ: ประวัติแทง / tx / ปิดราคา / ปิดรอบ / ac / สรุป

⚠️ ระบบ  [BACKOFFICE]
rs — แจ้งเตือนก่อนรีเซ็ต  →  rscf — ยืนยันรีเซ็ต`;

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
