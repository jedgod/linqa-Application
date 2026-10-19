import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinqaSendStatusBar, send } from "../../components/linqasend/ui";
import { getApiBaseUrl } from "../../config/api";
import { LinqaSendService,type WalletMoneyOperation } from "../../services/linqasend.service";
import { accessTokenProvider } from "../../services/session";
import { displayMoney } from "../../services/send-money-validation";
import { fonts } from "../../theme/tokens";
import { useAccounts } from "../../account/AccountContext";

/** Server balances only. A failed fetch never becomes an invented zero balance. */
export default function Wallet() {
  const router=useRouter();
  const {active:account}=useAccounts();const accountId=account?.userId;
  const client=useMemo(()=>new LinqaSendService(getApiBaseUrl(),()=>accessTokenProvider.getAccessToken()),[]);
  const [data,setData]=useState<Awaited<ReturnType<LinqaSendService["getWallets"]>>|null>(null);
  const [receipts,setReceipts]=useState<Awaited<ReturnType<LinqaSendService["getWalletReceipts"]>>|null>(null);
  const [error,setError]=useState("");const [reload,setReload]=useState(0);
  const [operations,setOperations]=useState<WalletMoneyOperation[]>([]),[currency,setCurrency]=useState('USD');
  const [canceling,setCanceling]=useState(false);
  async function cancel(id:string){
    if(canceling)return;setCanceling(true);
    try{await client.cancelWalletWithdrawal(id);setReload(v=>v+1);}catch{setError('The withdrawal could not be canceled. Refresh to check whether it has already been dispatched.');}finally{setCanceling(false);}
  }
  useFocusEffect(useCallback(()=>{
    let active=true;setError("");setData(null);setReceipts(null);setOperations([]);
    Promise.all([client.getWallets(),client.getWalletReceipts(),client.walletMoneyOperations()]).then(([wallets,items,money])=>{if(active){setData(wallets);setReceipts(items);setOperations(money.items);}})
      .catch(()=>{if(active)setError("Wallet balances are unavailable. Reconnect and try again.");});
    return()=>{active=false;};
  },[client,reload,accountId]));
  return <SafeAreaView style={s.screen}><LinqaSendStatusBar/>
    <View style={s.header}><Pressable accessibilityRole="button" onPress={()=>router.canGoBack()?router.back():router.replace("/linqasend")}><Text style={s.link}>Back</Text></Pressable><Text accessibilityRole="header" style={s.title}>Linqa wallet</Text></View>
    <ScrollView contentContainerStyle={s.content}>
      {error?<Text accessibilityRole="alert" style={s.error}>{error}</Text>:!data?<ActivityIndicator color={send.primary}/>:null}
      {data?.items.length===0?<><Text style={s.copy}>Open a wallet to receive money or add funds. Opening a wallet does not move money.</Text><TextInput accessibilityLabel='Wallet currency' value={currency} onChangeText={v=>setCurrency(v.toUpperCase())} maxLength={3} autoCapitalize='characters' style={s.copy}/><Pressable style={s.action} onPress={()=>{void client.openWallet(currency).then(()=>setReload(v=>v+1)).catch(()=>setError('This wallet cannot be opened yet. Check your verified account country and supported currency.'));}}><Text style={s.link}>Open wallet</Text></Pressable></>:null}
      {data?.items.map(w=><View key={w.id} style={s.card}>
        <Text style={s.title}>{w.currency} · {w.jurisdiction}</Text>
        {!w.balanceVerified?<Text style={s.copy}>Balance unavailable until this account is reconciled.</Text>:<>
          <Text style={s.amount}>{displayMoney(w.availableMinor,w.currency)} {w.currency}</Text><Text style={s.copy}>Available</Text>
          <Text style={s.copy}>Pending: {displayMoney(w.pendingMinor,w.currency)} {w.currency}</Text>
          <Text style={s.copy}>Held for withdrawals: {displayMoney(w.heldMinor,w.currency)} {w.currency}</Text>
          <Text style={s.copy}>Available to withdraw: {displayMoney(w.withdrawableMinor,w.currency)} {w.currency}</Text>
          <Text style={s.copy}>Account status: {w.status.toLowerCase()}</Text>
          {w.status==='ACTIVE'?([
            ['TOPUP','Add money'],['WITHDRAW','Withdraw amount'],['INTERNAL','Send to Linqa user'],['EXTERNAL','Send outside Linqa']
          ] as const).map(([kind,label])=><Pressable key={kind} accessibilityRole='button' style={s.action} onPress={()=>router.push({pathname:'/linqasend/wallet-money',params:{walletId:w.id,kind}})}><Text style={s.link}>{label}</Text></Pressable>):null}
        </>}
      </View>)}
      {operations.length?<Text accessibilityRole='header' style={s.title}>Wallet activity</Text>:null}
      {operations.map(o=><View key={o.id} style={s.card}><Text style={s.title}>{o.kind==='INTERNAL'&&o.direction==='RECEIVED'?'Received from Linqa user':({WITHDRAW:'Withdrawal',INTERNAL:'Sent to Linqa user',TOPUP:'Added money',EXTERNAL:'External payment'} as const)[o.kind]}</Text><Text style={s.copy}>{displayMoney(o.snapshot.amountMinor,o.snapshot.currency)} {o.snapshot.currency} · {o.status.toLowerCase().replace(/_/g,' ')}</Text><Text style={s.copy}>Reference: {o.id}</Text>
        {o.action_url?<Pressable style={s.action} onPress={()=>void Linking.openURL(o.action_url!)}><Text style={s.link}>Complete secure provider verification</Text></Pressable>:null}
        {o.status==='QUEUED'?<Pressable style={s.action} onPress={()=>{void client.cancelWalletMoney(o.id).then(()=>setReload(v=>v+1)).catch(()=>setError('Cancellation could not be confirmed. Refresh the wallet status.'));}}><Text style={s.link}>Cancel before processing</Text></Pressable>:null}
        {o.status==='COMPLETED'&&['WITHDRAW','EXTERNAL'].includes(o.kind)?<Pressable style={s.action} onPress={()=>{void client.requestWalletMoneyRefund(o.id).then(()=>setError('Refund requested. Funds are credited only when the provider confirms their return.')).catch(()=>setError('The refund request could not be confirmed. Refresh the wallet status.'));}}><Text style={s.link}>Request return of payment</Text></Pressable>:null}
        {BigInt(o.returned_minor)>0n?<Text style={s.copy}>Returned: {displayMoney(o.returned_minor,o.snapshot.currency)} {o.snapshot.currency}</Text>:null}
      </View>)}
      <Pressable accessibilityRole='button' style={s.action} onPress={()=>router.push('/linqasend/bank-link')}><Text style={s.link}>Link bank or debit card</Text></Pressable>
      {receipts&&receipts.items.length>0?<Text accessibilityRole="header" style={s.title}>Received money and withdrawals</Text>:null}
      {receipts?.items.map(r=><View key={r.id} style={s.card}><Text style={s.title}>{displayMoney(r.amount_minor,r.currency.trim())} {r.currency.trim()}</Text>
        <Text style={s.copy}>{new Date(r.created_at).toLocaleDateString()} · {r.id}</Text>
        {r.withdrawal_status&&!['FAILED','CANCELED'].includes(r.withdrawal_status)?<Text style={s.copy}>Withdrawal: {r.withdrawal_status.toLowerCase()}{r.withdrawal_status==="RECONCILING"?" — checking the provider; funds remain held":""}</Text>
          :<Pressable accessibilityRole="button" style={s.action} onPress={()=>router.push({pathname:"/linqasend/deposit",params:{id:r.id}})}><Text style={s.link}>Withdraw to bank or card</Text></Pressable>}
        {r.withdrawal_status==='SCHEDULED'&&r.withdrawal_id?<Pressable accessibilityRole='button' disabled={canceling} style={s.action} onPress={()=>void cancel(r.withdrawal_id!)}><Text style={s.link}>{canceling?'Canceling…':'Cancel scheduled withdrawal'}</Text></Pressable>:null}
      </View>)}
      <Pressable accessibilityRole="button" style={s.action} onPress={()=>setReload(v=>v+1)}><Text style={s.link}>Refresh wallet</Text></Pressable>
    </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({screen:{flex:1,backgroundColor:send.bg},header:{padding:20,gap:16},content:{padding:20,gap:16},card:{padding:20,borderRadius:18,backgroundColor:send.surface,gap:8},title:{fontFamily:fonts.bold,fontSize:18,color:send.text},amount:{fontFamily:fonts.extrabold,fontSize:28,color:send.primary},copy:{fontFamily:fonts.regular,fontSize:14,color:send.muted,lineHeight:21},link:{fontFamily:fonts.bold,fontSize:15,color:send.primary},action:{paddingVertical:14,minHeight:48},error:{fontSize:15,color:send.danger}});
