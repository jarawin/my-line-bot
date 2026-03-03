import { SystemState } from '../store/game-state';
import { saveBankAccount, deleteBankAccountDB, saveSystemConfig, getNextBankShortId } from '../store/persistence';
import { db } from '../store/db';
import { generateBankCarouselFlex } from '../flex/account-flex';
import { ReplyBuilder } from '../utils/response';
import type { BankAccount, CommandResult } from '../types';

function parseAddBankArgs(text: string): { bank: string; name: string; number: string } | null {
    const keywords = [
        { key: 'bank', prefix: 'bank=' },
        { key: 'name', prefix: 'name=' },
        { key: 'number', prefix: 'number=' },
    ];

    const positions: Array<{ key: string; idx: number; valueStart: number }> = [];
    for (const { key, prefix } of keywords) {
        const idx = text.indexOf(prefix);
        if (idx === -1) return null;
        positions.push({ key, idx, valueStart: idx + prefix.length });
    }

    positions.sort((a, b) => a.idx - b.idx);

    const result: Record<string, string> = {};
    for (let i = 0; i < positions.length; i++) {
        const { key, valueStart } = positions[i]!;
        const endIdx = positions[i + 1]?.idx ?? text.length;
        result[key] = text.slice(valueStart, endIdx).trim();
    }

    if (!result['bank'] || !result['name'] || !result['number']) return null;
    return { bank: result['bank']!, name: result['name']!, number: result['number']! };
}

function officialBankText(account: BankAccount): string {
    const adminLink = SystemState.adminLink;
    const base = `ธนาคาร: ${account.bank}\nชื่อบัญชี: ${account.name}\nเลขบัญชี: ${account.number}`;
    if (!adminLink) return base;
    return `${base}\n\nเมื่อโอนเงินแล้ว ส่งสลิปมาให้ แอดมินมาที่นี่ >>\n${adminLink}`;
}

export function cmdBankBetting(): CommandResult {
    const activeBank = [...SystemState.bankAccounts.values()].find(b => b.isActive);
    if (!activeBank) return ReplyBuilder.create().text('ไม่พบข้อมูลบัญชี').build();
    const builder = ReplyBuilder.create();
    if (activeBank.imageUrl) builder.image(activeBank.imageUrl);
    return builder.text(officialBankText(activeBank)).build();
}

export function cmdBankCarousel(): CommandResult {
    const accounts = [...SystemState.bankAccounts.values()].sort((a, b) => a.shortId - b.shortId);
    const carousel = generateBankCarouselFlex(accounts);
    const active = accounts.find(a => a.isActive);
    const altText = accounts.length === 0
        ? 'ยังไม่มีบัญชีในระบบ — กด #b0 เพื่อเพิ่ม'
        : `รายการบัญชี ${accounts.length} บัญชี | ใช้งาน: ${active ? `#b${active.shortId} ${active.bank}` : 'ไม่มี'}`;
    return ReplyBuilder.create().flex(carousel, altText).build();
}

export function cmdBankHelp(): CommandResult {
    return ReplyBuilder.create().text(
        '📋 วิธีเพิ่มบัญชีใหม่\n\n' +
        'พิมพ์คำสั่งในรูปแบบ:\n' +
        '#b0 bank=<ชื่อธนาคาร> name=<ชื่อเจ้าของ> number=<เลขบัญชี>\n\n' +
        'ตัวอย่าง:\n' +
        '#b0 bank=ธนาคารกรุงไทย name=นายสมชาย วงษ์ศักดิ์ number=1234567890\n\n' +
        'หมายเหตุ: ชื่อธนาคารและชื่อเจ้าของบัญชีรองรับเว้นวรรค',
    ).build();
}

export function cmdAddBank(text: string): CommandResult {
    const args = parseAddBankArgs(text);
    if (!args) throw new Error('รูปแบบไม่ถูกต้อง — ตัวอย่าง: #b0 bank=กรุงไทย name=สมชาย number=1234567890');

    const shortId = getNextBankShortId();
    const account: BankAccount = {
        shortId,
        bank: args.bank,
        name: args.name,
        number: args.number,
        isActive: false,
    };
    SystemState.bankAccounts.set(shortId, account);
    saveBankAccount(account);

    return ReplyBuilder.create().text(
        `✅ เพิ่มบัญชี #b${shortId} แล้ว\n\n` +
        `ธนาคาร: ${args.bank}\n` +
        `ชื่อบัญชี: ${args.name}\n` +
        `เลขบัญชี: ${args.number}\n\n` +
        `ใช้ #b${shortId}=active เพื่อเปิดใช้งาน`,
    ).build();
}

export function cmdShowBank(shortId: number): CommandResult {
    const account = SystemState.bankAccounts.get(shortId);
    if (!account) throw new Error(`ไม่พบบัญชี #b${shortId}`);
    const builder = ReplyBuilder.create();
    if (account.imageUrl) builder.image(account.imageUrl);
    return builder.text(officialBankText(account)).build();
}

export function cmdManageBank(shortId: number, action: string, groupId: string): CommandResult {
    const account = SystemState.bankAccounts.get(shortId);
    if (!account) throw new Error(`ไม่พบบัญชี #b${shortId}`);

    if (action === 'active') {
        const toDeactivate: typeof account[] = [];
        for (const acc of SystemState.bankAccounts.values()) {
            if (acc.isActive && acc.shortId !== shortId) {
                acc.isActive = false;
                toDeactivate.push(acc);
            }
        }
        account.isActive = true;

        db.transaction(() => {
            for (const acc of toDeactivate) saveBankAccount(acc);
            saveBankAccount(account);
        })();
        return ReplyBuilder.create().text(
            `✅ ตั้งบัญชี #b${shortId} เป็น active แล้ว\n\n` +
            `ธนาคาร: ${account.bank}\n` +
            `ชื่อบัญชี: ${account.name}\n` +
            `เลขบัญชี: ${account.number}`,
        ).build();
    }

    if (action === 'delete') {
        SystemState.bankAccounts.delete(shortId);
        deleteBankAccountDB(shortId);
        return ReplyBuilder.create().text(
            `🗑️ ลบบัญชี #b${shortId} แล้ว\n(${account.bank} — ${account.name})`,
        ).build();
    }

    if (action === 'image') {
        SystemState.pendingImageFor.set(groupId, shortId);
        return ReplyBuilder.create().text(
            `📷 พร้อมรับรูปสำหรับ #b${shortId} (${account.bank})\n` +
            `ส่งรูปมาในกลุ่มนี้ได้เลย`,
        ).build();
    }

    throw new Error(`action ไม่รู้จัก: ${action}`);
}

export function cmdSetAdminLink(link: string): CommandResult {
    SystemState.adminLink = link;
    saveSystemConfig('admin_link', link);
    return ReplyBuilder.create().text(`✅ ตั้ง admin link แล้ว:\n${link}`).build();
}
