import type { LineMessage, UserState } from '../types';
import { assetUrl } from '../utils/asset-url';
import { createPager } from './paginator';
import { SystemState } from '../store/game-state';

// Capacity: compact 27×12×4=1296 users | normal 15×3×4=180 users

const DEFAULT_AVATAR = assetUrl('default-avatar.webp');
const NODATA_IMAGE_URL = assetUrl('nodata.webp');

const CREDIT_BG = '#1B8A5A';  // emerald green  — credit/cash
const TURNOVER_BG = '#7B3FA0';  // purple          — betting activity

function fmtNum(n: number): string {
    return Math.round(n).toLocaleString('en-US');
}

/** Colored badge box (always shown, even if value is 0) */
function colorBox(value: number, activeBg: string) {
    const hasValue = value > 0;
    return {
        type: 'box',
        layout: 'vertical',
        contents: [{
            type: 'text',
            text: hasValue ? fmtNum(value) : '-',
            align: 'center',
            size: 'xxs',
            weight: 'bold',
            color: hasValue ? '#FFFFFF' : '#AAAAAA',
        }],
        backgroundColor: hasValue ? activeBg : '#F3F3F3',
        justifyContent: 'center',
        cornerRadius: '5px',
    };
}

/** Normal row: profile image + credit box + turnover box */
function userRow(user: UserState) {
    const profilePic = user.profilePictureUrl ?? DEFAULT_AVATAR;
    let nameText = `#u${user.shortId}`;
    if (user.displayName) nameText += ` ${user.displayName}`;
    else if (user.telegramUsername) nameText += ` @${user.telegramUsername}`;

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
                    colorBox(user.credit, CREDIT_BG),
                    colorBox(user.totalTurnover, TURNOVER_BG),
                ],
                spacing: '5px',
                paddingAll: '8px',
            },
        ],
        paddingAll: '0px',
        backgroundColor: '#F3F3F3',
    };
}

/** Compact row: text only — no images */
function userRowCompact(user: UserState) {
    let name = `#u${user.shortId}`;
    if (user.displayName) name += ` ${user.displayName}`;
    else if (user.telegramUsername) name += ` @${user.telegramUsername}`;

    const credit = fmtNum(user.credit);
    const turnover = user.totalTurnover > 0 ? fmtNum(user.totalTurnover) : '-';

    return {
        type: 'text',
        text: `  ${name} | 💳${credit} 🔄${turnover}`,
        size: 'xs',
        color: '#555555',
        margin: 'sm',
    };
}

// ---------------------------------------------------------------------------
// Bubble + message builders
// ---------------------------------------------------------------------------

function buildBubble(bodyRows: unknown[], footer: unknown): unknown {
    return {
        type: 'bubble',
        size: 'mega',
        body: { type: 'box', layout: 'vertical', contents: [...bodyRows, footer], paddingAll: '0px' },
    };
}

function pagesToMessages(
    pages: unknown[][],
    footer: unknown,
    altText: string,
    bubblesPerMsg: number,
    maxMessages: number,
): LineMessage[] {
    if (pages.length <= 1) {
        return [{ type: 'flex', altText, contents: buildBubble(pages[0] ?? [], footer) }];
    }
    const messages: LineMessage[] = [];
    for (let start = 0; start < pages.length && messages.length < maxMessages; start += bubblesPerMsg) {
        const chunk = pages.slice(start, start + bubblesPerMsg);
        const bubbles = chunk.map(pageRows => buildBubble(pageRows, footer));
        const contents = bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles };
        messages.push({ type: 'flex', altText, contents });
    }
    return messages;
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export interface ActiveCreditFlexResult {
    flexes: LineMessage[];
    activeUsers: UserState[];
    totalCredit: number;
    totalTurnover: number;
}

export function generateActiveCreditFlex(activeUsers: UserState[]): ActiveCreditFlexResult {
    const compact = SystemState.acCompact;
    const ROWS_PER_BUBBLE = compact ? 26 : 15;
    const BUBBLES_PER_MSG = compact ? 12 : 3;
    const MAX_MESSAGES = compact ? 4 : 4;

    // Totals
    let totalCredit = 0, totalTurnover = 0;
    for (const u of activeUsers) {
        totalCredit += u.credit;
        totalTurnover += u.totalTurnover;
    }

    const count = activeUsers.length;
    const dateStr = new Date().toLocaleDateString('th-TH', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric', month: 'short', day: 'numeric',
    });

    const mkHeaderRow = (cont: boolean) => ({
        type: 'box',
        layout: 'horizontal',
        contents: [
            {
                type: 'text',
                size: 'sm',
                weight: 'bold',
                text: cont
                    ? `สรุปยอดผู้ใช้งาน (${count} คน) ต่อ`
                    : `สรุปยอดผู้ใช้งาน (${count} คน)`,
                color: '#5a5a5a',
                flex: 2,
            },
            {
                type: 'text',
                size: 'xs',
                text: dateStr,
                color: '#a1a1a1',
                align: 'end',
                flex: 1,
            },
        ],
        paddingTop: '10px',
        paddingStart: '10px',
        paddingEnd: '10px',
    });

    // Column header row (credit | turnover labels)
    const mkColHeader = () => ({
        type: 'box',
        layout: 'horizontal',
        contents: [
            { type: 'box', layout: 'horizontal', contents: [{ type: 'filler' }], paddingAll: '10px' },
            {
                type: 'box',
                layout: 'horizontal',
                contents: [
                    { type: 'text', text: '💳 เครดิต', size: 'xxs', color: '#1B8A5A', align: 'center', weight: 'bold' },
                    { type: 'text', text: '🔄 Turnover', size: 'xxs', color: '#7B3FA0', align: 'center', weight: 'bold' },
                ],
                spacing: '5px',
                paddingAll: '4px',
            },
        ],
        paddingAll: '0px',
        backgroundColor: '#F9F9F9',
    });

    const separator = { type: 'separator', margin: 'md' };

    const footer = {
        type: 'box',
        layout: 'horizontal',
        justifyContent: 'space-between',
        contents: [
            {
                type: 'box',
                layout: 'vertical',
                paddingAll: '5px',
                backgroundColor: CREDIT_BG,
                contents: [{
                    type: 'text',
                    text: `💳 ${fmtNum(totalCredit)}`,
                    color: '#FFFFFF',
                    align: 'center',
                    size: 'sm',
                }],
            },
            {
                type: 'box',
                layout: 'vertical',
                paddingAll: '5px',
                backgroundColor: TURNOVER_BG,
                justifyContent: 'center',
                contents: [{
                    type: 'text',
                    text: `🔄 ${fmtNum(totalTurnover)}`,
                    color: '#FFFFFF',
                    align: 'center',
                    size: 'sm',
                }],
            },
        ],
    };

    const altText = `สรุปยอดผู้ใช้งาน ${count} คน | เครดิตรวม ${fmtNum(totalCredit)} | Turnover ${fmtNum(totalTurnover)}`;

    const initRows = compact
        ? [mkHeaderRow(false)]
        : [mkHeaderRow(false), separator, mkColHeader()];

    const makeContHdr = compact
        ? () => [mkHeaderRow(true)]
        : () => [mkHeaderRow(true), separator, mkColHeader()];

    const pager = createPager(
        ROWS_PER_BUBBLE,
        MAX_MESSAGES * BUBBLES_PER_MSG,
        initRows,
        0,
        makeContHdr,
    );

    for (const user of activeUsers) {
        if (!pager.fits(1)) {
            if (!pager.newPage()) break;
        }
        pager.push(compact ? userRowCompact(user) : userRow(user));
    }

    if (activeUsers.length === 0) {
        pager.push({ type: 'image', url: NODATA_IMAGE_URL, align: 'center', size: 'lg', margin: 'md' });
    }

    const flexes = pagesToMessages(pager.pages, footer, altText, BUBBLES_PER_MSG, MAX_MESSAGES);
    return { flexes, activeUsers, totalCredit, totalTurnover };
}
