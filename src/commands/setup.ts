import { SystemState } from '../store/game-state';
import { saveGroup, saveSystemConfig, saveOdds } from '../store/persistence';
import type { Platform, GroupType, CommandResult } from '../types';
import { ReplyBuilder } from '../utils/response';

type OddsNumericField = 'maxBet' | 'minBet' | 'userLimit' | 'vig';

/** อัพเดตราคาที่เปิดอยู่ทันที (ถ้ามี) และบันทึก DB — คืน suffix สำหรับ reply */
function patchCurrentOdds(field: OddsNumericField, value: number): string {
    const odds  = SystemState.currentOdds;
    const round = SystemState.currentRound;
    if (!odds || odds.status !== 'OPEN' || !round) return '';
    odds[field] = value;
    const idx = round.oddsHistory.indexOf(odds);
    if (idx >= 0) saveOdds(round.id, idx, odds);
    return '\n(อัพเดตราคาที่เปิดอยู่ด้วย ✅)';
}
import { generateCompactFlex } from '../flex/compact-flex';
import { generateSettingsFlex } from '../flex/settings-flex';

export function registerGroup(
    groupId: string,
    platform: Platform,
    type: GroupType,
    name: string = '',
): CommandResult {
    if (SystemState.allowedGroups.has(groupId)) {
        const existing = SystemState.allowedGroups.get(groupId)!;
        const existingLabel =
            existing.type === 'BETTING' ? 'BETTING (รับแทง)'
                : existing.type === 'NOTIFY' ? 'NOTIFY (แจ้งเตือน Admin)'
                    : 'BACKOFFICE (จัดการ)';
        return ReplyBuilder.create().text(`✅ กลุ่มนี้ลงทะเบียนแล้วเป็น ${existingLabel}`).build();
    }

    SystemState.allowedGroups.set(groupId, { type, platform });
    saveGroup({ id: groupId, platform, type, name, createdAt: Date.now() });

    const typeLabel =
        type === 'BETTING' ? 'BETTING (รับแทง)'
            : type === 'NOTIFY' ? 'NOTIFY (แจ้งเตือน Admin)'
                : 'BACKOFFICE (จัดการ)';
    return ReplyBuilder.create().text(`✅ ลงทะเบียนกลุ่ม ${typeLabel} เรียบร้อย!`).build();
}

export function cmdSetOddsCompact(enable: boolean): CommandResult {
    SystemState.oddsCompact = enable;
    saveSystemConfig('flex_compact', enable ? '1' : '0');
    const mode = enable
        ? 'Compact — ข้อความอย่างเดียว รองรับ ~1,200 คน'
        : 'Normal — รูปโปรไฟล์ + กล่องสี รองรับ ~156 คน';
    return ReplyBuilder.create().text(`✅ Odds Flex Mode: ${mode}`).build();
}

export function cmdSetBetCompact(enable: boolean): CommandResult {
    SystemState.betCompact = enable;
    saveSystemConfig('bet_compact', enable ? '1' : '0');
    const mode = enable
        ? 'Compact — ข้อความอย่างเดียว รองรับ ~720 รายการ'
        : 'Normal — ตารางสี รองรับ ~135 รายการ';
    return ReplyBuilder.create().text(`✅ Bet History Flex Mode: ${mode}`).build();
}

export function cmdSetRoundCompact(enable: boolean): CommandResult {
    SystemState.roundCompact = enable;
    saveSystemConfig('round_compact', enable ? '1' : '0');
    const mode = enable
        ? 'Compact — ข้อความอย่างเดียว รองรับ ~1,200 คน'
        : 'Normal — รูปโปรไฟล์ + กล่องสี รองรับ ~156 คน';
    return ReplyBuilder.create().text(`✅ Round Flex Mode: ${mode}`).build();
}

export function cmdSetTxCompact(enable: boolean): CommandResult {
    SystemState.txCompact = enable;
    saveSystemConfig('tx_compact', enable ? '1' : '0');
    const mode = enable
        ? 'Compact — ข้อความอย่างเดียว รองรับ ~1,800 รายการ'
        : 'Normal — ตารางสี รองรับ ~300 รายการ';
    return ReplyBuilder.create().text(`✅ Transaction Flex Mode: ${mode}`).build();
}

export function cmdSetSumCompact(enable: boolean): CommandResult {
    SystemState.sumCompact = enable;
    saveSystemConfig('sum_compact', enable ? '1' : '0');
    const mode = enable
        ? 'Compact — ข้อความอย่างเดียว รองรับ ~1,248 คน'
        : 'Normal — รูปโปรไฟล์ + กล่องสี รองรับ ~180 คน';
    return ReplyBuilder.create().text(`✅ Betting Summary Flex Mode: ${mode}`).build();
}

export function cmdSetDefMaxBet(value: number): CommandResult {
    SystemState.defMaxBet = value;
    saveSystemConfig('def_maxbet', String(value));
    const patch = patchCurrentOdds('maxBet', value);
    return ReplyBuilder.create().text(`✅ Max ต่อไม้ (default): ${value.toLocaleString('en-US')}${patch}`).build();
}

export function cmdSetDefMinBet(value: number): CommandResult {
    SystemState.defMinBet = value;
    saveSystemConfig('def_minbet', String(value));
    const patch = patchCurrentOdds('minBet', value);
    return ReplyBuilder.create().text(`✅ Min ต่อไม้ (default): ${value.toLocaleString('en-US')}${patch}`).build();
}

export function cmdSetDefLim(value: number): CommandResult {
    SystemState.defLim = value;
    saveSystemConfig('def_lim', String(value));
    const label = value === 0 ? 'ไม่จำกัด' : `${value} ไม้`;
    const patch = patchCurrentOdds('userLimit', value);
    return ReplyBuilder.create().text(`✅ Limit ต่อราคา (default): ${label}${patch}`).build();
}

export function cmdSetDefVig(value: number): CommandResult {
    SystemState.defVig = value;
    saveSystemConfig('def_vig', String(value));
    const patch = patchCurrentOdds('vig', value);
    return ReplyBuilder.create().text(`✅ Vig (default): ${value}%${patch}`).build();
}

export function cmdGetXCap(): CommandResult {
    const label = SystemState.xcap === 0
        ? 'ไม่จำกัด'
        : `${SystemState.xcap.toLocaleString('en-US')} บาท`;
    return ReplyBuilder.create().text(`xcap (ยอดเสียสูงสุดต่อราคา): ${label}`).build();
}

export function cmdGetDefMaxBet(): CommandResult {
    return ReplyBuilder.create().text(`maxbet (default): ${SystemState.defMaxBet.toLocaleString('en-US')}`).build();
}

export function cmdGetDefMinBet(): CommandResult {
    return ReplyBuilder.create().text(`minbet (default): ${SystemState.defMinBet.toLocaleString('en-US')}`).build();
}

export function cmdGetDefLim(): CommandResult {
    const label = SystemState.defLim === 0 ? 'ไม่จำกัด' : `${SystemState.defLim} ไม้`;
    return ReplyBuilder.create().text(`lim (default จำกัดไม้ต่อราคา): ${label}`).build();
}

export function cmdGetDefVig(): CommandResult {
    return ReplyBuilder.create().text(`vig (default): ${SystemState.defVig}%`).build();
}

export function cmdSetXCap(value: number): CommandResult {
    SystemState.xcap = value;
    saveSystemConfig('xcap', String(value));
    const label = value === 0
        ? '✅ ปิดขีดจำกัดยอดเสียต่อราคา (ไม่จำกัด)'
        : `✅ ขีดจำกัดยอดเสียต่อราคา: ${value.toLocaleString('en-US')} บาท`;
    return ReplyBuilder.create().text(label).build();
}

export function cmdGetRisk(): CommandResult {
    const r = SystemState.riskThreshold;
    const label = r === 0
        ? `อัตโนมัติ (80% xcap = ${Math.floor(SystemState.xcap * 0.8).toLocaleString('en-US')})`
        : r.toLocaleString('en-US');
    return ReplyBuilder.create().text(`risk (เพดาน risk alert): ${label}`).build();
}

export function cmdSetRisk(value: number): CommandResult {
    SystemState.riskThreshold = value;
    saveSystemConfig('risk_threshold', String(value));
    const label = value === 0
        ? '✅ risk alert: อัตโนมัติ (80% xcap)'
        : `✅ risk alert เพดาน: ${value.toLocaleString('en-US')} บาท`;
    return ReplyBuilder.create().text(label).build();
}

export function cmdGetDelay(): CommandResult {
    return ReplyBuilder.create().text(`delay (ดีเลย์ก่อน commit bet): ${SystemState.betDelayMs.toLocaleString('en-US')} ms`).build();
}

export function cmdSetDelay(value: number): CommandResult {
    SystemState.betDelayMs = value;
    saveSystemConfig('bet_delay_ms', String(value));
    return ReplyBuilder.create().text(`✅ Bet delay: ${value.toLocaleString('en-US')} ms`).build();
}

export function cmdGetMentionAll(): CommandResult {
    const status = SystemState.mentionAll ? '🔔 เปิด (Tag @everyone ทุกคน)' : '🔕 ปิด (ไม่ Tag @everyone)';
    return ReplyBuilder.create().text(`mention all: ${status}`).build();
}

export function cmdSetMentionAll(enable: boolean): CommandResult {
    SystemState.mentionAll = enable;
    saveSystemConfig('mention_all', enable ? '1' : '0');
    const label = enable ? '✅ เปิด Tag @everyone แล้ว' : '✅ ปิด Tag @everyone แล้ว';
    return ReplyBuilder.create().text(label).build();
}

export function cmdSetAcCompact(enable: boolean): CommandResult {
    SystemState.acCompact = enable;
    saveSystemConfig('ac_compact', enable ? '1' : '0');
    const mode = enable
        ? 'Compact — ข้อความอย่างเดียว รองรับ ~1,296 คน'
        : 'Normal — รูปโปรไฟล์ + กล่องสี รองรับ ~180 คน';
    return ReplyBuilder.create().text(`✅ Active Credit Flex Mode: ${mode}`).build();
}

export function cmdCompactPanel(): CommandResult {
    const bubble = generateCompactFlex({
        ofc:        SystemState.oddsCompact,
        bfc:        SystemState.betCompact,
        tfc:        SystemState.txCompact,
        rfc:        SystemState.roundCompact,
        acfc:       SystemState.acCompact,
        sumfc:      SystemState.sumCompact,
        mentionAll: SystemState.mentionAll,
    });
    return ReplyBuilder.create().flex(bubble, '⚙️ Compact Mode').build();
}

export function cmdSettingsPanel(): CommandResult {
    const bubble = generateSettingsFlex({
        vig:            SystemState.defVig,
        maxBet:         SystemState.defMaxBet,
        minBet:         SystemState.defMinBet,
        lim:            SystemState.defLim,
        xcap:           SystemState.xcap,
        adminLink:      SystemState.adminLink,
        riskThreshold:  SystemState.riskThreshold,
        betDelayMs:     SystemState.betDelayMs,
    });
    return ReplyBuilder.create().flex(bubble, '⚙️ Settings').build();
}
