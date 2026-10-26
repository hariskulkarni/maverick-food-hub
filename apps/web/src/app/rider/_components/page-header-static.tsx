/** Server-safe page header for the rider portal. */
export function PageHeaderStatic({ title, intro }: { title: string; intro?: string }) {
  return (
    <header>
      <h1 className="display text-2xl font-bold md:text-3xl">{title}</h1>
      {intro && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{intro}</p>}
    </header>
  );
}
