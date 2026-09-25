import { definedFields } from './defined';

describe('definedFields', () => {
  it('drops undefined but keeps null (null clears a field)', () => {
    expect(definedFields({ a: 1, b: undefined, c: null, d: '' })).toEqual({ a: 1, c: null, d: '' });
  });
});
