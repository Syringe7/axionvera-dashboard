import {
  createTrackedValue,
  transformTrackedValue,
  extractValue,
  __setProvenanceEnabled,
} from '../../src/utils/provenance';
import { TrackedValue } from '../../src/types/provenance';

// Enable provenance tracking via the test-only setter.
// This avoids jsdom's non-configurable window.location.search property
// and bypasses jest.mock's inability to override intra-module closures.
beforeAll(() => {
  __setProvenanceEnabled(true);
});

afterAll(() => {
  __setProvenanceEnabled(null);
});

describe('Provenance Layer', () => {
  describe('createTrackedValue', () => {
    it('creates a tracked value with initial metadata', () => {
      const result = createTrackedValue(100, 'MockSource') as TrackedValue<number>;
      
      expect(result).toHaveProperty('value', 100);
      expect(result).toHaveProperty('__provenance');
      expect(result.__provenance.source).toBe('MockSource');
      expect(result.__provenance.lineage).toEqual([]);
      expect(typeof result.__provenance.createdAt).toBe('number');
    });
  });

  describe('transformTrackedValue', () => {
    it('appends to lineage when transforming a tracked value', () => {
      const initial = createTrackedValue('100', 'API') as TrackedValue<string>;
      
      const transformed = transformTrackedValue(
        initial,
        'formatNumber',
        'ComponentA',
        (val) => Number(val) * 2
      ) as TrackedValue<number>;

      expect(transformed.value).toBe(200);
      expect(transformed.__provenance.source).toBe('API');
      expect(transformed.__provenance.lineage).toHaveLength(1);
      
      const step = transformed.__provenance.lineage[0];
      expect(step.operation).toBe('formatNumber');
      expect(step.actor).toBe('ComponentA');
      expect(step.previousValue).toBe('100');
    });

    it('handles multiple transformations sequentially', () => {
      const v1 = createTrackedValue(5, 'Source') as TrackedValue<number>;
      
      const v2 = transformTrackedValue(v1, 'add2', 'Actor1', (val) => val + 2) as TrackedValue<number>;
      const v3 = transformTrackedValue(v2, 'mul3', 'Actor2', (val) => val * 3) as TrackedValue<number>;

      expect(v3.value).toBe(21);
      expect(v3.__provenance.lineage).toHaveLength(2);
      expect(v3.__provenance.lineage[0].operation).toBe('add2');
      expect(v3.__provenance.lineage[1].operation).toBe('mul3');
      expect(v3.__provenance.lineage[1].previousValue).toBe(7);
    });

    it('works safely even if the input is not a tracked value', () => {
      const rawValue = 'raw_string';
      
      // transformTrackedValue checks if it isTracked. If not tracked, it just returns the new value.
      const result = transformTrackedValue(rawValue, 'op', 'actor', (val) => val + '_modified');
      
      expect(result).toBe('raw_string_modified');
      expect(result).not.toHaveProperty('__provenance');
    });
  });

  describe('extractValue', () => {
    it('extracts value from a tracked object', () => {
      const tracked = createTrackedValue({ data: 123 }, 'Source');
      const result = extractValue(tracked);
      expect(result).toEqual({ data: 123 });
    });

    it('returns the raw value if it is not tracked', () => {
      const result = extractValue('raw_string');
      expect(result).toBe('raw_string');
    });
  });
});
