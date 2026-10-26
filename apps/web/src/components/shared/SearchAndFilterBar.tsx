import { useEffect, useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface FilterOption {
  value: string;
  label: string;
}

/** Debounced search box plus segmented filter chips. */
export function SearchAndFilterBar({
  search,
  onSearchChange,
  placeholder = 'Search…',
  filters,
  filterValue,
  onFilterChange,
  actions,
  className,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  placeholder?: string;
  filters?: FilterOption[];
  filterValue?: string;
  onFilterChange?: (v: string) => void;
  actions?: ReactNode;
  className?: string;
}) {
  const [draft, setDraft] = useState(search);
  useEffect(() => setDraft(search), [search]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (draft !== search) onSearchChange(draft);
    }, 300);
    return () => clearTimeout(t);
  }, [draft, search, onSearchChange]);

  return (
    <div className={cn('flex flex-col gap-3 border-b border-line px-5 py-3.5 lg:flex-row lg:items-center', className)}>
      <div className="w-full lg:max-w-xs">
        <Input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          leftIcon={<Search />}
          className="h-9"
          rightSlot={
            draft ? (
              <button type="button" onClick={() => setDraft('')} className="grid size-7 place-items-center rounded-md text-muted hover:bg-subtle hover:text-ink" aria-label="Clear search">
                <X className="size-3.5" />
              </button>
            ) : undefined
          }
        />
      </div>
      {filters && onFilterChange && (
        <div className="scrollbar-thin -mx-1 flex items-center gap-1 overflow-x-auto px-1" role="radiogroup" aria-label="Filter">
          {filters.map((f) => {
            const active = (filterValue ?? '') === f.value;
            return (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onFilterChange(f.value)}
                className={cn(
                  'h-8 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium transition-colors',
                  active ? 'bg-ink text-white' : 'text-charcoal hover:bg-subtle hover:text-ink',
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      )}
      {actions && <div className="flex items-center gap-2 lg:ml-auto">{actions}</div>}
    </div>
  );
}
