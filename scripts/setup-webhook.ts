const serverUrl = process.env.SERVER_URL?.replace(/\/$/, '');
if (!serverUrl) {
    console.error('❌ SERVER_URL ไม่ได้ตั้งค่าใน .env');
    process.exit(1);
}

const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const tgToken = process.env.TELEGRAM_BOT_TOKEN;

if (!lineToken && !tgToken) {
    console.error('❌ ไม่พบ LINE_CHANNEL_ACCESS_TOKEN หรือ TELEGRAM_BOT_TOKEN ใน .env');
    process.exit(1);
}

if (lineToken) {
    try {
        const res = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${lineToken}`,
            },
            body: JSON.stringify({ endpoint: `${serverUrl}/line` }),
        });
        if (res.ok) {
            console.log(`✅ LINE Webhook → ${serverUrl}/line`);
        } else {
            const text = await res.text();
            console.error(`❌ LINE Webhook failed: ${res.status} ${text}`);
        }
    } catch (e) {
        console.error('❌ LINE Webhook error:', e);
    }
}

if (tgToken) {
    try {
        const url = `https://api.telegram.org/bot${tgToken}/setWebhook?url=${encodeURIComponent(`${serverUrl}/telegram`)}`;
        const res = await fetch(url);
        if (res.ok) {
            console.log(`✅ Telegram Webhook → ${serverUrl}/telegram`);
        } else {
            const text = await res.text();
            console.error(`❌ Telegram Webhook failed: ${res.status} ${text}`);
        }
    } catch (e) {
        console.error('❌ Telegram Webhook error:', e);
    }
}
