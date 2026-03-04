import { processEvent } from '../core/process';
import { printLog, nextWebhookId } from '../utils/logger';
import { notifyAllTelegramGroups } from './telegram';
import { getOrCreateUser, SystemState } from '../store/game-state';
import { saveUser, saveBankAccount } from '../store/persistence';
import { IMAGE_DIR } from '../config/paths';
import { generateCreditFlex } from '../flex/credit-flex';
import { ReplyBuilder } from '../utils/response';
import type { CommandResult, LineMessage, LineReplyContext, Mention, MentionData, NormalizedEvent } from '../types';

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN!;

function buildLineMessageWithMentions(text: string, mentions?: MentionData[]): LineMessage {
    if (!mentions || mentions.length === 0) {
        return { type: 'text', text };
    }

    const everyoneMention = mentions.find(m => m.userId === 'EVERYONE');

    if (everyoneMention) {
        const finalText = text.includes('{everyone}') ? text : `{everyone}\n${text}`;
        return {
            type: 'textV2',
            text: finalText,
            substitution: {
                everyone: {
                    type: 'mention',
                    mentionee: { type: 'all' },
                },
            },
        };
    }

    const mentionLines: string[] = [];
    const mentionees: Array<{ index: number; length: number; userId: string }> = [];
    let currentIndex = 0;

    for (const mention of mentions) {
        const mentionText = `@${mention.displayName}`;
        mentionLines.push(mentionText);
        mentionees.push({
            index: currentIndex,
            length: mentionText.length,
            userId: mention.userId,
        });
        currentIndex += mentionText.length + 1;
    }

    const finalText = mentionLines.join('\n') + '\n' + text;
    return {
        type: 'text',
        text: finalText,
        mention: { mentionees },
    };
}

async function sendLineReply(
    ctx: LineReplyContext,
    result: CommandResult,
): Promise<{ replyMs: number; replyOk: boolean }> {
    const t0 = Date.now();

    const lineMessages: Record<string, unknown>[] = [];

    const richSlots = new Map<number, Record<string, unknown>>();
    if (result.lineMessages && result.lineMessageIndices) {
        for (let i = 0; i < result.lineMessages.length; i++) {
            const m = result.lineMessages[i]!;
            const idx = result.lineMessageIndices[i]!;
            const obj: Record<string, unknown> = { type: m.type };
            if (m.text) obj.text = m.text;
            if (m.originalContentUrl) obj.originalContentUrl = m.originalContentUrl;
            if (m.previewImageUrl) obj.previewImageUrl = m.previewImageUrl;
            if (m.altText) obj.altText = m.altText;
            if (m.contents) obj.contents = m.contents;
            if (m.packageId) obj.packageId = m.packageId;
            if (m.stickerId) obj.stickerId = m.stickerId;
            if (m.mention) obj.mention = m.mention;
            if (m.substitution) obj.substitution = m.substitution;
            richSlots.set(idx, obj);
        }
    }

    const mentionIndex = result.mentionAtIndex ?? 0;
    for (let i = 0; i < result.messages.length; i++) {
        if (richSlots.has(i)) {
            lineMessages.push(richSlots.get(i)!);
        } else {
            const text = result.messages[i]!;
            const lineMsg = buildLineMessageWithMentions(text, i === mentionIndex ? result.mentions : undefined);
            const obj: Record<string, unknown> = { type: lineMsg.type };
            if (lineMsg.text) obj.text = lineMsg.text;
            if (lineMsg.mention) obj.mention = lineMsg.mention;
            if (lineMsg.substitution) obj.substitution = lineMsg.substitution;
            lineMessages.push(obj);
        }
    }

    if (lineMessages.length === 0) return { replyMs: 0, replyOk: true };

    // quoteToken ใส่ได้เฉพาะ text/textV2 เท่านั้น
    if (ctx.quoteToken) {
        const indicesToQuote = result.quoteIndices ?? [0];
        for (const idx of indicesToQuote) {
            const msg = lineMessages[idx];
            if (msg && (msg.type === 'text' || msg.type === 'textV2')) {
                msg.quoteToken = ctx.quoteToken;
            }
        }
    }

    try {
        const res = await fetch('https://api.line.me/v2/bot/message/reply', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
            },
            body: JSON.stringify({ replyToken: ctx.replyToken, messages: lineMessages.slice(0, 5) }),
        });

        if (!res.ok) {
            const errorBody = await res.text();
            const msgTypes = lineMessages.slice(0, 5).map(m => m.type).join(', ');
            console.error(`[LINE][ERROR] ${res.status} ${res.statusText} | msgs=[${msgTypes}] | ${errorBody}`);
        }

        return { replyMs: Date.now() - t0, replyOk: res.ok };
    } catch (err) {
        console.error('[LINE][ERROR] Exception during reply:', err);
        return { replyMs: Date.now() - t0, replyOk: false };
    }
}

function parseLineEvents(body: any, wID: number, receivedAt: number): NormalizedEvent[] {
    const events: NormalizedEvent[] = [];
    const rawEvents = body.events ?? [];

    for (let i = 0; i < rawEvents.length; i++) {
        const event = rawEvents[i];
        if (event.type !== 'message' || event.message.type !== 'text') continue;

        if (event.source.type === 'user') continue;

        const groupId: string = event.source.groupId ?? event.source.roomId ?? '';
        if (!groupId) continue;

        const mentions: Mention[] = [];
        const mentionees = event.message.mention?.mentionees ?? [];
        for (const mentionee of mentionees) {
            if (mentionee.userId) {
                mentions.push({
                    userId: mentionee.userId,
                    platform: 'LINE',
                });
            }
        }

        events.push({
            platform: 'LINE',
            userId: event.source.userId,
            groupId,
            text: event.message.text.trim(),
            replyContext: {
                type: 'LINE',
                replyToken: event.replyToken,
                quoteToken: event.message.quoteToken,
            },
            mentions: mentions.length > 0 ? mentions : undefined,
            webhookId: wID,
            eventIndex: i + 1,
            totalEvents: rawEvents.length,
            receivedAt,
            transportMs: receivedAt - event.timestamp,
        });
    }

    return events;
}

async function handleImageMessage(event: any, groupId: string): Promise<void> {
    const shortId = SystemState.pendingImageFor.get(groupId);
    if (shortId === undefined) return;

    const account = SystemState.bankAccounts.get(shortId);
    if (!account) {
        SystemState.pendingImageFor.delete(groupId);
        return;
    }

    const messageId = event.message.id;
    const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
        headers: { 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!res.ok) {
        console.error(`[LINE][IMAGE] Download failed: ${res.status} ${res.statusText}`);
        return;
    }

    const filename = `b${shortId}.jpg`;
    await Bun.write(`${IMAGE_DIR}/${filename}`, await res.arrayBuffer());

    const serverUrl = (process.env.SERVER_URL ?? `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
    account.imageUrl = `${serverUrl}/img/${filename}`;
    saveBankAccount(account);
    SystemState.pendingImageFor.delete(groupId);

    await fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
            replyToken: event.replyToken,
            messages: [{ type: 'text', text: `✅ อัปเดตรูปบัญชี #b${shortId} (${account.bank}) เรียบร้อยแล้ว` }],
        }),
    });
}

async function handleMemberJoined(event: any): Promise<void> {
    const members: Array<{ type: string; userId: string }> = event.joined?.members ?? [];
    const groupId: string = event.source?.groupId ?? '';
    const replyToken: string = event.replyToken ?? '';

    if (!groupId || !SystemState.allowedGroups.has(groupId)) return;

    for (const member of members) {
        if (member.type !== 'user') continue;
        const user = getOrCreateUser(member.userId, { platform: 'LINE' });
        const isNew = user.wasJustCreated;
        if (isNew) user.wasJustCreated = false;
        if (!user.isInGroup) {
            user.isInGroup = true;
            saveUser(user);
        }
        if (!replyToken) continue;
        const greeting = isNew
            ? 'ยินดีต้อนรับ {u0} 🎉'
            : 'ยินดีต้อนรับกลับมาอีกครั้ง {u0}';
        const flexes = generateCreditFlex({ user, transactions: [], currentRound: null, settledRound: null, showWelcome: true });
        const rb = ReplyBuilder.create().textV2UserMention(user.userId, greeting);
        for (const f of flexes) rb.flex(f.contents, f.altText ?? `#u${user.shortId} 💰 ${user.credit}`);
        try {
            await sendLineReply({ type: 'LINE', replyToken } as LineReplyContext, rb.build());
        } catch (err) {
            console.error('[LINE][ERROR] memberJoined reply failed:', err);
        }
        break;
    }
}

function handleMemberLeft(event: any): void {
    const members: Array<{ type: string; userId: string }> = event.left?.members ?? [];
    for (const member of members) {
        if (member.type !== 'user') continue;
        const user = SystemState.users.get(member.userId);
        if (!user) continue;
        if (user.isInGroup) {
            user.isInGroup = false;
            saveUser(user);
        }
    }
}

export async function handleLineWebhook(req: Request): Promise<Response> {
    const receivedAt = Date.now();
    const wID = nextWebhookId();

    try {
        const body = await req.json() as any;

        for (const raw of body.events ?? []) {
            if (raw.type === 'memberJoined') await handleMemberJoined(raw);
            else if (raw.type === 'memberLeft') handleMemberLeft(raw);
            else if (raw.type === 'message' && raw.message?.type === 'image') {
                const gId: string = raw.source?.groupId ?? raw.source?.roomId ?? '';
                if (gId) await handleImageMessage(raw, gId);
            }
        }

        const events = parseLineEvents(body, wID, receivedAt);

        if (events.length === 0) return new Response('OK');

        const tasks = events.map(async (event) => {
            const processResult = processEvent(event);
            if (!processResult) return;

            const { result, procMs } = processResult;
            if (result.messages.length === 0 && !result.lineMessages?.length) return;

            const { replyMs, replyOk } = await sendLineReply(
                event.replyContext as LineReplyContext,
                result,
            );

            await notifyAllTelegramGroups(result.notifications);

            printLog('LINE', event.webhookId, event.eventIndex, event.totalEvents,
                event.text, event.transportMs, procMs, replyMs, replyOk);
        });

        await Promise.all(tasks);
        return new Response('OK');

    } catch (err) {
        console.error('[LINE][ERROR]', err);
        return new Response('Error', { status: 500 });
    }
}
