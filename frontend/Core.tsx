export function Sparkline({ values }: { values: number[] }) {
  const points = values
    .map((v, i) => `${(i * 100) / Math.max(1, values.length - 1)},${35 - v * 0.32}`)
    .join(' ');
  return (
    <svg className="sparkline" viewBox="0 0 100 38" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 35 H100 M0 18 H100" className="graph-grid" />
      <polygon points={`0,38 ${points} 100,38`} className="graph-fill" />
      <polyline points={points} />
    </svg>
  );
}
