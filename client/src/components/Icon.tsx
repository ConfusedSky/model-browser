/**
 * The app's one icon set: 24-unit stroke glyphs drawn in `currentColor`, so an
 * icon takes its button's colour and state. Decorative by default — the control
 * carrying one names itself.
 */
const PATHS = {
  arrowLeft: "M19 12H5M12 19l-7-7 7-7",
  archive: "M3 4h18v4H3zM5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4",
  box: "M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8",
  chevronRight: "M9 18l6-6-6-6",
  copy: "M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  cornerUp: "M14 9l-5-5-5 5M20 20h-7a4 4 0 0 1-4-4V4",
  dice: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01",
  externalLink:
    "M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  filter: "M3 5h18l-7 8v6l-4 2v-8z",
  folder:
    "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16v-5M12 8h.01",
  layers: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5",
  maximize:
    "M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  refresh: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
  rotate: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  sliders: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4",
  sparkles:
    "M11 3l1.8 4.9L17.7 9.7l-4.9 1.8L11 16.4l-1.8-4.9L4.3 9.7l4.9-1.8zM19 14v5M16.5 16.5h5",
  type: "M4 7V5h16v2M9 19h6M12 5v14",
  warning: "M12 3l10 18H2zM12 10v4M12 17h.01",
  x: "M18 6L6 18M6 6l12 12",
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({
  name,
  className = "size-4",
  strokeWidth = 1.75,
}: {
  name: IconName;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
