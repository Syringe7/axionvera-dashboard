import { useState, useEffect, useRef } from "react";
import { widgetRegistry } from "@/widgets/registry";

/**
 * Hook to orchestrate the loading of widgets and their dependencies.
 * Ensures data sources are loaded once and in the correct order.
 */
export function useWidgetLoading() {
  const [loadingOrder, setLoadingOrder] = useState<string[]>([]);
  const [loadedEntities, setLoadedEntities] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Mutable ref tracks loaded IDs inside the mount-only effect without
  // creating a stale-closure problem. The state is synced for UI reads.
  const loadedRef = useRef(new Set<string>());

  useEffect(() => {
    async function loadAll() {
      try {
        setIsLoading(true);
        const order = widgetRegistry.getLoadingOrder();
        setLoadingOrder(order);

        for (const id of order) {
          const dataSource = widgetRegistry.getDataSource(id);
          if (dataSource) {
            // Check if already loaded (sharing resource)
            if (!loadedRef.current.has(id)) {
              await dataSource.loader();
              loadedRef.current.add(id);
              setLoadedEntities(new Set(loadedRef.current));
            }
          }
          // Widgets themselves might have some initialization, but usually they just wait for data
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to resolve widget dependencies");
      } finally {
        setIsLoading(false);
      }
    }

    void loadAll();
  }, []);

  return {
    loadingOrder,
    loadedEntities,
    isLoading,
    error,
    isLoaded: (id: string) => loadedEntities.has(id),
  };
}
