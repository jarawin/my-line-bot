import { getOrCreateUser } from './store/game-state';
import { loadSystemState, getLastTransactions } from './store/persistence';
import { placeBet } from './commands/place-bet';
import { openRound, closeRound, setResult, openOdds, closeOdds, confirmSettlement, resetSystem, cmdCancelOdds, cmdReverseRound } from './commands/admin';
import { manageCredit, setRole, claimFoundingMaster } from './commands/user-manager';
import { cmdUserList, cmdBettingBoard, cmdListAdmins } from './commands/info';

const port = process.env.PORT || 3000;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN!;

loadSystemState();

console.log(`🚀 High-Speed Betting Bot started on port ${port}...`);

let webhookCount = 0;

// --- LOGGING ---
const colors = {
    reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
    yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m',
};
const pad = (n: number, size = 4) => n.toString().padStart(size, ' ');

function printLog(
    wID: number, eID: number, totalE: number,
    msg: string, transMs: number, procMs: number, replyMs: number, ok: boolean
) {
    const totalMs = transMs + procMs + replyMs;
    const latencyColor = totalMs > 1000 ? colors.red : totalMs > 500 ? colors.yellow : colors.green;
    const status = ok ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
    const cleanMsg = msg.replace(/\n/g, ' ').substring(0, 20);
    console.log(
        `${colors.dim}[W${wID}-E${eID}/${totalE}]${colors.reset} ${status} ` +
        `${colors.cyan}📡 In:${pad(transMs)}ms${colors.reset} | ` +
        `${colors.yellow}⚡ Proc:${pad(procMs)}ms${colors.reset} | ` +
        `${colors.green}📤 Out:${pad(replyMs)}ms${colors.reset} | ` +
        `${latencyColor}⏱ Total:${pad(totalMs)}ms${colors.reset} ` +
        `→ "${colors.bold}${cleanMsg}${colors.reset}"`
    );
}

// --- CORE ---
async function replyMessage(
    replyToken: string, text: string, quoteToken?: string
): Promise<{ replyMs: number; replyOk: boolean }> {
    const t0 = Date.now();
    try {
        const message: Record<string, string> = { type: 'text', text };
        if (quoteToken) message.quoteToken = quoteToken;
        const res = await fetch('https://api.line.me/v2/bot/message/reply', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
            },
            body: JSON.stringify({ replyToken, messages: [message] }),
        });
        return { replyMs: Date.now() - t0, replyOk: res.ok };
    } catch {
        return { replyMs: Date.now() - t0, replyOk: false };
    }
}

const BET_RE          = /^([ดง])\s*(\d+)$|^(\d+)\s*([ดง])$/;
const OPEN_ODDS_RE    = /^[ดง](\/[\d.]+){2}/;
const RESULT_RE       = /^[sS]([ดงส])$/;
const CREDIT_RE       = /^#u(\d+)[+\-=](\d+)$/;
const ROLE_RE         = /^(admin|master|customer)\s+#u(\d+)$/i;
const CANCEL_ODDS_RE  = /^ยก(\d+)?$/;
const REVERSE_RE      = /^[rR](\d+)?$/;

// ย่อชื่อประเภท transaction สำหรับแสดงผล
const TX_ABBR: Record<string, string> = {
    DEPOSIT: 'DEP', WITHDRAW: 'WDR', BET_WIN: 'WIN',
    BET_LOSS: 'LSS', REFUND: 'REF', ADJUSTMENT: 'ADJ',
};

function tryAdmin(text: string): string | null {
    try {
        const t = text.toLowerCase();
        if (t === 'o')               return openRound();
        if (t === 'x')               return closeRound();
        if (t === 'y')               return confirmSettlement();
        if (t === 'rs')              return resetSystem();
        if (t === 'u')               return cmdUserList();
        if (t === 'b')               return cmdBettingBoard();
        if (t === 'admins')          return cmdListAdmins();
        if (OPEN_ODDS_RE.test(text)) return openOdds(text);
        if (t === 'ป' || t === 'ปด') return closeOdds();
        const mr = text.match(RESULT_RE);
        if (mr) {
            const w = mr[1] === 'ด' ? 'RED' : mr[1] === 'ง' ? 'BLUE' : 'DRAW';
            return setResult(w);
        }
    } catch (e: any) {
        return `❌ [Admin] ${e.message}`;
    }
    return null;
}

// ประมวลผล command จาก user — synchronous เพื่อ zero race condition
function processEvent(event: any): { procMs: number; resultText: string } {
    const t0 = Date.now();
    const userId: string = event.source.userId;
    const text: string   = event.message.text.trim();

    let resultText: string;
    const sender = getOrCreateUser(userId);
    const isPrivileged = sender.role === 'ADMIN' || sender.role === 'MASTER';

    // ─── Security gate: credit & role management ─────────────────────────────
    if (CREDIT_RE.test(text) || ROLE_RE.test(text)) {
        if (!isPrivileged) return { procMs: Date.now() - t0, resultText: '❌ ไม่มีสิทธิ์ใช้คำสั่งนี้' };
        try {
            resultText = CREDIT_RE.test(text) ? manageCredit(text) : setRole(text);
        } catch (e: any) {
            resultText = `❌ ${e.message}`;
        }
        return { procMs: Date.now() - t0, resultText };
    }

    // ─── Security gate: ยก / R ───────────────────────────────────────────────
    if (CANCEL_ODDS_RE.test(text) || REVERSE_RE.test(text)) {
        if (!isPrivileged) return { procMs: Date.now() - t0, resultText: '❌ ไม่มีสิทธิ์ใช้คำสั่งนี้' };
        try {
            resultText = CANCEL_ODDS_RE.test(text) ? cmdCancelOdds(text) : cmdReverseRound(text);
        } catch (e: any) {
            resultText = `❌ ${e.message}`;
        }
        return { procMs: Date.now() - t0, resultText };
    }

    // ─── fm: Founding Master bootstrap ──────────────────────────────────────
    if (text.toLowerCase() === 'fm') {
        return { procMs: Date.now() - t0, resultText: claimFoundingMaster(userId) };
    }

    // ─── General commands ────────────────────────────────────────────────────
    const adminResult = tryAdmin(text);
    if (adminResult !== null) {
        resultText = adminResult;
    } else if (text.toLowerCase() === 'c') {
        const user = sender;
        const roleIcon = user.role === 'MASTER' ? '👑' : user.role === 'ADMIN' ? '🔑' : '👤';
        const txs  = getLastTransactions(userId, 5);
        const txSection = txs.length > 0
            ? '\n📜 Last Tx:\n' + txs.map(tx => {
                const sign = tx.amount > 0 ? '+' : '';
                const ref  = tx.ref_id ? ` ${tx.ref_id}` : '';
                return `${sign}${tx.amount} ${TX_ABBR[tx.type] ?? tx.type}${ref}`;
            }).join('\n')
            : '';
        resultText = [
            `${roleIcon} #u${user.shortId} [${user.role}]`,
            `💰 เครดิต: ${user.credit}`,
            `🔒 วงเงินที่กัน: ${user.creditHold}`,
            `✅ ใช้ได้: ${user.credit - user.creditHold}`,
            `🔴 Net แดง: ${user.currentRoundRedNet}`,
            `🔵 Net น้ำเงิน: ${user.currentRoundBlueNet}`,
        ].join('\n') + txSection;
    } else {
        const m = text.match(BET_RE);
        if (m) {
            const sideChar = (m[1] ?? m[4])!;
            const amount   = parseInt(m[2] ?? m[3]!, 10);
            const side     = sideChar === 'ด' ? 'RED' : 'BLUE';
            const sideName = side === 'RED' ? 'แดง' : 'น้ำเงิน';
            try {
                const result = placeBet(userId, side, amount);
                const lines = [
                    `✅ แทง${sideName} ${result.amount} สำเร็จ`,
                    `   ได้: ${result.impact.winAmount}  |  เสีย: ${result.impact.lossAmount}`,
                    `💰 วงเงินที่กัน: ${result.impact.newCreditHold}`,
                    `💵 เครดิตที่ใช้ได้: ${result.availableCredit}`,
                ];
                if (result.warning) lines.unshift(result.warning);
                resultText = lines.join('\n');
            } catch (e: any) {
                resultText = `❌ ${e.message}`;
            }
        } else {
            resultText = `ไม่รู้จักคำสั่ง\nแทงแดง: "ด100"  แทงน้ำเงิน: "ง100"\nดูยอด: "c"`;
        }
    }

    return { procMs: Date.now() - t0, resultText };
}

// --- SERVER ---
export default {
    port,
    async fetch(req: Request) {
        if (req.method === 'GET') return new Response('Bot Ready!');

        if (req.method === 'POST' && new URL(req.url).pathname === '/callback') {
            const serverReceiveTime = Date.now();
            webhookCount++;

            try {
                const body = await req.json() as { events: any[] };
                const events = body.events ?? [];
                const eventSize = events.length;

                if (eventSize === 0) return new Response('OK');

                const tasks = events.map(async (event, index) => {
                    if (event.type !== 'message' || event.message.type !== 'text') return;

                    const transMs    = serverReceiveTime - event.timestamp;
                    const quoteToken: string | undefined = event.message.quoteToken;
                    const { procMs, resultText } = processEvent(event);
                    const { replyMs, replyOk }   = await replyMessage(event.replyToken, resultText, quoteToken);

                    printLog(webhookCount, index + 1, eventSize, event.message.text, transMs, procMs, replyMs, replyOk);
                });

                await Promise.all(tasks);
                return new Response('OK');

            } catch (err) {
                console.error('[ERROR]', err);
                return new Response('Error', { status: 500 });
            }
        }

        return new Response('Not Found', { status: 404 });
    },
};
