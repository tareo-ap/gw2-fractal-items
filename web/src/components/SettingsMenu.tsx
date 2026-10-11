import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { useT, type Key } from '../lib/i18n';
import { ACCENTS, DEFAULT_ACCENT, THEMES, WIDTHS, useSettings } from '../lib/settings';

// Default accent first, then the GW2 class colors (spread operator `...` copies array elements into the new array).
const ACCENT_CHOICES = [{ id: DEFAULT_ACCENT.id, color: DEFAULT_ACCENT.color }, ...ACCENTS];

/**
 * Gear in the header: popover with color scheme, accent color and content width. Closes on outside click and Escape.
 */
export function SettingsMenu() {
    const { t } = useT();
    const { settings, update } = useSettings();
    // useState: [value, setter]. `open` = popover visible, `hovered` = accent under the mouse (live preview of its
    // name).
    const [open, setOpen] = useState(false);
    const [hovered, setHovered] = useState<string | null>(null);
    // useRef<T>(null) holds a reference to a DOM element once rendered (attached below via ref={...}).
    const rootRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const panelId = useId(); // unique, stable id to link the button (aria-controls) to the panel

    // Register global listeners only while the popover is open; the returned cleanup removes them again.
    // The dependency array [open] makes the effect re-run whenever `open` changes.
    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
                buttonRef.current?.focus();
            }
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    // Display name of an accent: the default is translated, class names stay English.
    const accentName = (id: string) => (id === DEFAULT_ACCENT.id ? t('accent.default') : id);
    const shown = hovered ?? settings.accent;

    return (
        <div className="settings" ref={rootRef}>
            <button
                ref={buttonRef}
                type="button"
                className="btn btn-icon"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                aria-label={t('settings.open')}
                title={t('settings.open')}
                onClick={() => setOpen(!open)}
            >
                <span aria-hidden="true">⚙</span>
            </button>
            {open && (
                <div id={panelId} className="settings-panel" role="dialog" aria-label={t('settings.title')}>
                    <div className="field">
                        <span className="field-label">{t('settings.theme')}</span>
                        <div className="segmented" role="group" aria-label={t('settings.theme')}>
                            {THEMES.map((theme) => (
                                <button
                                    key={theme}
                                    type="button"
                                    className={theme === settings.theme ? 'active' : ''}
                                    aria-pressed={theme === settings.theme}
                                    onClick={() => update({ theme })}
                                >
                                    {t(`theme.${theme}` as Key)}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="field">
                        <span className="field-label">{t('settings.accent')}</span>
                        {/* The `as CSSProperties` cast below is needed because React's style type does not know custom CSS properties (--swatch). */}
                        <div className="swatches" role="group" aria-label={t('settings.accent')}>
                            {ACCENT_CHOICES.map((accent) => (
                                <button
                                    key={accent.id}
                                    type="button"
                                    className={accent.id === settings.accent ? 'swatch selected' : 'swatch'}
                                    style={{ '--swatch': accent.color } as CSSProperties}
                                    aria-pressed={accent.id === settings.accent}
                                    aria-label={accentName(accent.id)}
                                    title={accentName(accent.id)}
                                    onClick={() => update({ accent: accent.id })}
                                    onMouseEnter={() => setHovered(accent.id)}
                                    onMouseLeave={() => setHovered(null)}
                                    onFocus={() => setHovered(accent.id)}
                                    onBlur={() => setHovered(null)}
                                />
                            ))}
                        </div>
                        <span className="small muted swatch-label" aria-live="polite">
                            {accentName(shown)}
                        </span>
                    </div>
                    <div className="field">
                        <span className="field-label">{t('settings.width')}</span>
                        <div className="segmented" role="group" aria-label={t('settings.width')}>
                            {WIDTHS.map((width) => (
                                <button
                                    key={width}
                                    type="button"
                                    className={width === settings.width ? 'active' : ''}
                                    aria-pressed={width === settings.width}
                                    onClick={() => update({ width })}
                                >
                                    {t(`width.${width}` as Key)}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
