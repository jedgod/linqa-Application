import React,{useEffect,useRef,useState} from 'react';
import {Alert,Pressable,Text,View} from 'react-native';
import {rejectionReason,type RejectedMessage,type RejectedOutbox} from '../services/rejected-outbox';
export function RejectedMessagesPanel({outbox,conversationId,enabled}: {
 outbox: RejectedOutbox; conversationId: string; enabled: boolean;
}) {
 const [rows,setRows]=useState<RejectedMessage[]>([]);
 const [error,setError]=useState(false);const [busy,setBusy]=useState<string|null>(null);
 const generation=useRef(0);const request=useRef(0);
 useEffect(()=>{
  const epoch=++generation.current;setRows([]);setError(false);setBusy(null);
  const valid=()=>generation.current===epoch;
  async function reload(){
   const seq=++request.current;if(!enabled)return;
   try{const next=await outbox.rejected(conversationId);if(valid()&&seq===request.current){setRows(next);setError(false);}}
   catch{if(valid()&&seq===request.current)setError(true);}
  }
  const unsubscribe=outbox.subscribe(()=>{void reload();});void reload();
  return()=>{generation.current++;request.current++;unsubscribe();};
 },[outbox,conversationId,enabled]);
 if(!enabled)return null;
 function confirm(messageId:string){
  const epoch=generation.current;
  Alert.alert('Discard unsent message?','This removes the encrypted unsent copy from this device.',[
   {text:'Cancel',style:'cancel'},
   {text:'Discard',style:'destructive',onPress:()=>{
    if(generation.current!==epoch)return;
    setBusy(messageId);setError(false);
    void outbox.discard(conversationId,messageId).catch(()=>{if(generation.current===epoch)setError(true);})
     .finally(()=>{if(generation.current===epoch)setBusy(null);});
   }}
  ]);
 }
 return <View accessibilityLabel="Rejected outgoing messages" style={{padding:12,gap:8}}>
  {error&&<Text accessibilityRole="alert" style={{color:'#962C36'}}>Could not update unsent messages. Try reopening this conversation.</Text>}
  {rows.map(row=><View key={row.messageId} style={{padding:12,borderRadius:12,backgroundColor:'#FFF0EF',borderWidth:1,borderColor:'#DFA5A9'}}>
   <Text style={{color:'#54242B',fontWeight:'700'}}>Not sent</Text>
   <Text style={{color:'#54242B',marginTop:4}}>{rejectionReason(row.errorCode)}</Text>
   <Text style={{color:'#54242B',marginTop:4}}>Message text is unavailable here. You can compose a new message.</Text>
   <Pressable accessibilityRole="button" accessibilityLabel="Discard unsent message" disabled={busy!==null} onPress={()=>confirm(row.messageId)} style={{paddingVertical:12,minHeight:44}}>
    <Text style={{color:'#852831',fontWeight:'600'}}>{busy===row.messageId?'Discarding…':'Discard'}</Text>
   </Pressable>
  </View>)}
 </View>;
}
