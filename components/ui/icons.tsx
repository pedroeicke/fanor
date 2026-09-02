/**
 * Ícones de linha, traço 1.6, desenhados para o mesmo peso visual dos
 * mockups. Inline em vez de uma biblioteca: são poucos e evitam ~40 KB de JS.
 */
type P = { className?: string };

const base = "h-[1.25em] w-[1.25em]";
const svg = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  viewBox: "0 0 24 24",
  "aria-hidden": true,
} as const;

export const IconSearch = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const IconCart = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <path d="M3 4h2l2.2 10.4a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L20.5 7H6" />
    <circle cx="10" cy="20" r="1.4" />
    <circle cx="17" cy="20" r="1.4" />
  </svg>
);

export const IconHeart = ({ className = base, filled = false }: P & { filled?: boolean }) => (
  <svg {...svg} className={className} fill={filled ? "currentColor" : "none"}>
    <path d="M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 15.6 12 20 12 20Z" />
  </svg>
);

export const IconTruck = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <path d="M2 7h11v9H2z" />
    <path d="M13 10h4l3 3v3h-7z" />
    <circle cx="6" cy="18" r="1.6" />
    <circle cx="17" cy="18" r="1.6" />
  </svg>
);

export const IconStore = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <path d="M4 10v9h16v-9" />
    <path d="M3 5h18l1 4a3 3 0 0 1-5.5 1.6A3 3 0 0 1 12 10a3 3 0 0 1-4.5.6A3 3 0 0 1 2 9Z" />
    <path d="M10 19v-5h4v5" />
  </svg>
);

export const IconCalendar = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

export const IconClock = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const IconMessage = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <path d="M20 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" />
  </svg>
);

export const IconRuler = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <rect x="2.5" y="8" width="19" height="8" rx="2" transform="rotate(-45 12 12)" />
    <path d="m9 9 1.5 1.5M11.5 6.5 13 8M6.5 11.5 8 13" />
  </svg>
);

export const IconLock = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <rect x="4.5" y="10" width="15" height="10" rx="2" />
    <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
  </svg>
);

export const IconShield = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <path d="M12 3 5 6v6c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const IconCake = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <path d="M4 20h16v-6a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3Z" />
    <path d="M4 15.5c1.6 1.4 2.9 1.4 4.5 0s2.9-1.4 4.5 0 2.9 1.4 4.5 0" />
    <path d="M8 8V6M12 8V5.5M16 8V6" />
  </svg>
);

export const IconWhisk = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <path d="m4 20 5.5-5.5" />
    <path d="M9 14c-1.5-2.5-1-6 2-8.5S17.5 3 19 5.5s.5 6-2.5 8.5-5 2.5-7.5 0Z" />
    <path d="M11.5 5.5c1 3 2.5 5.5 5 7.5M14.5 4c.5 3.5 2 6 4 7.5" />
  </svg>
);

export const IconWhatsapp = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.6-6.1c-.3-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.6-1.2.1-.2 0-.4 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.6 4c2.2.9 2.2.6 2.6.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z" />
  </svg>
);

export const IconMail = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3.5 7 8.5 6 8.5-6" />
  </svg>
);

export const IconPin = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.6" />
  </svg>
);

export const IconUser = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
  </svg>
);

export const IconCard = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
    <path d="M2.5 10h19M6 15h3" />
  </svg>
);

export const IconBank = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <path d="m3 9 9-5 9 5" />
    <path d="M5 9v9M10 9v9M14 9v9M19 9v9M3 20h18" />
  </svg>
);

export const IconCamera = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <path d="M3 8h3.5L8 5.5h8L17.5 8H21v12H3Z" />
    <circle cx="12" cy="13.5" r="3.6" />
  </svg>
);

export const IconCheck = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
);

export const IconChevron = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <path d="m9 5 7 7-7 7" />
  </svg>
);

export const IconChevronDown = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <path d="m5 9 7 7 7-7" />
  </svg>
);

export const IconArrowRight = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </svg>
);

export const IconTrash = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
  </svg>
);

export const IconPlus = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconMinus = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <path d="M5 12h14" />
  </svg>
);

export const IconClose = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const IconMenu = ({ className = base }: P) => (
  <svg {...svg} className={className}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export const IconStar = ({ className = base, filled = true }: P & { filled?: boolean }) => (
  <svg viewBox="0 0 24 24" className={className} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
    <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8Z" />
  </svg>
);

/** Florão que separa título e subtítulo, presente em toda a marca. */
export const Flourish = ({ className = "" }: P) => (
  <svg viewBox="0 0 120 16" className={className} fill="none" stroke="currentColor" strokeWidth={1.2} aria-hidden="true">
    <path d="M2 8h38M80 8h38" strokeLinecap="round" />
    <path d="M60 4c-3 0-5 1.8-5 4s2 4 5 4 5-1.8 5-4-2-4-5-4Z" />
    <path d="M48 8c3-3 6-3 7 0-1 3-4 3-7 0ZM72 8c-3-3-6-3-7 0 1 3 4 3 7 0Z" />
  </svg>
);
