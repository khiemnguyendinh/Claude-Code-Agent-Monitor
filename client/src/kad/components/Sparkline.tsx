/**
 * Minimal chart primitive — 06-components.md §5. Monochrome, no axis/legend
 * for KPI/sparkline use (axis only appears in Báo cáo, out of this scope).
 */

const BLUE = "#247DF9";

export function Sparkline({
  values,
  variant = "bar",
  height = 36,
  color = BLUE,
}: {
  values: number[];
  variant?: "bar" | "line";
  height?: number;
  color?: string;
}) {
  const max = Math.max(1, ...values);
  const width = 100; // percentage-based viewBox, scales to container via CSS width:100%

  if (variant === "bar") {
    const gap = 2;
    const barWidth = values.length > 0 ? width / values.length - gap : 0;
    return (
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} aria-hidden>
        {values.map((v, i) => {
          const h = Math.max(1, (v / max) * (height - 2));
          const x = i * (barWidth + gap);
          return (
            <rect
              key={i}
              x={x}
              y={height - h}
              width={Math.max(1, barWidth)}
              height={h}
              rx={1}
              fill={color}
              opacity={0.55}
            />
          );
        })}
      </svg>
    );
  }

  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - (v / max) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} aria-hidden>
      {points.length > 0 && (
        <path
          d={`M ${points.join(" L ")}`}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
