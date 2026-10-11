import {
    createContext,
    createElement,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';

// Display settings (color scheme, accent color, content width), stored only in the user's own browser.
// Applied via attributes and CSS variables on the <html> element, see :root in styles.css.

// Union of string literals: a TS type that only allows exactly these values.
export type ThemeSetting = 'dark' | 'light' | 'system';
export type WidthSetting = 'normal' | 'wide' | 'wider' | 'full';

export interface Settings {
    theme: ThemeSetting;
    /** 'default' = gold, otherwise an entry from ACCENTS */
    accent: string;
    width: WidthSetting;
    /** Show the description column in the table layout of the item list. */
    showDescription: boolean;
}

export const THEMES: ThemeSetting[] = ['dark', 'light', 'system'];
export const WIDTHS: WidthSetting[] = ['normal', 'wide', 'wider', 'full'];

/** Default accent (gold) and the nine GW2 class colors. The class names stay English in all languages. */
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

// Record<K, V> = object type with keys K and values V (like Map<K, V> but a plain object).
const WIDTH_VALUES: Record<WidthSetting, string> = { normal: '1200px', wide: '1600px', wider: '2000px', full: '100%' };

export const DEFAULT_SETTINGS: Settings = {
    theme: 'dark',
    accent: DEFAULT_ACCENT.id,
    width: 'normal',
    showDescription: true,
};

// localStorage key (all other settings live inside this one JSON value).
const KEY = 'gw2items.settings';

/** Reads the stored settings; unknown or broken values fall back to the default. */
export function parseSettings(json: string | null): Settings {
    if (!json) return DEFAULT_SETTINGS;
    try {
        // Partial<Record<...>>: every key optional, values unknown - the stored JSON may be anything, so validate each
        // field.
        const raw = JSON.parse(json) as Partial<Record<keyof Settings, unknown>>;
        return {
            theme: THEMES.find((value) => value === raw.theme) ?? DEFAULT_SETTINGS.theme,
            accent: ACCENTS.find((accent) => accent.id === raw.accent)?.id ?? DEFAULT_SETTINGS.accent,
            width: WIDTHS.find((value) => value === raw.width) ?? DEFAULT_SETTINGS.width,
            // Settings saved before this field existed have no value, so only an explicit false hides the column.
            showDescription: typeof raw.showDescription === 'boolean' ? raw.showDescription : true,
        };
    } catch {
        return DEFAULT_SETTINGS;
    }
}

// localStorage can be blocked (private mode etc.), so always use try/catch.
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
        /* ignore */
    }
}

/** Relative luminance per WCAG for #rrggbb. */
function luminance(hex: string): number {
    // Linearized value (0..1) of color channel 0=red, 1=green, 2=blue from the #rrggbb string.
    const channel = (index: number) => {
        const v = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** Text color on an accent surface: dark or white, whichever gives more contrast. */
export function accentTextColor(hex: string): string {
    const dark = '#1a1408';
    const contrast = (first: number, second: number) =>
        (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    const accentLuminance = luminance(hex);
    return contrast(accentLuminance, luminance(dark)) >= contrast(accentLuminance, 1) ? dark : '#ffffff';
}

// MediaQueryList for the OS dark-mode preference, or null where matchMedia does not exist (e.g. tests).
const systemDark = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null);

/** Sets data-theme and the CSS variables for accent and width. */
export function applySettings(settings: Settings, root: HTMLElement = document.documentElement) {
    root.dataset.theme =
        settings.theme === 'system' ? (systemDark()?.matches === false ? 'light' : 'dark') : settings.theme;
    const accent = ACCENTS.find((accentEntry) => accentEntry.id === settings.accent);
    root.style.setProperty('--accent', accent?.color ?? DEFAULT_ACCENT.color);
    root.style.setProperty('--accent-text', accent ? accentTextColor(accent.color) : DEFAULT_ACCENT.text);
    root.style.setProperty('--content-width', WIDTH_VALUES[settings.width]);
}

// Apply as soon as the module loads so there is no flicker on the first render.
const initial = loadSettings();
if (typeof document !== 'undefined') applySettings(initial);

// React context = a value that any component below the provider can read without passing props through every level.
interface SettingsContextValue {
    settings: Settings;
    update: (patch: Partial<Settings>) => void;
}

const SettingsContext = createContext<SettingsContextValue>({ settings: DEFAULT_SETTINGS, update: () => {} });

/** Holds the settings in React state, persists changes to localStorage and applies them to <html>. */
export function SettingsProvider({ children }: { children: ReactNode }) {
    // useState: [current value, setter]; calling the setter re-renders the component.
    const [settings, setSettings] = useState<Settings>(initial);
    // useCallback keeps the same function identity between renders (so useMemo/useEffect below don't re-run
    // needlessly).
    const update = useCallback((patch: Partial<Settings>) => {
        setSettings((prev) => {
            const next = { ...prev, ...patch };
            saveSettings(next);
            return next;
        });
    }, []);

    // useEffect runs after render whenever `settings` changes (the dependency array at the end); the returned function
    // cleans up.
    useEffect(() => {
        applySettings(settings);
        if (settings.theme !== 'system') return;
        // System: follow changes of the operating system scheme
        const media = systemDark();
        const onChange = () => applySettings(settings);
        media?.addEventListener('change', onChange);
        return () => media?.removeEventListener('change', onChange);
    }, [settings]);

    // useMemo caches the context value so consumers only re-render when settings really change.
    const value = useMemo(() => ({ settings, update }), [settings, update]);
    return createElement(SettingsContext.Provider, { value }, children);
}

/** Hook: current settings and the `update(patch)` function. */
export function useSettings(): SettingsContextValue {
    return useContext(SettingsContext);
}
