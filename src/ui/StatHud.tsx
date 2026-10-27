import type { GameState } from '../engine/types';
import { t } from '../i18n/i18n';
import { changeClass } from './format';
import { formatHudDelta, hudGroups, type HudGroup, type HudItem } from './hud';
import { useEventFlash, type StatFlashes } from './useEventFlash';

/**
 * D75: the stats at a glance, as two small emoji + number boxes over the
 * scene frame (left: condition, skills, outcome; right: traits, environment).
 *
 * When an event changes a value, its number lights up green or red and a
 * "+2" floats up beside it for the same time as the flash on the cards
 * (the same changes, from useEventFlash). With reduced motion the colour
 * and the "+2" simply appear and disappear.
 *
 * The emoji is decoration; the stat's name is there as hidden text for
 * screen readers and as a tooltip for the mouse.
 */
export function StatHud({ game }: { game: GameState }) {
  const flashes = useEventFlash(game);
  const hud = hudGroups(game);

  return (
    <>
      <HudBox side="left" groups={hud.left} flashes={flashes} />
      <HudBox side="right" groups={hud.right} flashes={flashes} />
    </>
  );
}

function HudBox({ side, groups, flashes }: { side: 'left' | 'right'; groups: HudGroup[]; flashes: StatFlashes }) {
  return (
    <div className={`hud hud--${side}`}>
      {groups.map((group) => (
        <div key={group.titleKey} className="hud__group">
          <h3 className="hud__title">{t(group.titleKey)}</h3>
          <ul className="hud__list">
            {group.items.map((item) => (
              <HudRow key={item.key} item={item} flash={flashes[item.key]} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function HudRow({ item, flash }: { item: HudItem; flash: StatFlashes[keyof StatFlashes] }) {
  const label = t(`stat.${item.key}`);
  const tone = flash && changeClass(flash.amount) !== 'neutral' ? changeClass(flash.amount) : undefined;
  return (
    <li className="hud__item" title={label}>
      <span className="hud__emoji" aria-hidden="true">
        {item.emoji}
      </span>
      <span className="visually-hidden">{label}</span>
      {item.value === undefined ? (
        <span className="hud__value hud__value--locked">
          <span aria-hidden="true">🔒</span>
          <span className="visually-hidden">{t('hud.locked')}</span>
        </span>
      ) : (
        // A new key per flash restarts the CSS animation when the same stat changes twice in a row.
        <span key={flash?.token ?? 'still'} className={`hud__value${tone ? ` hud__value--${tone}` : ''}`}>
          {item.value}
        </span>
      )}
      {flash && tone && (
        <span key={flash.token} className={`hud__delta hud__delta--${tone}`} aria-hidden="true">
          {formatHudDelta(flash.amount)}
        </span>
      )}
    </li>
  );
}
