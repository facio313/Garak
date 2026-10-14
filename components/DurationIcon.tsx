import type { DurationBase } from "../lib/music/model";

interface DurationIconProps {
  value: DurationBase;
}

const FLAG_COUNTS: Readonly<Record<DurationBase, number>> = {
  1: 0,
  2: 0,
  4: 0,
  8: 1,
  16: 2,
  32: 3,
  64: 4,
};

/** Consistent noteheads, stems and flags in one compact icon box. */
export function DurationIcon({ value }: DurationIconProps) {
  const whole = value === 1;
  const openHead = value === 1 || value === 2;
  const noteheadX = whole ? 12 : 8;
  const noteheadY = whole ? 14 : 23;

  return (
    <svg
      className={`duration-icon duration-${value}`}
      viewBox="0 0 24 28"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
    >
      {!whole ? <path className="duration-stem" d="M11.7 22.5V3" /> : null}
      <ellipse
        className={`duration-notehead ${openHead ? "open" : "filled"}`}
        cx={noteheadX}
        cy={noteheadY}
        rx={whole ? 5.3 : 4.2}
        ry={whole ? 3.3 : 2.7}
        transform={`rotate(-18 ${noteheadX} ${noteheadY})`}
      />
      {Array.from({ length: FLAG_COUNTS[value] }, (_, index) => {
        const y = 3 + index * 3.6;
        return <path className="duration-flag" d={`M11.7 ${y} C19 ${y + 2}, 19 ${y + 6}, 14 ${y + 9} C17 ${y + 5}, 15.5 ${y + 3}, 11.7 ${y + 3} Z`} key={y} />;
      })}
    </svg>
  );
}
