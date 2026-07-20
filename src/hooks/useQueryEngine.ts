import { useMemo } from 'react';

import { QueryEngine } from '@/query';
import type { QueryRecord, QueryResult, QuerySpec } from '@/query';

export function useQueryEngine<T extends QueryRecord>(options?: { cacheSize?: number }): QueryEngine<T> {
  const { cacheSize } = options ?? {};
  return useMemo(() => new QueryEngine<T>({ cacheSize }), [cacheSize]);
}

export function useQuery<T extends QueryRecord>(data: readonly T[], query: QuerySpec<T>, options?: { cacheSize?: number }): QueryResult<T> {
  const engine = useQueryEngine<T>(options);
  return useMemo(() => engine.execute(data, query), [data, engine, query]);
}
