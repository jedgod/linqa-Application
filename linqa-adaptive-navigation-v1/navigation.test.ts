import { breadcrumbsForPath, navigationMode } from './navigation';

describe('adaptive navigation', () => {
  test.each([[599,'mobile'],[600,'tablet-compact'],[839,'tablet-compact'],[840,'tablet-expanded'],[1199,'tablet-expanded'],[1200,'desktop']] as const)(
    'width %i uses %s', (width, expected) => expect(navigationMode(width)).toBe(expected));
  test('derives wallet transaction trail', () => {
    expect(breadcrumbsForPath('/send/transactions').map(x => x.label)).toEqual(['Home','LinqaSend','Wallet','Transactions']);
  });
  test('unknown route does not fabricate a breadcrumb', () => {
    expect(breadcrumbsForPath('/unknown')).toEqual([]);
  });
});
