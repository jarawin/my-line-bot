import type { BankAccount } from '../types';

// ---------------------------------------------------------------------------
// Hero builder — with image vs. placeholder
// ---------------------------------------------------------------------------

function buildHero(account: BankAccount): unknown {
    const badge = {
        type: 'box',
        layout: 'vertical',
        contents: [
            { type: 'text', text: `#b${account.shortId}`, color: '#FFFFFF', align: 'center' },
        ],
        position: 'absolute',
        backgroundColor: '#C00707',
        paddingAll: '5px',
        offsetEnd: '0px',
        offsetTop: '0px',
        width: '50px',
        cornerRadius: '5px',
    };

    if (account.imageUrl) {
        return {
            type: 'box',
            layout: 'vertical',
            contents: [
                {
                    type: 'image',
                    url: account.imageUrl,
                    size: 'full',
                    aspectMode: 'cover',
                    aspectRatio: '1:1',
                },
                badge,
            ],
            action: { type: 'message', label: `#b${account.shortId}`, text: `#b${account.shortId}` },
        };
    }

    // No image yet — show "เพิ่มรูปภาพ" button
    return {
        type: 'box',
        layout: 'vertical',
        contents: [
            {
                type: 'box',
                layout: 'vertical',
                contents: [
                    {
                        type: 'button',
                        action: { type: 'message', label: 'เพิ่มรูปภาพ', text: `#b${account.shortId}=image` },
                    },
                ],
                width: '220px',
                height: '220px',
                justifyContent: 'center',
            },
            badge,
        ],
        action: { type: 'message', label: `#b${account.shortId}`, text: `#b${account.shortId}` },
    };
}

// ---------------------------------------------------------------------------
// Backoffice carousel — all accounts
// ---------------------------------------------------------------------------

export function generateBankCarouselFlex(accounts: BankAccount[]): unknown {
    const bubbles = accounts.map(account => ({
        type: 'bubble',
        size: 'deca',
        hero: buildHero(account),
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                { type: 'text', text: `เลขบัญชี: ${account.number}`, wrap: true, color: '#8c8c8c', size: 'xs', flex: 5 },
                { type: 'text', text: `ชื่อบัญชี: ${account.name}`, weight: 'bold', size: 'sm', wrap: true },
                { type: 'text', text: `ธนาคาร: ${account.bank}`, size: 'sm', wrap: true },
                {
                    type: 'box',
                    layout: 'vertical',
                    contents: [{ type: 'text', text: 'คัดลอก', size: 'xxs', style: 'italic', decoration: 'underline' }],
                    position: 'absolute',
                    offsetEnd: '5px',
                    offsetTop: '5px',
                },
            ],
            spacing: 'sm',
            paddingAll: '5px',
            paddingBottom: '5px',
            position: 'relative',
            action: { type: 'clipboard', label: 'คัดลอก', clipboardText: account.number },
        },
        footer: {
            type: 'box',
            layout: 'horizontal',
            contents: [
                {
                    type: 'button',
                    action: { type: 'message', label: 'ลบบัญชี', text: `#b${account.shortId}=delete` },
                    height: 'sm',
                    style: 'primary',
                    color: '#E36A6A',
                },
                {
                    type: 'button',
                    action: {
                        type: 'message',
                        label: account.isActive ? 'ใช้งานอยู่' : 'เริ่มใช้งาน',
                        text: `#b${account.shortId}=active`,
                    },
                    height: 'sm',
                    style: account.isActive ? 'primary' : 'secondary',
                },
            ],
            paddingTop: '0px',
            paddingAll: '5px',
            spacing: '5px',
        },
    }));

    // Always append "add new account" bubble
    const addNewBubble = {
        type: 'bubble',
        size: 'deca',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                {
                    type: 'box',
                    layout: 'vertical',
                    contents: [{ type: 'button', action: { type: 'message', label: 'วิธีเพิ่มบัญชีใหม่', text: '#b0' } }],
                    height: '280px',
                    justifyContent: 'center',
                },
                {
                    type: 'box',
                    layout: 'vertical',
                    contents: [{
                        type: 'button',
                        action: { type: 'clipboard', label: 'คัดลอก', clipboardText: '#b0 bank= name= number=' },
                        style: 'secondary',
                        height: 'sm',
                    }],
                },
            ],
            justifyContent: 'space-between',
            spacing: 'md',
            paddingAll: '5px',
        },
    };

    return { type: 'carousel', contents: [...bubbles, addNewBubble] };
}

// ---------------------------------------------------------------------------
// Official bank info flex — for BETTING group บช / BACKOFFICE #b<n>
// Image (if any) as hero + account info + admin link in body
// Telegram fallback = plain text
// ---------------------------------------------------------------------------

export function generateOfficialBankFlex(
    account: BankAccount,
    adminLink: string,
): { flex: unknown; altText: string } {
    const altText = [
        `ธนาคาร: ${account.bank}`,
        `ชื่อบัญชี: ${account.name}`,
        `เลขบัญชี: ${account.number}`,
        '',
        'เมื่อโอนเงินแล้ว ส่งสลิปมาให้ แอดมินมาที่นี่ >>',
        adminLink || '(ยังไม่ได้ตั้ง admin link)',
    ].join('\n');

    const bodyContents: unknown[] = [
        { type: 'text', text: account.bank, size: 'sm', color: '#888888', wrap: true },
        { type: 'text', text: account.name, weight: 'bold', size: 'lg', wrap: true },
        { type: 'text', text: account.number, size: 'xl', weight: 'bold', color: '#111111' },
        { type: 'separator', margin: 'md' },
        {
            type: 'text',
            text: 'เมื่อโอนเงินแล้ว ส่งสลิปมาให้ แอดมินมาที่นี่ >>',
            size: 'xs', color: '#888888', wrap: true, margin: 'md',
        },
        ...(adminLink ? [{ type: 'text', text: adminLink, size: 'xs', color: '#0E46A3', wrap: true }] : []),
    ];

    const bubble: Record<string, unknown> = {
        type: 'bubble',
        size: 'mega',
        ...(account.imageUrl ? {
            hero: {
                type: 'image',
                url: account.imageUrl,
                size: 'full',
                aspectMode: 'cover',
                aspectRatio: '20:13',
            },
        } : {}),
        body: {
            type: 'box',
            layout: 'vertical',
            contents: bodyContents,
            paddingAll: '15px',
            action: { type: 'clipboard', label: 'คัดลอกเลขบัญชี', clipboardText: account.number },
        },
    };

    return { flex: bubble, altText };
}
