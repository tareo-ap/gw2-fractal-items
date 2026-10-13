import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    AUTO_CONSUMED_PHRASES,
    chatLinkForId,
    compareNoCase,
    CONSUMABLE_SUBTYPES,
    HIDE_COMMON_SUBTYPES,
    HOMESTEAD_PHRASE,
    isAutoConsumed,
    isCommonConsumable,
    isGuildOrHomesteadItem,
    isHiddenByHideCommon,
    isPlaceholder,
    isTonic,
    itemIdFromChatLink,
    itemTypeFilterApplies,
    sqlTrim,
    subtypeFilterApplies,
} from '../../shared/rules.js';
import { parseItemListQuery, ValidationError } from '../../shared/params.js';
import { searchPhrases, tokenize } from '../../shared/staticQuery.js';
import { chatLinkFor } from './test/fixtures.js';

// Rules from shared/ that the browser evaluates instead of SQL. staticConsistency.test.ts checks that they match the
// server.

describe('Rules', () => {
    const item = (
        name: string,
        extra: Partial<{ type: string; subtype: string | null; icon: string | null; flags: string[] }> = {},
    ) => ({
        name,
        type: 'Consumable',
        subtype: null,
        icon: 'x.png',
        flags: [],
        ...extra,
    });

    it('Placeholders: empty name (whitespace counts), no icon, ((…)) and [[…]]', () => {
        assert.equal(isPlaceholder(item('')), true);
        assert.equal(isPlaceholder(item('   ')), true);
        assert.equal(isPlaceholder(item('\tName')), false);
        assert.equal(isPlaceholder(item('Name', { icon: null })), true);
        assert.equal(isPlaceholder(item('((906936))')), true);
        assert.equal(isPlaceholder(item('(())')), true);
        assert.equal(isPlaceholder(item('(()')), false);
        assert.equal(isPlaceholder(item('[[913817]]')), true);
        assert.equal(isPlaceholder(item('[913817]')), false);
        assert.equal(sqlTrim(' \t x  '), '\t x');
    });

    it('Tonics: flag or name, Gizmo/Consumable only, not Unlock', () => {
        assert.equal(isTonic(item('Feisty Feline Tonic', { type: 'Gizmo' })), true);
        assert.equal(isTonic(item('Kit', { flags: ['Tonic'] })), true);
        assert.equal(isTonic(item('TONIC water')), true);
        assert.equal(isTonic(item('Recipe: Wolf Tonic', { subtype: 'Unlock' })), false);
        assert.equal(isTonic(item('Wolf Tonic', { type: 'Trophy' })), false);
        assert.equal(isTonic(item('Plain')), false);
    });

    it('hideCommon: subtypes, Mastery Points, Emote Tomes, currency packs', () => {
        for (const subtype of ['Food', 'Utility', 'Unlock', 'Transmutation', 'Currency']) {
            assert.equal(isCommonConsumable(item('X', { subtype })), true, subtype);
        }
        assert.equal(isCommonConsumable(item('X', { subtype: 'Generic' })), false);
        assert.equal(isCommonConsumable(item('X', { type: 'Gizmo', subtype: 'Food' })), false);
        assert.equal(isCommonConsumable(item(' Mastery Point')), true);
        assert.equal(isCommonConsumable(item('Mastery Points')), false);
        assert.equal(isCommonConsumable(item('"/Clap" Emote Tome')), true);
        assert.equal(isCommonConsumable(item('300 Geodes', { subtype: 'Immediate' })), true);
        assert.equal(isCommonConsumable(item('2 Gold', { subtype: 'Immediate' })), true);
        assert.equal(isCommonConsumable(item('300 Geodes', { subtype: 'Generic' })), false);
        assert.equal(isCommonConsumable(item('300Geodes', { subtype: 'Immediate' })), false);
        assert.equal(isCommonConsumable(item('300 Geodes')), false);
    });

    it('hideCommon subtype helper matches isCommonConsumable; filters apply only in their view', () => {
        for (const subtype of CONSUMABLE_SUBTYPES) {
            // With a neutral name the name-based rules do not apply, so both helpers must agree.
            assert.equal(isHiddenByHideCommon(subtype), isCommonConsumable(item('X', { subtype })), subtype);
        }
        for (const subtype of HIDE_COMMON_SUBTYPES) assert.ok(CONSUMABLE_SUBTYPES.includes(subtype), subtype);
        assert.equal(isHiddenByHideCommon('Immediate'), false);
        assert.equal(itemTypeFilterApplies('tonic'), true);
        assert.equal(subtypeFilterApplies('consumable'), true);
        for (const view of ['gizmo', 'consumable', 'all']) assert.equal(itemTypeFilterApplies(view), false, view);
        for (const view of ['gizmo', 'tonic', 'all']) assert.equal(subtypeFilterApplies(view), false, view);
    });

    it('Auto-consumed: every phrase is found, ignoring case, inside longer text', () => {
        for (const phrase of AUTO_CONSUMED_PHRASES) {
            assert.equal(isAutoConsumed(phrase), true, phrase);
            assert.equal(isAutoConsumed(`Intro. <c=@flavor>${phrase.toUpperCase()}</c> Outro.`), true, phrase);
            // Phrases are used in SQL LIKE patterns, so they must not contain wildcards, and must be lowercase ASCII.
            assert.ok(!/[%_]/.test(phrase), `wildcard in "${phrase}"`);
            assert.equal(phrase, phrase.toLowerCase());
            assert.ok(/^[\x20-\x7e]+$/.test(phrase), `non-ASCII in "${phrase}"`);
        }
        assert.equal(isAutoConsumed('Double-click to use.'), false);
        assert.equal(isAutoConsumed('Wird beim Erwerb automatisch verbraucht.'), false);
        assert.equal(isAutoConsumed(''), false);
        assert.equal(isAutoConsumed(null), false);
        assert.equal(isAutoConsumed(undefined), false);
    });

    it('Guild hall / homestead: upgrade id, or phrase in name/description of Consumable/Gizmo', () => {
        const check = (type: string, name: string, descriptionEn: string | null | undefined, hasGuildUpgrade = false) =>
            isGuildOrHomesteadItem({ type, name, descriptionEn, hasGuildUpgrade });
        for (const type of ['Consumable', 'Gizmo', 'Trophy']) {
            assert.equal(check(type, 'Banner', null, true), true, type);
        }
        for (const type of ['Consumable', 'Gizmo']) {
            assert.equal(check(type, 'Homestead Relic', null), true, type);
            assert.equal(check(type, 'Relic', 'For your homestead.'), true, type);
            assert.equal(check(type, 'Recipe: HOMESTEAD Bench', 'Plain'), true, type);
            assert.equal(check(type, 'Relic', '<c=@flavor>HOMESTEAD</c>'), true, type);
        }
        assert.equal(check('Trophy', 'Homestead Relic', 'Homestead'), false);
        assert.equal(check('Container', 'Homestead Relic', 'Homestead'), false);
        assert.equal(check('Consumable', 'Heimstatt-Relikt', 'Für deine Heimstatt.'), false);
        assert.equal(check('Consumable', 'Relic', null), false);
        assert.equal(check('Gizmo', 'Relic', undefined), false);
        assert.equal(check('Gizmo', 'Relic', ''), false);
        assert.ok(!/[%_]/.test(HOMESTEAD_PHRASE) && HOMESTEAD_PHRASE === HOMESTEAD_PHRASE.toLowerCase());
    });

    it('hideGuildHomestead param: default true, bool parsing, invalid value throws', () => {
        assert.equal(parseItemListQuery({}).hideGuildHomestead, true);
        assert.equal(parseItemListQuery({ hideGuildHomestead: 'false' }).hideGuildHomestead, false);
        assert.equal(parseItemListQuery({ hideGuildHomestead: '0' }).hideGuildHomestead, false);
        assert.equal(parseItemListQuery({ hideGuildHomestead: '1' }).hideGuildHomestead, true);
        assert.equal(parseItemListQuery({ hideGuildHomestead: '' }).hideGuildHomestead, true);
        assert.throws(() => parseItemListQuery({ hideGuildHomestead: 'maybe' }), ValidationError);
    });

    it('Chat link: round trip as in the game', () => {
        for (const id of [1, 255, 8778, 70000, 913817]) {
            assert.equal(chatLinkForId(id), chatLinkFor(id));
            assert.equal(itemIdFromChatLink(chatLinkFor(id)), id);
        }
        assert.equal(itemIdFromChatLink('[&AAAA]'), null);
        assert.equal(itemIdFromChatLink('not a link'), null);
    });
});

describe('Sorting and search', () => {
    it('compareNoCase: ASCII case-insensitive, otherwise code points', () => {
        assert.ok(compareNoCase('apple', 'Banana') < 0);
        assert.equal(compareNoCase('ABC', 'abc'), 0);
        assert.ok(compareNoCase('Zebra', 'zebra2') < 0);
        // SQLite NOCASE only folds ASCII: "Ä" stays before "ä" (code point), both after "z"
        assert.ok(compareNoCase('z', 'Ä') < 0);
        assert.ok(compareNoCase('Ä', 'ä') < 0);
        // Outside the BMP (surrogates) after U+FFFF
        assert.ok(compareNoCase('�', '\u{1F600}') < 0);
    });

    it('tokenize: words like unicode61 (case and accents do not matter)', () => {
        assert.deepEqual(tokenize("Belcher's Bluff-Kit 2x"), ['belcher', 's', 'bluff', 'kit', '2x']);
        assert.deepEqual(tokenize('Süßer Käse'), ['sußer', 'kase']);
        assert.deepEqual(tokenize('<c=@flavor>Text</c>'), ['c', 'flavor', 'text', 'c']);
        assert.deepEqual(tokenize('---'), []);
    });

    it('searchPhrases: quotes are dropped, characters without letters/digits are ignored', () => {
        assert.deepEqual(searchPhrases('Mini  Golem'), [['mini'], ['golem']]);
        assert.deepEqual(searchPhrases('"golem" OR -NEAR( name:*'), [['golem'], ['or'], ['near'], ['name']]);
        assert.deepEqual(searchPhrases('--- *'), []);
        assert.deepEqual(searchPhrases("belcher's"), [['belcher', 's']]);
    });
});
