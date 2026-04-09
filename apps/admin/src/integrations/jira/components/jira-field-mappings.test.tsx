import { describe, it, expect } from 'vitest';
import { parseArrayField, parsePriority } from './jira-field-mappings.utils';

// Unit tests for parseArrayField and parsePriority utility functions
describe('Jira Field Mapping Utilities', () => {
  describe('parseArrayField behavior', () => {
    describe('filtering empty values', () => {
      it('should filter out empty strings from string arrays', () => {
        const result = parseArrayField('["valid", "", "another", "   "]');
        expect(result).toEqual(['valid', 'another']);
      });

      it('should filter out objects with missing name property', () => {
        const result = parseArrayField('[{"name": "Frontend"}, {}, {"name": "Backend"}]');
        expect(result).toEqual(['Frontend', 'Backend']);
      });

      it('should filter out objects with null name property', () => {
        const result = parseArrayField(
          '[{"name": "Frontend"}, {"name": null}, {"name": "Backend"}]'
        );
        expect(result).toEqual(['Frontend', 'Backend']);
      });

      it('should filter out objects with empty string name', () => {
        const result = parseArrayField('[{"name": "Frontend"}, {"name": ""}, {"name": "Backend"}]');
        expect(result).toEqual(['Frontend', 'Backend']);
      });

      it('should filter out objects with whitespace-only name', () => {
        const result = parseArrayField(
          '[{"name": "Frontend"}, {"name": "   "}, {"name": "Backend"}]'
        );
        expect(result).toEqual(['Frontend', 'Backend']);
      });

      it('should handle mixed valid and invalid data', () => {
        const result = parseArrayField(
          '[{"name": "Frontend"}, "", null, "Backend", {}, {"name": null}]'
        );
        expect(result).toEqual(['Frontend', 'Backend']);
      });
    });

    describe('edge cases', () => {
      it('should return empty array for malformed JSON', () => {
        const result = parseArrayField('not valid json');
        expect(result).toEqual([]);
      });

      it('should return empty array for non-array JSON', () => {
        const result = parseArrayField('{"invalid": "structure"}');
        expect(result).toEqual([]);
      });

      it('should return empty array when all values are invalid', () => {
        const result = parseArrayField('[{}, "", null, {"name": ""}, {"name": null}]');
        expect(result).toEqual([]);
      });

      it('should trim leading and trailing whitespace from tags', () => {
        const result = parseArrayField('["  my tag  ", "another tag"]');
        expect(result).toEqual(['my tag', 'another tag']);
      });

      it('should handle undefined name property', () => {
        const result = parseArrayField('[{"name": undefined}]');
        expect(result).toEqual([]);
      });

      it('should return empty array for undefined input', () => {
        const result = parseArrayField(undefined);
        expect(result).toEqual([]);
      });

      it('should return empty array for empty string input', () => {
        const result = parseArrayField('');
        expect(result).toEqual([]);
      });
    });
  });

  describe('parsePriority behavior', () => {
    describe('valid inputs', () => {
      it('should parse priority object with name property', () => {
        const result = parsePriority('{"name": "High"}');
        expect(result).toBe('High');
      });

      it('should handle priority with various names', () => {
        expect(parsePriority('{"name": "Highest"}')).toBe('Highest');
        expect(parsePriority('{"name": "Medium"}')).toBe('Medium');
        expect(parsePriority('{"name": "Low"}')).toBe('Low');
        expect(parsePriority('{"name": "Lowest"}')).toBe('Lowest');
      });

      it('should handle object with additional properties', () => {
        const result = parsePriority('{"name": "High", "id": "1", "color": "red"}');
        expect(result).toBe('High');
      });

      it('should return null for empty string name (due to || null operator)', () => {
        const result = parsePriority('{"name": ""}');
        expect(result).toBeNull();
      });
    });

    describe('invalid inputs', () => {
      it('should return null for malformed JSON', () => {
        const result = parsePriority('not valid json');
        expect(result).toBeNull();
      });

      it('should return null for object without name property', () => {
        const result = parsePriority('{"priority": "High"}');
        expect(result).toBeNull();
      });

      it('should return null for null name property', () => {
        const result = parsePriority('{"name": null}');
        expect(result).toBeNull();
      });

      it('should return null for undefined name property', () => {
        const result = parsePriority('{"name": undefined}');
        expect(result).toBeNull();
      });

      it('should return null for array input', () => {
        const result = parsePriority('["High"]');
        expect(result).toBeNull();
      });

      it('should return null for string input', () => {
        const result = parsePriority('"High"');
        expect(result).toBeNull();
      });

      it('should return null for number input', () => {
        const result = parsePriority('42');
        expect(result).toBeNull();
      });

      it('should return null for undefined input', () => {
        const result = parsePriority(undefined);
        expect(result).toBeNull();
      });

      it('should return null for empty string input', () => {
        const result = parsePriority('');
        expect(result).toBeNull();
      });

      it('should return null for empty object', () => {
        const result = parsePriority('{}');
        expect(result).toBeNull();
      });
    });
  });
});
