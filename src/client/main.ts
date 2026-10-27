import type { ClientConfig } from '../types.ts';
import { createEditor } from './editor.ts';
import './editor.css';

const read = <T>(id: string): T => JSON.parse(document.getElementById(id)!.textContent!);

const parent = document.getElementById('mdx-editor');
if (parent) {
    const cfg = read<ClientConfig>('mdx-editor-config');
    const text = read<string>('mdx-editor-doc');
    const editor = createEditor(parent, cfg, text);
    Object.assign(window, { mdxEditor: editor });
    editor.view.focus();
}
