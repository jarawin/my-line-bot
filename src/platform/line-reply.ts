const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN!;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

/** Send raw messages via LINE Reply API (used for delayed bet finalization). */
export async function sendRawLineReply(
    replyToken: string,
    messages: unknown[],
): Promise<void> {
    try {
        const res = await fetch('https://api.line.me/v2/bot/message/reply', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
            },
            body: JSON.stringify({ replyToken, messages }),
        });
        if (!res.ok) {
            const body = await res.text();
            console.error(`[LINE][RAW-REPLY] ${res.status} ${body}`);
        }
    } catch (err) {
        console.error('[LINE][RAW-REPLY] Error:', err);
    }
}

/** Send a plain text message via Telegram (used for delayed bet finalization). */
export async function sendRawTelegramText(
    chatId: number,
    text: string,
): Promise<void> {
    try {
        const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text }),
        });
        if (!res.ok) {
            const body = await res.text();
            console.error(`[TG][RAW-MSG] ${res.status} ${body}`);
        }
    } catch (err) {
        console.error('[TG][RAW-MSG] Error:', err);
    }
}
