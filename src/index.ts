import { loadSystemState } from './store/persistence';
import { closeDb } from './store/db';
import { SystemState } from './store/game-state';
import { handleLineWebhook } from './platform/line';
import { handleTelegramWebhook } from './platform/telegram';
import { EXPORT_DIR, BACKUP_DIR, IMAGE_DIR } from './config/paths';
import { printBoot, printShutdownStart, printShutdownDone } from './utils/logger';

const port = process.env.PORT || 3000;

const t0 = Date.now();
loadSystemState();

const r = SystemState.currentRound;
const roundInfo = r
    ? `round #${r.id} ${r.status}${r.bets.length ? ` (${r.bets.length} bets)` : ''}`
    : 'no active round';

printBoot(port, Date.now() - t0, SystemState.users.size, SystemState.allowedGroups.size, roundInfo);

function gracefulShutdown(signal: string): void {
    printShutdownStart(signal);
    try { closeDb(); } catch { /* already swallowed inside closeDb */ }
    printShutdownDone();
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default {
    port,
    async fetch(req: Request) {
        const url = new URL(req.url);

        if (req.method === 'GET' && url.pathname.startsWith('/img/')) {
            const filename = url.pathname.slice(5);
            if (!filename || filename.includes('/') || filename.includes('..')) {
                return new Response('Not Found', { status: 404 });
            }
            const ext = filename.split('.').pop()?.toLowerCase();
            const mimeType =
                ext === 'webp' ? 'image/webp' :
                    ext === 'png' ? 'image/png' :
                        'image/jpeg';
            const file = Bun.file(`${IMAGE_DIR}/${filename}`);
            if (!(await file.exists())) return new Response('Not Found', { status: 404 });
            return new Response(file, {
                headers: { 'Content-Type': mimeType, 'Cache-Control': 'public, max-age=86400' },
            });
        }

        if (req.method === 'GET' && url.pathname.startsWith('/export/')) {
            const filename = url.pathname.slice(8);
            if (!filename || filename.includes('/') || filename.includes('..')) {
                return new Response('Not Found', { status: 404 });
            }
            const file = Bun.file(`${EXPORT_DIR}/${filename}`);
            if (!(await file.exists())) return new Response('Not Found', { status: 404 });
            return new Response(file, {
                headers: {
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'Content-Disposition': `attachment; filename="${filename}"`,
                },
            });
        }

        // ตัดนามสกุล .zip ออกจาก URL เพราะ LINE ปฏิเสธ URI action ที่ชี้ไปยัง .zip
        if (req.method === 'GET' && url.pathname.startsWith('/backup/')) {
            const name = url.pathname.slice(8);
            if (!name || name.includes('/') || name.includes('..')) {
                return new Response('Not Found', { status: 404 });
            }
            const zipFilename = name.endsWith('.zip') ? name : `${name}.zip`;
            const file = Bun.file(`${BACKUP_DIR}/${zipFilename}`);
            if (!(await file.exists())) return new Response('Not Found', { status: 404 });
            return new Response(file, {
                headers: {
                    'Content-Type': 'application/zip',
                    'Content-Disposition': `attachment; filename="${zipFilename}"`,
                },
            });
        }

        if (req.method === 'GET') return new Response('Bot Ready Now!');

        if (req.method === 'POST' && url.pathname === '/line') {
            return handleLineWebhook(req);
        }

        if (req.method === 'POST' && url.pathname === '/telegram') {
            return handleTelegramWebhook(req);
        }

        return new Response('Not Found', { status: 404 });
    },
};
