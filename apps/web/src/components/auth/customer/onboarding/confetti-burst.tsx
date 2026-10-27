/**
 * A one-shot CSS confetti burst (no canvas, no dependency). Pieces fly out
 * from the centre of the nearest positioned ancestor. Deterministic spread so
 * server and client render the same markup. Hidden entirely under
 * prefers-reduced-motion (globals.css).
 */
const COLORS = ['hsl(var(--primary))', 'hsl(var(--pop))', 'hsl(var(--berry))', '#F59E0B', '#22C55E', '#38BDF8'];

export function ConfettiBurst({ pieces = 28 }: { pieces?: number }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: pieces }, (_, i) => {
        const angle = (i / pieces) * Math.PI * 2;
        const dist = 90 + ((i * 37) % 70);
        const style = {
          background: COLORS[i % COLORS.length],
          animationDelay: `${(i % 5) * 25}ms`,
          '--dx': `${Math.round(Math.cos(angle) * dist)}px`,
          '--dy': `${Math.round(Math.sin(angle) * dist * 0.8)}px`,
          '--rot': `${(i % 2 ? 1 : -1) * (240 + ((i * 53) % 300))}deg`,
          borderRadius: i % 3 === 0 ? '9999px' : undefined,
        } as React.CSSProperties;
        return <span key={i} className="ob-confetti" style={style} />;
      })}
    </div>
  );
}
