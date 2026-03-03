const colors = {
    reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
    yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m',
};
const B = colors.bold, R = colors.reset, G = colors.green, Y = colors.yellow, C = colors.cyan;

export function printBoot(port: string | number, ms: number, users: number, groups: number, roundInfo: string): void {
    console.log(`${B}${G}━━ BOOT${R}  🐂 Blue Bull Bot  port=${port}`);
    console.log(`${G}     ✓${R} ${C}State${R}  ${users} users · ${groups} groups · ${roundInfo}`);
    console.log(`${G}     ✓${R} ${C}Ready${R}  in ${ms}ms`);
}

export function printShutdownStart(signal: string): void {
    console.log(`\n${Y}━━ DOWN${R}  ${signal}`);
}

export function printShutdownDone(): void {
    console.log(`${Y}     ✓${R} WAL checkpoint · DB closed`);
}
const pad = (n: number, size = 4) => n.toString().padStart(size, ' ');

let webhookCount = 0;

export function nextWebhookId(): number {
    return ++webhookCount;
}

export function printLog(
    platform: string, wID: number, eID: number, totalE: number,
    msg: string, transMs: number, procMs: number, replyMs: number, ok: boolean,
) {
    const totalMs = transMs + procMs + replyMs;
    const latencyColor = totalMs > 1000 ? colors.red : totalMs > 500 ? colors.yellow : colors.green;
    const status = ok ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
    const cleanMsg = msg.replace(/\n/g, ' ').substring(0, 20);
    console.log(
        `${colors.dim}[${platform}][W${wID}-E${eID}-${totalE}]${colors.reset} ${status} ` +
        `${colors.cyan}📡 In:${pad(transMs)}ms${colors.reset} | ` +
        `${colors.yellow}⚡ Proc:${pad(procMs)}ms${colors.reset} | ` +
        `${colors.green}📤 Out:${pad(replyMs)}ms${colors.reset} | ` +
        `${latencyColor}⏱ Total:${pad(totalMs)}ms${colors.reset} ` +
        `→ "${colors.bold}${cleanMsg}${colors.reset}"`
    );
}
