import { validateRoutes } from '../src/route-integrity';
import { mayNavigate } from '../src/navigation-policy';
import { routes, breadcrumbsForPath, navigationMode } from '../src/navigation';
test('illustrative registry has no structural errors',()=>expect(validateRoutes(routes)).toEqual([]));
test('detects cycles',()=>expect(validateRoutes([{id:'a',href:'/a',parentId:'b'},{id:'b',href:'/b',parentId:'a'}])).toContain('Parent cycle involving a'));
test('fails closed for unauthenticated or unauthorized routes',()=>{
 const allowedRouteIds=new Set(['wallet']);
 expect(mayNavigate('wallet',{authenticated:false,onboardingComplete:true,allowedRouteIds})).toBe(false);
 expect(mayNavigate('wallet',{authenticated:true,onboardingComplete:false,allowedRouteIds})).toBe(false);
 expect(mayNavigate('send',{authenticated:true,onboardingComplete:true,allowedRouteIds})).toBe(false);
});
test('breadcrumbs',()=>expect(breadcrumbsForPath('/send/transactions').map(x=>x.id)).toEqual(['home','send','wallet','transactions']));
test.each([[599,'mobile'],[600,'tablet-compact'],[839,'tablet-compact'],[840,'tablet-expanded'],[1199,'tablet-expanded'],[1200,'desktop']] as const)('width %s', (w,mode)=>expect(navigationMode(w)).toBe(mode));
