import type { LineMessage } from '../types';

// ---------------------------------------------------------------------------
// Bubble builder
// ---------------------------------------------------------------------------

export function buildBubble(header: unknown, bodyRows: unknown[], footer?: unknown): unknown {
    const b: Record<string, unknown> = {
        type: 'bubble', size: 'mega', header,
        styles: { footer: { separator: true } },
    };
    if (bodyRows.length > 0) {
        b.body = { type: 'box', layout: 'vertical', contents: bodyRows, paddingAll: '5px', spacing: 'sm' };
    }
    if (footer) b.footer = footer;
    return b;
}

// ---------------------------------------------------------------------------
// Row pager — stateful page filler
// ---------------------------------------------------------------------------

/**
 * Creates a stateful pager that fills body-row pages up to `maxRows` per page.
 *
 * @param maxRows         Max body rows per bubble
 * @param maxPages        Max total pages (bubbles) to generate
 * @param initRows        Rows pre-filled into page 0 (e.g. section header + separator)
 * @param reservedRows    Rows already counted toward page 0's budget (existing body content)
 * @param makeContHeader  Returns rows placed at the top of every continuation page
 */
export function createPager(
    maxRows: number,
    maxPages: number,
    initRows: unknown[],
    reservedRows: number,
    makeContHeader: () => unknown[],
) {
    const pages: unknown[][] = [[...initRows]];
    let pi = 0;
    let rc = reservedRows + initRows.length;

    return {
        get pages(): unknown[][] { return pages; },

        /** Whether `n` more rows fit on the current page */
        fits(n: number): boolean { return rc + n <= maxRows; },

        /** Append rows to the current page */
        push(...rows: unknown[]): void { pages[pi]!.push(...rows); rc += rows.length; },

        /**
         * Start a new continuation page.
         * Returns `false` (and does nothing) if `maxPages` is already reached.
         */
        newPage(): boolean {
            if (pages.length >= maxPages) return false;
            const hdr = makeContHeader();
            pages.push([...hdr]);
            pi++;
            rc = hdr.length;
            return true;
        },
    };
}

// ---------------------------------------------------------------------------
// Pages → LineMessage[]
// ---------------------------------------------------------------------------

/**
 * Converts pre-computed pages into LINE flex messages.
 *
 * Strategy:
 *   - 0–1 pages  → single bubble (no carousel)
 *   - 2+ pages   → grouped into carousel messages (`maxCarouselBubbles` per message)
 *     Each message must be full before starting the next one.
 *
 * `existingRows` are prepended to the first bubble's body rows.
 * `footer` appears on every bubble.
 *
 * @param maxCarouselBubbles  Bubbles per carousel message (caller-defined per flex type)
 * @param maxFlexMessages     Max LINE messages to emit (caller-defined per flex type)
 */
export function pagesToMessages(
    pages: unknown[][],
    header: unknown,
    existingRows: unknown[],
    footer: unknown | undefined,
    altText: string,
    maxCarouselBubbles: number,
    maxFlexMessages: number,
): LineMessage[] {
    // ── Single bubble ───────────────────────────────────────────────────────
    if (pages.length <= 1) {
        const bodyRows = [...existingRows, ...(pages[0] ?? [])];
        const bubble: Record<string, unknown> = {
            type: 'bubble', size: 'mega', header,
            styles: { footer: { separator: true } },
        };
        if (bodyRows.length > 0) {
            bubble.body = { type: 'box', layout: 'vertical', contents: bodyRows, paddingAll: '5px', spacing: 'sm' };
        }
        if (footer) bubble.footer = footer;
        return [{ type: 'flex', altText, contents: bubble }];
    }

    // ── Multiple pages → carousel messages ─────────────────────────────────
    const messages: LineMessage[] = [];
    for (let start = 0; start < pages.length; start += maxCarouselBubbles) {
        if (messages.length >= maxFlexMessages) break;
        const chunk = pages.slice(start, start + maxCarouselBubbles);
        const bubbles = chunk.map((pageRows, j) => {
            const rows = start === 0 && j === 0 ? [...existingRows, ...pageRows] : [...pageRows];
            return buildBubble(header, rows, footer);
        });
        const contents = bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles };
        messages.push({ type: 'flex', altText, contents });
    }
    return messages;
}
