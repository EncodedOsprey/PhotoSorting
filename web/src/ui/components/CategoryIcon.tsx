import { Eye, Focus, Mountain, Smile, Sparkles, Star, Sun, User, Users, type LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { SelectionCategory } from '../../core/types';

interface CategoryStyle {
  Icon: LucideIcon;
  color: string;
}

/** Settings-style icon and tile color for each category. */
export const CATEGORY_STYLE: Readonly<Record<SelectionCategory, CategoryStyle>> = {
  bestSmiles: { Icon: Smile, color: '#ff9500' },
  eyesOpen: { Icon: Eye, color: '#007aff' },
  sharpest: { Icon: Focus, color: '#5856d6' },
  wellExposed: { Icon: Sun, color: '#f5a300' },
  groupShots: { Icon: Users, color: '#34c759' },
  portraits: { Icon: User, color: '#ff2d55' },
  noPeople: { Icon: Mountain, color: '#30b0c7' },
  bestOverall: { Icon: Star, color: '#af52de' },
};

export const FILL_STYLE: CategoryStyle = { Icon: Sparkles, color: '#af52de' };

interface TileIconProps {
  Icon: LucideIcon;
  color: string;
  small?: boolean;
}

export function TileIcon({ Icon, color, small }: TileIconProps) {
  return (
    <span className={small ? 'tile-icon tile-icon--small' : 'tile-icon'} style={{ '--tile': color } as CSSProperties} aria-hidden="true">
      <Icon />
    </span>
  );
}

export function CategoryIcon({ category, fill, small }: { category: SelectionCategory; fill?: boolean; small?: boolean }) {
  const style = fill ? FILL_STYLE : CATEGORY_STYLE[category];
  return <TileIcon Icon={style.Icon} color={style.color} small={small} />;
}
