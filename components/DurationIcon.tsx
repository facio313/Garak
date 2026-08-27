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

/**
 * A compact, code-native notation icon. SVG geometry avoids platform fallback
 * boxes for supplementary-plane Unicode note characters while retaining the
 * familiar notehead, stem, and flag shapes.
 */
export function DurationIcon({ value }: DurationIconProps) {
  const whole = value === 1;
  const openHead = value === 1 || value === 2;
  const flagCount = FLAG_COUNTS[value];
  const noteheadY = whole ? 21 : 31;

  return (
    <svg
      className={`duration-icon duration-${value}`}
      viewBox="0 0 32 42"
      aria-hidden="true"
      focusable="false"
    >
      {!whole ? <path className="duration-stem" d="M18 31V4" /> : null}
      <ellipse
        className={`duration-notehead ${openHead ? "open" : "filled"}`}
        cx={whole ? 15 : 11}
        cy={noteheadY}
        rx={whole ? 9 : 7.5}
        ry={whole ? 5.2 : 4.6}
        transform={`rotate(-18 ${whole ? 15 : 11} ${noteheadY})`}
      />
      {Array.from({ length: flagCount }, (_, index) => {
        const y = 4 + index * 6;
        return <path className="duration-flag" d={`M18 ${y} C27 ${y + 2}, 27 ${y + 8}, 20 ${y + 13} C23 ${y + 8}, 22 ${y + 5}, 18 ${y + 5} Z`} key={y} />;
      })}
    </svg>
  );
}
