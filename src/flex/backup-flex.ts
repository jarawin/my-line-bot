import { assetUrl } from '../utils/asset-url';
import type { LineMessage } from '../types';

const FILE_ICON_URL = assetUrl('file-icon.webp');

export function generateBackupFlex(filename: string, summary: string, fileUrl: string): LineMessage {
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
                        { type: 'image', url: FILE_ICON_URL, aspectMode: 'fit', size: 'full' },
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
                                { type: 'span', text: summary },
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
        altText: `💾 ${filename} — ${summary}`,
        contents: bubble,
    };
}
