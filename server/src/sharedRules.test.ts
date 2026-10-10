import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chatLinkForId,
  compareNoCase,
  isCommonConsumable,
  isPlaceholder,
  isTonic,
  itemIdFromChatLink,
  sqlTrim,
} from '../../shared/rules.js';
import { searchPhrases, tokenize } from '../../shared/staticQuery.js';
import { chatLinkFor } from './test/fixtures.js';

// Regeln aus shared/, die der Browser statt SQL auswertet. Die Übereinstimmung mit dem Server prüft staticConsistency.test.ts.

describe('Regeln', () => {
  const item = (name: string, extra: Partial<{ type: string; subtype: string | null; icon: string | null; flags: string[] }> = {}) => ({
    name,
    type: 'Consumable',
    subtype: null,
    icon: 'x.png',
    flags: [],
    ...extra,
  });

  it('Platzhalter: leerer Name (nur Leerzeichen zählen), kein Icon, ((…)) und [[…]]', () => {
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

  it('Tonics: Flag oder Name, nur Gizmo/Consumable, nicht Unlock', () => {
    assert.equal(isTonic(item('Feisty Feline Tonic', { type: 'Gizmo' })), true);
    assert.equal(isTonic(item('Kit', { flags: ['Tonic'] })), true);
    assert.equal(isTonic(item('TONIC water')), true);
    assert.equal(isTonic(item('Recipe: Wolf Tonic', { subtype: 'Unlock' })), false);
    assert.equal(isTonic(item('Wolf Tonic', { type: 'Trophy' })), false);
    assert.equal(isTonic(item('Plain')), false);
  });

  it('hideCommon: Untertypen, Mastery Points, Emote Tomes, Währungspakete', () => {
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

  it('Chat-Link: Hin- und Rückweg wie im Spiel', () => {
    for (const id of [1, 255, 8778, 70000, 913817]) {
      assert.equal(chatLinkForId(id), chatLinkFor(id));
      assert.equal(itemIdFromChatLink(chatLinkFor(id)), id);
    }
    assert.equal(itemIdFromChatLink('[&AAAA]'), null);
    assert.equal(itemIdFromChatLink('kein link'), null);
  });
});

describe('Sortierung und Suche', () => {
  it('compareNoCase: ASCII ohne Beachtung der Schreibweise, sonst Codepoints', () => {
    assert.ok(compareNoCase('apple', 'Banana') < 0);
    assert.equal(compareNoCase('ABC', 'abc'), 0);
    assert.ok(compareNoCase('Zebra', 'zebra2') < 0);
    // SQLite NOCASE faltet nur ASCII: "Ä" bleibt vor "ä" (Codepoint), beide hinter "z"
    assert.ok(compareNoCase('z', 'Ä') < 0);
    assert.ok(compareNoCase('Ä', 'ä') < 0);
    // Außerhalb der BMP (Surrogate) nach U+FFFF
    assert.ok(compareNoCase('�', '\u{1F600}') < 0);
  });

  it('tokenize: Wörter wie unicode61 (Groß-/Kleinschreibung und Akzente egal)', () => {
    assert.deepEqual(tokenize("Belcher's Bluff-Kit 2x"), ['belcher', 's', 'bluff', 'kit', '2x']);
    assert.deepEqual(tokenize('Süßer Käse'), ['sußer', 'kase']);
    assert.deepEqual(tokenize('<c=@flavor>Text</c>'), ['c', 'flavor', 'text', 'c']);
    assert.deepEqual(tokenize('---'), []);
  });

  it('searchPhrases: Anführungszeichen entfallen, Zeichen ohne Buchstaben/Ziffern werden ignoriert', () => {
    assert.deepEqual(searchPhrases('Mini  Golem'), [['mini'], ['golem']]);
    assert.deepEqual(searchPhrases('"golem" OR -NEAR( name:*'), [['golem'], ['or'], ['near'], ['name']]);
    assert.deepEqual(searchPhrases('--- *'), []);
    assert.deepEqual(searchPhrases("belcher's"), [['belcher', 's']]);
  });
});
