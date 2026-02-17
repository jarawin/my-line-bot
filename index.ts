// index.ts
const port = process.env.PORT || 3000;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN!;

// --- 🎨 LOGGING HELPERS (จัดหน้าตา Log) ---
const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
    bold: "\x1b[1m"
};

// จัดตัวเลขให้ชิดขวาเสมอ (เช่น "  5ms", "120ms")
const pad = (num: number, size: number = 4) => num.toString().padStart(size, ' ');

// สร้าง Log Bar สวยๆ
function printLog(
    wID: number, eID: number, totalE: number,
    msg: string,
    transMs: number, procMs: number, replyMs: number,
    isSuccess: boolean
) {
    const totalMs = transMs + procMs + replyMs;

    // เลือกสีตามความช้า/เร็ว
    let latencyColor = colors.green;
    if (totalMs > 1000) latencyColor = colors.red;
    else if (totalMs > 500) latencyColor = colors.yellow;

    const statusIcon = isSuccess ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
    const cleanMsg = msg.replace(/\n/g, ' ').substring(0, 20); // ตัดข้อความไม่ให้ยาวเกิน

    console.log(
        `${colors.dim}[W${wID}-E${eID}/${totalE}]${colors.reset} ` +
        `${statusIcon} ` +
        `${colors.cyan}📡 In:${pad(transMs)}ms${colors.reset} | ` +
        `${colors.yellow}⚡ Proc:${pad(procMs)}ms${colors.reset} | ` +
        `${colors.green}📤 Out:${pad(replyMs)}ms${colors.reset} | ` +
        `${latencyColor}⏱ Total:${pad(totalMs)}ms${colors.reset} ` +
        `→ "${colors.bold}${cleanMsg}${colors.reset}"`
    );
}


// จำลองฟังก์ชันตอบกลับ LINE (Network Bound)
async function replyMessage(replyToken: string, text: string): Promise<{ replyMs: number; replyOk: boolean }> {
    const t0 = Date.now();
    try {
        const response = await fetch("https://api.line.me/v2/bot/message/reply", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
            },
            body: JSON.stringify({
                replyToken,
                messages: [{ type: "text", text }],
            }),
        });
        return { replyMs: Date.now() - t0, replyOk: response.ok };
    } catch (e) {
        return { replyMs: Date.now() - t0, replyOk: false };
    }
}

// จำลองฟังก์ชันประมวลผลเดิมพัน (CPU Bound / In-Memory)
async function processEvent(event: any): Promise<{ procMs: number; resultText: string }> {
    const t0 = Date.now();

    // --- ใส่ Logic เดิมพันตรงนี้ ---
    // เช่น ตัดเงิน, เช็คยอด, บันทึกผล

    const userText = event.message.text;
    const resultText = `รับผล: ${userText}`;
    return { procMs: Date.now() - t0, resultText };
}

// --- 🚀 SERVER ---
console.log(`🚀 High-Speed Bot Server started on port ${port}...`);
let webhookCount = 0;

export default {
    port: port,
    async fetch(req: Request) {
        // 1. Health Check
        if (req.method === "GET") return new Response("Bot Ready!");

        // 2. Webhook Handler
        if (req.method === "POST" && new URL(req.url).pathname === "/callback") {
            const serverReceiveTime = Date.now();
            webhookCount++;

            try {
                const body = await req.json() as { events: any[] };
                const events = body.events || [];
                const eventSize = events.length;

                if (eventSize === 0) return new Response("OK");
                const tasks = events.map(async (event, index) => {
                    const eventIndex = index + 1;

                    if (event.type !== 'message' || event.message.type !== 'text') {
                        return;
                    }

                    const transMs = serverReceiveTime - event.timestamp;
                    const { procMs, resultText } = await processEvent(event);

                    const { replyMs, replyOk } = await replyMessage(event.replyToken, resultText);
                    printLog(
                        webhookCount, eventIndex, eventSize,
                        event.message.text,
                        transMs, procMs, replyMs,
                        replyOk
                    );
                });

                await Promise.all(tasks);
                return new Response("OK");

            } catch (err) {
                console.error(`[ERROR] Webhook processing failed:`, err);
                return new Response("Error", { status: 500 });
            }
        }

        return new Response("Not Found", { status: 404 });
    },
};