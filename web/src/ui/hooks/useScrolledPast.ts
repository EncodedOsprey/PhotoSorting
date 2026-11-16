import { useEffect, useState, type RefObject } from 'react';

/**
 * True once `target` (a large title) has scrolled up under the sticky navigation bar `bar`, so the bar can show
 * a compact title, as iOS does.
 */
export function useScrolledPast(target: RefObject<HTMLElement | null>, bar: RefObject<HTMLElement | null>): boolean {
  const [scrolledPast, setScrolledPast] = useState(false);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const title = target.current;
      const navigation = bar.current;
      if (!title || !navigation) return;
      setScrolledPast(title.getBoundingClientRect().bottom <= navigation.getBoundingClientRect().bottom + 1);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [target, bar]);
  return scrolledPast;
}
