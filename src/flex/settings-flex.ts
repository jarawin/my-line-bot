export interface SettingsState {
    vig: number;
    maxBet: number;
    minBet: number;
    lim: number;
    xcap: number;
    adminLink: string;
    riskThreshold: number;
    betDelayMs: number;
}

function valueRow(label: string, value: string, copyText: string) {
    return {
        type: 'box',
        layout: 'horizontal',
        alignItems: 'center',
        paddingTop: '6px',
        paddingBottom: '6px',
        contents: [
            {
                type: 'text',
                text: label,
                size: 'sm',
                color: '#666666',
                flex: 3,
                weight: 'bold',
            },
            {
                type: 'text',
                text: value,
                size: 'sm',
                color: '#222222',
                flex: 3,
                wrap: false,
                adjustMode: 'shrink-to-fit',
            },
            {
                type: 'button',
                style: 'secondary',
                height: 'sm',
                flex: 3,
                action: {
                    type: 'clipboard',
                    label: "คัดลอก",
                    clipboardText: copyText,
                },
            },
        ],
    };
}

export function generateSettingsFlex(s: SettingsState): unknown {
    const limLabel = s.lim === 0 ? '∞' : `${s.lim} ไม้`;
    const xcapLabel = s.xcap === 0 ? '∞' : s.xcap.toLocaleString('en-US');
    const linkLabel = s.adminLink
        ? (s.adminLink.length > 20 ? s.adminLink.slice(0, 20) + '…' : s.adminLink)
        : '(ไม่มี)';
    const riskLabel = s.riskThreshold === 0
        ? `อัตโนมัติ (${Math.floor(s.xcap * 0.8).toLocaleString('en-US')})`
        : s.riskThreshold.toLocaleString('en-US');

    const rows = [
        { label: 'ค่าน้ำ', value: `${s.vig}%`, copy: 'vig=' },
        { label: 'สูงสุด/ไม้', value: s.maxBet.toLocaleString('en-US'), copy: 'maxbet=' },
        { label: 'ต่ำสุด/ไม้', value: s.minBet.toLocaleString('en-US'), copy: 'minbet=' },
        { label: 'จำกัดไม้', value: limLabel, copy: 'lim=' },
        { label: 'เพดานเสีย', value: xcapLabel, copy: 'xcap=' },
        { label: 'Risk Alert', value: riskLabel, copy: 'risk=' },
        { label: 'Bet Delay', value: `${s.betDelayMs.toLocaleString('en-US')} ms`, copy: 'delay=' },
        { label: 'Admin Link', value: linkLabel, copy: 'al=' },
    ];

    return {
        type: 'bubble',
        header: {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#1A5276',
            paddingAll: '12px',
            contents: [{
                type: 'text',
                text: '⚙️  ตั้งค่าระบบ',
                color: '#FFFFFF',
                weight: 'bold',
                size: 'md',
            }],
        },
        body: {
            type: 'box',
            layout: 'vertical',
            paddingAll: '10px',
            spacing: 'none',
            contents: [
                {
                    type: 'box',
                    layout: 'horizontal',
                    paddingBottom: '4px',
                    contents: [
                        { type: 'text', text: 'รายการ', size: 'xxs', color: '#888888', flex: 3 },
                        { type: 'text', text: 'ค่า', size: 'xxs', color: '#888888', flex: 3 },
                        { type: 'filler', flex: 3 },
                    ],
                },
                { type: 'separator', margin: 'none' },
                ...rows.map(r => valueRow(r.label, r.value, r.copy)),
            ],
        },
    };
}
