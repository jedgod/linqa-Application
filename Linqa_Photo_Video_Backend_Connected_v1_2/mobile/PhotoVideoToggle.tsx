import React, {useEffect,useRef,useState} from 'react';
import {Dimensions,Modal,Pressable,StyleSheet,Text,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
export type CaptureMode='photo'|'video';
type Props={mode:CaptureMode;onModeChange:(mode:CaptureMode)=>void;onCapture:(mode:CaptureMode)=>void;disabled?:boolean;scopeKey:string;color?:string;surface?:string;ink?:string};
/** One visible icon. Popup choices disappear after selection. Parent owns mode. */
export function PhotoVideoToggle({mode,onModeChange,onCapture,disabled=false,scopeKey,color='#FDBA8C',surface='#171A35',ink='#F5F3FF'}:Props){
 const [open,setOpen]=useState(false),[anchor,setAnchor]=useState({left:0,top:0});
 const target=useRef<View>(null),generation=useRef(0),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
 useEffect(()=>{generation.current++;setOpen(false);},[disabled,scopeKey]);
 useEffect(()=>{const sub=Dimensions.addEventListener('change',()=>{generation.current++;setOpen(false);});return()=>sub.remove();},[]);
 function toggle(){
  if(disabled)return;
  if(open){generation.current++;setOpen(false);return;}
  const ticket=++generation.current;
  target.current?.measureInWindow((x,y,width)=>{
   if(!alive.current||ticket!==generation.current)return;
   const screen=Dimensions.get('window');
   setAnchor({left:Math.max(8,Math.min(x+width-190,screen.width-198)),top:Math.max(8,y-128)});setOpen(true);
  });
 }
 function select(next:CaptureMode){
  generation.current++;setOpen(false);
  if(disabled)return;
  onModeChange(next);onCapture(next);
 }
 const dismiss=()=>{generation.current++;setOpen(false);};
 return <View ref={target} collapsable={false}>
  <Pressable accessibilityRole="button" accessibilityLabel={`${mode==='photo'?'Photo':'Video'} selected. Choose photo or video`} accessibilityState={{disabled,expanded:open}} disabled={disabled} onPress={toggle} style={[styles.trigger,disabled&&{opacity:.35}]}>
   <Ionicons name={mode==='photo'?'camera-outline':'videocam-outline'} size={27} color={color}/>
   <Ionicons name={open?'chevron-up':'chevron-down'} size={12} color={color}/>
  </Pressable>
  <Modal visible={open&&!disabled} transparent animationType="fade" onRequestClose={dismiss}>
   <View style={styles.modal}>
    <Pressable accessibilityRole="button" accessibilityLabel="Close photo and video choices" onPress={dismiss} style={StyleSheet.absoluteFill}/>
    <View style={[styles.menu,{left:anchor.left,top:anchor.top,backgroundColor:surface}]} accessibilityViewIsModal>
     {(['photo','video'] as const).map(value=><Pressable key={value} accessibilityRole="button" accessibilityState={{selected:mode===value}} accessibilityLabel={value==='photo'?'Take a photo':'Record a video'} onPress={()=>select(value)} style={styles.choice}>
      <Ionicons name={value==='photo'?'camera-outline':'videocam-outline'} size={24} color={color}/>
      <Text style={[styles.label,{color:ink}]}>{value==='photo'?'Photo':'Video'}</Text>
      {mode===value&&<Ionicons name="checkmark" size={19} color={color}/>}
     </Pressable>)}
    </View>
   </View>
  </Modal>
 </View>;
}
const styles=StyleSheet.create({trigger:{minWidth:48,minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:2},modal:{flex:1},menu:{position:'absolute',width:190,borderRadius:16,padding:6,elevation:9,shadowColor:'#000',shadowOpacity:.2,shadowRadius:12,shadowOffset:{width:0,height:4}},choice:{minHeight:52,flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:12},label:{fontSize:16,flex:1}});
