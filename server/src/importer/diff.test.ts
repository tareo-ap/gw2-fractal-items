import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Gw2Item } from '../gw2/client.js';
import { changedFields, diffItem, hashItem, normalizeGameTypes, stableStringify, type StoredItem } from './diff.js';

const base: Gw2Item = {
    id: 1,
    name: 'Mini Golem Kit',
    type: 'Gizmo',
    rarity: 'Rare',
    level: 0,
    game_types: ['Pve', 'Dungeon'],
    details: { type: 'Default', b: 1, a: 2 },
};

function stored(item: Gw2Item, removed = false): StoredItem {
    return {
        hash: hashItem(item),
        rawJson: JSON.stringify(item),
        removed,
        gameTypes: normalizeGameTypes(item.game_types),
    };
}

describe('stableStringify / hashItem', () => {
    it('is independent of key order, also nested', () => {
        const reordered: Gw2Item = {
            details: { a: 2, type: 'Default', b: 1 },
            level: 0,
            game_types: ['Pve', 'Dungeon'],
            rarity: 'Rare',
            type: 'Gizmo',
            name: 'Mini Golem Kit',
            id: 1,
        };
        assert.equal(stableStringify(reordered), stableStringify(base));
        assert.equal(hashItem(reordered), hashItem(base));
    });

    it('detects changes to values', () => {
        assert.notEqual(hashItem({ ...base, name: 'Other' }), hashItem(base));
    });
});

describe('changedFields', () => {
    it('returns changed, new and removed top-level fields', () => {
        const before = { a: 1, b: { x: 1 }, c: 'gone' };
        const after = { a: 1, b: { x: 2 }, d: 'new' };
        assert.deepEqual(changedFields(before, after), ['b', 'c', 'd']);
    });
});

describe('diffItem', () => {
    it('added if the item is unknown', () => {
        assert.deepEqual(diffItem(undefined, base, hashItem(base)), {
            kind: 'added',
            gameTypesAfter: ['Dungeon', 'Pve'],
        });
    });

    it('added if a removed item comes back', () => {
        assert.equal(diffItem(stored(base, true), base, hashItem(base)).kind, 'added');
    });

    it('unchanged for the same hash', () => {
        assert.deepEqual(diffItem(stored(base), base, hashItem(base)), { kind: 'unchanged' });
    });

    it('changed with game_types before/after when Dungeon is lost', () => {
        const next: Gw2Item = { ...base, game_types: ['Pve'], description: 'neu' };
        assert.deepEqual(diffItem(stored(base), next, hashItem(next)), {
            kind: 'changed',
            changedFields: ['description', 'game_types'],
            gameTypesBefore: ['Dungeon', 'Pve'],
            gameTypesAfter: ['Pve'],
            valuesBefore: { game_types: ['Pve', 'Dungeon'] },
            valuesAfter: { description: 'neu', game_types: ['Pve'] },
        });
    });
});

describe('normalizeGameTypes', () => {
    it('sorts, removes duplicates and non-strings', () => {
        assert.deepEqual(normalizeGameTypes(['Wvw', 'Dungeon', 'Wvw', 3]), ['Dungeon', 'Wvw']);
        assert.deepEqual(normalizeGameTypes(undefined), []);
    });
});
