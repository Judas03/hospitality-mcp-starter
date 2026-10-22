import type { ReactNode } from 'react';
import type { ProviderType } from '../contract/types';

function Svg({ children, size = 18 }: { children: ReactNode; size?: number }) {
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
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconRestaurant = () => (
  <Svg>
    <path d="M7 3v18M4.5 3v5a2.5 2.5 0 0 0 5 0V3M17 21V3c-2 0-3.5 2.5-3.5 6v4H17" />
  </Svg>
);
export const IconSalon = () => (
  <Svg>
    <circle cx="6" cy="7" r="2.5" />
    <circle cx="6" cy="17" r="2.5" />
    <path d="M8.2 8.4 20 18M8.2 15.6 20 6" />
  </Svg>
);
export const IconHotel = () => (
  <Svg>
    <path d="M3 6v13M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6" />
    <circle cx="6.8" cy="11.5" r="1.6" />
  </Svg>
);
export const IconSpeaker = () => (
  <Svg>
    <path d="M4 9v6h4l5 4V5L8 9H4z" />
    <path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11" />
  </Svg>
);
export const IconSend = () => (
  <Svg>
    <path d="M4 12 20 4l-6 16-2.5-6.5L4 12z" />
  </Svg>
);
export const IconMic = () => (
  <Svg>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </Svg>
);
export const IconClose = () => (
  <Svg>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IconSparkle = () => (
  <Svg size={15}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
  </Svg>
);
export const IconCheck = () => (
  <Svg size={14}>
    <path d="M5 12.5 9.5 17 19 7.5" />
  </Svg>
);
export const IconClock = () => (
  <Svg size={15}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);
export const IconUsers = () => (
  <Svg size={15}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3 3 0 0 1 0 6M18 14.5c2 .8 3 2.8 3 5.5" />
  </Svg>
);
export const IconPin = () => (
  <Svg size={15}>
    <path d="M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11z" />
    <circle cx="12" cy="10" r="2" />
  </Svg>
);
export const IconCalendar = () => (
  <Svg size={15}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Svg>
);
export const IconEdit = () => (
  <Svg size={15}>
    <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />
  </Svg>
);

export function ProviderIcon({ provider }: { provider: ProviderType }) {
  if (provider === 'salon') return <IconSalon />;
  if (provider === 'hotel') return <IconHotel />;
  return <IconRestaurant />;
}
