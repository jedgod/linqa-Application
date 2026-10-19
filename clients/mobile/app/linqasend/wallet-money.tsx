import { useEffect,useMemo,useRef,useState } from 'react';
import { ActivityIndicator,Pressable,ScrollView,Text,TextInput,StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams,useRouter } from 'expo-router';
import { LinqaSendService,type WalletMoneyKind,type WalletMoneyQuote } from '../../services/linqasend.service';
import { accessTokenProvider } from '../../services/session';
import { getApiBaseUrl } from '../../config/api';
import { useAccounts } from '../../account/AccountContext';
import { displayMoney,parseMoney } from '../../services/send-money-validation';
import { send } from '../../components/linqasend/ui';

const labels:Record<WalletMoneyKind,string>={WITHDRAW:'Withdraw to your account',INTERNAL:'Send to a Linqa user',TOPUP:'Add money',EXTERNAL:'Send outside Linqa'};
export default function WalletMoney(){
  const router=useRouter(),params=useLocalSearchParams<{walletId:string;kind:string}>(),{active}=useAccounts(),userId=active?.userId,owner=useRef(userId);owner.current=userId;
  const kind:WalletMoneyKind=['WITHDRAW','INTERNAL','TOPUP','EXTERNAL'].includes(params.kind)?params.kind as WalletMoneyKind:'WITHDRAW';
  const client=useMemo(()=>new LinqaSendService(getApiBaseUrl(),async()=>{const token=await accessTokenProvider.getAccessToken();if(!userId||owner.current!==userId)throw new Error('Account changed. Reopen your wallet.');return token;}),[userId]);
  const [wallet,setWallet]=useState<{id:string;currency:string;availableMinor:string}|null>(null),[targets,setTargets]=useState<Array<{id:string;name:string;currency:string}>>([]),[target,setTarget]=useState(''),[amount,setAmount]=useState(''),[quote,setQuote]=useState<WalletMoneyQuote|null>(null),[pending,setPending]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{let current=true;setWallet(null);setQuote(null);setMessage('');setTarget('');setTargets([]);setPending(false);setAmount('');
    Promise.all([client.getWallets(),client.walletMoneyTargets(kind),client.pendingWalletMoney()]).then(([w,t,p])=>{if(!current)return;setWallet(w.items.find(x=>x.id===params.walletId&&x.balanceVerified&&x.status==='ACTIVE')??null);setTargets(t.items);setPending(!!p);if(!w.items.some(x=>x.id===params.walletId))setMessage('Open an active wallet first.');}).catch(e=>{if(current)setMessage(e instanceof Error?e.message:'Unable to load this wallet.');});return()=>{current=false;};
  },[client,kind,params.walletId]);
  async function preview(){if(!wallet)return;const minor=parseMoney(amount,wallet.currency);if(!minor||!target){setMessage('Enter a positive amount and choose an account or recipient.');return;}setBusy(true);setMessage('');try{const q=await client.quoteWalletMoney({walletId:wallet.id,kind,amountMinor:minor,targetId:target});if(owner.current===userId)setQuote(q);}catch(e){if(owner.current===userId)setMessage(e instanceof Error?e.message:'Unable to quote this action.');}finally{setBusy(false);}}
  async function confirm(resume=false,resolve=false){setBusy(true);setMessage('');try{const r=resolve?await client.resolvePendingWalletMoney():resume?await client.resumeWalletMoney():await client.authorizeWalletMoney(quote!.id);if(owner.current===userId){setPending(false);setQuote(null);setMessage(`Status: ${r.status.toLowerCase()}. Reference: ${r.id}. Check your wallet for updates.`);}}catch(e){if(owner.current===userId){setMessage(`${e instanceof Error?e.message:'Unable to confirm.'} Check the wallet status before starting another action.`);setPending(!!await client.pendingWalletMoney());}}finally{setBusy(false);}}
  return <SafeAreaView style={s.page}><ScrollView contentContainerStyle={s.content}><Pressable onPress={()=>router.back()}><Text style={s.link}>Back</Text></Pressable><Text style={s.title}>{labels[kind]}</Text>
    {!wallet&&!message?<ActivityIndicator/>:null}{wallet?<Text style={s.copy}>Available: {displayMoney(wallet.availableMinor,wallet.currency)} {wallet.currency}</Text>:null}
    {pending?<><Pressable disabled={busy} style={s.button} onPress={()=>void confirm(true)}><Text style={s.white}>Resume pending wallet action</Text></Pressable><Text style={s.copy}>Check its status before starting another. If it was never submitted, checking cancels the unused authorization.</Text><Pressable disabled={busy} onPress={()=>void confirm(false,true)}><Text style={s.link}>Check pending action</Text></Pressable></>:quote?<>
      <Text style={s.copy}>Amount: {displayMoney(quote.amountMinor,quote.currency)} {quote.currency}</Text><Text style={s.copy}>Fee: {displayMoney(quote.feeMinor,quote.currency)} {quote.currency}</Text><Text style={s.copy}>Total {kind==='TOPUP'?'charged to your account':'from wallet'}: {displayMoney(quote.totalMinor,quote.currency)} {quote.currency}</Text><Text style={s.copy}>{kind==='TOPUP'?'Wallet receives':'Recipient receives'}: {displayMoney(quote.receiveAmountMinor,quote.receiveCurrency)} {quote.receiveCurrency}</Text><Text style={s.copy}>Rate: {quote.fxRate}. Estimated arrival: {quote.estimatedArrival}. Quote expires {new Date(quote.expiresAt).toLocaleTimeString()}.</Text>
      <Pressable disabled={busy||Date.parse(quote.expiresAt)<=Date.now()} style={s.button} onPress={()=>void confirm()}><Text style={s.white}>Authorize with biometrics</Text></Pressable><Pressable disabled={busy} onPress={()=>setQuote(null)}><Text style={s.link}>Change details</Text></Pressable>
    </>:<>
      <Text style={s.copy}>Amount {wallet?.currency??''}</Text><TextInput accessibilityLabel='Amount' keyboardType='decimal-pad' value={amount} onChangeText={setAmount} style={s.input}/>
      <Text style={s.copy}>{kind==='TOPUP'?'Pay from':kind==='WITHDRAW'?'Your bank or debit card':'Recipient'}</Text>
      {targets.map(t=><Pressable accessibilityRole='radio' accessibilityState={{checked:target===t.id}} key={t.id} style={[s.option,target===t.id&&s.selected]} onPress={()=>setTarget(t.id)}><Text style={s.copy}>{t.name} · {t.currency}</Text></Pressable>)}
      {!targets.length?<Text style={s.copy}>No eligible accounts or recipients. Link an account or add a recipient before continuing.</Text>:null}
      <Pressable onPress={()=>router.push(kind==='TOPUP'||kind==='WITHDRAW'?'/linqasend/bank-link':'/linqasend/recipients')}><Text style={s.link}>{kind==='TOPUP'||kind==='WITHDRAW'?'Link bank or debit card':'Manage recipients'}</Text></Pressable>
      <Pressable disabled={busy||!wallet||!target} style={s.button} onPress={()=>void preview()}><Text style={s.white}>Review amount and fees</Text></Pressable>
    </>}
    <Text accessibilityRole='alert' style={s.copy}>{busy?'Please wait…':message}</Text>
    {kind==='TOPUP'?<Text style={s.copy}>Money becomes available only after the provider confirms settlement. A charge authorization or pending bank payment is not a completed top-up.</Text>:null}
  </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:send.bg},content:{padding:22,gap:16},title:{fontSize:24,fontWeight:'700',color:send.text},copy:{fontSize:15,lineHeight:23,color:send.text},link:{fontSize:16,color:send.primary,paddingVertical:12},button:{backgroundColor:send.primary,padding:18,borderRadius:14},white:{fontSize:16,color:'white',fontWeight:'700'},input:{borderWidth:1,borderColor:send.border,borderRadius:12,padding:16,fontSize:20,color:send.text},option:{borderWidth:1,borderColor:send.border,borderRadius:12,padding:15},selected:{borderColor:send.primary,backgroundColor:send.primarySoft}});
