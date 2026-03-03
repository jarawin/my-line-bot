import type { Bet, LineMessage, UserState } from '../types';
import { assetUrl } from '../utils/asset-url';
import { createPager } from './paginator';
import { SystemState } from '../store/game-state';

// Capacity: compact 30×4×5 = 560 users | normal 15×3×4 = 156 users

const DEFAULT_AVATAR  = assetUrl('default-avatar.webp');
const NODATA_IMAGE_URL = assetUrl('nodata.webp');

function fmtNum(n: number): string {
    return Math.round(n).toLocaleString('en-US');
}

/** Normal row: profile image + colored RED/BLUE badge boxes */
function userRow(user: UserState | undefined, userId: string, red: number, blue: number, isCancelled = false) {
    const profilePic = user?.profilePictureUrl ?? DEFAULT_AVATAR;
    const shortId = user?.shortId ?? userId;

    let nameText = `#u${shortId}`;
    if (user?.displayName) nameText += ` ${user.displayName}`;
    else if (user?.telegramUsername) nameText += ` @${user.telegramUsername}`;

    const redBox = {
        type: 'box',
        layout: 'vertical',
        contents: [{
            type: 'text',
            text: red > 0 ? fmtNum(red) : '-',
            align: 'center',
            size: 'xxs',
            weight: 'bold',
            color: red > 0 ? '#FFFFFF' : '#AAAAAA',
            ...(isCancelled && red > 0 ? { decoration: 'line-through' } : {}),
        }],
        backgroundColor: isCancelled ? (red > 0 ? '#888888' : '#F3F3F3') : (red > 0 ? '#C40C0C' : '#F3F3F3'),
        justifyContent: 'center',
        cornerRadius: '5px',
    };

    const blueBox = {
        type: 'box',
        layout: 'vertical',
        contents: [{
            type: 'text',
            text: blue > 0 ? fmtNum(blue) : '-',
            align: 'center',
            size: 'xxs',
            weight: 'bold',
            color: blue > 0 ? '#FFFFFF' : '#AAAAAA',
            ...(isCancelled && blue > 0 ? { decoration: 'line-through' } : {}),
        }],
        backgroundColor: isCancelled ? (blue > 0 ? '#888888' : '#F3F3F3') : (blue > 0 ? '#0E46A3' : '#F3F3F3'),
        justifyContent: 'center',
        cornerRadius: '5px',
    };

    return {
        type: 'box',
        layout: 'horizontal',
        contents: [
            {
                type: 'box',
                layout: 'horizontal',
                contents: [
                    {
                        type: 'box',
                        layout: 'vertical',
                        contents: [{ type: 'image', url: profilePic, aspectMode: 'cover', size: 'full' }],
                        cornerRadius: '5px',
                        width: '20px',
                        height: '20px',
                    },
                    {
                        type: 'box',
                        layout: 'vertical',
                        contents: [{ type: 'text', text: nameText, size: 'xxs', color: '#555555' }],
                        width: '120px',
                        offsetStart: '5px',
                        offsetEnd: '5px',
                        justifyContent: 'center',
                    },
                ],
                paddingAll: '10px',
            },
            {
                type: 'box',
                layout: 'horizontal',
                contents: [redBox, blueBox],
                spacing: '5px',
                paddingAll: '8px',
            },
        ],
        paddingAll: '0px',
        backgroundColor: '#F3F3F3',
    };
}

/** Compact row: plain text only — no image, no nested boxes (~120 chars/row) */
function userRowCompact(user: UserState | undefined, userId: string, red: number, blue: number, isCancelled = false) {
    const shortId = user?.shortId ?? userId;
    let name = `#u${shortId}`;
    if (user?.displayName) name += ` ${user.displayName}`;
    else if (user?.telegramUsername) name += ` @${user.telegramUsername}`;

    const parts: string[] = [];
    if (red > 0) parts.push(`ด${fmtNum(red)}`);
    if (blue > 0) parts.push(`ง${fmtNum(blue)}`);

    return {
        type: 'text',
        text: `  ${name} | ${parts.join(' ')}`,
        size: 'xs',
        color: isCancelled ? '#888888' : '#555555',
        ...(isCancelled ? { decoration: 'line-through' } : {}),
        margin: 'sm',
    };
}

export function generateCancelOddsBubble(
    roundId: number | string,
    oddsNum: number | string,
): unknown {
    return {
        type: 'bubble',
        size: 'giga',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                {
                    type: 'text',
                    text: 'ยกเลิกราคา',
                    weight: 'bold',
                    size: '4xl',
                    margin: 'md',
                    align: 'center',
                    color: '#FFFFFF',
                    decoration: 'line-through',
                },
                {
                    type: 'text',
                    size: 'xs',
                    color: '#FAFAFA',
                    wrap: true,
                    align: 'center',
                    text: 'แอดมินยกเลิกราคานี้แล้ว เดิมพันทั้งหมดถูกยกเลิก',
                },
                { type: 'separator', margin: 'xxl' },
                {
                    type: 'box',
                    layout: 'horizontal',
                    margin: 'md',
                    contents: [
                        { type: 'text', size: 'xs', color: '#FAFAFA', flex: 0, text: `ยกราคาที่ ${oddsNum}/${roundId}` },
                        { type: 'text', text: ' กด C เพื่อเช็คเครดิต', color: '#FAFAFA', size: 'xs', align: 'end' },
                    ],
                },
            ],
            backgroundColor: '#888888',
        },
        styles: { footer: { separator: true } },
    };
}

export function generateStopBettingBubble(
    roundId: number | string,
    oddsNum: number | string,
): unknown {
    return {
        type: 'bubble',
        size: 'giga',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                {
                    type: 'text',
                    text: 'หยุดเดิมพัน',
                    weight: 'bold',
                    size: '4xl',
                    margin: 'md',
                    align: 'center',
                    color: '#FFFFFF',
                },
                {
                    type: 'text',
                    size: 'xs',
                    color: '#FAFAFA',
                    wrap: true,
                    align: 'center',
                    text: 'แอดมินปิดราคาแล้ว กรุณารอราคาใหม่...',
                },
                { type: 'separator', margin: 'xxl' },
                {
                    type: 'box',
                    layout: 'horizontal',
                    margin: 'md',
                    contents: [
                        { type: 'text', size: 'xs', color: '#FAFAFA', flex: 0, text: `ปิดราคาที่ ${roundId}/${oddsNum}` },
                        { type: 'text', text: ' กด C เพื่อเช็คเครดิต', color: '#FAFAFA', size: 'xs', align: 'end' },
                    ],
                },
            ],
            backgroundColor: '#FA7070',
        },
        styles: { footer: { separator: true } },
    };
}

// ---------------------------------------------------------------------------
// Bubble + message builders (close-odds specific — no LINE header section)
// ---------------------------------------------------------------------------

function buildCloseOddsBubble(bodyRows: unknown[], footer: unknown): unknown {
    return {
        type: 'bubble',
        size: 'mega',
        body: { type: 'box', layout: 'vertical', contents: [...bodyRows, footer], paddingAll: '0px' },
    };
}

function closeOddsPagesToMessages(pages: unknown[][], footer: unknown, altText: string, bubblesPerMsg: number, maxMessages: number): LineMessage[] {
    if (pages.length <= 1) {
        return [{ type: 'flex', altText, contents: buildCloseOddsBubble(pages[0] ?? [], footer) }];
    }
    const messages: LineMessage[] = [];
    for (let start = 0; start < pages.length && messages.length < maxMessages; start += bubblesPerMsg) {
        const chunk = pages.slice(start, start + bubblesPerMsg);
        const bubbles = chunk.map(pageRows => buildCloseOddsBubble(pageRows, footer));
        const contents = bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles };
        messages.push({ type: 'flex', altText, contents });
    }
    return messages;
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export function generateCloseOddsFlex(
    roundId: number | string,
    oddsNum: number | string,
    oddsText: string,
    isOpen: boolean,
    betsForOdds: Bet[],
    users: Map<string, UserState>,
    isCancelled = false,
): LineMessage[] {
    // Runtime compact mode — read from SystemState so ofc=1/ofc=0 takes effect without restart
    const compact = SystemState.oddsCompact;
    const CLOSE_ROWS_PER_BUBBLE = compact ? 27 : 15;
    const CLOSE_BUBBLES_PER_MSG = compact ? 12 : 3;
    const CLOSE_MAX_MESSAGES = compact ? 4 : 4;

    // Accumulate per-user red/blue totals (preserve order of first appearance)
    const userOrder: string[] = [];
    const userTotals = new Map<string, { red: number; blue: number }>();
    let totalRed = 0, totalBlue = 0;

    for (const bet of betsForOdds) {
        if (!userTotals.has(bet.userId)) {
            userTotals.set(bet.userId, { red: 0, blue: 0 });
            userOrder.push(bet.userId);
        }
        const t = userTotals.get(bet.userId)!;
        if (bet.side === 'RED') { t.red += bet.amount; totalRed += bet.amount; }
        else { t.blue += bet.amount; totalBlue += bet.amount; }
    }

    const statusLabel = isCancelled ? 'ยกเลิกแล้ว' : isOpen ? 'เปิดอยู่' : 'ปิดแล้ว';
    const statusColor = isCancelled ? '#C40C0C' : isOpen ? '#27AE60' : '#a1a1a1';

    const mkHeaderRow = (cont: boolean) => ({
        type: 'box',
        layout: 'horizontal',
        contents: [
            {
                type: 'text', size: 'sm', weight: 'bold',
                text: cont ? `สรุปราคา ${oddsText} (ต่อ)` : `สรุปราคา ${oddsText}`,
                color: isCancelled ? '#888888' : '#5a5a5a',
                ...(isCancelled ? { decoration: 'line-through' } : {}),
            },
            {
                type: 'box', layout: 'horizontal', justifyContent: 'flex-end',
                contents: [
                    { type: 'text', size: 'sm', text: statusLabel, color: statusColor, flex: 0 },
                    { type: 'text', size: 'sm', text: `ราคาที่ ${oddsNum}/${roundId}  `, color: '#a1a1a1', flex: 0 },
                ],
            },
        ],
        paddingTop: '10px', paddingStart: '10px', paddingEnd: '10px',
    });

    const separator = { type: 'separator', margin: 'md' };

    const footer = {
        type: 'box', layout: 'horizontal', justifyContent: 'space-between',
        contents: [
            {
                type: 'box', layout: 'vertical', paddingAll: '5px',
                backgroundColor: isCancelled ? '#888888' : '#C40C0C',
                contents: [{ type: 'text', text: `รวมแดง ${fmtNum(totalRed)}`, color: '#FFFFFF', align: 'center', size: 'sm', ...(isCancelled ? { decoration: 'line-through' } : {}) }],
            },
            {
                type: 'box', layout: 'vertical', paddingAll: '5px', justifyContent: 'center',
                backgroundColor: isCancelled ? '#888888' : '#0E46A3',
                contents: [{ type: 'text', text: `รวมน้ำเงิน ${fmtNum(totalBlue)}`, color: '#FFFFFF', align: 'center', size: 'sm', ...(isCancelled ? { decoration: 'line-through' } : {}) }],
            },
        ],
    };

    const altText = isCancelled
        ? `ยกเลิกราคา ${oddsText} ราคาที่ ${oddsNum}/${roundId} | แดง ${fmtNum(totalRed)} น้ำเงิน ${fmtNum(totalBlue)}`
        : `สรุปราคา ${oddsText} ${statusLabel}ที่ ${oddsNum}/${roundId} | แดง ${fmtNum(totalRed)} น้ำเงิน ${fmtNum(totalBlue)}`;

    // ── Paginate user rows ────────────────────────────────────────────────
    const pager = createPager(
        CLOSE_ROWS_PER_BUBBLE,
        CLOSE_MAX_MESSAGES * CLOSE_BUBBLES_PER_MSG,
        [mkHeaderRow(false), separator],
        0,
        () => [mkHeaderRow(true), separator],
    );

    for (const userId of userOrder) {
        if (!pager.fits(1)) {
            if (!pager.newPage()) break;
        }
        const u = users.get(userId);
        const { red, blue } = userTotals.get(userId)!;
        pager.push(compact
            ? userRowCompact(u, userId, red, blue, isCancelled)
            : userRow(u, userId, red, blue, isCancelled));
    }

    if (userOrder.length === 0) {
        pager.push({ type: 'image', url: NODATA_IMAGE_URL, align: 'center', size: 'lg', margin: 'md' });
    }

    return closeOddsPagesToMessages(pager.pages, footer, altText, CLOSE_BUBBLES_PER_MSG, CLOSE_MAX_MESSAGES);
}

