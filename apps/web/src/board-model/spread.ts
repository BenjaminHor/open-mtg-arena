// Laying out a row of things of given widths between two edges: side by side with a gap where they fit, packed
// against one edge or centred; when they don't fit, overlapped evenly so the row still spans the space.

export type Align = "start" | "centre" | "end";

/** The left edge of each item, in order. */
export function spread(widths: readonly number[], left: number, right: number, gap: number, align: Align): number[] {
  if (widths.length === 0) return [];
  const natural = widths.reduce((sum, w) => sum + w, 0) + gap * (widths.length - 1);
  const room = right - left;
  if (natural <= room) {
    let x = align === "start" ? left : align === "end" ? right - natural : left + (room - natural) / 2;
    return widths.map((w) => {
      const at = x;
      x += w + gap;
      return at;
    });
  }
  // Too wide: every item starts the same step after the last, so the row ends exactly at `right`.
  const last = widths[widths.length - 1] ?? 0;
  const step = widths.length > 1 ? (room - last) / (widths.length - 1) : 0;
  return widths.map((_, i) => left + i * step);
}
