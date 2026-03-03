import type { Bet, BettingRound, LineMessage, UserState } from '../types';
import { oddsToText } from '../utils/odds-format';
import { assetUrl } from '../utils/asset-url';
import { createPager, pagesToMessages } from './paginator';
import { SystemState } from '../store/game-state';

const WELCOME_IMAGE_URL = assetUrl('welcome-member.webp');

// Pagination config — computed at runtime inside generateCreditFlex from SystemState flags

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtNum(n: number): string {
    return Math.round(n).toLocaleString('en-US');
}

function fmtSign(n: number): string {
    return (n >= 0 ? '+' : '') + fmtNum(n);
}

function fmtTimeSec(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function txInfo(type: string, amount: number, refId: string): { label: string; size: string } {
    switch (type) {
        case 'DEPOSIT': return { label: 'เติมเครดิต', size: 'xs' };
        case 'WITHDRAW': return { label: 'ถอนเครดิต', size: 'xs' };
        case 'BET_WIN': return { label: `ยอดชนะ${refId ? ` ${refId}` : ''}`, size: 'xxs' };
        case 'BET_LOSS': return { label: `ยอดแพ้${refId ? ` ${refId}` : ''}`, size: 'xxs' };
        case 'BET_DRAW': return { label: `ยอดเสมอ${refId ? ` ${refId}` : ''}`, size: 'xxs' };
        case 'REFUND': return { label: `คืนเงิน${refId ? ` ${refId}` : ''}`, size: 'xs' };
        case 'ADJUSTMENT': return { label: amount >= 0 ? 'เติมยอด' : 'หักยอด', size: 'xs' };
        default: return { label: type, size: 'xxs' };
    }
}

function txColor(type: string, amount: number): string {
    if (type === 'BET_DRAW' || amount === 0) return '#888888';
    if (amount > 0) return '#6D9E51';
    return '#F5824A';
}

function groupBetsByOdds(bets: Bet[]): Map<number, Bet[]> {
    const grouped = new Map<number, Bet[]>();
    for (const bet of bets) {
        const arr = grouped.get(bet.oddsIndex) ?? [];
        arr.push(bet);
        grouped.set(bet.oddsIndex, arr);
    }
    return grouped;
}

// ---------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------

/** Transaction row: time | label | colored badge | balance after */
function txRow(time: string, label: string, labelSize: string, amountText: string, bgColor: string, balanceText: string) {
    return {
        type: 'box',
        layout: 'horizontal',
        contents: [
            { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: time, size: 'xs', align: 'center' }] },
            { type: 'separator' },
            { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: label, size: labelSize, align: 'center' }] },
            { type: 'separator' },
            {
                type: 'box', layout: 'horizontal', justifyContent: 'center', flex: 1,
                contents: [{
                    type: 'box', layout: 'horizontal', flex: 1, width: '60px',
                    backgroundColor: bgColor, cornerRadius: '5px',
                    contents: [{ type: 'text', text: amountText, align: 'center', size: 'xs', color: '#FFFFFF', weight: 'bold' }],
                }],
            },
            { type: 'separator' },
            { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: balanceText, size: 'xs', align: 'center' }] },
        ],
    };
}

/** Header row for an odds group in the betting table */
function oddsTableHeader(oddsLabel: string, redHeaderColor = '#555555', blueHeaderColor = '#555555') {
    return {
        type: 'box',
        layout: 'horizontal',
        contents: [
            {
                type: 'box',
                layout: 'vertical',
                contents: [{ type: 'text', text: oddsLabel, color: '#555555', size: 'xs', weight: 'bold' }],
            },
            {
                type: 'box',
                layout: 'horizontal',
                contents: [
                    { type: 'separator', color: '#FFFFFF' },
                    { type: 'text', text: 'แดงชนะ', size: 'xs', align: 'center', gravity: 'bottom', color: redHeaderColor, weight: 'bold' },
                    { type: 'separator' },
                    { type: 'text', text: 'น้ำเงินชนะ', size: 'xs', align: 'center', gravity: 'bottom', color: blueHeaderColor, weight: 'bold' },
                ],
            },
        ],
    };
}

/** Single bet row in the betting table */
function betTableRow(
    time: string,
    sideText: string,
    sideColor: string,
    redNetText: string,
    blueNetText: string,
    redNetColor = '#555555',
    blueNetColor = '#555555',
) {
    return {
        type: 'box',
        layout: 'horizontal',
        contents: [
            { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: time, size: 'xs', align: 'center' }] },
            { type: 'separator' },
            {
                type: 'box', layout: 'horizontal', justifyContent: 'center', flex: 1,
                contents: [{
                    type: 'box', layout: 'horizontal', flex: 1, width: '60px',
                    backgroundColor: sideColor, cornerRadius: '5px',
                    contents: [{ type: 'text', text: sideText, align: 'center', size: 'xs', color: '#FFFFFF', weight: 'bold' }],
                }],
            },
            { type: 'separator' },
            { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: redNetText, size: 'xs', align: 'center', color: redNetColor }] },
            { type: 'separator' },
            { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: blueNetText, size: 'xs', align: 'center', color: blueNetColor }] },
        ],
    };
}

// ---------------------------------------------------------------------------
// Bet row builder (settled)
// ---------------------------------------------------------------------------

function buildBetRow(b: Bet, redColColor: string, blueColColor: string): unknown {
    const sideChar = b.side === 'RED' ? 'ด' : 'ง';
    const sideColor = b.status === 'WON'
        ? (b.side === 'RED' ? '#C40C0C' : '#0E46A3')
        : b.status === 'LOST'
            ? (b.side === 'RED' ? '#EA7B7B' : '#9CC6DB')
            : '#888888';
    return betTableRow(
        fmtTimeSec(b.timestamp),
        `${sideChar}${fmtNum(b.amount)}`, sideColor,
        b.side === 'RED' ? `+${fmtNum(b.winAmount)}` : `-${fmtNum(b.lossAmount)}`,
        b.side === 'BLUE' ? `+${fmtNum(b.winAmount)}` : `-${fmtNum(b.lossAmount)}`,
        redColColor, blueColColor,
    );
}

// ---------------------------------------------------------------------------
// Compact row builders — plain text, no nested boxes
// ---------------------------------------------------------------------------

/** Compact odds section header — just a bold text label */
function oddsTableHeaderCompact(oddsLabel: string): unknown {
    return { type: 'text', text: oddsLabel, size: 'xs', weight: 'bold', color: '#555555', margin: 'sm' };
}

/** Compact TX row — single text line: "HH:MM:SS  label  +amount  = balance" */
function txRowCompact(time: string, label: string, amountText: string, balanceText: string, color: string): unknown {
    return { type: 'text', text: `${time}  ${label}  ${amountText}  ${balanceText}`, size: 'xs', color };
}

/** Compact bet row — single text line: "HH:MM  ด1,000  ด+900 ง-1,000" */
function buildBetRowCompact(b: Bet): unknown {
    const sideChar = b.side === 'RED' ? 'ด' : 'ง';
    const color = b.status === 'WON' ? '#333333' : b.status === 'LOST' ? '#888888' : '#555555';
    const redNet = b.side === 'RED' ? `+${fmtNum(b.winAmount)}` : `-${fmtNum(b.lossAmount)}`;
    const blueNet = b.side === 'BLUE' ? `+${fmtNum(b.winAmount)}` : `-${fmtNum(b.lossAmount)}`;
    return {
        type: 'text',
        text: `${fmtTimeSec(b.timestamp)}  ${sideChar}${fmtNum(b.amount)}  ด${redNet} ง${blueNet}`,
        size: 'xs', color,
    };
}

// ---------------------------------------------------------------------------
// Transactions paginator
// ---------------------------------------------------------------------------

/** Splits transactions into pages. */
function buildTxPages(
    txs: Array<{ type: string; amount: number; ref_id: string; created_at: number }>,
    txHeaderLabel: string,
    user: UserState,
    existingRowCount: number,  // rows already on page 0 before this section
    compact: boolean,
    rowsPerBubble: number,
    bubblesPerMsg: number,
    maxMessages: number,
): unknown[][] {
    const sep = { type: 'separator' };
    const mkHdr = (cont: boolean): unknown => ({
        type: 'text', size: 'xs', color: '#AAAAAA',
        ...(existingRowCount > 0 && !cont ? { margin: 'xl' } : {}),
        contents: cont
            ? [{ type: 'span', text: 'ประวัติธุรกรรม ' }, { type: 'span', text: '(ต่อ)', weight: 'bold', color: '#333333' }]
            : [{ type: 'span', text: 'ประวัติธุรกรรม ' }, { type: 'span', text: txHeaderLabel, weight: 'bold', color: '#333333' }],
    });

    const initRows = compact ? [mkHdr(false)] : [mkHdr(false), sep];
    const makeContHdr = compact ? () => [mkHdr(true)] : () => [mkHdr(true), sep];

    const pager = createPager(
        rowsPerBubble,
        maxMessages * bubblesPerMsg,
        initRows,
        existingRowCount,
        makeContHdr,
    );

    // Compute running balance after each tx (newest tx leaves user.credit)
    const balances: number[] = new Array(txs.length);
    let bal = user.credit;
    for (let i = txs.length - 1; i >= 0; i--) {
        balances[i] = bal;
        bal -= txs[i]!.amount;
    }

    for (let i = 0; i < txs.length; i++) {
        if (!pager.fits(1)) {
            if (!pager.newPage()) break;
        }
        const tx = txs[i]!;
        const { label, size: labelSize } = txInfo(tx.type, tx.amount, tx.ref_id);
        const color = txColor(tx.type, tx.amount);
        pager.push(compact
            ? txRowCompact(fmtTimeSec(tx.created_at), label, fmtSign(tx.amount), `= ${fmtNum(balances[i]!)}`, color)
            : txRow(fmtTimeSec(tx.created_at), label, labelSize, fmtSign(tx.amount), color, `= ${fmtNum(balances[i]!)}`));
    }

    return pager.pages;
}

// ---------------------------------------------------------------------------
// Settled bets paginator
// ---------------------------------------------------------------------------

/** Splits settled bets into pages (one page = one bubble's body rows). */
function buildSettledPages(
    settledUserBets: Bet[],
    settledRound: BettingRound,
    existingRowCount: number,
    resultLabel: string,
    winnerColor: string,
    redColColor: string,
    blueColColor: string,
    hasExistingRows: boolean,
    compact: boolean,
    rowsPerBubble: number,
    bubblesPerMsg: number,
    maxMessages: number,
): unknown[][] {
    const sep = { type: 'separator' };
    const mkHdr = (cont: boolean): unknown => ({
        type: 'text', size: 'xs', color: '#AAAAAA',
        ...(hasExistingRows && !cont ? { margin: 'xl' } : {}),
        contents: cont
            ? [{ type: 'span', text: `รอบที่ ${settledRound.id} ` }, { type: 'span', text: '(ต่อ)', weight: 'bold', color: '#333333' }]
            : [{ type: 'span', text: `ประวัติการเดิมพันรอบที่ ${settledRound.id} ` }, { type: 'span', text: `[ผลลัพธ์: ${resultLabel}]`, weight: 'bold', color: winnerColor }],
    });

    const initRows = compact ? [mkHdr(false)] : [mkHdr(false), sep];
    const makeContHdr = compact ? () => [mkHdr(true)] : () => [mkHdr(true), sep];

    const pager = createPager(
        rowsPerBubble,
        maxMessages * bubblesPerMsg,
        initRows,
        existingRowCount,
        makeContHdr,
    );

    let firstOnPage = true;
    let lastOddsHdr: unknown = null;
    let truncated = false;

    for (const [oddsIdx, bets] of groupBetsByOdds(settledUserBets)) {
        if (truncated) break;
        const odds = settledRound.oddsHistory[oddsIdx];
        const oddsStr = odds ? oddsToText(odds) : '';
        const oddsLabel = oddsStr ? `#o${oddsIdx + 1}  ${oddsStr}` : `#o${oddsIdx + 1}`;
        lastOddsHdr = compact
            ? oddsTableHeaderCompact(oddsLabel)
            : oddsTableHeader(oddsLabel, redColColor, blueColColor);

        // compact: oddsHdr + ≥1 bet = 2 (no separators)
        // normal:  [leading sep] + oddsHdr + sep + ≥1 bet = 3 (first) or 4 (subsequent)
        if (!pager.fits(compact ? 2 : (firstOnPage ? 3 : 4))) {
            if (!pager.newPage()) { truncated = true; break; }
            firstOnPage = true;
        }
        if (!compact && !firstOnPage) pager.push(sep);
        pager.push(...(compact ? [lastOddsHdr] : [lastOddsHdr, sep]));
        firstOnPage = false;

        for (const b of bets) {
            if (!pager.fits(1)) {
                if (!pager.newPage()) { truncated = true; break; }
                pager.push(...(compact ? [lastOddsHdr!] : [lastOddsHdr!, sep]));
            }
            pager.push(compact ? buildBetRowCompact(b) : buildBetRow(b, redColColor, blueColColor));
        }
    }

    if (truncated) {
        pager.pages[pager.pages.length - 1]!.push(
            { type: 'text', size: 'xs', color: '#AAAAAA', text: '... (ข้อมูลถูกตัดเนื่องจากมีมากเกินไป)' },
        );
    }
    return pager.pages;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export interface CreditFlexInput {
    user: UserState;
    transactions: Array<{ type: string; amount: number; ref_id: string; created_at: number }>;
    currentRound: BettingRound | null;
    settledRound: BettingRound | null;
    allTransactions?: boolean;
    showWelcome?: boolean;
}

export function generateCreditFlex(input: CreditFlexInput): LineMessage[] {
    const { user, transactions, currentRound, settledRound, allTransactions = false, showWelcome = false } = input;

    const isPrivileged = user.role === 'ADMIN' || user.role === 'MASTER';

    // ── Header ──────────────────────────────────────────────────────────────
    const profileImageUrl = user.profilePictureUrl
        ?? (user.isProfileLoaded ? assetUrl('default-avatar.webp') : assetUrl('loading-avatar.webp'));
    const displayName = user.displayName
        ?? (user.isProfileLoaded ? 'ไม่มีชื่อ' : 'กำลังโหลด...');

    const headerCreditBox = isPrivileged
        ? {
            type: 'box',
            layout: 'vertical',
            contents: [
                {
                    type: 'text',
                    size: '10px',
                    align: 'end',
                    margin: 'xs',
                    color: '#555555',
                    text: 'บทบาท',
                },
                {
                    type: 'text',
                    weight: 'bold',
                    align: 'end',
                    size: 'sm',
                    text: user.role === 'MASTER' ? 'มาสเตอร์' : 'แอดมิน',
                    wrap: true,
                },
            ],
            cornerRadius: '10px',
            paddingEnd: '5px',
            spacing: 'xs',
        }
        : {
            type: 'box',
            layout: 'vertical',
            contents: [
                {
                    type: 'text',
                    size: '10px',
                    align: 'end',
                    margin: 'xs',
                    color: '#555555',
                    text: 'ยอดเครดิต',
                },
                {
                    type: 'text',
                    weight: 'bold',
                    align: 'end',
                    size: 'sm',
                    text: fmtNum(user.credit),
                    wrap: true,
                },
            ],
            cornerRadius: '10px',
            paddingEnd: '5px',
            spacing: 'xs',
        };

    const header = {
        type: 'box',
        layout: 'horizontal',
        contents: [
            {
                type: 'box',
                layout: 'vertical',
                contents: [
                    {
                        type: 'image',
                        url: profileImageUrl,
                        aspectMode: 'cover',
                        size: 'full',
                    },
                ],
                cornerRadius: '10px',
                width: '40px',
                height: '40px',
            },
            {
                type: 'box',
                layout: 'vertical',
                contents: [
                    {
                        type: 'text',
                        contents: [
                            { type: 'span', text: 'ID' },
                            { type: 'span', text: ': ' },
                            { type: 'span', text: String(user.shortId) },
                        ],
                        size: 'md',
                        wrap: true,
                        weight: 'bold',
                        margin: '3px',
                    },
                    {
                        type: 'text',
                        text: displayName,
                        size: 'xs',
                        color: '#555555',
                    },
                ],
                width: '130px',
            },
            {
                type: 'separator',
                color: '#7F7F7F',
            },
            headerCreditBox,
        ],
        spacing: 'md',
        paddingAll: '10px',
        backgroundColor: '#F3F3F3',
    };

    // Admin/Master: header only
    if (isPrivileged) {
        return [{
            type: 'flex',
            altText: `#u${user.shortId} [${user.role === 'MASTER' ? 'มาสเตอร์' : 'แอดมิน'}]`,
            contents: {
                type: 'bubble',
                size: 'mega',
                header,
                styles: { header: { separator: false } },
            },
        }];
    }

    // Runtime compact flags — toggled without restart
    const txCompact = SystemState.txCompact;
    // TX capacity: compact 40×4×5=800 rows | normal 22×3×5=330 rows
    const TX_ROWS_PER_BUBBLE = txCompact ? 31 : 22;
    const TX_BUBBLES_PER_MSG = txCompact ? 12 : 3;
    const TX_MAX_MESSAGES = txCompact ? 5 : 5;

    const compact = SystemState.betCompact;
    // BET capacity: compact 20×12×5=1200 rows | normal 25×4×5=500 rows
    const BET_ROWS_PER_BUBBLE = compact ? 20 : 25;
    const BET_BUBBLES_PER_MSG = compact ? 12 : 4;
    const BET_MAX_MESSAGES = compact ? 5 : 5;

    // ── Transaction pages ──────────────────────────────────────────────────
    const txs = allTransactions ? [...transactions].reverse() : [...transactions].reverse().slice(0, 10);
    const txHeaderLabel = allTransactions ? '[ทั้งหมด]' : `[${txs.length} รายการล่าสุด]`;
    const txPages: unknown[][] | null = txs.length > 0
        ? buildTxPages(txs, txHeaderLabel, user, 0, txCompact, TX_ROWS_PER_BUBBLE, TX_BUBBLES_PER_MSG, TX_MAX_MESSAGES)
        : null;

    // ── Body rows — current round pending bets ────────────────────────────
    const bodyRows: unknown[] = [];

    // Unsettled (pending) bets in current round
    if (currentRound && currentRound.status !== 'COMPLETED') {
        const userBets = currentRound.bets.filter(b => b.userId === user.userId && b.status !== 'VOID');
        if (userBets.length > 0) {
            // Section header with bold credit hold
            // Only add margin if there's content above (transactions)
            const headerMargin = txs.length > 0 ? 'xl' : undefined;
            bodyRows.push({
                type: 'text', size: 'xs', color: '#AAAAAA', ...(headerMargin ? { margin: headerMargin } : {}),
                contents: [
                    { type: 'span', text: `ประวัติการเดิมพันรอบที่ ${currentRound.id} ` },
                    { type: 'span', text: `[กันเครดิต: ${fmtNum(user.creditHold)}]`, weight: 'bold', color: '#333333' },
                ],
            });
            if (!compact) bodyRows.push({ type: 'separator' });

            for (const [oddsIdx, bets] of groupBetsByOdds(userBets)) {
                const odds = currentRound.oddsHistory[oddsIdx];
                const oddsNum = `#o${oddsIdx + 1}`;
                const oddsStr = odds ? oddsToText(odds) : '';
                const oddsLabel = oddsStr ? `${oddsNum}  ${oddsStr}` : oddsNum;

                if (compact) {
                    bodyRows.push(oddsTableHeaderCompact(oddsLabel));
                    for (const b of bets) bodyRows.push(buildBetRowCompact(b));
                } else {
                    bodyRows.push(oddsTableHeader(oddsLabel));
                    for (const b of bets) {
                        const sideChar = b.side === 'RED' ? 'ด' : 'ง';
                        const sideColor = b.side === 'RED' ? '#EA7B7B' : '#9CC6DB';
                        const redNetText = b.side === 'RED' ? `+${fmtNum(b.winAmount)}` : `-${fmtNum(b.lossAmount)}`;
                        const blueNetText = b.side === 'BLUE' ? `+${fmtNum(b.winAmount)}` : `-${fmtNum(b.lossAmount)}`;
                        bodyRows.push(betTableRow(fmtTimeSec(b.timestamp), `${sideChar}${fmtNum(b.amount)}`, sideColor, redNetText, blueNetText));
                    }
                }
            }
        }
    }

    if (showWelcome) {
        bodyRows.push({ type: 'image', url: WELCOME_IMAGE_URL, align: 'center', size: 'full', margin: '0px' });
    }

    // Append current round bets after TX rows (TX-first order, few rows so budget is fine)
    if (txPages !== null && bodyRows.length > 0) {
        txPages[txPages.length - 1]!.push(...bodyRows);
    }

    // Settled round — paginate
    let settledPages: unknown[][] | null = null;
    let settledResult: BettingRound['result'] | undefined;
    let settledWinnerColor = '#888888';
    let settledRedColColor = '#CCCCCC';
    let settledBlueColColor = '#CCCCCC';
    let settledUserBets: Bet[] = [];

    if (!currentRound && settledRound) {
        settledUserBets = settledRound.bets.filter(b => b.userId === user.userId && b.status !== 'VOID' && b.status !== 'PENDING');
        if (settledUserBets.length > 0) {
            settledResult = settledRound.result;
            const resultLabel = settledResult === 'RED' ? 'แดงชนะ' : settledResult === 'BLUE' ? 'น้ำเงินชนะ' : 'เสมอ';
            settledWinnerColor = settledResult === 'RED' ? '#C40C0C' : settledResult === 'BLUE' ? '#0E46A3' : '#888888';
            settledRedColColor = settledResult === 'RED' ? settledWinnerColor : '#CCCCCC';
            settledBlueColColor = settledResult === 'BLUE' ? settledWinnerColor : '#CCCCCC';
            const txPage0Count = txPages?.[0]?.length ?? 0;
            settledPages = buildSettledPages(
                settledUserBets, settledRound, txPage0Count,
                resultLabel, settledWinnerColor,
                settledRedColColor, settledBlueColColor,
                txPage0Count > 0,
                compact, BET_ROWS_PER_BUBBLE, BET_BUBBLES_PER_MSG, BET_MAX_MESSAGES,
            );
        }
    }

    // ── Footer ────────────────────────────────────────────────────────────
    let footer: unknown | undefined;

    if (currentRound && currentRound.status !== 'COMPLETED') {
        const userBets = currentRound.bets.filter(b => b.userId === user.userId && b.status !== 'VOID');
        if (userBets.length > 0) {
            let totalRedNet = 0, totalBlueNet = 0;
            for (const b of userBets) {
                if (b.side === 'RED') { totalRedNet += b.winAmount; totalBlueNet -= b.lossAmount; }
                else { totalRedNet -= b.lossAmount; totalBlueNet += b.winAmount; }
            }
            footer = {
                type: 'box', layout: 'vertical', paddingAll: '0px',
                contents: [{
                    type: 'box', layout: 'horizontal', justifyContent: 'space-between',
                    contents: [
                        {
                            type: 'box', layout: 'vertical', paddingAll: '5px',
                            backgroundColor: '#C40C0C',
                            contents: [{ type: 'text', text: `แดงชนะ ${fmtSign(totalRedNet)}`, color: '#FFFFFF', align: 'center', size: 'sm' }],
                        },
                        {
                            type: 'box', layout: 'vertical', paddingAll: '5px', justifyContent: 'center',
                            backgroundColor: '#0E46A3',
                            contents: [{ type: 'text', text: `น้ำเงินชนะ ${fmtSign(totalBlueNet)}`, color: '#FFFFFF', align: 'center', size: 'sm' }],
                        },
                    ],
                }],
            };
        }
    } else if (settledUserBets.length > 0) {
        let totalRedNet = 0, totalBlueNet = 0;
        for (const b of settledUserBets) {
            if (b.side === 'RED') { totalRedNet += b.winAmount; totalBlueNet -= b.lossAmount; }
            else { totalRedNet -= b.lossAmount; totalBlueNet += b.winAmount; }
        }
        footer = {
            type: 'box', layout: 'vertical', paddingAll: '0px',
            contents: [{
                type: 'box', layout: 'horizontal', justifyContent: 'space-between',
                contents: [
                    {
                        type: 'box', layout: 'vertical', paddingAll: '5px',
                        backgroundColor: settledResult === 'RED' ? settledWinnerColor : '#CCCCCC',
                        contents: [{ type: 'text', text: `แดงชนะ ${fmtSign(totalRedNet)}`, color: '#FFFFFF', align: 'center', size: 'sm' }],
                    },
                    {
                        type: 'box', layout: 'vertical', paddingAll: '5px', justifyContent: 'center',
                        backgroundColor: settledResult === 'BLUE' ? settledWinnerColor : '#CCCCCC',
                        contents: [{ type: 'text', text: `น้ำเงินชนะ ${fmtSign(totalBlueNet)}`, color: '#FFFFFF', align: 'center', size: 'sm' }],
                    },
                ],
            }],
        };
    }

    // ── Alt text ──────────────────────────────────────────────────────────
    let altText = `#u${user.shortId}`;
    if (user.displayName) altText += ` ${user.displayName}`;
    altText += ` เครดิต: ${fmtNum(user.credit)}`;

    if (allTransactions && txs.length > 0) {
        altText += `\nประวัติธุรกรรมทั้งหมด ${txs.length} รายการ`;
    } else if (txs.length > 0) {
        altText += `\nประวัติธุรกรรม ${txs.length} รายการล่าสุด`;
    }

    if (currentRound && currentRound.status !== 'COMPLETED') {
        const altBets = currentRound.bets.filter(b => b.userId === user.userId && b.status !== 'VOID');
        if (altBets.length > 0) {
            let tRed = 0, tBlue = 0;
            for (const b of altBets) {
                if (b.side === 'RED') { tRed += b.winAmount; tBlue -= b.lossAmount; }
                else { tRed -= b.lossAmount; tBlue += b.winAmount; }
            }
            altText += `\nรอบ #r${currentRound.id} [กันเครดิต: ${fmtNum(user.creditHold)}] แดง${fmtSign(tRed)} น้ำเงิน${fmtSign(tBlue)}`;
        }
    } else if (settledUserBets.length > 0) {
        const resLabel = settledResult === 'RED' ? 'แดงชนะ' : settledResult === 'BLUE' ? 'น้ำเงินชนะ' : 'เสมอ';
        let tRed = 0, tBlue = 0;
        for (const b of settledUserBets) {
            if (b.side === 'RED') { tRed += b.winAmount; tBlue -= b.lossAmount; }
            else { tRed -= b.lossAmount; tBlue += b.winAmount; }
        }
        altText += `\nรอบ #r${settledRound!.id} [${resLabel}] แดง${fmtSign(tRed)} น้ำเงิน${fmtSign(tBlue)}`;
    }

    // ── Build output ──────────────────────────────────────────────────────
    if (settledPages !== null) {
        // Settled bet history: TX page 0 rows as existingRows before settled pages
        return pagesToMessages(settledPages, header, txPages?.[0] ?? [], footer, altText, BET_BUBBLES_PER_MSG, BET_MAX_MESSAGES);
    } else if (txPages !== null) {
        // TX mode (current round bets already appended to txPages above)
        return pagesToMessages(txPages, header, [], footer, altText, TX_BUBBLES_PER_MSG, TX_MAX_MESSAGES);
    } else {
        // Current round bets only (no TX, no settled)
        return pagesToMessages([[]], header, bodyRows, footer, altText, TX_BUBBLES_PER_MSG, TX_MAX_MESSAGES);
    }
}
