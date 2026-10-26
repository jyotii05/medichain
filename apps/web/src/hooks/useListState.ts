import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

/**
 * Page/search/filter/sort state kept in the URL query string so lists are shareable and survive reloads.
 * `extra` lists additional string params (e.g. "status", "tab") to expose.
 */
export function useListState<K extends string = never>(defaults: { pageSize?: number; sort?: string; order?: 'asc' | 'desc' } = {}, extra: readonly K[] = []) {
  const [params, setParams] = useSearchParams();

  const state = useMemo(() => {
    const values = Object.fromEntries(extra.map((k) => [k, params.get(k) ?? ''])) as Record<K, string>;
    return {
      page: Math.max(1, Number(params.get('page') ?? 1) || 1),
      pageSize: defaults.pageSize ?? 10,
      search: params.get('q') ?? '',
      sort: params.get('sort') ?? defaults.sort,
      order: (params.get('order') as 'asc' | 'desc' | null) ?? defaults.order ?? 'desc',
      ...values,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const update = useCallback(
    (patch: Record<string, string | number | undefined | null>, resetPage = true) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            const key = k === 'search' ? 'q' : k;
            if (v === undefined || v === null || v === '') next.delete(key);
            else next.set(key, String(v));
          }
          if (resetPage && !('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return {
    ...state,
    setPage: (page: number) => update({ page }, false),
    setSearch: (search: string) => update({ search }),
    setSort: (s: { sort?: string; order: 'asc' | 'desc' }) => update({ sort: s.sort, order: s.order }),
    set: (key: K, value: string) => update({ [key]: value }),
    update,
  };
}
