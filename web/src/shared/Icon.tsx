import type { ReactNode } from 'react';

// Line icons drawn on a 24-unit grid. They take the colour of the text around them.
const SHAPES = {
  camera: <><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.5" /></>,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M20.5 15.5 16 11l-8.5 8.5" /></>,
  pencil: <><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></>,
  box: <><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9z" /><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" /></>,
  chart: <path d="M5 20V10M12 20V4M19 20v-7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M5 12.5 9.5 17 19 7.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 10.5v6M14 10.5v6" />,
  refresh: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />,
  sparkle: <path d="M11 3.5l1.9 5.1 5.1 1.9-5.1 1.9L11 17.5l-1.9-5.1L4 10.5l5.1-1.9L11 3.5zM18.5 15.5v5M16 18h5" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  forward: <path d="M5 12h14M13 6l6 6-6 6" />,
  // An open hand with a plus at its fingertips: add something by hand.
  handPlus: (
    <>
      <path d="M7 12V7.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M10 11V6a1.5 1.5 0 0 1 3 0v5" />
      <path d="M13 11V7.5a1.5 1.5 0 0 1 3 0v3.5" />
      <path d="M16 11v-1a1.5 1.5 0 0 1 3 0v4.5a7 7 0 0 1-7 7h-.6a6 6 0 0 1-4.5-2.1l-3-3.5a1.6 1.6 0 0 1 2.4-2.1L7 15.4V12" />
      <path d="M20 1.5v5M17.5 4h5" />
    </>
  ),
  send: <path d="M12 19V5.5M6 11.5l6-6 6 6" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof SHAPES;

/** Decorative only: a button shows text beside it or names itself with aria-label, so screen readers skip the icon. */
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {SHAPES[name]}
    </svg>
  );
}
