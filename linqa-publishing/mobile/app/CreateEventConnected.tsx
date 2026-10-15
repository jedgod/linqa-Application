import React from 'react';
import {Alert} from 'react-native';
import LinqaCreateEvent from '../LinqaCreateEvent';
import {publishOrQueue,type PublishingConfig} from '../src/publishing';

// Replace with the existing Linqa auth/session provider and navigation.
export default function CreateEventConnected({config,onClose}:{config:PublishingConfig;onClose:()=>void}){
 return <LinqaCreateEvent onClose={onClose} onPublish={async event=>{
  const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
  const result=await publishOrQueue(config,event,timezone);
  if(result.status==='published')Alert.alert('Published','Your event is live.');
  else if(result.status==='pending')Alert.alert('Saved offline','Your event is pending synchronization.');
  else Alert.alert('Action required',result.error||'Please review the event.');
  onClose();
 }}/>;
}
