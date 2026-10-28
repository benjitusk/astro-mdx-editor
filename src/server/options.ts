import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Checks the integration's options before anything uses them, so a typo or a wrong type stops the dev
 * server with a message naming the option, instead of a stack trace from deep inside a hook. Problems
 * that don't stop the editor (a collection folder that doesn't exist yet) are warnings.
 */

export interface OptionProblems {
    errors: string[];
    warnings: string[];
}

const TOP = ['shell', 'globals', 'collections', 'typography', 'keymap', 'callouts', 'emoji', 'images'];
const COLLECTION = ['dir', 'pageUrl', 'newEntry', 'images'];
const TYPOGRAPHY = ['quotes', 'dashes', 'ellipsis'];
const IMAGES = ['dir', 'snippet'];
const EMOJI = ['shortcodes', 'locale'];

export function checkOptions(value: unknown, root: string): OptionProblems {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (value === undefined) return { errors, warnings };
    if (!isObject(value)) {
        errors.push(`the options must be an object, got ${describe(value)}`);
        return { errors, warnings };
    }
    unknownKeys(value, TOP, '', errors);

    for (const key of ['shell', 'globals'] as const) {
        const path = value[key];
        if (path === undefined) continue;
        if (typeof path !== 'string' || !path) {
            errors.push(`\`${key}\` must be a path relative to the project, got ${describe(path)}`);
        } else if (!existsSync(resolve(root, path))) {
            errors.push(`\`${key}\`: ${path} doesn't exist`);
        } else if (key === 'shell' && !path.endsWith('.astro')) {
            errors.push(`\`shell\` must be an .astro component, got ${path}`);
        }
    }

    const collections = value.collections;
    if (collections !== undefined) {
        if (!isObject(collections)) {
            errors.push(`\`collections\` must be an object like { blog: {} }, got ${describe(collections)}`);
        } else {
            for (const [name, c] of Object.entries(collections)) {
                const at = `collections.${name}`;
                if (!isObject(c)) {
                    errors.push(`\`${at}\` must be an object (\`{}\` for the defaults), got ${describe(c)}`);
                    continue;
                }
                unknownKeys(c, COLLECTION, `${at}.`, errors);
                if (c.dir !== undefined && typeof c.dir !== 'string') {
                    errors.push(`\`${at}.dir\` must be a folder relative to the project, got ${describe(c.dir)}`);
                }
                const dir = typeof c.dir === 'string' ? c.dir : `src/content/${name}`;
                if (!existsSync(resolve(root, dir))) warnings.push(`\`${at}\`: ${dir} doesn't exist yet`);
                if (c.pageUrl !== undefined && typeof c.pageUrl !== 'function') {
                    errors.push(`\`${at}.pageUrl\` must be a function such as (id) => \`/${name}/\${id}/\``);
                }
                if (c.newEntry !== undefined && typeof c.newEntry !== 'function') {
                    errors.push(`\`${at}.newEntry\` must be a function such as (title) => ({ title })`);
                }
                checkImages(c.images, `${at}.images`, errors);
            }
        }
    }

    const typography = value.typography;
    if (typography !== undefined) {
        if (!isObject(typography)) errors.push(`\`typography\` must be an object, got ${describe(typography)}`);
        else {
            unknownKeys(typography, TYPOGRAPHY, 'typography.', errors);
            for (const key of TYPOGRAPHY) {
                if (typography[key] !== undefined && typeof typography[key] !== 'boolean') {
                    errors.push(`\`typography.${key}\` must be true or false, got ${describe(typography[key])}`);
                }
            }
        }
    }

    const keymap = value.keymap;
    if (keymap !== undefined) {
        if (!isObject(keymap) || Object.values(keymap).some((k) => typeof k !== 'string')) {
            errors.push(`\`keymap\` must map command ids to keys, like { 'format.bold': 'Mod-Shift-b' }`);
        }
    }

    const callouts = value.callouts;
    if (callouts !== undefined && !(Array.isArray(callouts) && callouts.every((c) => typeof c === 'string'))) {
        errors.push(`\`callouts\` must be a list of callout types, got ${describe(callouts)}`);
    }

    const emoji = value.emoji;
    if (emoji !== undefined && emoji !== false) {
        if (!isObject(emoji)) errors.push(`\`emoji\` must be an object or false, got ${describe(emoji)}`);
        else {
            unknownKeys(emoji, EMOJI, 'emoji.', errors);
            const codes = emoji.shortcodes;
            if (codes !== undefined && !(Array.isArray(codes) && codes.every((c) => typeof c === 'string'))) {
                errors.push(`\`emoji.shortcodes\` must be a list of catalog names, got ${describe(codes)}`);
            }
            if (emoji.locale !== undefined && typeof emoji.locale !== 'string') {
                errors.push(`\`emoji.locale\` must be a string, got ${describe(emoji.locale)}`);
            }
        }
    }

    checkImages(value.images, 'images', errors);
    return { errors, warnings };
}

function checkImages(images: unknown, at: string, errors: string[]): void {
    if (images === undefined || images === false) return;
    if (!isObject(images)) {
        errors.push(`\`${at}\` must be an object or false, got ${describe(images)}`);
        return;
    }
    unknownKeys(images, IMAGES, `${at}.`, errors);
    if (images.dir !== undefined && typeof images.dir !== 'string') {
        errors.push(`\`${at}.dir\` must be a folder relative to the project, got ${describe(images.dir)}`);
    }
    if (images.snippet !== undefined && typeof images.snippet !== 'function') {
        errors.push(`\`${at}.snippet\` must be a function that returns the markup`);
    }
}

function unknownKeys(value: Record<string, unknown>, known: string[], prefix: string, errors: string[]): void {
    for (const key of Object.keys(value)) {
        if (known.includes(key)) continue;
        const near = known.find((k) => k.startsWith(key) || key.startsWith(k));
        const hint = near ? `; did you mean \`${prefix}${near}\`?` : `; expected one of ${known.join(', ')}`;
        errors.push(`unknown option \`${prefix}${key}\`${hint}`);
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
    if (Array.isArray(value)) return 'a list';
    if (value === null) return 'null';
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'object') return 'an object';
    if (typeof value === 'function') return 'a function';
    return String(value);
}
