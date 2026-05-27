'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Leaf, Drumstick, ListFilter, Clock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { MenuItemCard, type MenuItemForCard } from './menu-item-card';

interface CategoryGroup {
  id: string;
  name: string;
  slug: string;
  /** Computed server-side. Off-hours categories still render — dimmed + with a hint. */
  available?: boolean;
  unavailableReason?: 'disabled' | 'no_schedule_rows' | 'off_hours' | null;
  nextOpenLabel?: string | null;
  items: (MenuItemForCard & { isVeg: boolean })[];
}

type Diet = 'all' | 'veg' | 'nonveg';

export function MenuClient({ data, branchId, showSearch = true, showFilters = true, menuLayout = 'list' }: { data: CategoryGroup[]; branchId: string; showSearch?: boolean; showFilters?: boolean; menuLayout?: 'list' | 'grid' }) {
  // 'list' keeps the established two-up layout; 'grid' is a denser card grid.
  const itemGridClass = menuLayout === 'grid' ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3' : 'grid gap-3 lg:grid-cols-2';
  const [q, setQ] = useState('');
  const [diet, setDiet] = useState<Diet>('all');
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const jumpRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return data
      .map((cat) => ({
        ...cat,
        items: cat.items.filter((i) => {
          if (diet === 'veg' && !i.isVeg) return false;
          if (diet === 'nonveg' && i.isVeg) return false;
          if (ql && !(i.name.toLowerCase().includes(ql) || (i.description || '').toLowerCase().includes(ql))) return false;
          return true;
        })
      }))
      // Keep categories that either have matching items OR are off-hours
      // (so we still surface "Lunch — Opens at 12:00" even when empty after
      //  diet filter). Disabled categories with no items get dropped.
      .filter((c) => c.items.length > 0 || c.available === false);
  }, [data, q, diet]);

  // Spy on which category is in view to highlight in jumpnav
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sections = filtered
      .map((c) => document.getElementById(`cat-${c.slug}`))
      .filter((el): el is HTMLElement => !!el);
    if (sections.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) {
          const id = visible[0].target.id.replace('cat-', '');
          setActiveCat(id);
          // auto-scroll jumpnav to active pill
          const pill = jumpRef.current?.querySelector<HTMLElement>(`[data-cat="${id}"]`);
          if (pill && jumpRef.current) {
            const left = pill.offsetLeft - jumpRef.current.offsetWidth / 2 + pill.offsetWidth / 2;
            jumpRef.current.scrollTo({ left, behavior: 'smooth' });
          }
        }
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: [0, 0.25, 0.5, 1] }
    );
    sections.forEach((s) => obs.observe(s));
    return () => obs.disconnect();
  }, [filtered]);

  const totalDishes = filtered.reduce((s, c) => s + c.items.length, 0);

  return (
    <div className="grid gap-6 md:grid-cols-[240px_1fr]">
      {/* ───────── Desktop sidebar ───────── */}
      <aside className="hidden md:block md:sticky md:top-[6.5rem] self-start space-y-4 max-h-[calc(100vh-8rem)] overflow-auto scrollbar-thin pr-1">
        {showSearch && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search menu" className="pl-9" />
          </div>
        )}
        {showFilters && <DietPicker diet={diet} setDiet={setDiet} />}
        <nav className="text-sm space-y-0.5 pt-2">
          {filtered.map((c) => (
            <a
              key={c.id}
              href={`#cat-${c.slug}`}
              className={`flex items-center justify-between rounded-md px-2.5 py-2 transition-colors ${
                activeCat === c.slug
                  ? 'bg-primary/10 text-primary font-medium border-l-2 border-primary'
                  : 'hover:bg-accent border-l-2 border-transparent'
              }`}
            >
              <span>{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.items.length}</span>
            </a>
          ))}
        </nav>
      </aside>

      {/* ───────── Mobile sticky jumpnav + search ───────── */}
      <div className="md:hidden -mx-4 px-4 sticky top-[3.25rem] z-20 glass border-b pb-2 pt-2 space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dishes" className="pl-9 h-9" />
          </div>
          <DietPicker diet={diet} setDiet={setDiet} compact />
        </div>
        <div ref={jumpRef} className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
          {filtered.map((c) => (
            <a
              key={c.id}
              data-cat={c.slug}
              href={`#cat-${c.slug}`}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                activeCat === c.slug
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground border-border hover:text-foreground'
              }`}
            >
              {c.name} <span className="opacity-70">·{c.items.length}</span>
            </a>
          ))}
        </div>
      </div>

      {/* ───────── Items ───────── */}
      <div className="space-y-12">
        {filtered.length === 0 && (
          <div className="rounded-2xl border border-dashed bg-muted/30 p-12 text-center text-muted-foreground">
            <ListFilter className="size-8 mx-auto text-muted-foreground/60" />
            <div className="mt-3 font-medium">Nothing matches your search</div>
            <div className="text-xs mt-1">Try a different keyword or clear the filters.</div>
          </div>
        )}
        {filtered.length > 0 && (
          <div className="text-xs text-muted-foreground -mb-6">{totalDishes} {totalDishes === 1 ? 'dish' : 'dishes'} found</div>
        )}
        {filtered.map((cat) => {
          const unavailable = cat.available === false;
          return (
            <section id={`cat-${cat.slug}`} key={cat.id} className="scroll-mt-32 md:scroll-mt-24">
              <div className="flex items-baseline gap-3 mb-4 flex-wrap">
                <h2 className={`display text-xl font-semibold ${unavailable ? 'text-muted-foreground' : ''}`}>{cat.name}</h2>
                <span className="text-xs text-muted-foreground">{cat.items.length} {cat.items.length === 1 ? 'item' : 'items'}</span>
                {unavailable && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/5 px-2.5 py-0.5 text-[11px] font-medium text-warning">
                    <Clock className="size-3" />
                    {cat.nextOpenLabel ?? 'Currently unavailable'}
                  </span>
                )}
                <div className="flex-1 h-px bg-border ml-2" />
              </div>
              {unavailable && cat.items.length === 0 && (
                <div className="rounded-xl border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                  {cat.unavailableReason === 'disabled'
                    ? 'This menu is currently unavailable.'
                    : 'These dishes are only available during select hours.'}
                </div>
              )}
              {cat.items.length > 0 && (
                <div className={`${itemGridClass} ${unavailable ? 'opacity-60 pointer-events-none select-none' : ''}`}>
                  {cat.items.map((item) => <MenuItemCard key={item.id} item={item} branchId={branchId} />)}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function DietPicker({ diet, setDiet, compact = false }: { diet: Diet; setDiet: (d: Diet) => void; compact?: boolean }) {
  const opts: { value: Diet; label: string; icon?: any; cls: string }[] = [
    { value: 'all',    label: 'All',    cls: '' },
    { value: 'veg',    label: 'Veg',    icon: Leaf,      cls: 'data-[active=true]:bg-success/15 data-[active=true]:text-success data-[active=true]:border-success/40' },
    { value: 'nonveg', label: 'Non-veg', icon: Drumstick, cls: 'data-[active=true]:bg-destructive/10 data-[active=true]:text-destructive data-[active=true]:border-destructive/40' }
  ];
  return (
    <div className={`flex gap-1 ${compact ? '' : 'flex-wrap'}`}>
      {opts.map((o) => {
        const active = diet === o.value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            data-active={active}
            onClick={() => setDiet(o.value)}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${active ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'} ${o.cls}`}
          >
            {Icon && <Icon className="size-3" />}
            {compact && o.value === 'all' ? '·' : o.label}
          </button>
        );
      })}
    </div>
  );
}
