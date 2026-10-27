import { Text } from '@codemirror/state';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, relative } from 'node:path';
import type ts from 'typescript';
import type { ViteDevServer } from 'vite';
import { allElements, scanJsx } from '../client/jsx.ts';
import { findMeta } from '../client/meta.ts';
import type { ComponentInfo, PropInfo, Registry, ResolvedCollection } from '../types.ts';
import { listEntries, type EntryFile } from './entries.ts';
import { importLines } from './render.ts';

/**
 * What the slash menu and the props popover know about components: for each component an entry can
 * use (the site's globals, the entry's own imports, and anything other entries in the collection
 * import), its props from the `Props` type, its header comment as docs, and how it's usually written.
 *
 * Props are read with the TypeScript parser, from `interface Props` in an `.astro` frontmatter or the
 * first parameter's type of a `.tsx`/`.jsx` component. Nothing is type-checked or executed.
 */

let typescript: Promise<typeof ts> | undefined;
const loadTs = () => (typescript ??= import('typescript').then((m) => (m.default ?? m) as typeof ts));

/** A component as imported somewhere: the local name, the export it names, and the resolved file. */
interface Binding {
    name: string;
    exported: string;
    file: string;
    /** The specifier as written, for writing the same import into another entry. */
    specifier: string;
}

type Analysis = Pick<ComponentInfo, 'doc' | 'props' | 'children'> & { example: string };

export function createRegistry(server: ViteDevServer, root: string, globals: string | null) {
    const analyses = new Map<string, { mtime: number; result: Analysis }>();

    async function resolve(specifier: string, importer: string): Promise<string | null> {
        const env = server.environments.ssr as unknown as {
            pluginContainer: { resolveId: (id: string, importer: string) => Promise<{ id: string } | null> };
        };
        const r = await env.pluginContainer.resolveId(specifier, importer).catch(() => null);
        return r ? r.id.replace(/[?#].*$/, '') : null;
    }

    async function bindings(code: string, importer: string, exportsOnly: boolean): Promise<Binding[]> {
        const t = await loadTs();
        const src = t.createSourceFile('x.ts', code, t.ScriptTarget.Latest, false, t.ScriptKind.TS);
        const out: Binding[] = [];
        for (const st of src.statements) {
            const spec = (t.isImportDeclaration(st) || t.isExportDeclaration(st)) && st.moduleSpecifier;
            if (!spec || !t.isStringLiteral(spec)) continue;
            const names: [string, string][] = [];
            if (t.isImportDeclaration(st) && !exportsOnly) {
                const clause = st.importClause;
                if (!clause || clause.isTypeOnly) continue;
                if (clause.name) names.push([clause.name.text, 'default']);
                if (clause.namedBindings && t.isNamedImports(clause.namedBindings))
                    for (const el of clause.namedBindings.elements)
                        names.push([el.name.text, (el.propertyName ?? el.name).text]);
            } else if (t.isExportDeclaration(st) && st.exportClause && t.isNamedExports(st.exportClause)) {
                for (const el of st.exportClause.elements)
                    names.push([el.name.text, (el.propertyName ?? el.name).text]);
            }
            const tags = names.filter(([n]) => /^[A-Z]/.test(n));
            if (!tags.length) continue;
            const file = await resolve(spec.text, importer);
            if (!file) continue;
            for (const [name, exported] of tags) out.push({ name, exported, file, specifier: spec.text });
        }
        return out;
    }

    async function analyse(file: string, exported: string): Promise<Analysis> {
        const key = `${file}#${exported}`;
        const mtime = (await stat(file)).mtimeMs;
        const hit = analyses.get(key);
        if (hit && hit.mtime === mtime) return hit.result;
        const result = await analyseFile(await loadTs(), file, await readFile(file, 'utf8'), exported);
        analyses.set(key, { mtime, result });
        return result;
    }

    /** Usage across the collection: the form each component is written in, and the quote style. */
    async function usage(entries: EntryFile[]) {
        const forms = new Map<string, Record<'block' | 'line' | 'void', number>>();
        const quotes = { '"': 0, "'": 0 };
        const imports: { entry: EntryFile; bindings: Binding[] }[] = [];
        for (const entry of entries) {
            const text = await readFile(entry.path, 'utf8').catch(() => '');
            for (const el of allElements(scanJsx(text, findMeta(Text.of(text.split('\n')))))) {
                for (const p of el.props) if (p.value !== null) quotes[p.raw![0] as '"' | "'"]++;
                if (el.kind === 'inline') continue;
                const f = forms.get(el.name) ?? { block: 0, line: 0, void: 0 };
                f[el.kind]++;
                forms.set(el.name, f);
            }
            imports.push({ entry, bindings: await bindings(importLines(text).join('\n'), entry.path, false) });
        }
        return { forms, quote: (quotes["'"] > quotes['"'] ? "'" : '"') as Registry['quote'], imports };
    }

    async function registry(collections: ResolvedCollection[], entry: EntryFile): Promise<Registry> {
        const entries = (await listEntries(collections)).filter((e) => e.collection === entry.collection);
        const { forms, quote, imports } = await usage(entries);
        const own = imports.find((i) => i.entry.path === entry.path)?.bindings ?? [];
        const global = globals && (await bindings(await readFile(globals, 'utf8').catch(() => ''), globals, true));

        // Available as they are: the globals and this entry's imports. Then the components other
        // entries import, which need an import line added first.
        const found = new Map<string, { b: Binding; import: string | null }>();
        for (const b of [...(global || []), ...own]) found.set(b.name, { b, import: null });
        for (const { entry: other, bindings: bs } of imports) {
            for (const b of bs) {
                const known = [...found.values()].some((f) => f.b.file === b.file && f.b.exported === b.exported);
                if (found.has(b.name) || known || other.path === entry.path) continue;
                found.set(b.name, { b, import: importFor(b, entry) });
            }
        }

        const components: ComponentInfo[] = [];
        for (const { b, import: imp } of found.values()) {
            let a: Analysis;
            try {
                a = await analyse(b.file, b.exported);
            } catch {
                a = { doc: '', props: null, children: true, example: '' };
            }
            components.push({
                name: b.name,
                file: relative(root, b.file),
                doc: a.doc,
                props: a.props,
                children: a.children,
                form: formOf(b.name, forms.get(b.name), a),
                import: imp,
            });
        }
        components.sort((x, y) => x.name.localeCompare(y.name));
        return { components, quote };
    }

    return { registry };
}

/** The import line for `b` in entry `to`: the specifier as written, or a path from `to`'s folder if it's relative. */
function importFor(b: Binding, to: EntryFile): string {
    let spec = b.specifier;
    if (spec.startsWith('.')) {
        spec = relative(dirname(to.path), b.file).split('\\').join('/');
        if (!spec.startsWith('.')) spec = `./${spec}`;
    }
    const clause =
        b.exported === 'default' ? b.name : `{ ${b.exported === b.name ? b.name : `${b.exported} as ${b.name}`} }`;
    return `import ${clause} from '${spec}';`;
}

function formOf(name: string, counts: Record<'block' | 'line' | 'void', number> | undefined, a: Analysis) {
    if (counts) {
        const best = (Object.entries(counts) as [ComponentInfo['form'], number][]).sort((x, y) => y[1] - x[1])[0];
        if (best[1] > 0) return best[0];
    }
    if (!a.children) return 'void';
    // The doc's own example, if it writes the element on one line.
    const one = new RegExp(`<${name}\\b[^\\n]*</${name}>`);
    return one.test(a.example) ? 'line' : 'block';
}

// ---------- reading a component file ----------

export async function analyseFile(t: typeof ts, file: string, text: string, exported: string): Promise<Analysis> {
    const ext = extname(file);
    if (ext === '.astro') {
        const m = /^\s*---\r?\n([\s\S]*?)\r?\n---/.exec(text);
        const front = m?.[1] ?? '';
        const template = m ? text.slice(m.index + m[0].length) : text;
        const src = t.createSourceFile('c.ts', front, t.ScriptTarget.Latest, true, t.ScriptKind.TS);
        const decl = typeNamed(t, src, 'Props');
        const doc = cleanComment((decl && jsdocOf(t, decl, src)) || firstDocComment(front));
        const defaults = defaultsFrom(t, src, (init) => init.getText(src) === 'Astro.props');
        return {
            doc,
            props: decl ? propsOf(t, src, decl, defaults) : front.includes('Astro.props') ? null : [],
            children: /<slot\b/.test(template),
            example: doc,
        };
    }
    if (['.tsx', '.jsx', '.ts', '.js'].includes(ext)) {
        const kind = ext === '.tsx' ? t.ScriptKind.TSX : ext === '.jsx' ? t.ScriptKind.JSX : t.ScriptKind.TS;
        const src = t.createSourceFile(file, text, t.ScriptTarget.Latest, true, kind);
        const fn = componentFunction(t, src, exported);
        const param = fn?.parameters[0];
        let decl: ts.Node | undefined;
        if (param?.type && t.isTypeReferenceNode(param.type))
            decl = typeNamed(t, src, param.type.typeName.getText(src));
        else if (param?.type && t.isTypeLiteralNode(param.type)) decl = param.type;
        const defaults = new Map<string, string>();
        if (param && t.isObjectBindingPattern(param.name)) collectDefaults(t, src, param.name, defaults);
        const props = decl ? propsOf(t, src, decl, defaults) : param ? null : [];
        const docNode = fn && (t.isFunctionDeclaration(fn) ? fn : fn.parent?.parent?.parent);
        const doc = cleanComment(
            (docNode && jsdocOf(t, docNode, src)) ||
                (decl && jsdocOf(t, declStatement(t, decl), src)) ||
                firstDocComment(text)
        );
        return {
            doc,
            props: props?.filter((p) => p.name !== 'children') ?? null,
            children: (props ?? []).some((p) => p.name === 'children') || /\bchildren\b/.test(fn?.getText(src) ?? ''),
            example: doc,
        };
    }
    return { doc: '', props: null, children: true, example: '' };
}

function typeNamed(t: typeof ts, src: ts.SourceFile, name: string): ts.Node | undefined {
    for (const st of src.statements) {
        if (t.isInterfaceDeclaration(st) && st.name.text === name) return st;
        if (t.isTypeAliasDeclaration(st) && st.name.text === name) return st.type;
    }
}

const declStatement = (t: typeof ts, n: ts.Node) => (t.isTypeAliasDeclaration(n.parent) ? n.parent : n);

function membersOf(t: typeof ts, n: ts.Node): readonly ts.TypeElement[] {
    if (t.isInterfaceDeclaration(n) || t.isTypeLiteralNode(n)) return n.members;
    if (t.isIntersectionTypeNode(n)) return n.types.flatMap((x) => [...membersOf(t, x)]);
    return [];
}

function propsOf(t: typeof ts, src: ts.SourceFile, decl: ts.Node, defaults: Map<string, string>): PropInfo[] {
    const out: PropInfo[] = [];
    for (const m of membersOf(t, decl)) {
        if (!t.isPropertySignature(m) || !m.name) continue;
        const name = t.isStringLiteral(m.name) || t.isIdentifier(m.name) ? m.name.text : m.name.getText(src);
        const type = m.type?.getText(src) ?? 'any';
        const info: PropInfo = { name, required: !m.questionToken, type, ...kindOf(t, m.type) };
        const dflt = defaults.get(name);
        if (dflt !== undefined) info.default = dflt;
        const doc = jsdocOf(t, m, src);
        if (doc) info.doc = cleanComment(doc);
        out.push(info);
    }
    return out;
}

function kindOf(t: typeof ts, type: ts.TypeNode | undefined): Pick<PropInfo, 'kind' | 'options'> {
    if (!type) return { kind: 'expression' };
    let parts = t.isUnionTypeNode(type) ? [...type.types] : [type];
    parts = parts.filter((p) => !(t.isLiteralTypeNode(p) && p.literal.kind === t.SyntaxKind.NullKeyword));
    parts = parts.filter((p) => p.kind !== t.SyntaxKind.UndefinedKeyword);
    const strings = parts.filter((p) => t.isLiteralTypeNode(p) && t.isStringLiteral(p.literal));
    if (parts.length && strings.length === parts.length)
        return {
            kind: 'enum',
            options: strings.map((p) => ((p as ts.LiteralTypeNode).literal as ts.StringLiteral).text),
        };
    if (parts.some((p) => p.kind === t.SyntaxKind.StringKeyword)) return { kind: 'string' };
    if (parts.length === 1 && parts[0].kind === t.SyntaxKind.NumberKeyword) return { kind: 'number' };
    if (parts.length === 1 && parts[0].kind === t.SyntaxKind.BooleanKeyword) return { kind: 'boolean' };
    return { kind: 'expression' };
}

function defaultsFrom(t: typeof ts, src: ts.SourceFile, isProps: (init: ts.Expression) => boolean) {
    const out = new Map<string, string>();
    const visit = (n: ts.Node) => {
        if (t.isVariableDeclaration(n) && n.initializer && t.isObjectBindingPattern(n.name) && isProps(n.initializer))
            collectDefaults(t, src, n.name, out);
        t.forEachChild(n, visit);
    };
    visit(src);
    return out;
}

function collectDefaults(t: typeof ts, src: ts.SourceFile, pattern: ts.ObjectBindingPattern, out: Map<string, string>) {
    for (const el of pattern.elements) {
        if (!el.initializer) continue;
        const name = el.propertyName ?? el.name;
        if (t.isIdentifier(name)) out.set(name.text, el.initializer.getText(src));
    }
}

/** The function behind an export: `export default function`, `export function X`, `export const X = () =>`. */
function componentFunction(
    t: typeof ts,
    src: ts.SourceFile,
    exported: string
): ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | undefined {
    const isExported = (n: ts.Node) =>
        t.canHaveModifiers(n) && (t.getModifiers(n) ?? []).some((m) => m.kind === t.SyntaxKind.ExportKeyword);
    const isDefault = (n: ts.Node) =>
        t.canHaveModifiers(n) && (t.getModifiers(n) ?? []).some((m) => m.kind === t.SyntaxKind.DefaultKeyword);
    let local = exported === 'default' ? null : exported;
    for (const st of src.statements) {
        if (exported === 'default') {
            if (t.isFunctionDeclaration(st) && isDefault(st)) return st;
            if (t.isExportAssignment(st)) {
                if (t.isIdentifier(st.expression)) local = st.expression.text;
                else if (t.isArrowFunction(st.expression) || t.isFunctionExpression(st.expression))
                    return st.expression;
            }
        } else if (t.isFunctionDeclaration(st) && isExported(st) && st.name?.text === exported) return st;
    }
    if (!local) return;
    for (const st of src.statements) {
        if (t.isFunctionDeclaration(st) && st.name?.text === local) return st;
        if (t.isVariableStatement(st))
            for (const d of st.declarationList.declarations) {
                if (!t.isIdentifier(d.name) || d.name.text !== local || !d.initializer) continue;
                if (t.isArrowFunction(d.initializer) || t.isFunctionExpression(d.initializer)) return d.initializer;
            }
    }
}

function jsdocOf(t: typeof ts, node: ts.Node, src: ts.SourceFile): string {
    const ranges = t.getLeadingCommentRanges(src.text, node.getFullStart()) ?? [];
    const last = ranges.filter((r) => src.text.startsWith('/**', r.pos)).at(-1);
    return last ? src.text.slice(last.pos, last.end) : '';
}

function firstDocComment(text: string): string {
    return /\/\*\*[\s\S]*?\*\//.exec(text)?.[0] ?? '';
}

/** `/** … *\/` without its markers; indentation inside (code examples) is kept. */
export function cleanComment(comment: string): string {
    if (!comment) return '';
    const lines = comment
        .replace(/^\/\*\*\s?/, '')
        .replace(/\s*\*\/$/, '')
        .split('\n')
        .map((l) => l.replace(/^\s*\* ?/, ''));
    return lines.join('\n').trim();
}
