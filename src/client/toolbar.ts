import type { DevToolbarApp } from 'astro';
import { PAGE_ANSWER, PAGE_QUERY, TOOLBAR_APP_ID, type EditedEntry, type PageEntry } from '../server/pages.ts';

/**
 * "Edit this page" in Astro's dev toolbar. On a page that shows an entry (src/server/pages.ts decides
 * which), the app's icon gets a dot and a click opens that entry in the editor. Anywhere else, or when
 * the page could be one of several entries, it opens a window to choose from. In the editor itself, it
 * goes the other way: a click opens the entry's published page, and the button says so.
 */

const editorUrl = (e: PageEntry) => `/__edit/${e.collection}/${e.id}`;

/** The button's look in the editor: an eye, drawn like the pencil (24px, currentColor). */
const VIEW_NAME = 'View this page';
const VIEW_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';

const app: DevToolbarApp = {
    init(canvas, app, server) {
        let entries: PageEntry[] = [];
        let editing: EditedEntry | null = null;
        let asked = '';

        const ask = () => {
            asked = location.pathname;
            server.send(PAGE_QUERY, { path: asked });
        };
        server.on<{ path: string; entries: PageEntry[]; editing: EditedEntry | null }>(PAGE_ANSWER, (data) => {
            if (data.path !== asked) return;
            entries = data.entries;
            editing = data.editing;
            relabel(editing !== null);
            const linked = editing ? editing.url !== null : entries.length > 0;
            app.toggleNotification(linked ? { state: true, level: 'info' } : { state: false });
        });
        ask();
        // A client-side navigation (Astro's ClientRouter) keeps the toolbar but changes the page.
        document.addEventListener('astro:page-load', () => {
            if (location.pathname !== asked) ask();
        });

        app.onToggled(({ state }) => {
            canvas.replaceChildren();
            if (!state) return;
            if (editing) {
                if (editing.url === null) {
                    canvas.append(unpublished(editing));
                    return;
                }
                app.toggleState({ state: false });
                location.assign(editing.url);
                return;
            }
            if (entries.length === 1) {
                app.toggleState({ state: false });
                location.assign(editorUrl(entries[0]));
                return;
            }
            canvas.append(chooser(entries));
        });
    },
};

export default app;

let pencil: { name: string; icon: string } | null = null;

/**
 * Shows the eye and "View this page" in the editor, the pencil elsewhere. Astro's toolbar has no API for
 * an app's icon or name, so this edits the app's button in the toolbar's shadow DOM; if Astro changes
 * that markup, the button just keeps the pencil.
 */
function relabel(viewing: boolean) {
    const button = document
        .querySelector('astro-dev-toolbar')
        ?.shadowRoot?.querySelector(`button[data-app-id="${TOOLBAR_APP_ID}"]`);
    const icon = button?.querySelector(':scope > .icon > svg');
    const tooltip = button?.querySelector('.item-tooltip');
    if (!icon || !tooltip) return;
    pencil ??= { name: tooltip.textContent ?? '', icon: icon.outerHTML };
    tooltip.textContent = viewing ? VIEW_NAME : pencil.name;
    icon.outerHTML = viewing ? VIEW_ICON : pencil.icon;
}

/** A toolbar window with the app's styles and a title. */
function toolbarWindow(heading: string): HTMLElement {
    const win = document.createElement('astro-dev-toolbar-window');
    const style = document.createElement('style');
    style.textContent = `
        h1 { margin: 0 0 8px; font-size: 22px; font-weight: 600; color: #fff; }
        p { margin: 0 0 12px; color: rgba(204, 206, 216, 1); }
        ul { margin: 0 0 12px; padding: 0; list-style: none; }
        li { padding: 4px 0; }
        a { color: rgba(224, 204, 250, 1); }
    `;
    const title = document.createElement('h1');
    title.textContent = heading;
    win.append(style, title);
    return win;
}

/** In the editor, for an entry whose collection has no `pageUrl`: there's no page to go back to. */
function unpublished(entry: EditedEntry): HTMLElement {
    const win = toolbarWindow(VIEW_NAME);
    const option = document.createElement('code');
    option.textContent = 'pageUrl';
    const note = document.createElement('p');
    note.append(
        `The editor doesn’t know where ${entry.collection}/${entry.id} is published. Set `,
        option,
        ' on its collection to link them.'
    );
    win.append(note, link('/__edit', 'All entries'));
    return win;
}

function chooser(entries: PageEntry[]): HTMLElement {
    const win = toolbarWindow('Edit this page');
    const note = document.createElement('p');
    if (entries.length) note.textContent = 'This page could show any of these entries:';
    else {
        const option = document.createElement('code');
        option.textContent = 'pageUrl';
        note.append(
            'This page doesn’t show an entry the editor knows. Set ',
            option,
            ' on its collection to link them.'
        );
    }
    win.append(note);
    if (entries.length) {
        const list = document.createElement('ul');
        for (const e of entries) {
            const item = document.createElement('li');
            item.append(link(editorUrl(e), `${e.collection}/${e.id}`));
            list.append(item);
        }
        win.append(list);
    }
    win.append(link('/__edit', 'All entries'));
    return win;
}

function link(href: string, text: string): HTMLAnchorElement {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    return a;
}
