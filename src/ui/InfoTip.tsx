import { useId, useState } from 'react';
import { t } from '../i18n/i18n';

interface Props {
  /** What the tip is about, for screen readers: "ข้อมูลเพิ่มเติม: <label>". */
  label: string;
  text: string;
}

/**
 * A small "i" button that shows an explanation:
 * - mouse: on hover
 * - keyboard: when focused with Tab; Escape hides it
 * - touch: tap to show; tap anywhere else hides it (the button loses focus)
 *
 * Accessibility: the bubble is linked with aria-describedby, so a screen
 * reader reads the explanation when the button gets focus — even while the
 * bubble is visually hidden.
 *
 * Layout: the bubble is positioned against the nearest positioned parent
 * (the summary row, see .summary__list li in styles.css), so it spans the
 * row's width and can never overflow the screen on a phone.
 */
export function InfoTip({ label, text }: Props) {
  const bubbleId = useId();
  const [open, setOpen] = useState(false);

  return (
    <span className="infotip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="infotip__button"
        aria-label={t('info.about', { label })}
        aria-describedby={bubbleId}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        // Show (not toggle): on touch, focus already opened it; a toggle
        // would close it again in the same tap.
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            setOpen(false);
            // Only this tip closes; a surrounding panel (ChangePopover) stays open.
            event.stopPropagation();
          }
        }}
      >
        i
      </button>
      <span id={bubbleId} role="tooltip" className="infotip__bubble" hidden={!open}>
        {text}
      </span>
    </span>
  );
}
