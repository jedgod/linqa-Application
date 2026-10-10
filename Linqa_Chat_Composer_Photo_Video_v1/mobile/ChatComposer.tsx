import React, {useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Alert,Image,Modal,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
export type MediaDraft={uri:string;kind:'photo'|'video';mimeType:string;name:string;size?:number;durationMs?:number};
type Props={scopeKey:string;enabled:boolean;onText:(text:string)=>Promise<boolean>;onMedia:(draft:MediaDraft,caption:string)=>Promise<boolean>;onAdd:()=>void;onVoice:()=>void};
const emojis=['😀','😊','🥰','😂','👏','🙏','❤️','👍','🎉','✨','🌍','✈️'];
export function ChatComposer({scopeKey,enabled,onText,onMedia,onAdd,onVoice}:Props){
 const [text,setText]=useState(''),[selection,setSelection]=useState({start:0,end:0});
 const [emoji,setEmoji]=useState(false),[camera,setCamera]=useState(false),[draft,setDraft]=useState<MediaDraft|null>(null),[busy,setBusy]=useState(false);
 const epoch=useRef(0),alive=useRef(true),flight=useRef(false),picker=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;epoch.current++;};},[]);
 useEffect(()=>{epoch.current++;setText('');setDraft(null);setEmoji(false);setCamera(false);},[scopeKey,enabled]);
 const valid=(e:number)=>alive.current&&epoch.current===e;
 const addEmoji=(value:string)=>{setText(old=>old.slice(0,selection.start)+value+old.slice(selection.end));const at=selection.start+value.length;setSelection({start:at,end:at});};
 async function choose(mode:'photo'|'video'|'gallery'){
  if(!enabled||flight.current||picker.current)return;picker.current=true;const e=epoch.current;setCamera(false);
  try{
   if(mode!=='gallery'){
    const permission=await ImagePicker.requestCameraPermissionsAsync();if(!valid(e))return;
    if(!permission.granted){Alert.alert('Camera permission','Allow camera access in your device settings to take a photo or video.');return;}
   } else {
    const permission=await ImagePicker.requestMediaLibraryPermissionsAsync();if(!valid(e))return;
    if(!permission.granted){Alert.alert('Gallery permission','Allow photo library access in your device settings.');return;}
   }
   const result=mode==='gallery'?await ImagePicker.launchImageLibraryAsync({mediaTypes:ImagePicker.MediaTypeOptions.All,allowsEditing:false,allowsMultipleSelection:false}):await ImagePicker.launchCameraAsync({mediaTypes:mode==='photo'?ImagePicker.MediaTypeOptions.Images:ImagePicker.MediaTypeOptions.Videos,allowsEditing:false,quality:0.85,videoMaxDuration:60});
   if(!valid(e)||result.canceled)return;
   const asset=result.assets[0];if(!asset||!['image','video'].includes(asset.type??''))throw new Error('Choose a photo or video.');
   if(asset.fileSize&&asset.fileSize>25*1024*1024)throw new Error('Choose a file below 25 MB.');
   if(asset.type==='video'&&(asset.duration??0)>60_000)throw new Error('Choose a video of 60 seconds or less.');
   setDraft({uri:asset.uri,kind:asset.type==='video'?'video':'photo',mimeType:asset.mimeType??(asset.type==='video'?'video/mp4':'image/jpeg'),name:asset.fileName??(asset.type==='video'?'video.mp4':'photo.jpg'),size:asset.fileSize,durationMs:asset.duration??undefined});
  }catch(error){if(valid(e))Alert.alert('Media unavailable',error instanceof Error?error.message:'Please try again.');}finally{picker.current=false;}
 }
 async function send(){
  if(!enabled||flight.current||(!draft&&!text.trim()))return;
  const e=epoch.current;flight.current=true;setBusy(true);
  try{const ok=draft?await onMedia(draft,text.trim()):await onText(text.trim());if(valid(e)&&ok){setText('');setDraft(null);setEmoji(false);}}
  catch{if(valid(e))Alert.alert('Not sent','Your message could not be sent. Check the connection and try again.');}
  finally{flight.current=false;if(alive.current)setBusy(false);}
 }
 const button=(label:string,glyph:string,action:()=>void)=> <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={!enabled||busy} onPress={action} style={s.button}><Text style={[s.icon,(!enabled||busy)&&s.disabled]}>{glyph}</Text></Pressable>;
 return <View style={s.root}>
  {draft&&<View style={s.preview}>{draft.kind==='photo'?<Image source={{uri:draft.uri}} style={s.thumb}/>:<Text style={s.video}>▶ Video</Text>}<View style={{flex:1}}><Text style={s.label}>{draft.kind==='photo'?'Photo ready':'Video ready'}</Text><Text style={s.note}>Add a caption below</Text></View>{button('Remove attachment','×',()=>setDraft(null))}</View>}
  {emoji&&enabled&&<View style={s.emojis}>{emojis.map(value=><Pressable key={value} accessibilityRole="button" accessibilityLabel={`Insert ${value}`} onPress={()=>addEmoji(value)} style={s.button}><Text style={s.emoji}>{value}</Text></Pressable>)}</View>}
  <View style={s.row}>
   {button('Choose emoji','☺',()=>setEmoji(v=>!v))}
   <TextInput accessibilityLabel={draft?'Attachment caption':'Message'} placeholder={draft?'Add a caption…':'Message…'} placeholderTextColor="#A3A7C4" value={text} onChangeText={setText} selection={selection} onSelectionChange={event=>setSelection(event.nativeEvent.selection)} multiline maxLength={4000} editable={enabled&&!busy} style={s.input}/>
   {button('Attachments','＋',onAdd)}
   {button('Take photo or video','▣',()=>{setEmoji(false);setCamera(true);})}
   {text.trim()||draft?button('Send message','➤',()=>void send()):button('Record voice message','♩',onVoice)}
   {busy&&<ActivityIndicator color="#FDBA8C"/>}
  </View>
  {!enabled&&<Text style={s.note}>Unlock this conversation to send messages</Text>}
  <Modal transparent visible={camera&&enabled} animationType="slide" onRequestClose={()=>setCamera(false)}><View style={s.overlay}><View style={s.sheet}><Text style={s.title}>Share a moment</Text>{[['Take photo','photo'],['Record video','video'],['Choose from gallery','gallery']].map(([label,mode])=><Pressable key={mode} accessibilityRole="button" onPress={()=>void choose(mode as 'photo'|'video'|'gallery')} style={s.option}><Text style={s.label}>{label}</Text></Pressable>)}<Pressable accessibilityRole="button" onPress={()=>setCamera(false)} style={s.option}><Text style={s.note}>Cancel</Text></Pressable></View></View></Modal>
 </View>;
}
const s=StyleSheet.create({root:{backgroundColor:'#171A35',padding:8,borderTopWidth:1,borderTopColor:'#353A60'},row:{flexDirection:'row',alignItems:'flex-end',gap:2},input:{flex:1,minHeight:44,maxHeight:130,backgroundColor:'#252947',borderRadius:18,color:'#F5F3FF',padding:12,fontSize:16},button:{minWidth:42,minHeight:44,alignItems:'center',justifyContent:'center'},icon:{fontSize:25,color:'#FDBA8C'},disabled:{opacity:.35},emojis:{flexDirection:'row',flexWrap:'wrap',paddingBottom:8},emoji:{fontSize:25},preview:{flexDirection:'row',gap:10,alignItems:'center',padding:8},thumb:{width:60,height:60,borderRadius:12},video:{color:'#FDBA8C',padding:10},label:{color:'#F5F3FF',fontSize:16},note:{color:'#B5B8D2',fontSize:12,paddingVertical:4},overlay:{flex:1,justifyContent:'flex-end',backgroundColor:'#0009'},sheet:{backgroundColor:'#171A35',borderTopLeftRadius:24,borderTopRightRadius:24,padding:22,paddingBottom:40},title:{color:'#FDBA8C',fontSize:21,fontWeight:'600',marginBottom:12},option:{paddingVertical:17,borderBottomWidth:1,borderBottomColor:'#353A60'}});
