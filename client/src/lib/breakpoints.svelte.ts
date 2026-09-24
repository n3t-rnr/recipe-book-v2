/**
 * Layout breakpoints (NF-08, approved design): < 600 px phone, 600–1023 px tablet portrait,
 * ≥ 1024 px tablet landscape and desktop (navigation rail, list and detail side by side).
 * Reactive via matchMedia; CSS uses the same values in @media rules.
 */
export type Layout = 'phone' | 'tablet' | 'wide';

export const BREAKPOINT_TABLET = 600;
export const BREAKPOINT_WIDE = 1024;

const tabletQuery = matchMedia(`(min-width: ${BREAKPOINT_TABLET}px)`);
const wideQuery = matchMedia(`(min-width: ${BREAKPOINT_WIDE}px)`);

let tablet = $state(tabletQuery.matches);
let wide = $state(wideQuery.matches);

tabletQuery.addEventListener('change', (e) => {
  tablet = e.matches;
});
wideQuery.addEventListener('change', (e) => {
  wide = e.matches;
});

export const breakpoints = {
  /** ≥ 1024 px: rail left, list 380 px, detail next to it. */
  get wide(): boolean {
    return wide;
  },
  /** 600–1023 px: two-column cards, floating bottom navigation. */
  get tablet(): boolean {
    return tablet && !wide;
  },
  /** < 600 px. */
  get phone(): boolean {
    return !tablet;
  },
  get layout(): Layout {
    if (wide) return 'wide';
    return tablet ? 'tablet' : 'phone';
  },
};
