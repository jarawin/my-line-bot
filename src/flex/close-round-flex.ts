import type { Bet, LineMessage, UserState } from '../types';
import { assetUrl } from '../utils/asset-url';
import { createPager } from './paginator';
import { SystemState } from '../store/game-state';

// Capacity: compact 27×12×4=1296 users | normal 15×3×4=180 users

const DEFAULT_AVATAR   = assetUrl('default-avatar.webp');
const NODATA_IMAGE_URL = assetUrl('nodata.webp');

function fmtNum(n: number): string {
    return Math.round(Math.abs(n)).toLocaleString('en-US');
}

function fmtSign(n: number): string {
    return (n >= 0 ? '+' : '-') + fmtNum(n);
}

/** Colored badge showing net P&L. */
function netBox(net: number, color: string) {
    const text = net === 0 ? '0' : fmtSign(net);
    return {
        type: 'box',
        layout: 'vertical',
        contents: [{
            type: 'text',
            text,
            align: 'center',
            size: 'xxs',
            weight: 'bold',
            color: '#FFFFFF',
        }],
        backgroundColor: color,
        justifyContent: 'center',
        cornerRadius: '5px',
    };
}

/** Normal row: profile image + colored netBox badges */
function userRow(
    user: UserState | undefined,
    userId: string,
    redNet: number,
    blueNet: number,
    redColor: string = '#C40C0C',
    blueColor: string = '#0E46A3',
) {
    const profilePic = user?.profilePictureUrl ?? DEFAULT_AVATAR;
    const shortId = user?.shortId ?? userId;

    let nameText = `#u${shortId}`;
    if (user?.displayName) nameText += ` ${user.displayName}`;
    else if (user?.telegramUsername) nameText += ` @${user.telegramUsername}`;

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
                contents: [
                    netBox(redNet, redColor),
                    netBox(blueNet, blueColor),
                ],
                spacing: '5px',
                paddingAll: '8px',
            },
        ],
        paddingAll: '0px',
        backgroundColor: '#F3F3F3',
    };
}

/** Compact row: plain text only — no image, no nested boxes */
function userRowCompact(
    user: UserState | undefined,
    userId: string,
    redNet: number,
    blueNet: number,
    isCancelled = false,
) {
    const shortId = user?.shortId ?? userId;
    let name = `#u${shortId}`;
    if (user?.displayName) name += ` ${user.displayName}`;
    else if (user?.telegramUsername) name += ` @${user.telegramUsername}`;

    return {
        type: 'text',
        text: `${name}  ด${fmtSign(redNet)} ง${fmtSign(blueNet)}`,
        size: 'xs',
        color: isCancelled ? '#888888' : '#555555',
        margin: 'sm',
        ...(isCancelled ? { decoration: 'line-through' } : {}),
    };
}

// ---------------------------------------------------------------------------
// Bubble + message builders (no LINE header section)
// ---------------------------------------------------------------------------

function buildCloseRoundBubble(bodyRows: unknown[], footer: unknown | null): unknown {
    const contents = footer !== null ? [...bodyRows, footer] : [...bodyRows];
    return {
        type: 'bubble',
        size: 'mega',
        body: { type: 'box', layout: 'vertical', contents, paddingAll: '0px' },
    };
}

function closeRoundPagesToMessages(
    pages: unknown[][],
    footer: unknown | null,
    altText: string,
    bubblesPerMsg: number,
    maxMessages: number,
): LineMessage[] {
    if (pages.length <= 1) {
        return [{ type: 'flex', altText, contents: buildCloseRoundBubble(pages[0] ?? [], footer) }];
    }
    const messages: LineMessage[] = [];
    for (let start = 0; start < pages.length && messages.length < maxMessages; start += bubblesPerMsg) {
        const chunk = pages.slice(start, start + bubblesPerMsg);
        const bubbles = chunk.map(pageRows => buildCloseRoundBubble(pageRows, footer));
        const contents = bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles };
        messages.push({ type: 'flex', altText, contents });
    }
    return messages;
}

// ---------------------------------------------------------------------------
// Announcement bubbles (unchanged)
// ---------------------------------------------------------------------------

export function generateResultAnnouncementBubble(roundId: number | string, winner: 'RED' | 'BLUE' | 'DRAW'): unknown {
    const winnerText = winner === 'RED' ? 'แดงชนะ' : winner === 'BLUE' ? 'น้ำเงินชนะ' : 'เสมอ';
    const winnerIcon = winner === 'RED' ? '🔴' : winner === 'BLUE' ? '🔵' : '🤝';
    const bgColor = winner === 'RED' ? '#C40C0C' : winner === 'BLUE' ? '#0E46A3' : '#888888';

    return {
        type: 'bubble',
        size: 'giga',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                {
                    type: 'text',
                    text: `${winnerIcon} ${winnerText}`,
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
                    text: 'แอดมินประกาศผลแล้ว กด Y เพื่อจ่ายเงิน',
                },
                { type: 'separator', margin: 'xxl' },
                {
                    type: 'box',
                    layout: 'horizontal',
                    margin: 'md',
                    contents: [
                        { type: 'text', size: 'xs', color: '#FAFAFA', flex: 0, text: `รอบที่ ${roundId}` },
                        { type: 'text', text: ' กด C เพื่อเช็คเครดิต', color: '#FAFAFA', size: 'xs', align: 'end' },
                    ],
                },
            ],
            backgroundColor: bgColor,
        },
        styles: { footer: { separator: true } },
    };
}

export function generateCloseRoundBubble(roundId: number | string): unknown {
    return {
        type: 'bubble',
        size: 'giga',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                {
                    type: 'text',
                    text: 'ปิดรอบแล้ว',
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
                    text: 'แอดมินปิดรอบแล้ว กรุณารอประกาศผล...',
                },
                { type: 'separator', margin: 'xxl' },
                {
                    type: 'box',
                    layout: 'horizontal',
                    margin: 'md',
                    contents: [
                        { type: 'text', size: 'xs', color: '#FAFAFA', flex: 0, text: `ปิดรอบที่ ${roundId}` },
                        { type: 'text', text: ' กด C เพื่อเช็คเครดิต', color: '#FAFAFA', size: 'xs', align: 'end' },
                    ],
                },
            ],
            backgroundColor: '#FA7070',
        },
        styles: { footer: { separator: true } },
    };
}

export function generateReverseRoundBubble(roundId: number | string, previousResult: string): unknown {
    return {
        type: 'bubble',
        size: 'giga',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                {
                    type: 'text',
                    text: '♻️ ย้อนกลับรอบ',
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
                    text: `ยกเลิกผลลัพธ์ ${previousResult} แล้ว สามารถสรุปผลใหม่ได้`,
                },
                { type: 'separator', margin: 'xxl' },
                {
                    type: 'box',
                    layout: 'horizontal',
                    margin: 'md',
                    contents: [
                        { type: 'text', size: 'xs', color: '#FAFAFA', flex: 0, text: `ย้อนกลับรอบ #r${roundId}` },
                        { type: 'text', text: ' ตั้งผลด้วย Sด/Sง/Sส', color: '#FAFAFA', size: 'xs', align: 'end' },
                    ],
                },
            ],
            backgroundColor: '#888888',
        },
        styles: { footer: { separator: true } },
    };
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export interface CloseRoundFlexResult {
    flexes: LineMessage[];
    /** House net if red wins (for fallback text / notify) */
    houseRedNet: number;
    /** House net if blue wins (for fallback text / notify) */
    houseBlueNet: number;
    /** Per-user predictions: userId → { redNet, blueNet } */
    userNets: Map<string, { redNet: number; blueNet: number }>;
    userOrder: string[];
}

export function generateCloseRoundFlex(
    roundId: number | string,
    activeBets: Bet[],
    users: Map<string, UserState>,
    isOpen: boolean = false,
    winner?: 'RED' | 'BLUE' | 'DRAW',
    isCancelled: boolean = false,
    hideFooter: boolean = false,
): CloseRoundFlexResult {
    // Runtime compact mode — rfc=1/rfc=0 toggles without restart
    const compact = SystemState.roundCompact;
    const ROUND_ROWS_PER_BUBBLE = compact ? 27 : 15;
    const ROUND_BUBBLES_PER_MSG = compact ? 12 : 3;
    const ROUND_MAX_MESSAGES    = compact ? 4  : 4;

    // ── Compute per-user net P&L ─────────────────────────────────────────
    let userOrder: string[] = [];
    const userNets = new Map<string, { redNet: number; blueNet: number }>();

    for (const bet of activeBets) {
        if (!userNets.has(bet.userId)) {
            userNets.set(bet.userId, { redNet: 0, blueNet: 0 });
            userOrder.push(bet.userId);
        }
        const t = userNets.get(bet.userId)!;
        if (bet.side === 'RED') {
            t.redNet  += bet.winAmount;
            t.blueNet -= bet.lossAmount;
        } else {
            t.blueNet += bet.winAmount;
            t.redNet  -= bet.lossAmount;
        }
    }

    // ── House net ────────────────────────────────────────────────────────
    let houseRedNet = 0, houseBlueNet = 0;
    for (const bet of activeBets) {
        if (bet.side === 'RED') {
            houseRedNet  -= bet.winAmount;
            houseBlueNet += bet.lossAmount;
        } else {
            houseBlueNet -= bet.winAmount;
            houseRedNet  += bet.lossAmount;
        }
    }

    // ── Sort by winner outcome ───────────────────────────────────────────
    if (winner && winner !== 'DRAW') {
        userOrder = userOrder.sort((a, b) => {
            const aNet = winner === 'RED' ? userNets.get(a)!.redNet : userNets.get(a)!.blueNet;
            const bNet = winner === 'RED' ? userNets.get(b)!.redNet : userNets.get(b)!.blueNet;
            return bNet - aNet;
        });
    }

    // ── Header text ──────────────────────────────────────────────────────
    let headerText = 'สรุปผลแพ้ชนะ (คาดการณ์)';
    let headerColor = '#5a5a5a';
    let headerDecoration: 'line-through' | undefined;

    if (isCancelled) {
        headerText = 'ย้อนกลับรอบ (ยกเลิกแล้ว)';
        headerColor = '#888888';
        headerDecoration = 'line-through';
    } else if (winner === 'RED') {
        headerText = 'สรุปผลแพ้ชนะ (แดงชนะ)';
        headerColor = '#C40C0C';
    } else if (winner === 'BLUE') {
        headerText = 'สรุปผลแพ้ชนะ (น้ำเงินชนะ)';
        headerColor = '#0E46A3';
    } else if (winner === 'DRAW') {
        headerText = 'สรุปผลแพ้ชนะ (เสมอ)';
        headerColor = '#888888';
    }

    const statusLabel = isCancelled ? 'ยกเลิกแล้ว' : isOpen ? 'เปิดอยู่' : 'ปิดแล้ว';
    const statusColor = isCancelled ? '#C40C0C' : isOpen ? '#27AE60' : '#a1a1a1';

    const mkHeaderRow = (cont: boolean) => ({
        type: 'box',
        layout: 'horizontal',
        contents: [
            {
                type: 'text',
                size: 'sm',
                text: cont ? `${headerText} (ต่อ)` : headerText,
                weight: 'bold',
                color: headerColor,
                flex: 2,
                ...(headerDecoration ? { decoration: headerDecoration } : {}),
            },
            {
                type: 'box', layout: 'horizontal', flex: 1,
                justifyContent: 'flex-end',
                contents: [
                    { type: 'text', size: 'sm', text: statusLabel, color: statusColor, flex: 0 },
                    { type: 'text', size: 'sm', text: `รอบที่ ${roundId}`, color: '#a1a1a1', flex: 0 },
                ],
            },
        ],
        paddingTop: '10px',
        paddingStart: '10px',
        paddingEnd: '10px',
        flex: 3,
    });

    const separator = { type: 'separator', margin: 'md' };

    // ── Net box colors ───────────────────────────────────────────────────
    const redColor  = isCancelled ? '#CCCCCC' : (winner === 'BLUE' || winner === 'DRAW') ? '#CCCCCC' : '#C40C0C';
    const blueColor = isCancelled ? '#CCCCCC' : (winner === 'RED'  || winner === 'DRAW') ? '#CCCCCC' : '#0E46A3';

    // ── Footer ───────────────────────────────────────────────────────────
    const footerRedBg  = isCancelled ? '#CCCCCC' : (winner === 'BLUE' || winner === 'DRAW') ? '#CCCCCC' : '#C40C0C';
    const footerBlueBg = isCancelled ? '#CCCCCC' : (winner === 'RED'  || winner === 'DRAW') ? '#CCCCCC' : '#0E46A3';

    const footer = {
        type: 'box',
        layout: 'horizontal',
        contents: [
            {
                type: 'box',
                layout: 'vertical',
                contents: [{ type: 'text', text: `แดงชนะ ${fmtSign(houseRedNet)}`, color: '#FFFFFF', align: 'center', size: 'sm' }],
                backgroundColor: footerRedBg,
                paddingAll: '5px',
            },
            {
                type: 'box',
                layout: 'vertical',
                contents: [{ type: 'text', text: `น้ำเงินชนะ ${fmtSign(houseBlueNet)}`, color: '#FFFFFF', align: 'center', size: 'sm' }],
                backgroundColor: footerBlueBg,
                justifyContent: 'center',
                paddingAll: '5px',
            },
        ],
        justifyContent: 'space-between',
    };

    // ── Alt text ─────────────────────────────────────────────────────────
    const altText = `${isOpen ? 'เปิดอยู่' : 'ปิดแล้ว'}รอบที่ ${roundId} | แดงชนะ ${fmtSign(houseRedNet)} น้ำเงินชนะ ${fmtSign(houseBlueNet)}`;

    // ── Paginate user rows ────────────────────────────────────────────────
    const initRows  = compact ? [mkHeaderRow(false)]         : [mkHeaderRow(false), separator];
    const makeContHdr = compact ? () => [mkHeaderRow(true)]  : () => [mkHeaderRow(true), separator];

    const pager = createPager(
        ROUND_ROWS_PER_BUBBLE,
        ROUND_MAX_MESSAGES * ROUND_BUBBLES_PER_MSG,
        initRows,
        0,
        makeContHdr,
    );

    for (const userId of userOrder) {
        if (!pager.fits(1)) {
            if (!pager.newPage()) break;
        }
        const user = users.get(userId);
        const { redNet, blueNet } = userNets.get(userId)!;
        pager.push(compact
            ? userRowCompact(user, userId, redNet, blueNet, isCancelled)
            : userRow(user, userId, redNet, blueNet, redColor, blueColor));
    }

    if (userOrder.length === 0) {
        pager.push({ type: 'image', url: NODATA_IMAGE_URL, align: 'center', size: 'lg', margin: 'md' });
    }

    const flexes = closeRoundPagesToMessages(pager.pages, hideFooter ? null : footer, altText, ROUND_BUBBLES_PER_MSG, ROUND_MAX_MESSAGES);

    return { flexes, houseRedNet, houseBlueNet, userNets, userOrder };
}
