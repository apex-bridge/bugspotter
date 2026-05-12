/**
 * Pins the default Linear config seed shape. React inputs need
 * non-undefined string values to stay controlled from the first render,
 * so all three fields must be explicit empty strings — undefined
 * would make `useState` flip to uncontrolled mid-edit.
 */

import { describe, it, expect } from 'vitest';
import { defaultLinearConfig } from '../../../integrations/linear';

describe('defaultLinearConfig', () => {
  it('seeds all required fields as empty strings (controlled inputs)', () => {
    expect(defaultLinearConfig).toEqual({
      apiKey: '',
      teamId: '',
      teamKey: '',
    });
  });

  it('apiKey, teamId, teamKey are all string type (not undefined)', () => {
    expect(typeof defaultLinearConfig.apiKey).toBe('string');
    expect(typeof defaultLinearConfig.teamId).toBe('string');
    expect(typeof defaultLinearConfig.teamKey).toBe('string');
  });
});
