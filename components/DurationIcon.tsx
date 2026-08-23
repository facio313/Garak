import type { DurationBase } from "../lib/music/model";

interface DurationIconProps {
  value: DurationBase;
}

/**
 * A small notation-safe toolbar icon. It is drawn with CSS primitives so it
 * does not depend on the operating system having Unicode music glyphs.
 */
export function DurationIcon({ value }: DurationIconProps) {
  const hasStem = value !== 1;
  const flagCount = value === 64 ? 4 : value === 32 ? 3 : value === 16 ? 2 : value === 8 ? 1 : 0;
  const openHead = value === 1 || value === 2;

  return (
    <span
      className={`duration-icon duration-${value}${openHead ? " open-head" : " filled-head"}`}
      aria-hidden="true"
    >
      <span className="duration-notehead" />
      {hasStem ? <span className="duration-stem" /> : null}
      {Array.from({ length: flagCount }, (_, index) => (
        <span className={`duration-flag flag-${index + 1}`} style={{ top: `${1 + index * 6}px` }} key={index} />
      ))}
    </span>
  );
}
