import { TrackedValue } from "../types/provenance";

// Global debug flag (controlled by URL params for easy debugging)
// A module-level override lets tests force provenance on/off without
// touching the non-configurable window.location.search.
let _enabledOverride: boolean | null = null;

export function isProvenanceEnabled(): boolean {
  if (_enabledOverride !== null) return _enabledOverride;
  return typeof window !== 'undefined' && window.location.search.includes('debug=true');
}

/** Test-only helper — set to `true`/`false` to override, `null` to revert. */
export function __setProvenanceEnabled(v: boolean | null): void {
  _enabledOverride = v;
}

// Re-export as a const for backward compatibility.
export const IS_PROVENANCE_ENABLED = false;

export function createTrackedValue<T>(value: T, source: string): T | TrackedValue<T> {
  if (!isProvenanceEnabled()) {
    return value;
  }
  
  return {
    value,
    __provenance: {
      source,
      createdAt: Date.now(),
      lineage: []
    }
  } as TrackedValue<T>;
}

export function transformTrackedValue<T, U>(
  tracked: T | TrackedValue<T>,
  operation: string,
  actor: string,
  transformFn: (val: T) => U
): U | TrackedValue<U> {
  const isTracked = tracked !== null && typeof tracked === 'object' && '__provenance' in tracked;
  const actualValue = isTracked ? (tracked as TrackedValue<T>).value : tracked as T;
  const newValue = transformFn(actualValue);

  if (!isProvenanceEnabled() || !isTracked) {
    return newValue;
  }

  const trackedObj = tracked as TrackedValue<T>;
  return {
    value: newValue,
    __provenance: {
      ...trackedObj.__provenance,
      lineage: [
        ...trackedObj.__provenance.lineage,
        {
          operation,
          timestamp: Date.now(),
          actor,
          previousValue: actualValue
        }
      ]
    }
  } as TrackedValue<U>;
}

export function extractValue<T>(data: T | TrackedValue<T>): T {
  if (data !== null && typeof data === 'object' && '__provenance' in data) {
    return (data as TrackedValue<T>).value;
  }
  return data as T;
}
