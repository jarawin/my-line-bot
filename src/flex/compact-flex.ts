export interface CompactState {
    ofc: boolean;
    bfc: boolean;
    tfc: boolean;
    rfc: boolean;
    acfc: boolean;
    sumfc: boolean;
}

function row(label: string, cmd: string, isOn: boolean) {
    const ON_COLOR  = '#27AE60';
    const OFF_COLOR = '#E74C3C';
    const DIM_COLOR = '#BBBBBB';

    return {
        type: 'box',
        layout: 'horizontal',
        alignItems: 'center',
        paddingTop: '5px',
        paddingBottom: '5px',
        contents: [
            {
                type: 'text',
                text: label,
                size: 'sm',
                color: '#222222',
                flex: 3,
            },
            {
                type: 'button',
                style: 'primary',
                height: 'sm',
                flex: 2,
                margin: 'sm',
                color: isOn ? DIM_COLOR : OFF_COLOR,
                action: { type: 'message', label: 'ปิด', text: `${cmd}=0` },
            },
            {
                type: 'button',
                style: 'primary',
                height: 'sm',
                flex: 2,
                margin: 'sm',
                color: isOn ? ON_COLOR : DIM_COLOR,
                action: { type: 'message', label: 'เปิด', text: `${cmd}=1` },
            },
        ],
    };
}

export function generateCompactFlex(state: CompactState): unknown {
    const rows = [
        { label: 'หน้าราคา',   cmd: 'ofc',   on: state.ofc },
        { label: 'ประวัติแทง', cmd: 'bfc',   on: state.bfc },
        { label: 'ธุรกรรม',    cmd: 'tfc',   on: state.tfc },
        { label: 'ผลรอบ',      cmd: 'rfc',   on: state.rfc },
        { label: 'ยอด Active', cmd: 'acfc',  on: state.acfc },
        { label: 'สรุปแพ้ชนะ', cmd: 'sumfc', on: state.sumfc },
    ];

    return {
        type: 'bubble',
        header: {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#2C3E50',
            paddingAll: '12px',
            contents: [{
                type: 'text',
                text: '⚙️  โหมดกระชับ',
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
                        { type: 'text', text: 'หน้าจอ', size: 'xxs', color: '#888888', flex: 3 },
                        { type: 'text', text: 'ปิด', size: 'xxs', color: '#888888', flex: 2, align: 'center' },
                        { type: 'text', text: 'เปิด', size: 'xxs', color: '#888888', flex: 2, align: 'center' },
                    ],
                },
                { type: 'separator', margin: 'none' },
                ...rows.map(r => row(r.label, r.cmd, r.on)),
            ],
        },
    };
}
