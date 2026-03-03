import { assetUrl } from '../utils/asset-url';

const DEPOSIT_ICON  = assetUrl('deposit-icon.webp');
const WITHDRAW_ICON = assetUrl('withdraw-icon.webp');

function iconBox(iconUrl: string): unknown {
    return {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'image', url: iconUrl, aspectMode: 'cover' }],
        width: '50px',
        height: '50px',
        paddingAll: '6px',
    };
}

export function generateTxFlex(deposit: number, withdraw: number, balance: number): { contents: unknown; altText: string } {
    const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

    const contents = {
        type: 'bubble',
        body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'xs',
            paddingAll: '10px',
            action: { type: 'message', label: 'transaction summary', text: 'tx' },
            contents: [
                {
                    type: 'box',
                    layout: 'horizontal',
                    cornerRadius: 'md',
                    paddingEnd: '10px',
                    contents: [
                        iconBox(DEPOSIT_ICON),
                        { type: 'text', text: fmt(deposit), size: '3xl', align: 'end', color: '#008D0A' },
                    ],
                },
                {
                    type: 'box',
                    layout: 'horizontal',
                    cornerRadius: 'md',
                    paddingEnd: '10px',
                    contents: [
                        iconBox(WITHDRAW_ICON),
                        { type: 'text', text: fmt(withdraw), size: '3xl', align: 'end', color: '#B60000' },
                    ],
                },
                { type: 'separator', color: '#AAAAAA' },
                {
                    type: 'text',
                    size: 'sm',
                    align: 'end',
                    weight: 'bold',
                    margin: 'md',
                    contents: [
                        { type: 'span', text: 'คงเหลือในระบบ ' },
                        { type: 'span', text: fmt(balance) },
                        { type: 'span', text: ' บาท' },
                    ],
                },
            ],
        },
        styles: { footer: { separator: true } },
    };

    const altText = `ฝาก ${fmt(deposit)} | ถอน ${fmt(withdraw)} | คงเหลือ ${fmt(balance)} บาท`;
    return { contents, altText };
}
