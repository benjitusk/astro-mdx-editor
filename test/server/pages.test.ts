import { describe, expect, it } from 'vitest';
import { entriesForPage } from '../../src/server/pages.ts';

const entries = [
    { collection: 'essays', id: 'judging' },
    { collection: 'essays', id: '2024/notes' },
    { collection: 'projects', id: 'robot' },
    { collection: 'projects', id: 'notes' },
    { collection: 'notes', id: 'notes' },
];
const noUrls = () => null;
const drafts = (collection: string, id: string) => (collection === 'essays' ? `/drafts/${id}/` : null);

describe('entriesForPage', () => {
    it('matches an entry by its pageUrl', () => {
        expect(entriesForPage('/drafts/judging/', entries, drafts)).toEqual([entries[0]]);
        expect(entriesForPage('/drafts/judging', entries, drafts)).toEqual([entries[0]]);
        expect(entriesForPage('/drafts/judging/index.html', entries, drafts)).toEqual([entries[0]]);
    });
    it('matches a path ending in an entry id, without a pageUrl', () => {
        expect(entriesForPage('/essays/judging/', entries, drafts)).toEqual([entries[0]]);
        expect(entriesForPage('/judging', entries, noUrls)).toEqual([entries[0]]);
        expect(entriesForPage('/essays/2024/notes/?x=1', entries, noUrls)).toEqual([entries[1]]);
        expect(entriesForPage('/projects/robot.html', entries, noUrls)).toEqual([entries[2]]);
    });
    it('only matches whole segments', () => {
        expect(entriesForPage('/essays/prejudging/', entries, noUrls)).toEqual([]);
    });
    it('prefers entries whose collection is in the path, and returns ties', () => {
        expect(entriesForPage('/projects/notes/', entries, noUrls)).toEqual([entries[3]]);
        expect(entriesForPage('/notes/notes/', entries, noUrls)).toEqual([entries[4]]);
        expect(entriesForPage('/x/notes/', entries, noUrls)).toEqual([entries[3], entries[4]]);
    });
    it('decodes the path', () => {
        const odd = [{ collection: 'essays', id: 'café' }];
        expect(entriesForPage('/essays/caf%C3%A9/', odd, noUrls)).toEqual(odd);
    });
    it('shows nothing for the home page or the editor', () => {
        expect(entriesForPage('/', entries, noUrls)).toEqual([]);
        expect(entriesForPage('/__edit/essays/judging', entries, noUrls)).toEqual([]);
        expect(entriesForPage('/__edit', entries, noUrls)).toEqual([]);
    });
});
