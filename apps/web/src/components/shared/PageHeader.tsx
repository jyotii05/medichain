import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: { label: string; to?: string }[];
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {breadcrumbs && (
          <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-[13px] text-muted">
            {breadcrumbs.map((b, i) => (
              <span key={b.label} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3.5" aria-hidden />}
                {b.to ? (
                  <Link to={b.to} className="hover:text-ink">
                    {b.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="text-charcoal">
                    {b.label}
                  </span>
                )}
              </span>
            ))}
          </nav>
        )}
        {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold leading-tight md:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
