import { useMemo,useRef,useState } from 'react';
import { Linking,Pressable,ScrollView,Text,View,StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinqaSendService } from '../../services/linqasend.service';
import { accessTokenProvider } from '../../services/session';
import { getApiBaseUrl } from '../../config/api';
import { useAccounts } from '../../account/AccountContext';
import { send } from '../../components/linqasend/ui';

export default function BankLink(){
  const router=useRouter(),{active}=useAccounts(),userId=active?.userId,owner=useRef(userId);owner.current=userId;
  const client=useMemo(()=>new LinqaSendService(getApiBaseUrl(),async()=>{const token=await accessTokenProvider.getAccessToken();if(!userId||owner.current!==userId)throw new Error('Account changed. Reopen bank linking.');return token;}),[userId]);
  const [session,setSession]=useState<{id:string;url:string;owner:string}|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function begin(type:'BANK_ACCOUNT'|'DEBIT_CARD'){
    setBusy(true);setMessage('');try{const r=await client.beginBankLink(type);if(owner.current!==userId)return;setSession({...r,owner:userId!});await Linking.openURL(r.url);}catch(e){if(owner.current===userId)setMessage(e instanceof Error?e.message:'Unable to open secure setup.');}finally{setBusy(false);}
  }
  async function confirm(){if(!session||session.owner!==userId)return;setBusy(true);try{await client.confirmBankLink(session.id);if(owner.current===userId){setSession(null);setMessage('Account verified. It is available for the funding or withdrawal options approved by your provider.');}}catch(e){if(owner.current===userId)setMessage(e instanceof Error?e.message:'Verification is not complete.');}finally{setBusy(false);}}
  return <SafeAreaView style={s.page}><ScrollView contentContainerStyle={s.content}><Pressable onPress={()=>router.back()}><Text style={s.link}>Back</Text></Pressable><Text style={s.title}>Link your bank or debit card</Text><Text style={s.copy}>Complete verification on the provider’s secure page, then return here. Linking an account does not move money.</Text>
    <Pressable disabled={busy} style={s.button} onPress={()=>void begin('BANK_ACCOUNT')}><Text style={s.white}>Link bank account</Text></Pressable>
    <Pressable disabled={busy} style={s.button} onPress={()=>void begin('DEBIT_CARD')}><Text style={s.white}>Verify debit card for wallet use</Text></Pressable>
    {session&&session.owner===userId?<View><Pressable disabled={busy} style={s.button} onPress={()=>void confirm()}><Text style={s.white}>Check verification</Text></Pressable><Pressable onPress={()=>void Linking.openURL(session.url)}><Text style={s.link}>Reopen secure setup</Text></Pressable></View>:null}
    <Text accessibilityRole='alert' style={s.copy}>{busy?'Please wait…':message}</Text>
  </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:send.bg},content:{padding:22,gap:20},title:{fontSize:24,fontWeight:'700',color:send.text},copy:{fontSize:15,lineHeight:23,color:send.muted},link:{fontSize:16,color:send.primary,paddingVertical:12},button:{backgroundColor:send.primary,padding:18,borderRadius:14},white:{fontSize:16,color:'white',fontWeight:'700'}});
