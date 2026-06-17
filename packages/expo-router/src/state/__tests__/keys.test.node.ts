import { makeRouteKey } from '../keys';

describe('makeRouteKey', () => {
  it('formats name#seq and is deterministic', () => {
    expect(makeRouteKey('index', 0)).toBe('index#0');
    expect(makeRouteKey('details', 1)).toBe('details#1');
    expect(makeRouteKey('details', 1)).toBe(makeRouteKey('details', 1));
  });
});
