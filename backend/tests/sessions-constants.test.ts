import { ALLOWED_VOTES, NUMERIC_VOTES } from '../src/modules/sessions/constants.js';

describe('sessions constants', () => {
  it('contains the expected numeric votes', () => {
    expect(NUMERIC_VOTES).toEqual([1, 2, 3, 5, 8, 13, 21]);
  });

  it('contains numeric votes as strings and coffee', () => {
    expect(ALLOWED_VOTES).toEqual(['1', '2', '3', '5', '8', '13', '21', 'coffee']);
  });
});
