import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseItemListQuery } from '../../shared/params.js';
import { CONSUMABLE_SUBTYPES } from '../../shared/rules.js';
import { listStaticItems, prepareDataset, type StaticDataset } from '../../shared/staticQuery.js';

// Checks the type and subtype filters against the real export in site-data/ (skipped if it is not there).
// The numbers change with every export, so only invariants are asserted, never absolute counts.
const siteDataDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site-data');
const hasSiteData = fs.existsSync(path.join(siteDataDirectory, 'items.json'));

function loadDataset(): StaticDataset {
    const read = (name: string) => JSON.parse(fs.readFileSync(path.join(siteDataDirectory, name), 'utf8'));
    return prepareDataset({
        meta: read('meta.json'),
        items: read('items.json'),
        updates: read('updates.json'),
        changes: read('changes.json'),
    } as Parameters<typeof prepareDataset>[0]);
}

// All matching IDs; walks through the pages because the page size is capped.
const listIds = (dataset: StaticDataset, queryString: string) => {
    const ids: number[] = [];
    for (let page = 1; ; page++) {
        const params = { ...Object.fromEntries(new URLSearchParams(queryString)), pageSize: '200', page: String(page) };
        const response = listStaticItems(dataset, parseItemListQuery(params));
        ids.push(...response.items.map((item) => item.id));
        if (ids.length >= response.total || response.items.length === 0) return ids;
    }
};

describe('Real data (site-data): type and subtype filters', { skip: !hasSiteData }, () => {
    it('every consumable subtype in the data can be selected (is part of CONSUMABLE_SUBTYPES)', () => {
        const dataset = loadDataset();
        const known = new Set<string>(CONSUMABLE_SUBTYPES);
        const unknown = new Set<string>();
        for (const item of dataset.items) {
            if (item.src.type === 'Consumable' && item.subtype !== null && !known.has(item.subtype)) {
                unknown.add(item.subtype);
            }
        }
        assert.deepEqual([...unknown], [], 'subtypes missing in CONSUMABLE_SUBTYPES');
    });

    it('the subtype options partition the consumable candidates; hideCommon only removes hidden subtypes', () => {
        const dataset = loadDataset();
        const base = 'view=consumable&hideCommon=false&hideAutoConsumed=false&hidePlaceholders=false&candidate=all';
        const all = listIds(dataset, base);
        const perSubtype = CONSUMABLE_SUBTYPES.map((subtype) => listIds(dataset, `${base}&subtype=${subtype}`));
        assert.equal(
            perSubtype.reduce((sum, ids) => sum + ids.length, 0),
            all.length,
            'consumables without a known subtype would be unfilterable',
        );
        assert.deepEqual(listIds(dataset, `${base}&subtype=${CONSUMABLE_SUBTYPES.join(',')}`), all);
        const sorted = [...perSubtype.flat()].sort((a, b) => a - b);
        assert.deepEqual(
            sorted,
            [...all].sort((a, b) => a - b),
        );
    });

    it('the tonic type filter splits the tonic view into Gizmo and Consumable', () => {
        const dataset = loadDataset();
        const base = 'view=tonic&hideAutoConsumed=false&hidePlaceholders=false&candidate=all';
        const all = listIds(dataset, base);
        const gizmos = listIds(dataset, `${base}&itemType=Gizmo`);
        const consumables = listIds(dataset, `${base}&itemType=Consumable`);
        assert.ok(all.length > 0);
        assert.equal(gizmos.length + consumables.length, all.length);
        assert.deepEqual(listIds(dataset, `${base}&itemType=Gizmo,Consumable`), all);
    });
});
