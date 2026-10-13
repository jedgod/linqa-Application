import {afterEach,expect,it,vi} from 'vitest';
import {files,File} from './feature-native-mocks';
import {addMyEvent,importLegacyEvents,listMyEvents,pastOf,removeMyEvent,upcomingOf} from '../../clients/mobile/services/my-events';
import {clearAccountScopedState} from '../../clients/mobile/services/account-scope';
import {buildCardPayload} from '../../clients/mobile/services/conversation-thread';
import {eventRange} from '../../clients/mobile/features/conversation/features/schedule/scheduleModel';
const event={id:'one',kind:'event' as const,title:'Private event',startsAt:'2030-01-01T12:00:00Z',endsAt:'2030-01-01T13:00:00Z'};
afterEach(()=>{vi.restoreAllMocks();clearAccountScopedState();files.clear();});
it('isolates Upcoming and event logs between accounts and survives cache reset',async()=>{
 await addMyEvent('account-a',event);expect(await listMyEvents('account-b')).toEqual([]);
 await addMyEvent('account-b',{...event,title:'Other account'});clearAccountScopedState();
 expect((await listMyEvents('account-a'))[0].title).toBe('Private event');
 await removeMyEvent('account-b',event.id);expect(await listMyEvents('account-b')).toEqual([]);expect(await listMyEvents('account-a')).toHaveLength(1);
});
it('serializes concurrent edits, rejects invalid dates and does not pretend a failed write saved',async()=>{
 await Promise.all([addMyEvent('account-a',event),addMyEvent('account-a',{...event,id:'two'})]);expect(await listMyEvents('account-a')).toHaveLength(2);
 await expect(addMyEvent('account-a',{...event,endsAt:'1999-01-01'})).rejects.toThrow('INVALID_EVENT');
 vi.spyOn(File.prototype,'write').mockImplementation(()=>{throw Error('disk full');});
 await expect(addMyEvent('account-a',{...event,id:'three'})).rejects.toThrow('disk full');expect(await listMyEvents('account-a')).toHaveLength(2);
});
it('preserves ambiguous legacy logs without exposing them to another account, and removes ended events from Upcoming',async()=>{
 files.set('file:///documents/linqa-my-events.json',Buffer.from(JSON.stringify([{...event,addedAt:'2026-01-01'}])));
 expect(await listMyEvents('account-b')).toEqual([]);expect(files.has('file:///documents/linqa-my-events.json')).toBe(true);
 await importLegacyEvents('account-a');expect(await listMyEvents('account-a')).toHaveLength(1);expect(await listMyEvents('account-b')).toEqual([]);
 expect(upcomingOf([{...event,addedAt:'2026-01-01'}],Date.parse('2030-01-01T14:00:00Z'))).toEqual([]);
});

it('archives historical events and moves an ongoing event into Past exactly at its end time',async()=>{
 const old={...event,id:'historic',startsAt:'2000-01-01T12:00:00Z',endsAt:'2000-01-01T13:00:00Z'};
 await addMyEvent('account-a',old);await addMyEvent('account-a',event);
 const items=await listMyEvents('account-a');const end=Date.parse(event.endsAt);
 expect(upcomingOf(items,end-1).map(item=>item.id)).toEqual(['one']);
 expect(pastOf(items,end-1).map(item=>item.id)).toEqual(['historic']);
 expect(upcomingOf(items,end)).toEqual([]);
 expect(pastOf(items,end).map(item=>item.id)).toEqual(['one','historic']);
 expect(await listMyEvents('account-b')).toEqual([]);
});

it('allows historical event validation for local archives while still refusing past meeting invitations',()=>{
 const form={title:'Past event',date:'2000-01-01',time:'12:00',place:'',durationMinutes:'30'};
 const now=new Date('2026-10-13T16:00:00Z');
 expect(buildCardPayload('EVENT',form,now).ok).toBe(false);
 expect(buildCardPayload('EVENT',form,now,{allowPastEvent:true}).ok).toBe(true);
 expect(buildCardPayload('MEETING',form,now,{allowPastEvent:true}).ok).toBe(false);
 expect(buildCardPayload('EVENT',{...form,date:'2000-02-30'},now,{allowPastEvent:true}).ok).toBe(false);
});

it('all-day events end immediately before the next local midnight',()=>{
 const range=eventRange(new Date(2026,10,1,12,0),0);
 expect(range.start.getHours()).toBe(0);expect(range.end.getHours()).toBe(23);expect(range.end.getMinutes()).toBe(59);
 const next=new Date(range.end.getTime()+1);expect(next.getDate()).toBe(2);expect(next.getHours()).toBe(0);
 expect(eventRange(new Date(2026,10,1,12,0),90).end.getTime()-new Date(2026,10,1,12,0).getTime()).toBe(90*60_000);
});
