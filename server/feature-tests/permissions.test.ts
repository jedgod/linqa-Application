import {beforeEach,expect,it,vi} from 'vitest';
import * as system from './system-native-mocks';
import {addToCalendar,scheduleReminder} from '../../clients/mobile/features/conversation/features/schedule/calendar';
import {pickDocuments,pickPhotos,takePhotoOrVideo} from '../../clients/mobile/features/conversation/attachments/pickers';
const event={type:'event' as const,eventId:'event-1',title:'Private medical appointment',startsAt:'2030-10-10T14:00:00Z',endsAt:'2030-10-10T15:00:00Z'};
beforeEach(()=>{vi.resetAllMocks();system.requestCalendarPermissionsAsync.mockResolvedValue({granted:true});system.requestPermissionsAsync.mockResolvedValue({granted:true});});
it('calendar denial and absence of writable calendars create no event',async()=>{
 system.requestCalendarPermissionsAsync.mockResolvedValue({granted:false});expect(await addToCalendar(event)).toBe('denied');expect(system.createEventAsync).not.toHaveBeenCalled();
 system.requestCalendarPermissionsAsync.mockResolvedValue({granted:true});system.getDefaultCalendarAsync.mockRejectedValue(Error('no default'));system.getCalendarsAsync.mockResolvedValue([{id:'read-only',allowsModifications:false}]);
 expect(await addToCalendar(event)).toBe('denied');expect(system.createEventAsync).not.toHaveBeenCalled();
});
it('calendar export chooses a writable calendar and correct meeting end time',async()=>{
 system.getDefaultCalendarAsync.mockResolvedValue({id:'readonly',allowsModifications:false});system.getCalendarsAsync.mockResolvedValue([{id:'writable',allowsModifications:true}]);
 expect(await addToCalendar({...event,type:'meeting',meetingId:'meeting-1',durationMin:45})).toBe('added');
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
