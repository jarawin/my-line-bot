import type { BettingOdds, LineMessage } from '../types';
import { getFixedOdds } from '../config/fixed-odds';

export function generateOddsFlex(odds: BettingOdds, roundId: number, oddsN: number): LineMessage {
    const f = (ratio: number) => ratio % 10 === 0 ? String(ratio / 10) : (ratio / 10).toFixed(1);

    // For fixed odds, get display labels from config
    const fixedCfg = odds.fixedOddsKey ? getFixedOdds(odds.fixedOddsKey) : null;
    const limitText = odds.userLimit === 0 ? 'ไม่จำกัด' : String(odds.userLimit);

    const isRedOpen = odds.redLossRatio > 0;
    const isBlueOpen = odds.blueLossRatio > 0;

    const sideBox = (
        label: string,
        sideName: string,
        bgColor: string,
        lossRatio: number,
        winRatio: number,
        lossText?: string,
        winText?: string,
    ) => {
        // Build contents array - only include label span if label is not empty
        const textContents: any[] = [];
        if (label) {
            textContents.push({ type: 'span', text: label });
        }
        textContents.push(
            { type: 'span', text: sideName },
            { type: 'span', text: ' เสีย ' },
            { type: 'span', text: lossText ?? f(lossRatio) },
            { type: 'span', text: ' ได้ ' },
            { type: 'span', text: winText ?? f(winRatio) },
        );

        return {
            type: 'box',
            layout: 'vertical',
            contents: [
                {
                    type: 'text',
                    weight: 'bold',
                    size: 'xl',
                    margin: 'md',
                    color: '#FFFFFF',
                    align: 'center',
                    contents: textContents,
                },
            ],
            backgroundColor: bgColor,
            paddingBottom: 'xl',
            cornerRadius: 'md',
            paddingTop: 'md',
        };
    };

    const closedBox = (sideName: string, bgColor: string) => ({
        type: 'box',
        layout: 'vertical',
        contents: [
            {
                type: 'text',
                weight: 'bold',
                size: 'lg',
                margin: 'md',
                color: '#FFFFFF',
                align: 'center',
                text: `${sideName} ❌ ปิดรับเดิมพัน`,
            },
        ],
        backgroundColor: bgColor,
        paddingBottom: 'lg',
        cornerRadius: 'md',
        paddingTop: 'lg',
    });

    // Build content array based on which sides are open
    const bodyContents: any[] = [];

    if (isRedOpen && isBlueOpen) {
        // Check if equal odds (both sides have identical ratios)
        const isEqual = !fixedCfg && odds.redLossRatio === odds.blueLossRatio && odds.redWinRatio === odds.blueWinRatio;

        if (isEqual) {
            // Equal odds: no ต่อ/รอง labels, just show both sides equally
            bodyContents.push(sideBox('', 'แดง', '#C40C0C', odds.redLossRatio, odds.redWinRatio));
            bodyContents.push(sideBox('', 'น้ำเงิน', '#0E46A3', odds.blueLossRatio, odds.blueWinRatio));
        } else {
            // Normal double-side: ต่อ on top, รอง on bottom
            bodyContents.push(sideBox('ต่อ', 'แดง', '#C40C0C', odds.redLossRatio, odds.redWinRatio,
                fixedCfg?.redLossLabel, fixedCfg?.redWinLabel));
            bodyContents.push(sideBox('รอง', 'น้ำเงิน', '#0E46A3', odds.blueLossRatio, odds.blueWinRatio,
                fixedCfg?.blueLossLabel, fixedCfg?.blueWinLabel));
        }
    } else if (isRedOpen) {
        // Red only (underdog) → ต่อ (blue closed) on top, รอง (red open) on bottom
        bodyContents.push(closedBox('น้ำเงิน', '#888888'));
        bodyContents.push(sideBox('รอง', 'แดง', '#C40C0C', odds.redLossRatio, odds.redWinRatio,
            fixedCfg?.redLossLabel, fixedCfg?.redWinLabel));
    } else if (isBlueOpen) {
        // Blue only (underdog) → ต่อ (red closed) on top, รอง (blue open) on bottom
        bodyContents.push(closedBox('แดง', '#888888'));
        bodyContents.push(sideBox('รอง', 'น้ำเงิน', '#0E46A3', odds.blueLossRatio, odds.blueWinRatio,
            fixedCfg?.blueLossLabel, fixedCfg?.blueWinLabel));
    }

    bodyContents.push({
        type: 'separator',
        margin: 'md',
    });

    bodyContents.push({
        type: 'box',
        layout: 'horizontal',
        margin: 'md',
        contents: [
            {
                type: 'text',
                text: `#r${roundId} #o${oddsN}`,
                size: 'xs',
                color: '#aaaaaa',
                flex: 0,
                weight: 'bold',
            },
            {
                type: 'text',
                color: '#aaaaaa',
                size: 'xs',
                align: 'end',
                contents: [
                    { type: 'span', text: 'ขั้นต่ำ ' },
                    { type: 'span', text: odds.minBet.toLocaleString('en-US') },
                    { type: 'span', text: ' สูงสุด ' },
                    { type: 'span', text: odds.maxBet.toLocaleString('en-US') },
                    { type: 'span', text: ' (จำกัด ' },
                    { type: 'span', text: limitText },
                    { type: 'span', text: odds.userLimit === 0 ? ')' : ' ครั้ง)' },
                ],
            },
        ],
    });

    const flexContent = {
        type: 'bubble',
        size: 'giga',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: bodyContents,
            spacing: 'md',
            paddingAll: 'lg',
        },
        styles: {
            footer: {
                separator: true,
            },
        },
    };

    return {
        type: 'flex',
        altText: `เปิดราคา รอบ ${roundId}`,
        contents: flexContent,
    };
}
