import { useEffect, useMemo } from "react";
import { eventBus } from "@/events";
import type { DashboardEventMap, EventHandler, SubscribeOptions } from "@/events";

export function useEventBus<TType extends keyof DashboardEventMap & string>(
  type: TType,
  handler: EventHandler<DashboardEventMap[TType], TType>,
  options: SubscribeOptions = {},
): void {
  // Stabilize the options reference so the effect only re-runs when
  // individual fields actually change, not on every render.
  const stableOptions = useMemo(
    () => ({ priority: options.priority, subscriberId: options.subscriberId }),
    [options.priority, options.subscriberId],
  );

  useEffect(() => {
    return eventBus.subscribe(type, handler, stableOptions);
  }, [type, handler, stableOptions]);
}
