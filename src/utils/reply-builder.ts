import type { CommandResult, LineMessage, MentionData, AdminNotification, UserState } from '../types';

/**
 * Fluent API builder for constructing CommandResult replies
 *
 * Usage:
 * ```typescript
 * return ReplyBuilder.create()
 *     .text("Hello world")
 *     .notify("Topic", "Message", "INFO")
 *     .build();
 * ```
 */
export class ReplyBuilder {
    private messages: string[] = [];
    private lineMessages: LineMessage[] = [];
    private lineMessageIndices: number[] = [];
    private notifications: AdminNotification[] = [];
    private mentions?: MentionData[];
    private mentionAtIndex?: number;
    private quoteIndices: number[] = [];

    private constructor() {}

    /**
     * Create a new ReplyBuilder instance
     */
    static create(): ReplyBuilder {
        return new ReplyBuilder();
    }

    /**
     * Add a plain text message
     * @param text The message text
     * @param shouldQuote Whether this message should quote the original (LINE only, default: false)
     */
    text(text: string, shouldQuote = false): this {
        if (shouldQuote) {
            this.quoteIndices.push(this.messages.length);
        }
        this.messages.push(text);
        return this;
    }

    /**
     * Add a text message that quotes the original message (LINE only)
     * @param text The message text
     */
    textQuoted(text: string): this {
        return this.text(text, true);
    }

    /**
     * Add a text message with user mention (displayed at the start of this message)
     * @param user The user to mention
     * @param text The message text
     * @param shouldQuote Whether this message should quote the original (LINE only, default: false)
     */
    mentionUser(user: UserState, text: string, shouldQuote = false): this {
        const mention: MentionData = {
            userId: user.userId,
            displayName: `#u${user.shortId}`,
            platform: user.platform,
        };
        this.mentionAtIndex = this.messages.length;
        this.mentions = [mention];
        if (shouldQuote) {
            this.quoteIndices.push(this.messages.length);
        }
        this.messages.push(text);
        return this;
    }

    /**
     * Add a text message with @everyone mention (LINE only)
     * Supports {everyone} placeholder for custom positioning
     * @param text The message text (use {everyone} to position the mention)
     * @param shouldQuote Whether this message should quote the original (LINE only, default: false)
     */
    mentionEveryone(text: string, shouldQuote = false): this {
        const mention: MentionData = {
            userId: 'EVERYONE',
            displayName: 'everyone',
            platform: 'LINE',
        };
        this.mentionAtIndex = this.messages.length;
        this.mentions = [mention];
        if (shouldQuote) {
            this.quoteIndices.push(this.messages.length);
        }
        this.messages.push(text);
        return this;
    }

    /**
     * Add a LINE textV2 message with inline user mention via {u0} substitution.
     * Renders as: "ยินดีต้อนรับ @username 🎉" (inline, not prepended on a new line).
     * On Telegram, the {u0} placeholder is stripped.
     * @param userId LINE userId to mention
     * @param text Text containing {u0} as the mention position
     */
    textV2UserMention(userId: string, text: string): this {
        this.lineMessageIndices.push(this.messages.length);
        this.lineMessages.push({
            type: 'textV2',
            text,
            substitution: {
                u0: { type: 'mention', mentionee: { type: 'user', userId } },
            },
        });
        // Telegram fallback: remove placeholder
        this.messages.push(text.replace('{u0}', '').trim());
        return this;
    }

    /**
     * Add a flex message (LINE) with fallback text (Telegram)
     * @param flexContent The LINE Flex Message bubble/carousel content
     * @param altText Fallback text for Telegram and LINE notifications
     */
    flex(flexContent: unknown, altText: string): this {
        this.lineMessageIndices.push(this.messages.length);
        this.lineMessages.push({
            type: 'flex',
            altText,
            contents: flexContent,
        });
        this.messages.push(altText);
        return this;
    }

    /**
     * Add an image message (LINE only — Telegram skips the slot)
     * @param url The image URL (must be HTTPS)
     * @param previewUrl Optional preview image URL (defaults to main URL)
     */
    image(url: string, previewUrl?: string): this {
        this.lineMessageIndices.push(this.messages.length);
        this.lineMessages.push({
            type: 'image',
            originalContentUrl: url,
            previewImageUrl: previewUrl ?? url,
        });
        this.messages.push('');  // placeholder slot — LINE uses the image, Telegram skips empty string
        return this;
    }

    /**
     * Add an admin notification (logged to console, not sent to user)
     * @param topic Notification topic
     * @param message Notification message
     * @param level Severity level (default: INFO)
     */
    notify(topic: string, message: string, level: 'INFO' | 'WARN' | 'DANGER' = 'INFO'): this {
        this.notifications.push({ topic, message, level });
        return this;
    }

    /**
     * Build the final CommandResult
     */
    build(): CommandResult {
        return {
            messages: this.messages,
            lineMessages: this.lineMessages.length > 0 ? this.lineMessages : undefined,
            lineMessageIndices: this.lineMessageIndices.length > 0 ? this.lineMessageIndices : undefined,
            notifications: this.notifications,
            mentions: this.mentions,
            mentionAtIndex: this.mentionAtIndex,
            quoteIndices: this.quoteIndices.length > 0 ? this.quoteIndices : undefined,
        };
    }
}

/**
 * Convenience function to create a simple text reply
 * @param text The message text
 */
export function reply(text: string): CommandResult {
    return ReplyBuilder.create().text(text).build();
}

/**
 * Convenience function to create a reply with notification
 * @param text The message text
 * @param topic Notification topic
 * @param message Notification message
 * @param level Severity level
 */
export function replyWithNotify(
    text: string,
    topic: string,
    message: string,
    level: 'INFO' | 'WARN' | 'DANGER',
): CommandResult {
    return ReplyBuilder.create()
        .text(text)
        .notify(topic, message, level)
        .build();
}
