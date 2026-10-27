import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_EMOJI_SHORTCODES } from '../defaults.ts';
import type { EmojiOptions } from '../types.ts';

/** Shortcode → [emoji, label]. */
export type EmojiTable = Record<string, [string, string]>;

interface Registry {
    HEXCODES: Record<string, string>;
    SHORTCODES: Record<string, Record<string, string>>;
    LABELS: Record<string, Record<string, string>>;
}

/**
 * The shortcodes the site's satteri-emoji resolves, read from the site's own copy of its registry so
 * the editor previews exactly what the page will show. Catalogs merge in order, later ones winning,
 * as in the plugin. Null when the site doesn't have satteri-emoji.
 */
export async function loadEmojiTable(root: string, options: EmojiOptions): Promise<EmojiTable | null> {
    let entry: string;
    try {
        entry = createRequire(join(root, 'package.json')).resolve('satteri-emoji');
    } catch {
        return null;
    }
    // The package only exports its plugin; the registry sits next to it.
    const registry = (await import(pathToFileURL(join(dirname(entry), 'registry.js')).href)) as Registry;
    const labels = registry.LABELS[options.locale ?? 'en'] ?? registry.LABELS.en;
    const hexcodes: Record<string, string> = {};
    for (const catalog of options.shortcodes ?? DEFAULT_EMOJI_SHORTCODES)
        Object.assign(hexcodes, registry.SHORTCODES[catalog]);
    const table: EmojiTable = {};
    for (const [code, hex] of Object.entries(hexcodes)) {
        const emoji = registry.HEXCODES[hex];
        if (emoji) table[code] = [emoji, labels[hex] ?? code];
    }
    return table;
}
