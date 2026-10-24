/** Inline SVG icon set (no icon dependency). */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...props }: IconProps, children: React.ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconDashboard = (p: IconProps) =>
  base(p, (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ));

export const IconDevice = (p: IconProps) =>
  base(p, (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <line x1="10.5" y1="18.5" x2="13.5" y2="18.5" />
    </>
  ));

export const IconTerminal = (p: IconProps) =>
  base(p, (
    <>
      <rect x="2.5" y="4" width="19" height="16" rx="2" />
      <path d="M7 9.5l3 2.5-3 2.5" />
      <line x1="12.5" y1="15" x2="17" y2="15" />
    </>
  ));

export const IconLink = (p: IconProps) =>
  base(p, (
    <>
      <path d="M10 13.5a4 4 0 0 0 5.7.3l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.5 1.5" />
      <path d="M14 10.5a4 4 0 0 0-5.7-.3l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.5-1.5" />
    </>
  ));

export const IconTools = (p: IconProps) =>
  base(p, (
    <>
      <path d="M14.5 6.5a4 4 0 0 1 5 5L21 13l-8 8-2-2 8-8" />
      <path d="M9.5 9.5L4 5l2-2 4.5 5.5" />
      <path d="M6 14l-2 2a2.8 2.8 0 1 0 4 4l2-2" />
    </>
  ));

export const IconRefresh = (p: IconProps) =>
  base(p, (
    <>
      <path d="M20 11a8 8 0 0 0-13.7-5.7L4 7.5" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 13.7 5.7L20 16.5" />
      <path d="M20 20v-4h-4" />
    </>
  ));

export const IconPlay = (p: IconProps) => base(p, <path d="M7 4.5l12 7.5-12 7.5z" />);
export const IconStop = (p: IconProps) => base(p, <rect x="6" y="6" width="12" height="12" rx="1.5" />);

export const IconTrash = (p: IconProps) =>
  base(p, (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2" />
      <path d="M6.5 7l1 12a2 2 0 0 0 2 1.8h5a2 2 0 0 0 2-1.8l1-12" />
    </>
  ));

export const IconExport = (p: IconProps) =>
  base(p, (
    <>
      <path d="M12 3v11" />
      <path d="M8 10l4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </>
  ));

export const IconShield = (p: IconProps) =>
  base(p, (
    <>
      <path d="M12 3l7 3v5c0 4.7-3 8.4-7 10-4-1.6-7-5.3-7-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ));

export const IconBug = (p: IconProps) =>
  base(p, (
    <>
      <rect x="8" y="7" width="8" height="12" rx="4" />
      <path d="M8 11H4.5M19.5 11H16M8 15H4.5M19.5 15H16M9 7.5L7.5 5M15 7.5L16.5 5" />
    </>
  ));

export const IconExternal = (p: IconProps) =>
  base(p, (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M18 14v5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7.5A1.5 1.5 0 0 1 5 6h5" />
    </>
  ));

export const IconFolder = (p: IconProps) =>
  base(p, <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />);

export const IconSearch = (p: IconProps) =>
  base(p, (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ));

export const IconPause = (p: IconProps) =>
  base(p, (
    <>
      <rect x="7" y="5" width="3.5" height="14" rx="1" />
      <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
    </>
  ));

export const IconCopy = (p: IconProps) =>
  base(p, (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2h9a1 1 0 0 1 1 1v1" />
    </>
  ));

export const IconSun = (p: IconProps) =>
  base(p, (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19" />
    </>
  ));

export const IconMoon = (p: IconProps) =>
  base(p, <path d="M20 13.5A8.5 8.5 0 0 1 10.5 4a8.5 8.5 0 1 0 9.5 9.5z" />);

export const IconUsb = (p: IconProps) =>
  base(p, (
    <>
      <path d="M12 21V5" />
      <path d="M9.5 7.5L12 5l2.5 2.5" />
      <path d="M12 13l3.5-2.5v-2M12 17l-3.5-2.5v-2" />
      <rect x="10.7" y="2" width="2.6" height="2.6" rx="0.6" />
      <rect x="16.5" y="7.2" width="2.6" height="2.6" rx="0.6" />
      <rect x="4.9" y="11.2" width="2.6" height="2.6" rx="0.6" />
    </>
  ));

export const IconWifi = (p: IconProps) =>
  base(p, (
    <>
      <path d="M3.5 9.5a13 13 0 0 1 17 0" />
      <path d="M6.8 13a8.4 8.4 0 0 1 10.4 0" />
      <path d="M10 16.4a3.7 3.7 0 0 1 4 0" />
      <circle cx="12" cy="19.5" r="0.9" fill="currentColor" stroke="none" />
    </>
  ));

export const IconEmulator = (p: IconProps) =>
  base(p, (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2.5" />
      <path d="M8.5 20.5h7M12 17v3.5" />
      <path d="M7.5 8.5l2.5 2-2.5 2" />
      <line x1="12" y1="12.5" x2="15.5" y2="12.5" />
    </>
  ));

export const IconCheck = (p: IconProps) => base(p, <path d="M4.5 12.5l5 5 10-11" />);

export const IconArrowRight = (p: IconProps) =>
  base(p, (
    <>
      <path d="M4 12h15" />
      <path d="M13.5 6.5L19 12l-5.5 5.5" />
    </>
  ));

export const IconWarning = (p: IconProps) =>
  base(p, (
    <>
      <path d="M12 3.5l9 15.5H3z" />
      <path d="M12 9.5v4.2" />
      <circle cx="12" cy="16.6" r="0.9" fill="currentColor" stroke="none" />
    </>
  ));

export const IconClose = (p: IconProps) =>
  base(p, (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </>
  ));

export const IconBridge = (p: IconProps) =>
  base(p, (
    <>
      <path d="M4 8.5l2.6 7h10.8l2.6-7" />
      <path d="M4 8.5h16" />
      <path d="M8 15.5l1-3M16 15.5l-1-3M12 15.5v-3" />
      <path d="M6.6 20h10.8" />
    </>
  ));
