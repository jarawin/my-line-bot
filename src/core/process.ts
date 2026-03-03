import { getOrCreateUser, SystemState } from '../store/game-state';
import { saveUser } from '../store/persistence';
import { registerGroup } from '../commands/setup';
import { claimFoundingMaster } from '../commands/user';
import { dispatch } from './dispatch';
import { ReplyBuilder } from '../utils/response';
import { fetchAndSaveLineProfile } from '../platform/line-profile';
import { generateCreditFlex } from '../flex/credit-flex';
import type { CommandResult, NormalizedEvent, UserState } from '../types';

const profileFetchAttempted = new Set<string>();

export interface ProcessResult {
    result: CommandResult;
    procMs: number;
}

export function tryWelcomeUser(user: UserState, groupId: string): CommandResult | null {
    if (!user.wasJustCreated) return null;
    user.wasJustCreated = false;
    if (user.platform === 'LINE' && !profileFetchAttempted.has(user.userId)) {
        profileFetchAttempted.add(user.userId);
        queueMicrotask(() => { fetchAndSaveLineProfile(user, groupId); });
    }
    const flexes = generateCreditFlex({ user, transactions: [], currentRound: null, settledRound: null, showWelcome: true });
    const rb = ReplyBuilder.create().textV2UserMention(user.userId, 'ยินดีต้อนรับ {u0} 🎉');
    for (const f of flexes) rb.flex(f.contents, f.altText ?? `#u${user.shortId} 💰 ${user.credit}`);
    return rb.build();
}

export function processEvent(event: NormalizedEvent): ProcessResult | null {
    const t0 = Date.now();
    const { platform, userId, groupId, text } = event;

    if (text === 'betgroup' || text === 'notifygroup' || text === 'backgroup') {
        const sender = getOrCreateUser(userId, {
            platform,
            autoAdmin: false,
            telegramUsername: event.telegramUsername,
        });

        if (sender.role !== 'MASTER') {
            return { result: ReplyBuilder.create().text('❌ เฉพาะ Master เท่านั้นที่สามารถลงทะเบียนกลุ่มได้').build(), procMs: Date.now() - t0 };
        }

        let reply: CommandResult;
        if (text === 'betgroup') {
            reply = registerGroup(groupId, platform, 'BETTING', groupId);
        } else if (text === 'notifygroup') {
            if (platform === 'LINE') {
                return { result: ReplyBuilder.create().text('❌ คำสั่งนี้ใช้ได้เฉพาะ Telegram เท่านั้น').build(), procMs: Date.now() - t0 };
            }
            reply = registerGroup(groupId, platform, 'NOTIFY', groupId);
        } else {
            reply = registerGroup(groupId, platform, 'BACKOFFICE', groupId);
        }
        return { result: reply, procMs: Date.now() - t0 };
    }

    if (/^fm$/i.test(text)) {
        const sender = getOrCreateUser(userId, {
            platform,
            autoAdmin: false,
            telegramUsername: event.telegramUsername,
        });
        return { result: claimFoundingMaster(sender.userId), procMs: Date.now() - t0 };
    }

    const groupInfo = SystemState.allowedGroups.get(groupId);
    if (!groupInfo) return null;

    const isNotifyGroup = groupInfo.type === 'NOTIFY';
    const sender = getOrCreateUser(userId, {
        platform,
        autoAdmin: isNotifyGroup,
        telegramUsername: event.telegramUsername,
    });

    if (!sender.isActive) {
        sender.isActive = true;
        saveUser(sender);
    }

    const welcome = tryWelcomeUser(sender, groupId);
    if (welcome) return { result: welcome, procMs: Date.now() - t0 };

    if (platform === 'LINE' && !sender.displayName && !profileFetchAttempted.has(userId)) {
        profileFetchAttempted.add(userId);
        queueMicrotask(() => { fetchAndSaveLineProfile(sender, groupId); });
    }

    if (isNotifyGroup && sender.role === 'CUSTOMER') {
        sender.role = 'ADMIN';
        saveUser(sender);
    }

    const result = dispatch(userId, event.groupId, text, sender, groupInfo.type, event.mentions, event.replyContext);
    if (!result) return null;

    return { result, procMs: Date.now() - t0 };
}
