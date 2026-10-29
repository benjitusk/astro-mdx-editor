import type { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { blockOffsets } from './textmap.ts';

/**
 * Scroll sync between the editor and the live page pane. The page's blocks are matched to the source by
 * their text (`blockOffsets`), which gives pairs of heights, one on each side; scrolling one side scrolls
 * the other to the matching height, interpolating between pairs. Whichever side was last wheeled, keyed,
 * clicked or touched leads, so the follower's own scroll events don't echo back.
 */

const BLOCKS = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, dt, dd, figcaption, summary';
const INPUT = ['wheel', 'keydown', 'pointerdown', 'touchstart'] as const;

/** A height in the editor's page and the matching height in the live page, both from the top of the page. */
export type Anchor = readonly [editor: number, page: number];

export interface Scroll {
    top: number;
    /** The largest `top`. */
    max: number;
    /** The page's full height. */
    height: number;
}

/** Anchors increasing on both sides, from both tops to both bottoms. Pairs that would go backwards are dropped. */
export function anchorsFrom(pairs: Iterable<Anchor>, editorHeight: number, pageHeight: number): Anchor[] {
    const out: Anchor[] = [[0, 0]];
    for (const [e, p] of pairs) {
        const [le, lp] = out.at(-1)!;
        if (e > le && p > lp && e < editorHeight && p < pageHeight) out.push([e, p]);
    }
    out.push([editorHeight, pageHeight]);
    return out;
}

/** The height on the other side matching `y` on side `from` (0 the editor, 1 the page). */
export function mapY(anchors: readonly Anchor[], y: number, from: 0 | 1): number {
    const to = from ? 0 : 1;
    for (let i = 1; i < anchors.length; i++) {
        const [a, b] = [anchors[i - 1], anchors[i]];
        if (y > b[from] && i < anchors.length - 1) continue;
        if (b[from] === a[from]) return a[to];
        const t = Math.min(1, Math.max(0, (y - a[from]) / (b[from] - a[from])));
        return a[to] + t * (b[to] - a[to]);
    }
    return 0;
}

/**
 * Where `to` scrolls to follow `from`. The point tracked slides from the top of the viewport (scrolled to
 * the top) to its bottom (scrolled to the end), so both sides reach their ends together.
 */
export function syncedScroll(from: Scroll, to: Scroll, anchors: readonly Anchor[], side: 0 | 1): number {
    const y = from.max > 0 ? (from.top * from.height) / from.max : 0;
    return to.height > 0 ? Math.max(0, (mapY(anchors, y, side) * to.max) / to.height) : 0;
}

function scrollOf(win: Window): Scroll {
    const height = win.document.documentElement.scrollHeight;
    return { top: win.scrollY, max: height - win.innerHeight, height };
}

/** Syncs the editor (scrolling the window) with `frame`, re-reading the page on each load. Returns a stop function. */
export function scrollSync(view: EditorView, frame: HTMLIFrameElement): () => void {
    let lead: 'editor' | 'page' = 'editor';
    let blocks: Element[] = [];
    let texts: string[] = [];
    let matched: { el: Element; offset: number }[] = [];
    let matchedDoc: Text | null = null;
    let queued = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;
    let detachPage = () => {};

    const pageWindow = (): Window | null => {
        try {
            // Null for a page on another origin: nothing to read, so no sync.
            return frame.contentDocument?.body ? frame.contentWindow : null;
        } catch {
            return null;
        }
    };

    const anchors = (win: Window): Anchor[] => {
        const doc = view.state.doc;
        if (matchedDoc !== doc) {
            matchedDoc = doc;
            const offsets = blockOffsets(doc.toString(), texts);
            matched = offsets.flatMap((offset, i) => (offset === null ? [] : [{ el: blocks[i], offset }]));
        }
        const editorTop = view.documentTop + scrollY;
        return anchorsFrom(
            matched.map(({ el, offset }) => [
                view.lineBlockAt(offset).top + editorTop,
                el.getBoundingClientRect().top + win.scrollY,
            ]),
            document.documentElement.scrollHeight,
            win.document.documentElement.scrollHeight
        );
    };

    const sync = () => {
        queued = 0;
        const win = pageWindow();
        if (!win) return;
        const a = anchors(win);
        if (lead === 'editor')
            win.scrollTo({ top: syncedScroll(scrollOf(window), scrollOf(win), a, 0), behavior: 'instant' });
        else scrollTo({ top: syncedScroll(scrollOf(win), scrollOf(window), a, 1), behavior: 'instant' });
    };
    const schedule = () => {
        queued ||= requestAnimationFrame(sync);
        // Once more after scrolling stops: the editor measures lines it scrolls to, so its heights shift.
        clearTimeout(settle);
        settle = setTimeout(sync, 150);
    };
    const follow = (side: typeof lead) => () => lead === side && schedule();

    const leadEditor = () => (lead = 'editor');
    const onEditorScroll = follow('editor');
    for (const e of INPUT) addEventListener(e, leadEditor, { capture: true, passive: true });
    addEventListener('scroll', onEditorScroll, { passive: true });

    const attach = () => {
        detachPage();
        const win = pageWindow();
        if (!win) return;
        blocks = [...win.document.body.querySelectorAll(BLOCKS)].filter((el) => el.getClientRects().length);
        texts = blocks.map((el) => el.textContent ?? '');
        matchedDoc = null;
        const leadPage = () => (lead = 'page');
        const onPageScroll = follow('page');
        for (const e of INPUT) win.addEventListener(e, leadPage, { capture: true, passive: true });
        win.addEventListener('scroll', onPageScroll, { passive: true });
        // Late images and fonts move the page's blocks. The page's own constructor: it watches its document.
        const resized = new (win as typeof window).ResizeObserver(schedule);
        resized.observe(win.document.documentElement);
        detachPage = () => {
            for (const e of INPUT) win.removeEventListener(e, leadPage, { capture: true });
            win.removeEventListener('scroll', onPageScroll);
            resized.disconnect();
        };
        // A (re)loaded page follows the editor, wherever it was.
        lead = 'editor';
        schedule();
    };
    frame.addEventListener('load', attach);

    return () => {
        frame.removeEventListener('load', attach);
        for (const e of INPUT) removeEventListener(e, leadEditor, { capture: true });
        removeEventListener('scroll', onEditorScroll);
        cancelAnimationFrame(queued);
        clearTimeout(settle);
        detachPage();
    };
}
