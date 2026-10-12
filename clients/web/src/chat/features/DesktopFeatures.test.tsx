import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {LinqaMenuPanel} from '../ControlsDialogs';
import {calendarFile,desktopFeature} from './DesktopFeatures';

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
afterEach(()=>{document.body.replaceChildren();});
it('opens every requested desktop feature from the menu',()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const open=vi.fn();
 act(()=>root.render(<LinqaMenuPanel activeTitle="Test chat" canPoll requestCount={0} onFeature={open} onPoll={()=>{}} onRequests={()=>{}} onBlocked={()=>{}} onClose={()=>{}}/>));
 const expected=['voice-call','video-call','recording','photos','voice','attachments','gif','location','contact','whiteboard','events','meetings','vault','ai'];
 const buttons=Array.from(host.querySelectorAll<HTMLButtonElement>('.lc-menu-row')).filter(button=>!['Polls','Message requests','Blocked people','Mute, disappearing messages, report, block'].includes(button.querySelector('strong')!.textContent!));
 expect(buttons).toHaveLength(expected.length);
 for(const [index,button] of buttons.entries()){expect(button.getAttribute('aria-disabled')).toBe('false');act(()=>button.click());expect(open).toHaveBeenLastCalledWith(expected[index]);}
 act(()=>root.unmount());
});
it('rejects malformed phone cards before rendering',()=>{
 expect(desktopFeature({type:'location',latitude:NaN,longitude:1})).toBeNull();
 expect(desktopFeature({type:'meeting',title:'Broken',startsAt:'invalid'})).toBeNull();
 expect(desktopFeature({type:'media',mediaId:'bad',mediaKey:'bad',mimeType:'text/html'})).toBeNull();
});
it('escapes event text so it cannot inject calendar properties',()=>{
 const calendar=calendarFile({type:'event',eventId:'test',title:'Meeting\nATTENDEE:attacker',startsAt:'2026-10-11T12:00:00Z',endsAt:'2026-10-11T13:00:00Z'});
 expect(calendar).toContain('SUMMARY:Meeting\\nATTENDEE:attacker');expect(calendar).not.toContain('\r\nATTENDEE:');
});
