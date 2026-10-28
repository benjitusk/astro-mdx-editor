import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The path of a module relative to `base` (an `import.meta.url`), with base's own extension: `.ts`
 * when running from source, `.js` when built into dist/.
 */
export function siblingModule(name: string, base: string): string {
    return fileURLToPath(new URL(`${name}${extname(new URL(base).pathname)}`, base));
}
