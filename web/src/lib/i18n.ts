import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Lang } from '../../../shared/types';
import { ApiError } from '../api';

// Zwei Wörterbücher ohne Fremdbibliothek. Englisch ist Standard und gibt die Schlüssel vor;
// Deutsch ist als Record<Key, string> typisiert, fehlt dort ein Schlüssel, bricht der Typecheck ab.
// Platzhalter stehen als {name} im Text und werden von t() ersetzt.
// Nicht übersetzt werden Werte aus der API, nach denen gefiltert wird (game_types, Typen, Seltenheiten, Flags)
// und die Feldnamen im Tab "Änderungen".

const en = {
  // Kopfzeile und Tabs
  'header.statsUnavailable': 'Statistics unavailable',
  'header.lastUpdate': 'Last update',
  'header.updateLabel': 'Update:',
  'header.noUpdate': 'none yet',
  'header.export': 'Export',
  'header.exportTitle': 'Download the database as a file (backup)',
  'header.germanHint': 'German item names will be loaded with the next update.',
  'lang.aria': 'Language',
  'tabs.aria': 'View',
  'tab.gizmo': 'Gizmos',
  'tab.consumable': 'Consumables',
  'tab.tonic': 'Tonics',
  'tab.all': 'All',
  'tab.changes': 'Changes',
  'tab.candidatesTitle': 'Fractal candidates',
  'tab.changesTitle': 'Entries in the latest update',

  // Einstellungen und Fußzeile
  'settings.open': 'Settings',
  'settings.title': 'Settings',
  'settings.theme': 'Color scheme',
  'theme.dark': 'Dark',
  'theme.light': 'Light',
  'theme.system': 'System',
  'settings.accent': 'Accent color',
  'accent.default': 'Default (gold)',
  'settings.width': 'Content width',
  'width.normal': 'Normal',
  'width.wide': 'Wide',
  'width.wider': 'Very wide',
  'width.full': 'Full width',
  'footer.legal': 'Guild Wars 2 © ArenaNet, LLC. Item data and icons from the official GW2 API. Not affiliated with ArenaNet.',

  // Allgemein
  'app.notFound': 'This page does not exist.',
  'app.toList': 'Back to the list',
  'common.retry': 'Try again',
  'common.loading': 'Loading …',
  'common.empty': 'empty',
  'error.unreachable': 'Backend not reachable',

  // Teststatus, Änderungsarten
  'test.untested': 'Untested',
  'test.works': 'Works',
  'test.broken': 'Does not work',
  'test.retest': 'Retest',
  'badge.retest': 'retest',
  'badge.retestTitle': 'game_types have changed since the test',
  'change.added': 'New',
  'change.changed': 'Changed',
  'change.removed': 'Removed',

  // Import-Phasen und Update-Button
  'phase.idle': 'Ready',
  'phase.ids': 'Loading item IDs',
  'phase.details': 'Loading item details',
  'phase.details_de': 'Loading German texts',
  'phase.diff': 'Comparing with cache',
  'phase.done': 'Done',
  'phase.failed': 'Failed',
  'update.button': 'Update',
  'update.tooltip': 'Update the local API cache (all GW2 items, English and German)',
  'update.running': 'Updating …',
  'update.alreadyRunning': 'An update is already running.',
  'update.startFailed': 'Could not start the update: {error}',
  'update.viewChanges': 'View changes',
  'update.lastFailed': 'Last update failed: {error}',
  'update.unknownError': 'unknown error',
  'update.germanIncomplete': 'German texts were not loaded completely. The next update will retry.',
  'update.describeNew': '{n} new',
  'update.describeChanged': '{n} changed',
  'update.describeRemoved': '{n} removed',
  'update.describeRunning': 'running',
  'update.describeFailed': 'failed',

  // Filter
  'filter.aria': 'Search and filters',
  'filter.search': 'Search',
  'filter.searchPlaceholder': 'Name, description, ID or chat link',
  'filter.candidate': 'Candidate',
  'filter.candidate.yes': 'Yes (Dungeon)',
  'filter.candidate.no': 'No',
  'filter.candidate.all': 'All',
  'filter.sort': 'Sort by',
  'filter.asc': 'Ascending',
  'filter.desc': 'Descending',
  'filter.ascAria': 'Ascending, click for descending',
  'filter.descAria': 'Descending, click for ascending',
  'sort.name': 'Name',
  'sort.id': 'ID',
  'sort.rarity': 'Rarity',
  'sort.level': 'Level',
  'sort.lastChanged': 'Last changed',
  'filter.more': 'More filters',
  'filter.rarity': 'Rarity',
  'filter.gameTypes': 'Game types (all must match)',
  'filter.testStatus': 'Test status',
  'filter.all': 'All',
  'filter.update': 'Only from update',
  'filter.allUpdates': 'All updates',
  'filter.updatesFailed': 'Updates could not be loaded',
  'filter.updateN': 'Update #{id}',
  'filter.hideCommon': 'Hide Food, Utility, Unlock, Transmutation, currencies, Mastery Points, Emote Tomes',
  'filter.hidePlaceholders': 'Hide placeholders without a name or icon, e.g. "((906936))" or "[[913817]]"',
  'filter.includeRemoved': 'Show removed items',
  'filter.clear': 'clear',

  // Liste
  'list.items': '{n} items',
  'list.loading': 'Loading …',
  'list.refreshing': ' · refreshing …',
  'list.export': 'Export:',
  'list.exportTitle': 'Export the current list with all results',
  'list.layout': 'Layout',
  'list.table': 'Table',
  'list.grid': 'Tiles',
  'list.loadError': 'Items could not be loaded: {error}',
  'list.loadingItems': 'Loading items …',
  'list.empty': 'No items found. Adjust the filters or change the search.',
  'list.removed': 'removed',
  'col.icon': 'Icon',
  'col.name': 'Name',
  'col.type': 'Type',
  'col.level': 'Level',
  'col.test': 'Test',
  'page.aria': 'Pages',
  'page.first': 'First page',
  'page.last': 'Last page',
  'page.prev': 'Previous',
  'page.next': 'Next',
  'page.of': 'Page {page} of {pages}',

  // Detail
  'detail.back': '← Back to the list',
  'detail.loading': 'Loading item …',
  'detail.notFound': 'Item #{id} was not found.',
  'detail.loadError': 'Item could not be loaded: {error}',
  'detail.history': 'Change history',
  'detail.removedBadge': 'no longer in the API',
  'detail.type': 'Type',
  'detail.rarity': 'Rarity',
  'detail.level': 'Level',
  'detail.candidate': 'Fractal candidate',
  'detail.vendorValue': 'Vendor value',
  'detail.wiki': 'Open in wiki ↗',
  'list.wiki': 'Wiki ↗',
  'detail.copy': 'Copy',
  'detail.copied': 'Copied ✓',
  'detail.copyManual': 'Please copy manually',
  'detail.raw': 'Raw data (details)',
  'detail.englishName': 'English: {name}',
  'history.empty': 'No changes recorded.',
  'history.fields': 'Fields: {fields}',

  // Teststatus-Formular
  'testPanel.title': 'Test status',
  'testPanel.retestLabel': 'Retest:',
  'testPanel.retestText': 'The game_types have changed since the last test.',
  'testPanel.lastTested': 'Last tested: {date}',
  'testPanel.never': 'Not tested yet.',
  'testPanel.status': 'Status',
  'testPanel.note': 'Note',
  'testPanel.notePlaceholder': 'e.g. which fractal it was tested in, observations',
  'testPanel.save': 'Save',
  'testPanel.saving': 'Saving …',
  'testPanel.saved': 'Saved',
  'testPanel.error': 'Error: {error}',
  'testPanel.confirmHint': 'Saving without changes confirms the status for the current game_types.',

  // Seite "Änderungen"
  'focus.all': 'All',
  'focus.gameTypes': 'game_types changed',
  'focus.dungeonGained': 'Dungeon added',
  'focus.dungeonLost': 'Dungeon removed',
  'type.gizmo': 'Gizmo',
  'type.consumable': 'Consumable',
  'type.tonic': 'Tonics',
  'type.all': 'All',
  'changes.loadingUpdates': 'Loading updates …',
  'changes.updatesError': 'Updates could not be loaded: {error}',
  'changes.noUpdate': 'No update yet. Use "Update" at the top right to load the items.',
  'changes.invalidCompare': 'Invalid comparison: from must be smaller than to.',
  'changes.toLatest': 'Go to the latest update',
  'changes.notFound': 'This update does not exist or the comparison is invalid.',
  'changes.loadError': 'Changes could not be loaded: {error}',
  'changes.loading': 'Loading changes …',
  'changes.titleCompare': 'Comparison: update #{from} → update #{to}',
  'changes.titleUpdate': 'Changes in update #{id}',
  'changes.build': 'Build {build}',
  'changes.stateName': 'State {name} (UTC)',
  'changes.unknownBuild': 'unknown',
  'changes.statusDone': 'completed',
  'changes.statusRunning': 'still running',
  'changes.statusFailed': 'failed',
  'changes.from': 'From (state after, UTC)',
  'changes.to': 'To (state after, UTC)',
  'changes.failed': 'This update failed.',
  'changes.failedWithError': 'This update failed: {error}.',
  'changes.legacyRange': 'This range contains changes from before old values were stored. For those, the old values are partly missing.',
  'changes.legacyUpdate': 'This update contains changes from before old values were stored. For those, the old values are partly missing.',
  'changes.first': 'This is the first update (full import), so every item is "New". A comparison only makes sense from the second update on.',
  'changes.filterAria': 'Filter',
  'changes.kind': 'Kind',
  'changes.focus': 'Focus',
  'changes.type': 'Type',
  'changes.search': 'Search',
  'changes.searchPlaceholder': 'Name or ID',
  'changes.hidePlaceholders': 'Hide placeholders',
  'changes.entries': '{n} entries',
  'changes.refreshing': ' · refreshing …',
  'changes.noResults': 'No changes for these filters.',
  'changes.stateAfter': 'State {date}',
  'changes.beforeImport': 'Old (before the import)',
  'changes.notStored': 'old value not stored (update from before this version)',
  'changes.didNotExist': 'did not exist yet',
  'changes.removedValue': 'removed',
  'changes.absent': 'not present',
  'changes.colItem': 'Item',
  'changes.colField': 'Field',
  'changes.noFieldChange': 'No field change recorded.',
  'value.more': 'more',
  'value.less': 'less',

  // Stände verwalten
  'manage.title': 'Manage states',
  'manage.hint': 'Failed updates and completed updates without changes can be deleted. States with changes stay, otherwise the history would be falsified.',
  'manage.delete': 'Delete',
  'manage.confirm': 'Delete state {name}? This cannot be undone.',
  'manage.error': 'Could not delete the state: {error}',
  'manage.noChanges': 'no changes',
  'manage.blocked.running': 'Still running',
  'manage.blocked.hasChanges': 'Contains changes; deleting would falsify the history',
  'manage.blocked.referenced': 'Items still refer to this state; deleting would falsify the history',
} as const;

export type Key = keyof typeof en;

const de: Record<Key, string> = {
  'header.statsUnavailable': 'Kennzahlen nicht verfügbar',
  'header.lastUpdate': 'Letztes Update',
  'header.updateLabel': 'Update:',
  'header.noUpdate': 'noch keins',
  'header.export': 'Export',
  'header.exportTitle': 'Datenbank als Datei herunterladen (Sicherung)',
  'header.germanHint': 'Deutsche Item-Namen werden beim nächsten Update geladen.',
  'lang.aria': 'Sprache',
  'tabs.aria': 'Ansicht',
  'tab.gizmo': 'Gizmos',
  'tab.consumable': 'Consumables',
  'tab.tonic': 'Tonics',
  'tab.all': 'Alle',
  'tab.changes': 'Änderungen',
  'tab.candidatesTitle': 'Fractal-Kandidaten',
  'tab.changesTitle': 'Einträge im neuesten Update',

  'settings.open': 'Einstellungen',
  'settings.title': 'Einstellungen',
  'settings.theme': 'Farbschema',
  'theme.dark': 'Dunkel',
  'theme.light': 'Hell',
  'theme.system': 'System',
  'settings.accent': 'Akzentfarbe',
  'accent.default': 'Standard (Gold)',
  'settings.width': 'Inhaltsbreite',
  'width.normal': 'Normal',
  'width.wide': 'Breit',
  'width.wider': 'Sehr breit',
  'width.full': 'Volle Breite',
  'footer.legal': 'Guild Wars 2 © ArenaNet, LLC. Itemdaten und Icons stammen aus der offiziellen GW2-API. Keine Verbindung zu ArenaNet.',

  'app.notFound': 'Diese Seite gibt es nicht.',
  'app.toList': 'Zur Liste',
  'common.retry': 'Erneut versuchen',
  'common.loading': 'Lade …',
  'common.empty': 'leer',
  'error.unreachable': 'Backend nicht erreichbar',

  'test.untested': 'Ungetestet',
  'test.works': 'Funktioniert',
  'test.broken': 'Funktioniert nicht',
  'test.retest': 'Neu testen',
  'badge.retest': 'neu testen',
  'badge.retestTitle': 'game_types haben sich seit dem Test geändert',
  'change.added': 'Neu',
  'change.changed': 'Geändert',
  'change.removed': 'Entfernt',

  'phase.idle': 'Bereit',
  'phase.ids': 'Lade Item-IDs',
  'phase.details': 'Lade Item-Details',
  'phase.details_de': 'Lade deutsche Texte',
  'phase.diff': 'Vergleiche mit Cache',
  'phase.done': 'Fertig',
  'phase.failed': 'Fehlgeschlagen',
  'update.button': 'Aktualisieren',
  'update.tooltip': 'Lokalen API-Cache aktualisieren (alle GW2-Items, Englisch und Deutsch)',
  'update.running': 'Aktualisiere …',
  'update.alreadyRunning': 'Ein Update läuft bereits.',
  'update.startFailed': 'Update konnte nicht gestartet werden: {error}',
  'update.viewChanges': 'Änderungen ansehen',
  'update.lastFailed': 'Letztes Update fehlgeschlagen: {error}',
  'update.unknownError': 'unbekannter Fehler',
  'update.germanIncomplete': 'Deutsche Texte wurden nicht vollständig geladen. Das nächste Update versucht es erneut.',
  'update.describeNew': '{n} neu',
  'update.describeChanged': '{n} geändert',
  'update.describeRemoved': '{n} entfernt',
  'update.describeRunning': 'läuft',
  'update.describeFailed': 'fehlgeschlagen',

  'filter.aria': 'Suche und Filter',
  'filter.search': 'Suche',
  'filter.searchPlaceholder': 'Name, Beschreibung, ID oder Chat-Link',
  'filter.candidate': 'Kandidat',
  'filter.candidate.yes': 'Ja (Dungeon)',
  'filter.candidate.no': 'Nein',
  'filter.candidate.all': 'Alle',
  'filter.sort': 'Sortierung',
  'filter.asc': 'Aufsteigend',
  'filter.desc': 'Absteigend',
  'filter.ascAria': 'Aufsteigend, klicken für absteigend',
  'filter.descAria': 'Absteigend, klicken für aufsteigend',
  'sort.name': 'Name',
  'sort.id': 'ID',
  'sort.rarity': 'Seltenheit',
  'sort.level': 'Level',
  'sort.lastChanged': 'Zuletzt geändert',
  'filter.more': 'Weitere Filter',
  'filter.rarity': 'Seltenheit',
  'filter.gameTypes': 'Game Types (alle müssen passen)',
  'filter.testStatus': 'Teststatus',
  'filter.all': 'Alle',
  'filter.update': 'Nur aus Update',
  'filter.allUpdates': 'Alle Updates',
  'filter.updatesFailed': 'Updates nicht ladbar',
  'filter.updateN': 'Update #{id}',
  'filter.hideCommon': 'Food, Utility, Unlock, Transmutation, Währungen, Mastery Points, Emote Tomes ausblenden',
  'filter.hidePlaceholders': 'Platzhalter ohne Namen oder Icon ausblenden, z. B. „((906936))“ oder „[[913817]]“',
  'filter.includeRemoved': 'Entfernte Items anzeigen',
  'filter.clear': 'zurücksetzen',

  'list.items': '{n} Items',
  'list.loading': 'Lade …',
  'list.refreshing': ' · aktualisiere …',
  'list.export': 'Export:',
  'list.exportTitle': 'Aktuelle Liste mit allen Treffern exportieren',
  'list.layout': 'Darstellung',
  'list.table': 'Tabelle',
  'list.grid': 'Kacheln',
  'list.loadError': 'Items konnten nicht geladen werden: {error}',
  'list.loadingItems': 'Lade Items …',
  'list.empty': 'Keine Items gefunden. Filter anpassen oder Suche ändern.',
  'list.removed': 'entfernt',
  'col.icon': 'Icon',
  'col.name': 'Name',
  'col.type': 'Typ',
  'col.level': 'Level',
  'col.test': 'Test',
  'page.aria': 'Seiten',
  'page.first': 'Erste Seite',
  'page.last': 'Letzte Seite',
  'page.prev': 'Zurück',
  'page.next': 'Weiter',
  'page.of': 'Seite {page} von {pages}',

  'detail.back': '← Zurück zur Liste',
  'detail.loading': 'Lade Item …',
  'detail.notFound': 'Item #{id} wurde nicht gefunden.',
  'detail.loadError': 'Item konnte nicht geladen werden: {error}',
  'detail.history': 'Änderungsverlauf',
  'detail.removedBadge': 'nicht mehr in der API',
  'detail.type': 'Typ',
  'detail.rarity': 'Seltenheit',
  'detail.level': 'Level',
  'detail.candidate': 'Fractal-Kandidat',
  'detail.vendorValue': 'Händlerwert',
  'detail.wiki': 'Im Wiki öffnen ↗',
  'list.wiki': 'Wiki ↗',
  'detail.copy': 'Kopieren',
  'detail.copied': 'Kopiert ✓',
  'detail.copyManual': 'Bitte manuell kopieren',
  'detail.raw': 'Rohdaten (details)',
  'detail.englishName': 'Englisch: {name}',
  'history.empty': 'Keine Änderungen erfasst.',
  'history.fields': 'Felder: {fields}',

  'testPanel.title': 'Teststatus',
  'testPanel.retestLabel': 'Neu testen:',
  'testPanel.retestText': 'Die game_types haben sich seit dem letzten Test geändert.',
  'testPanel.lastTested': 'Zuletzt getestet: {date}',
  'testPanel.never': 'Noch nicht getestet.',
  'testPanel.status': 'Status',
  'testPanel.note': 'Notiz',
  'testPanel.notePlaceholder': 'z. B. in welchem Fraktal getestet, Auffälligkeiten',
  'testPanel.save': 'Speichern',
  'testPanel.saving': 'Speichere …',
  'testPanel.saved': 'Gespeichert',
  'testPanel.error': 'Fehler: {error}',
  'testPanel.confirmHint': 'Speichern ohne Änderung bestätigt den Status für die aktuellen game_types.',

  'focus.all': 'Alle',
  'focus.gameTypes': 'game_types geändert',
  'focus.dungeonGained': 'Dungeon dazu',
  'focus.dungeonLost': 'Dungeon weg',
  'type.gizmo': 'Gizmo',
  'type.consumable': 'Consumable',
  'type.tonic': 'Tonics',
  'type.all': 'Alle',
  'changes.loadingUpdates': 'Lade Updates …',
  'changes.updatesError': 'Updates konnten nicht geladen werden: {error}',
  'changes.noUpdate': 'Noch kein Update. Mit „Aktualisieren“ oben rechts die Items laden.',
  'changes.invalidCompare': 'Ungültiger Vergleich: from muss kleiner als to sein.',
  'changes.toLatest': 'Zum neuesten Update',
  'changes.notFound': 'Dieses Update gibt es nicht oder der Vergleich ist ungültig.',
  'changes.loadError': 'Änderungen konnten nicht geladen werden: {error}',
  'changes.loading': 'Lade Änderungen …',
  'changes.titleCompare': 'Vergleich: Update #{from} → Update #{to}',
  'changes.titleUpdate': 'Änderungen im Update #{id}',
  'changes.build': 'Build {build}',
  'changes.stateName': 'Stand {name} (UTC)',
  'changes.unknownBuild': 'unbekannt',
  'changes.statusDone': 'abgeschlossen',
  'changes.statusRunning': 'läuft noch',
  'changes.statusFailed': 'fehlgeschlagen',
  'changes.from': 'Von (Stand nach, UTC)',
  'changes.to': 'Bis (Stand nach, UTC)',
  'changes.failed': 'Dieses Update ist fehlgeschlagen.',
  'changes.failedWithError': 'Dieses Update ist fehlgeschlagen: {error}.',
  'changes.legacyRange': 'In diesem Bereich liegen Änderungen aus der Zeit vor der Speicherung alter Werte. Dort sind die alten Werte teils nicht gespeichert.',
  'changes.legacyUpdate': 'In diesem Update liegen Änderungen aus der Zeit vor der Speicherung alter Werte. Dort sind die alten Werte teils nicht gespeichert.',
  'changes.first': 'Das ist das erste Update (Vollimport), deshalb sind alle Items „Neu“. Ein Vergleich ist erst ab dem zweiten Update sinnvoll.',
  'changes.filterAria': 'Filter',
  'changes.kind': 'Art',
  'changes.focus': 'Fokus',
  'changes.type': 'Typ',
  'changes.search': 'Suche',
  'changes.searchPlaceholder': 'Name oder ID',
  'changes.hidePlaceholders': 'Platzhalter ausblenden',
  'changes.entries': '{n} Einträge',
  'changes.refreshing': ' · aktualisiere …',
  'changes.noResults': 'Keine Änderungen für diese Filter.',
  'changes.stateAfter': 'Stand {date}',
  'changes.beforeImport': 'Alt (vor dem Import)',
  'changes.notStored': 'alter Wert nicht gespeichert (Update vor dieser Version)',
  'changes.didNotExist': 'gab es noch nicht',
  'changes.removedValue': 'entfernt',
  'changes.absent': 'nicht vorhanden',
  'changes.colItem': 'Item',
  'changes.colField': 'Feld',
  'changes.noFieldChange': 'Keine Feldänderung erfasst.',
  'value.more': 'mehr',
  'value.less': 'weniger',

  'manage.title': 'Stände verwalten',
  'manage.hint': 'Fehlgeschlagene Updates und abgeschlossene ohne Änderungen lassen sich löschen. Stände mit Änderungen bleiben, sonst würde der Verlauf verfälscht.',
  'manage.delete': 'Löschen',
  'manage.confirm': 'Stand {name} löschen? Das lässt sich nicht rückgängig machen.',
  'manage.error': 'Stand konnte nicht gelöscht werden: {error}',
  'manage.noChanges': 'keine Änderungen',
  'manage.blocked.running': 'Läuft noch',
  'manage.blocked.hasChanges': 'Enthält Änderungen; Löschen würde den Verlauf verfälschen',
  'manage.blocked.referenced': 'Items verweisen noch auf diesen Stand; Löschen würde den Verlauf verfälschen',
};

const dictionaries: Record<Lang, Record<Key, string>> = { en, de };

const LANG_KEY = 'gw2items.lang';
const LOCALES: Record<Lang, string> = { en: 'en-GB', de: 'de-DE' };

// localStorage kann gesperrt sein (privater Modus o. ä.), daher immer mit try/catch.
function loadLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'de' ? 'de' : 'en';
  } catch {
    return 'en';
  }
}

function saveLang(lang: Lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* egal */
  }
}

export type TFunction = (key: Key, vars?: Record<string, string | number>) => string;

export interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TFunction;
  /** Zahl im Format der Sprache (en-GB: 74,300 · de-DE: 74.300). */
  formatNumber: (n: number) => string;
  /** Datum und Uhrzeit im Format der Sprache; null → "–". */
  formatDateTime: (iso: string | null) => string;
}

function createI18n(lang: Lang, setLang: (lang: Lang) => void): I18n {
  const dict = dictionaries[lang];
  const locale = LOCALES[lang];
  return {
    lang,
    setLang,
    t: (key, vars) => {
      const text = dict[key];
      return vars ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : text;
    },
    formatNumber: (n) => n.toLocaleString(locale),
    formatDateTime: (iso) => {
      if (!iso) return '–';
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return iso;
      return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
    },
  };
}

const I18nContext = createContext<I18n>(createI18n('en', () => {}));

/** Stellt Sprache und Übersetzung bereit, merkt sich die Wahl im Browser und setzt <html lang>. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(loadLang);
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    saveLang(next);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const value = useMemo(() => createI18n(lang, setLang), [lang, setLang]);
  return createElement(I18nContext.Provider, { value }, children);
}

export function useT(): I18n {
  return useContext(I18nContext);
}

/** Text zu einem Fehler: Netzwerkfehler (Status 0) übersetzt, Server-Meldungen bleiben wie geliefert. */
export function errorText(error: Error, t: TFunction): string {
  return error instanceof ApiError && error.status === 0 ? t('error.unreachable') : error.message;
}
