import { createHash } from 'node:crypto';

/** Content hash used to detect that the file changed under the editor. Must match the client's. */
export function hashText(text: string): string {
    return createHash('sha1').update(text, 'utf8').digest('hex');
}
