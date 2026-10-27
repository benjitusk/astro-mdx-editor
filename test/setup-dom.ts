// jsdom has no layout; CodeMirror only needs these to exist when it measures.
if (typeof Range !== 'undefined') {
    const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} });
    Range.prototype.getClientRects ??= () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect ??= empty as () => DOMRect;
}
