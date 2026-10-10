import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

// Anzeigeeinstellungen (Farbschema, Akzentfarbe, Inhaltsbreite), nur im eigenen Browser gespeichert.
// Wirkung über Attribute und CSS-Variablen am <html>-Element, siehe :root in styles.css.

export type ThemeSetting = 'dark' | 'light' | 'system';
export type WidthSetting = 'normal' | 'wide' | 'wider' | 'full';

export interface Settings {
  theme: ThemeSetting;
  /** 'default' = Gold, sonst ein Eintrag aus ACCENTS */
  accent: string;
  width: WidthSetting;
}

export const THEMES: ThemeSetting[] = ['dark', 'light', 'system'];
export const WIDTHS: WidthSetting[] = ['normal', 'wide', 'wider', 'full'];

/** Standardakzent (Gold) und die neun GW2-Klassenfarben. Die Klassennamen bleiben in allen Sprachen englisch. */
export const DEFAULT_ACCENT = { id: 'default', color: '#d9b45a', text: '#1a1408' };
export const ACCENTS = [
  { id: 'Guardian', color: '#72C1D9' },
  { id: 'Warrior', color: '#FFD166' },
  { id: 'Engineer', color: '#D09C59' },
  { id: 'Ranger', color: '#8CDC82' },
  { id: 'Thief', color: '#C08F95' },
  { id: 'Elementalist', color: '#F68A87' },
  { id: 'Mesmer', color: '#B679D5' },
  { id: 'Necromancer', color: '#52A76F' },
  { id: 'Revenant', color: '#D16E5A' },
];

const WIDTH_VALUES: Record<WidthSetting, string> = { normal: '1200px', wide: '1600px', wider: '2000px', full: '100%' };

export const DEFAULT_SETTINGS: Settings = { theme: 'dark', accent: DEFAULT_ACCENT.id, width: 'normal' };

const KEY = 'gw2items.settings';

/** Liest die gespeicherten Einstellungen; unbekannte oder kaputte Werte fallen auf den Standard zurück. */
export function parseSettings(json: string | null): Settings {
  if (!json) return DEFAULT_SETTINGS;
  try {
    const raw = JSON.parse(json) as Partial<Record<keyof Settings, unknown>>;
    return {
      theme: THEMES.find((v) => v === raw.theme) ?? DEFAULT_SETTINGS.theme,
      accent: ACCENTS.find((a) => a.id === raw.accent)?.id ?? DEFAULT_SETTINGS.accent,
      width: WIDTHS.find((v) => v === raw.width) ?? DEFAULT_SETTINGS.width,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// localStorage kann gesperrt sein (privater Modus o. ä.), daher immer mit try/catch.
function loadSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* egal */
  }
}

/** Relative Leuchtdichte nach WCAG für #rrggbb. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** Textfarbe auf einer Akzentfläche: dunkel oder weiß, je nachdem, was mehr Kontrast bringt. */
export function accentTextColor(hex: string): string {
  const dark = '#1a1408';
  const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const l = luminance(hex);
  return contrast(l, luminance(dark)) >= contrast(l, 1) ? dark : '#ffffff';
}

const systemDark = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null);

/** Setzt data-theme und die CSS-Variablen für Akzent und Breite. */
export function applySettings(settings: Settings, root: HTMLElement = document.documentElement) {
  root.dataset.theme = settings.theme === 'system' ? (systemDark()?.matches === false ? 'light' : 'dark') : settings.theme;
  const accent = ACCENTS.find((a) => a.id === settings.accent);
  root.style.setProperty('--accent', accent?.color ?? DEFAULT_ACCENT.color);
  root.style.setProperty('--accent-text', accent ? accentTextColor(accent.color) : DEFAULT_ACCENT.text);
  root.style.setProperty('--content-width', WIDTH_VALUES[settings.width]);
}

// Schon beim Laden des Moduls anwenden, damit beim ersten Rendern kein Flackern entsteht.
const initial = loadSettings();
if (typeof document !== 'undefined') applySettings(initial);

interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

const SettingsContext = createContext<SettingsContextValue>({ settings: DEFAULT_SETTINGS, update: () => {} });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(initial);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  useEffect(() => {
    applySettings(settings);
    if (settings.theme !== 'system') return;
    // System: bei Wechsel des Betriebssystem-Schemas mitziehen
    const media = systemDark();
    const onChange = () => applySettings(settings);
    media?.addEventListener('change', onChange);
    return () => media?.removeEventListener('change', onChange);
  }, [settings]);

  const value = useMemo(() => ({ settings, update }), [settings, update]);
  return createElement(SettingsContext.Provider, { value }, children);
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
