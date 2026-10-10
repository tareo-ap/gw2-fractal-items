import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { useT, type Key } from '../lib/i18n';
import { ACCENTS, DEFAULT_ACCENT, THEMES, WIDTHS, useSettings } from '../lib/settings';

const ACCENT_CHOICES = [{ id: DEFAULT_ACCENT.id, color: DEFAULT_ACCENT.color }, ...ACCENTS];

/** Zahnrad im Header: Popover mit Farbschema, Akzentfarbe und Inhaltsbreite. Schließt per Klick außerhalb und Escape. */
export function SettingsMenu() {
  const { t } = useT();
  const { settings, update } = useSettings();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
                <button key={theme} type="button" className={theme === settings.theme ? 'active' : ''} aria-pressed={theme === settings.theme} onClick={() => update({ theme })}>
                  {t(`theme.${theme}` as Key)}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('settings.accent')}</span>
            <div className="swatches" role="group" aria-label={t('settings.accent')}>
              {ACCENT_CHOICES.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={a.id === settings.accent ? 'swatch selected' : 'swatch'}
                  style={{ '--swatch': a.color } as CSSProperties}
                  aria-pressed={a.id === settings.accent}
                  aria-label={accentName(a.id)}
                  title={accentName(a.id)}
                  onClick={() => update({ accent: a.id })}
                  onMouseEnter={() => setHovered(a.id)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(a.id)}
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
                <button key={width} type="button" className={width === settings.width ? 'active' : ''} aria-pressed={width === settings.width} onClick={() => update({ width })}>
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
