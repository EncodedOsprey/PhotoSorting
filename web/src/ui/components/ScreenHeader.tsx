import { useRef, type ReactNode } from 'react';
import { useScrolledPast } from '../hooks/useScrolledPast';

interface ScreenHeaderProps {
  title: string;
  subtitle?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Hide the compact title on phones (when the bar buttons need the room). */
  compactTitleOnWideOnly?: boolean;
}

/**
 * A sticky navigation bar plus a large title on the brand gradient. As on iOS, the bar shows a compact title once
 * the large one has scrolled away.
 */
export function ScreenHeader({ title, subtitle, leading, trailing, compactTitleOnWideOnly }: ScreenHeaderProps) {
  const barRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const scrolled = useScrolledPast(titleRef, barRef);
  return (
    <>
      <header ref={barRef} className={scrolled ? 'navbar navbar--scrolled' : 'navbar'}>
        <div className="navbar__inner">
          <div className="navbar__side">{leading}</div>
          <span className={compactTitleOnWideOnly ? 'navbar__title navbar__title--optional' : 'navbar__title'} aria-hidden="true">
            {title}
          </span>
          <div className="navbar__side">{trailing}</div>
        </div>
      </header>
      <div className="hero">
        <div className="hero__inner">
          <h1 className="hero__title" ref={titleRef} tabIndex={-1}>
            {title}
          </h1>
          {subtitle ? <div className="hero__subtitle">{subtitle}</div> : null}
        </div>
      </div>
    </>
  );
}
