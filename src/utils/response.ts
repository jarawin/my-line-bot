import type { CommandResult, AdminNotification, MentionData } from '../types';

// Export ReplyBuilder for fluent API usage
export { ReplyBuilder } from './reply-builder';

/** Single text message reply, no notification. */
export function textReply(text: string): CommandResult {
    return { messages: [text], notifications: [] };
}

/** Multiple text messages with optional notifications. */
export function multiReply(messages: string[], notifications: AdminNotification[] = []): CommandResult {
    return { messages, notifications };
}

/**
 * One text reply + one admin notification.
 * Used for privileged actions that need an audit trail.
 */
export function adminAction(
    replyText: string,
    notifyTopic: string,
    notifyDetail: string,
    level: AdminNotification['level'] = 'INFO',
): CommandResult {
    return {
        messages: [replyText],
        notifications: [{ topic: notifyTopic, message: notifyDetail, level }],
    };
}

/** Text reply with mentions (LINE textV2 / Telegram markdown). */
export function mentionReply(text: string, mentions: MentionData[]): CommandResult {
    return {
        messages: [text],
        notifications: [],
        mentions,
    };
}
