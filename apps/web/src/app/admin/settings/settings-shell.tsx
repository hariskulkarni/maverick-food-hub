'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Building2, Workflow, MapPin, Plug, Bell, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'branding', label: 'Branding', icon: Building2 },
  { id: 'order-flow', label: 'Order flow', icon: Workflow },
  { id: 'branches', label: 'Branches', icon: MapPin },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'reviews', label: 'Reviews', icon: Star },
  { id: 'notifications', label: 'Notifications', icon: Bell }
] as const;

type TabId = (typeof TABS)[number]['id'];
const STORAGE_KEY = 'flavrly.admin.settings.tab';
const isTab = (v: string | null | undefined): v is TabId => TABS.some((t) => t.id === v);

export interface SettingsShellProps {
  branding: ReactNode;
  orderFlow: ReactNode;
  branches: ReactNode;
  integrations: ReactNode;
  reviews: ReactNode;
  notifications: ReactNode;
}

export function SettingsShell(props: SettingsShellProps) {
  const [tab, setTab] = useState<TabId>('branding');

  useEffect(() => {
    let next: string | null = null;
    try { next = new URLSearchParams(window.location.search).get('tab'); } catch {}
    if (!isTab(next)) {
      try { next = window.localStorage.getItem(STORAGE_KEY); } catch {}
    }
    if (isTab(next)) setTab(next);
  }, []);

  const select = useCallback((id: TabId) => {
    setTab(id);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', id);
      window.history.replaceState(null, '', url.toString());
    } catch {}
    try { window.localStorage.setItem(STORAGE_KEY, id); } catch {}
  }, []);

  const slots: Record<TabId, ReactNode> = {
    branding: props.branding,
    'order-flow': props.orderFlow,
    branches: props.branches,
    integrations: props.integrations,
    reviews: props.reviews,
    notifications: props.notifications
  };

  return (
    <div className="flex flex-col gap-4 md:flex-row md:gap-8">
      <nav
        role="tablist"
        aria-label="Settings sections"
        className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 md:sticky md:top-6 md:mx-0 md:w-52 md:shrink-0 md:flex-col md:self-start md:overflow-visible md:px-0 md:pb-0"
      >
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              aria-selected={active}
              aria-controls="settings-panel"
              onClick={() => select(id)}
              className={cn(
                'flex shrink-0 items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          );
        })}
      </nav>
      <div
        role="tabpanel"
        id="settings-panel"
        aria-labelledby={`settings-tab-${tab}`}
        className="min-w-0 flex-1"
      >
        {slots[tab]}
      </div>
    </div>
  );
}
