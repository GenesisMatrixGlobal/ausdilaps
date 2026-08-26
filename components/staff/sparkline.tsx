/**
 * Inline SVG sparkline. No charting dependency.
 *
 * The repo has no charting library, and pulling in recharts for one trend line would be
 * ~50KB of JavaScript to draw a polyline. This is ~40 lines of markup, renders on the
 * server, ships no JS at all, and matches the house style (flat, bordered, steel accent)
 * better than any library default would.
 *
 * Deliberately minimal: a line, a filled area, and an emphasised final point. No axes, no
 * tooltips, no grid — this is a shape-at-a-glance, and the exact numbers live in the
 * labels beside it.
 */
export function Sparkline({
  points,
  width = 640,
  height = 56,
  label,
}: {
  points: number[];
  width?: number;
  height?: number;
  /** Accessible description — the line itself is decorative. */
  label: string;
}) {
  if (points.length < 2) {
    return <p className="text-sm text-ad-muted">Not enough history to chart yet.</p>;
  }

  const max = Math.max(...points, 1);
  const pad = 3; // keeps the stroke and the end dot from clipping at the edges
  const stepX = (width - pad * 2) / (points.length - 1);
  const y = (v: number) => pad + (1 - v / max) * (height - pad * 2);

  const coords = points.map((v, i) => [pad + i * stepX, y(v)] as const);
  const line = coords.map(([x, yy], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${yy.toFixed(1)}`).join(" ");
  const area = `${line} L${(width - pad).toFixed(1)},${height - pad} L${pad},${height - pad} Z`;
  const [lastX, lastY] = coords[coords.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-14 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <path d={area} fill="var(--color-ad-steel)" opacity="0.08" />
      <path
        d={line}
        fill="none"
        stroke="var(--color-ad-steel)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        // The viewBox is stretched by preserveAspectRatio="none", which would smear the
        // stroke horizontally. This keeps it an even width at any container size.
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} r="2.5" fill="var(--color-ad-steel)" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
