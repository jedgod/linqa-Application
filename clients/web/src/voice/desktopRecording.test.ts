import {afterEach,describe,expect,it,vi} from 'vitest';
import {LocalTranscription} from './LocalTranscription';
import {VoiceNoteRecorder} from './VoiceNoteRecorder';

afterEach(()=>vi.unstubAllGlobals());
describe('desktop microphone lifecycle',()=>{
 it('stops a microphone granted after the recording dialog was cancelled',async()=>{
  let grant!:(stream:MediaStream)=>void;const stop=vi.fn();
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:()=>new Promise<MediaStream>(resolve=>{grant=resolve;})}});
  const recorder=new VoiceNoteRecorder();const started=recorder.start();const rejected=expect(started).rejects.toThrow('cancelled');
  recorder.cancel();grant({getTracks:()=>[{stop}]} as unknown as MediaStream);await rejected;expect(stop).toHaveBeenCalled();
 });
 it('does not start transcription after cancellation while checking the language pack',async()=>{
  let available!:(value:string)=>void;const start=vi.fn();
  class Recognition{processLocally=false;start=start;abort=vi.fn();static available=vi.fn(()=>new Promise<string>(resolve=>{available=resolve;}));}
  vi.stubGlobal('SpeechRecognition',Recognition);
  const transcription=new LocalTranscription();const pending=transcription.start(vi.fn(),vi.fn());transcription.stop();available('available');await pending;
  expect(start).not.toHaveBeenCalled();expect(Recognition.available).toHaveBeenCalledWith({langs:['en-US'],processLocally:true});
 });
 it('rejects cloud-only speech recognition',async()=>{
  class Recognition{start=vi.fn();}
  vi.stubGlobal('SpeechRecognition',Recognition);
  await expect(new LocalTranscription().start(vi.fn(),vi.fn())).rejects.toThrow('on-device');
 });
});
