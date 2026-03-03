import { assetUrl } from '../utils/asset-url';
import type { LineMessage } from '../types';

const EXCEL_ICON_URL = assetUrl('excel-icon.webp');

const TX_TYPE_TH: Record<string, string> = {
    DEPOSIT:    'ฝากเครดิต',
    WITHDRAW:   'ถอนเครดิต',
    BET_WIN:    'ชนะเดิมพัน',
    BET_LOSS:   'แพ้เดิมพัน',
    BET_DRAW:   'เสมอเดิมพัน',
    REFUND:     'คืนเงิน',
    ADJUSTMENT: 'ปรับยอด',
};

export function txTypeTh(type: string): string {
    return TX_TYPE_TH[type] ?? type;
}

export function fmtThaiDate(ts: number): string {
    return new Date(ts).toLocaleString('th-TH', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    });
}

export function generateExcelFlex(filename: string, rowCount: number, fileUrl: string): LineMessage {
    const dateStr = new Date().toLocaleDateString('th-TH', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric', month: 'short', day: 'numeric',
    });

    const bubble = {
        type: 'bubble',
        size: 'mega',
        body: {
            type: 'box',
            layout: 'horizontal',
            contents: [
                {
                    type: 'box',
                    layout: 'vertical',
                    contents: [
                        { type: 'image', url: EXCEL_ICON_URL, aspectMode: 'fit', size: 'full' },
                    ],
                    maxWidth: '40px',
                    maxHeight: '40px',
                },
                {
                    type: 'box',
                    layout: 'vertical',
                    contents: [
                        { type: 'text', text: filename, size: 'sm', weight: 'bold' },
                        {
                            type: 'text',
                            size: 'xxs',
                            color: '#777777',
                            contents: [
                                { type: 'span', text: dateStr },
                                { type: 'span', text: '  ' },
                                { type: 'span', text: `${rowCount.toLocaleString('en-US')} รายการ` },
                            ],
                        },
                    ],
                    margin: 'sm',
                    justifyContent: 'center',
                },
            ],
            action: {
                type: 'uri',
                label: filename,
                uri: `${fileUrl}&openExternalBrowser=1`,
            },
            paddingAll: '10px',
        },
    };

    return {
        type: 'flex',
        altText: `📊 ${filename} — ${rowCount.toLocaleString('en-US')} รายการ`,
        contents: bubble,
    };
}
