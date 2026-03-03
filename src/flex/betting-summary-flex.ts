import type { LineMessage, UserState } from '../types';
import { assetUrl } from '../utils/asset-url';
import { createPager } from './paginator';
import { SystemState } from '../store/game-state';

// Capacity: compact 26×12×4=1248 users | normal 15×3×4=180 users

const DEFAULT_AVATAR   = assetUrl('default-avatar.webp');
const NODATA_IMAGE_URL = assetUrl('nodata.webp');

const CREDIT_BG  = '#1D6FA4';  // blue  — credit
const WIN_BG     = '#1B8A5A';  // green — positive net P/L
const LOSS_BG    = '#C0392B';  // red   — negative net P/L
const NEUTRAL_BG = '#888888';  // gray  — zero net P/L

function fmtNum(n: number): string {
    return Math.round(n).toLocaleString('en-US');
}

function netBg(net: number): string {
    if (net > 0) return WIN_BG;
    if (net < 0) return LOSS_BG;
    return NEUTRAL_BG;
}

function fmtNet(net: number): string {
    if (net > 0) return `+${fmtNum(net)}`;
    if (net < 0) return `-${fmtNum(-net)}`;
    return '0';
}

function colorBox(text: string, bg: string, hasValue: boolean) {
    return {
        type: 'box',
        layout: 'vertical',
        contents: [{
            type: 'text',
            text,
            align: 'center',
            size: 'xxs',
            weight: 'bold',
            color: hasValue ? '#FFFFFF' : '#AAAAAA',
        }],
        backgroundColor: hasValue ? bg : '#F3F3F3',
        justifyContent: 'center',
        cornerRadius: '5px',
    };
}

/** Normal row: profile image + name | credit box + net P/L box */
function userRow(user: UserState) {
    const profilePic = user.profilePictureUrl ?? DEFAULT_AVATAR;
    let nameText = `#u${user.shortId}`;
    if (user.displayName) nameText += ` ${user.displayName}`;
    else if (user.telegramUsername) nameText += ` @${user.telegramUsername}`;

    const net = user.totalWin - user.totalLoss;
    const creditHasValue = user.credit > 0;

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
                    colorBox(fmtNum(user.credit), CREDIT_BG, creditHasValue),
                    colorBox(fmtNet(net), netBg(net), net !== 0),
                ],
                spacing: '5px',
                paddingAll: '8px',
            },
        ],
        paddingAll: '0px',
        backgroundColor: '#F3F3F3',
    };
}

/** Compact row: text only */
function userRowCompact(user: UserState) {
    let name = `#u${user.shortId}`;
    if (user.displayName) name += ` ${user.displayName}`;
    else if (user.telegramUsername) name += ` @${user.telegramUsername}`;

    const net = user.totalWin - user.totalLoss;
    const indicator = net > 0 ? '📈' : net < 0 ? '📉' : '➖';

    return {
        type: 'text',
        text: `  ${name} | 💰${fmtNum(user.credit)} ${indicator}${fmtNet(net)}`,
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

export interface BettingSummaryFlexResult {
    flexes: LineMessage[];
    bettingUsers: number;
    totalCredit: number;
    totalNetPL: number;
}

export function generateBettingSummaryFlex(users: UserState[]): BettingSummaryFlexResult {
    const compact = SystemState.sumCompact;
    const ROWS_PER_BUBBLE = compact ? 26 : 15;
    const BUBBLES_PER_MSG = compact ? 12 : 3;
    const MAX_MESSAGES = 4;

    let totalCredit = 0, totalNetPL = 0;
    for (const u of users) {
        totalCredit += u.credit;
        totalNetPL += (u.totalWin - u.totalLoss);
    }

    const count = users.length;
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
                    ? `สรุปยอดแพ้ชนะ (${count} คน) ต่อ`
                    : `สรุปยอดแพ้ชนะ (${count} คน)`,
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

    const mkColHeader = () => ({
        type: 'box',
        layout: 'horizontal',
        contents: [
            { type: 'box', layout: 'horizontal', contents: [{ type: 'filler' }], paddingAll: '10px' },
            {
                type: 'box',
                layout: 'horizontal',
                contents: [
                    { type: 'text', text: '💰 เครดิต', size: 'xxs', color: CREDIT_BG, align: 'center', weight: 'bold' },
                    { type: 'text', text: '📊 แพ้/ชนะ', size: 'xxs', color: WIN_BG,    align: 'center', weight: 'bold' },
                ],
                spacing: '5px',
                paddingAll: '4px',
            },
        ],
        paddingAll: '0px',
        backgroundColor: '#F9F9F9',
    });

    const separator = { type: 'separator', margin: 'md' };

    const footerNetBg = totalNetPL > 0 ? WIN_BG : totalNetPL < 0 ? LOSS_BG : NEUTRAL_BG;
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
                    text: `💰 ${fmtNum(totalCredit)}`,
                    color: '#FFFFFF',
                    align: 'center',
                    size: 'sm',
                }],
            },
            {
                type: 'box',
                layout: 'vertical',
                paddingAll: '5px',
                backgroundColor: footerNetBg,
                justifyContent: 'center',
                contents: [{
                    type: 'text',
                    text: `📊 ${fmtNet(totalNetPL)}`,
                    color: '#FFFFFF',
                    align: 'center',
                    size: 'sm',
                }],
            },
        ],
    };

    const altText = `สรุปยอดแพ้ชนะ ${count} คน | เครดิตรวม ${fmtNum(totalCredit)} | Net P/L ${fmtNet(totalNetPL)}`;

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

    for (const user of users) {
        if (!pager.fits(1)) {
            if (!pager.newPage()) break;
        }
        pager.push(compact ? userRowCompact(user) : userRow(user));
    }

    if (users.length === 0) {
        pager.push({ type: 'image', url: NODATA_IMAGE_URL, align: 'center', size: 'lg', margin: 'md' });
    }

    const flexes = pagesToMessages(pager.pages, footer, altText, BUBBLES_PER_MSG, MAX_MESSAGES);
    return { flexes, bettingUsers: count, totalCredit, totalNetPL };
}
