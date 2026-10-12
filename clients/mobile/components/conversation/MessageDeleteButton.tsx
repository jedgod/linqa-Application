import React, { useRef, useState } from 'react';
import { Alert, Pressable, Text } from 'react-native';
import type { DisplayMessage } from '../../services/conversation-types';

export function MessageDeleteButton({message,onDelete,color}:{message:DisplayMessage;onDelete:(id:string,scope:'me'|'everyone')=>Promise<void>;color:string}) {
  const busyRef=useRef(false);
  const [busy,setBusy]=useState(false);
  if(message.delivery==='sending'||message.delivery==='failed')return null;
  const confirm=(scope:'me'|'everyone')=>Alert.alert(scope==='me'?'Delete for me?':'Delete for everyone?',scope==='me'?'This message will be removed from your chats on your devices. Other people keep their copy.':'This message will be removed from the conversation for everyone. Copies already saved elsewhere cannot be removed.',[
    {text:'Cancel',style:'cancel'},
    {text:'Delete',style:'destructive',onPress:()=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);void onDelete(message.id,scope).catch(()=>Alert.alert('Could not delete','Please check your connection and try again.')).finally(()=>{busyRef.current=false;setBusy(false);});}},
  ]);
  return <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel="Delete message" onPress={()=>Alert.alert('Delete message','Choose who this deletion applies to.',[
    {text:'Delete for me',onPress:()=>confirm('me')},
    ...(message.outgoing?[{text:'Delete for everyone',onPress:()=>confirm('everyone')}]:[]),
    {text:'Cancel',style:'cancel'},
  ])} style={{minHeight:44,minWidth:44,alignSelf:message.outgoing?'flex-end':'flex-start',justifyContent:'center',paddingHorizontal:12}}><Text style={{color,fontSize:12}}>{busy?'Deleting…':'Delete'}</Text></Pressable>;
}
