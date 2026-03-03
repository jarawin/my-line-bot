import { processEvent } from '../core/process';
import { printLog, nextWebhookId } from '../utils/logger';
import { getNotifyGroups } from '../store/persistence';
import type { CommandResult, Mention, MentionData, NormalizedEvent, TelegramReplyContext, AdminNotification } from '../types';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

function buildTelegramTextWithMentions(text: string, mentions?: MentionData[]): string {
    if (!mentions || mentions.length === 0) return text;

    const mentionLines: string[] = [];
    for (const mention of mentions) {
        const numericId = mention.userId.replace('tg_', '');
        const mentionMarkdown = `[${mention.displayName}](tg://user?id=${numericId})`;
        mentionLines.push(mentionMarkdown);
    }

    return mentionLines.join('\n') + '\n' + text;
}

async function sendTelegramMessage(chatId: number, text: string): Promise<boolean> {
    try {
        const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text }),
        });
        return res.ok;
    } catch (e) {
        console.error('[TG] sendMessage failed:', e);
        return false;
    }
}

async function sendTelegramReply(
    ctx: TelegramReplyContext,
    result: CommandResult,
): Promise<{ replyMs: number; replyOk: boolean }> {
    const t0 = Date.now();
    let replyOk = true;

    const mentionIndex = result.mentionAtIndex ?? 0;

    for (let i = 0; i < result.messages.length; i++) {
        const text = result.messages[i]!;
        if (!text) continue;
        const finalText = buildTelegramTextWithMentions(text, i === mentionIndex ? result.mentions : undefined);

        const body: Record<string, unknown> = {
            chat_id: ctx.chatId,
            text: finalText,
            reply_to_message_id: ctx.messageId,
        };

        if (i === mentionIndex && result.mentions && result.mentions.length > 0) {
            body.parse_mode = 'Markdown';
        }

        try {
            const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) replyOk = false;
        } catch (e) {
            console.error('[TG] sendMessage failed:', e);
            replyOk = false;
        }
    }

    return { replyMs: Date.now() - t0, replyOk };
}

export async function notifyAllTelegramGroups(notifications: AdminNotification[]): Promise<void> {
    if (notifications.length === 0) return;

    const notifyGroups = getNotifyGroups('TELEGRAM');
    if (notifyGroups.length === 0) return;

    const lines: string[] = [];
    for (const n of notifications) {
        const levelIcon = n.level === 'DANGER' ? '🔴' : n.level === 'WARN' ? '⚠️' : 'ℹ️';
        lines.push(`${levelIcon} ${n.topic}`);
        lines.push(n.message);
        lines.push('');
    }
    const message = lines.join('\n').trim();

    for (const group of notifyGroups) {
        const chatId = parseInt(group.id.replace('tg_', ''), 10);
        const sent = await sendTelegramMessage(chatId, message);
        if (!sent) {
            console.error(`[NOTIFY][TG] Failed to send to group ${group.id}`);
        }
    }
}

function parseTelegramEvent(body: any, wID: number, receivedAt: number): NormalizedEvent | null {
    const message = body?.message;
    if (!message || typeof message.text !== 'string') return null;

    const chat = message.chat;
    if (chat.type !== 'group' && chat.type !== 'supergroup') return null;

    const chatId: number = chat.id;
    const transportMs = message.date ? receivedAt - (message.date * 1000) : 0;

    const mentions: Mention[] = [];
    const entities = message.entities ?? [];

    for (const entity of entities) {
        if (entity.type === 'text_mention' && entity.user?.id) {
            mentions.push({
                userId: `tg_${entity.user.id}`,
                platform: 'TELEGRAM',
            });
        } else if (entity.type === 'mention') {
            const mentionText = message.text.substring(entity.offset, entity.offset + entity.length);
            const username = mentionText.startsWith('@') ? mentionText.substring(1) : mentionText;
            mentions.push({
                username,
                platform: 'TELEGRAM',
            });
        }
    }

    const telegramUsername = message.from.username;

    return {
        platform: 'TELEGRAM',
        userId: `tg_${message.from.id}`,
        groupId: `tg_${chatId}`,
        text: message.text.trim(),
        replyContext: {
            type: 'TELEGRAM',
            chatId,
            messageId: message.message_id,
        },
        mentions: mentions.length > 0 ? mentions : undefined,
        telegramUsername,
        webhookId: wID,
        eventIndex: 1,
        totalEvents: 1,
        receivedAt,
        transportMs,
    };
}

export async function handleTelegramWebhook(req: Request): Promise<Response> {
    const receivedAt = Date.now();
    const wID = nextWebhookId();

    let body: any;
    try { body = await req.json(); }
    catch { return new Response('OK'); }

    const event = parseTelegramEvent(body, wID, receivedAt);
    if (!event) return new Response('OK');

    const processResult = processEvent(event);
    if (!processResult) return new Response('OK');

    const { result, procMs } = processResult;
    if (result.messages.length === 0) return new Response('OK');

    const { replyMs, replyOk } = await sendTelegramReply(
        event.replyContext as TelegramReplyContext,
        result,
    );

    await notifyAllTelegramGroups(result.notifications);

    printLog('TG', event.webhookId, event.eventIndex, event.totalEvents,
        event.text, event.transportMs, procMs, replyMs, replyOk);

    return new Response('OK');
}
