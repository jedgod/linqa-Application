import {beforeEach,expect,it,vi} from 'vitest';
import * as system from './system-native-mocks';
import {addToCalendar,scheduleReminder} from '../../clients/mobile/features/conversation/features/schedule/calendar';
import {pickDocuments,pickPhotos,takePhotoOrVideo} from '../../clients/mobile/features/conversation/attachments/pickers';
const event={type:'event' as const,eventId:'event-1',title:'Private medical appointment',startsAt:'2030-10-10T14:00:00Z',endsAt:'2030-10-10T15:00:00Z'};
beforeEach(()=>{vi.resetAllMocks();system.requestCalendarPermissionsAsync.mockResolvedValue({granted:true});system.requestPermissionsAsync.mockResolvedValue({granted:true});system.getItemAsync.mockResolvedValue(null);system.setItemAsync.mockResolvedValue(undefined);system.createEventInCalendarAsync.mockResolvedValue({action:'done'});});
it('calendar fallback never claims an Android editor result confirms saving',async()=>{
 system.requestCalendarPermissionsAsync.mockResolvedValue({granted:false});expect(await addToCalendar(event,'account-a')).toBe('opened');expect(system.createEventAsync).not.toHaveBeenCalled();
 system.requestCalendarPermissionsAsync.mockResolvedValue({granted:true});system.getDefaultCalendarAsync.mockRejectedValue(Error('no default'));system.getCalendarsAsync.mockResolvedValue([{id:'read-only',allowsModifications:false}]);
 expect(await addToCalendar(event,'account-a')).toBe('opened');expect(system.createEventAsync).not.toHaveBeenCalled();
});
it('calendar export chooses a writable calendar and correct meeting end time',async()=>{
 system.getDefaultCalendarAsync.mockResolvedValue({id:'readonly',allowsModifications:false});system.getCalendarsAsync.mockResolvedValue([{id:'writable',allowsModifications:true}]);
 expect(await addToCalendar({...event,type:'meeting',meetingId:'meeting-1',durationMin:45},'account-a')).toBe('added');
 const [id,details]=system.createEventAsync.mock.calls[0]!;expect(id).toBe('writable');expect(details.endDate.toISOString()).toBe('2030-10-10T14:45:00.000Z');
});
it('reminders use stable identifiers and hide private titles unless preview is enabled',async()=>{
 system.scheduleNotificationAsync.mockResolvedValue('notification');expect(await scheduleReminder(event,false)).toBe('notification');
 let request=system.scheduleNotificationAsync.mock.calls[0]![0];expect(request.identifier).toBe('linqa-reminder:event-1');expect(request.content.body).not.toContain(event.title);expect(request.trigger.channelId).toBe('chat-reminders');
 await scheduleReminder(event,true);request=system.scheduleNotificationAsync.mock.calls[1]![0];expect(request.content.body).toBe(event.title);
 expect(system.setNotificationChannelAsync).toHaveBeenCalled();
});
it('expired and permission-denied reminders are not scheduled',async()=>{
 expect(await scheduleReminder({...event,startsAt:'2000-01-01T00:00:00Z'},true)).toBeNull();expect(system.requestPermissionsAsync).not.toHaveBeenCalled();
 system.requestPermissionsAsync.mockResolvedValue({granted:false});expect(await scheduleReminder(event,true)).toBeNull();expect(system.scheduleNotificationAsync).not.toHaveBeenCalled();
});
it('native picker cancellation and permission denial produce no attachments',async()=>{
 system.getDocumentAsync.mockResolvedValue({canceled:true});expect(await pickDocuments()).toEqual([]);
 system.requestMediaLibraryPermissionsAsync.mockResolvedValue({granted:false});expect(await pickPhotos()).toEqual([]);expect(system.launchImageLibraryAsync).not.toHaveBeenCalled();
 system.requestCameraPermissionsAsync.mockResolvedValue({granted:false});expect(await takePhotoOrVideo()).toEqual([]);expect(system.launchCameraAsync).not.toHaveBeenCalled();
});
it('document selections use private cache copies and safe MIME fallback',async()=>{
 system.getDocumentAsync.mockResolvedValue({canceled:false,assets:[{uri:'file:///document',name:'note.txt'}]});
 expect(await pickDocuments()).toEqual([{uri:'file:///document',name:'note.txt',mime:'application/octet-stream',kind:'document'}]);
 expect(system.getDocumentAsync).toHaveBeenCalledWith({multiple:true,copyToCacheDirectory:true});
});

it('concurrent calendar additions create one event and later retries reuse the marker',async()=>{
 const value={...event,eventId:'dedupe-event'};system.getDefaultCalendarAsync.mockResolvedValue({id:'writable',allowsModifications:true});
 await Promise.all([addToCalendar(value,'account-a'),addToCalendar(value,'account-a')]);
 expect(system.createEventAsync).toHaveBeenCalledTimes(1);expect(await addToCalendar(value,'account-a')).toBe('added');expect(system.createEventAsync).toHaveBeenCalledTimes(1);
 await addToCalendar(value,'account-b');expect(system.createEventAsync).toHaveBeenCalledTimes(2);
});
it('unknown calendar persistence does not insert duplicates and reversed dates are rejected',async()=>{
 system.getItemAsync.mockRejectedValueOnce(Error('storage unavailable'));
 await expect(addToCalendar({...event,eventId:'storage-fail'},'account-a')).rejects.toThrow('storage unavailable');expect(system.createEventAsync).not.toHaveBeenCalled();
 await expect(addToCalendar({...event,eventId:'invalid',endsAt:'2000-01-01T00:00:00Z'},'account-a')).rejects.toThrow('INVALID_DATES');
});

it('past events and meetings never request calendar access, open an editor or schedule a notification',async()=>{
 const past={...event,eventId:'past-no-trigger',startsAt:'2000-01-01T12:00:00Z',endsAt:'2000-01-01T13:00:00Z',remind:true};
 expect(await addToCalendar(past,'account-a')).toBe('past');
 expect(await addToCalendar({...past,type:'meeting',meetingId:'past-meeting-no-trigger',durationMin:30},'account-a')).toBe('past');
 expect(await scheduleReminder(past,true)).toBeNull();
 expect(system.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
 expect(system.createEventAsync).not.toHaveBeenCalled();
 expect(system.createEventInCalendarAsync).not.toHaveBeenCalled();
 expect(system.requestPermissionsAsync).not.toHaveBeenCalled();
 expect(system.scheduleNotificationAsync).not.toHaveBeenCalled();
});

it('an event close to its start is saved without an alarm that would fire immediately',async()=>{
 vi.useFakeTimers();
 try {
  vi.setSystemTime(Date.parse(event.startsAt)-10*60_000);
  system.getDefaultCalendarAsync.mockResolvedValue({id:'writable',allowsModifications:true});
  expect(await addToCalendar({...event,eventId:'within-reminder-window'},'account-a')).toBe('added');
  expect(system.createEventAsync.mock.calls[0]![1].alarms).toEqual([]);
 } finally { vi.useRealTimers(); }
});

it('a reminder that expires while its permission prompt is open never fires late',async()=>{
 vi.useFakeTimers();
 try {
  vi.setSystemTime(Date.parse(event.startsAt)-16*60_000);
  system.requestPermissionsAsync.mockImplementation(async()=>{vi.setSystemTime(Date.parse(event.startsAt)-14*60_000);return {granted:true};});
  expect(await scheduleReminder({...event,eventId:'expired-during-prompt'},true)).toBeNull();
  expect(system.scheduleNotificationAsync).not.toHaveBeenCalled();
 } finally { vi.useRealTimers(); }
});
