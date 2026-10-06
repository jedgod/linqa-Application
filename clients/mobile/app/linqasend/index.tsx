import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { LinqaSendService, type LinqaSendTransferSummary } from "../../services/linqasend.service";
import { accessTokenProvider } from "../../services/session";
import { getApiBaseUrl } from "../../config/api";
import { useLinqaSendAvailability } from "../../services/linqasend-availability";

const API = getApiBaseUrl();
const money = (minor: string, currency: string) => `${(Number(minor) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })} ${currency}`;

export default function LinqaSendHome() {
  const router = useRouter();
  const available = useLinqaSendAvailability();
  const client = useMemo(() => new LinqaSendService(API, () => accessTokenProvider.getAccessToken()), []);
  const [items, setItems] = useState<LinqaSendTransferSummary[] | null>(null);
  const [overview, setOverview] = useState<Awaited<ReturnType<LinqaSendService["getHome"]>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    setItems(null);
    setOverview(null);
    try {
      const [home, transfers] = await Promise.all([client.getHome(), client.listTransfers(5)]);
      setOverview(home);
      setItems(transfers.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load LinqaSend.");
    }
  }, [client]);

  useEffect(() => { if (available === true) void load(); }, [available, load, refreshKey]);

  if (available !== true) return <SafeAreaView style={s.screen}><View style={s.content}>
    <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back"><Ionicons name="chevron-back" size={27} color="#344054" /></Pressable>
    {available === null ? <ActivityIndicator style={{ marginTop: 40 }} /> : <><Text style={s.brand}>LinqaSend</Text><Text style={s.greeting}>Money transfers are not available yet. We will let you know as soon as they launch in your region.</Text></>}
  </View></SafeAreaView>;

  return <SafeAreaView style={s.screen}><ScrollView contentContainerStyle={s.content}>
    <View style={s.top}><View><Text style={s.brand}>LinqaSend</Text><Text style={s.greeting}>Move money with transparent rates</Text></View><Pressable onPress={()=>router.push("/linqasend/controls")} accessibilityLabel="Limits and settings"><Ionicons name="settings-outline" size={22} color="#111827" /></Pressable></View>
    <View style={s.balanceCard}>
      <Text style={s.eyebrow}>Your LinqaSend</Text>
      <Text style={s.balance}>Send with clarity</Text>
      <Text style={s.cardMuted}>Rates and transfer status are confirmed by our service before you authorize.</Text>
    </View>
    <View style={s.actions}><Pressable style={s.primary} onPress={() => router.push("/linqasend/send")}><Text style={s.primaryText}>Send Money</Text></Pressable><Pressable style={s.secondary} onPress={() => router.push("/linqasend/receive")}><Text style={s.secondaryText}>Receive</Text></Pressable></View>
    <View style={s.quick}><Pressable onPress={() => router.push("/linqasend/requests")}><Ionicons name="cash-outline" size={22} color="#5146E5" /><Text style={s.quickText}>Requests</Text></Pressable><Pressable onPress={() => router.push("/linqasend/history")}><Ionicons name="receipt-outline" size={22} color="#5146E5" /><Text style={s.quickText}>Transactions</Text></Pressable><Pressable onPress={() => router.push("/linqasend/payment-methods")}><Ionicons name="wallet-outline" size={22} color="#5146E5" /><Text style={s.quickText}>Funding</Text></Pressable><Pressable onPress={() => router.push("/linqasend/jurisdiction")}><Ionicons name="globe-outline" size={22} color="#5146E5" /><Text style={s.quickText}>Jurisdiction</Text></Pressable></View>
    {overview && <View style={s.stats}>
      <View style={s.stat}><Text style={s.statValue}>{overview.recipientCount}</Text><Text style={s.statLabel}>Saved recipients</Text></View>
      <View style={s.stat}><Text style={s.statValue}>{overview.verifiedFundingSourceCount}</Text><Text style={s.statLabel}>Verified funding sources</Text></View>
      <View style={s.stat}><Text style={s.statValue}>{overview.requests.incoming + overview.requests.outgoing}</Text><Text style={s.statLabel}>Open requests</Text></View>
      <Text style={s.jurisdiction}>Regulatory account region: {overview.jurisdiction}</Text>
    </View>}
    <Text style={s.section}>Recent Activity</Text>
    {error && <View style={s.errorBox}><Text style={s.error}>{error.replace(/_/g, " ")}</Text><Pressable onPress={() => setRefreshKey((key) => key + 1)} accessibilityRole="button"><Text style={s.retry}>Try again</Text></Pressable></View>}
    {error ? null : items === null ? <ActivityIndicator color="#5146E5" /> : items.length === 0 ? <Text style={s.muted}>No transfers yet.</Text> : items.map(item => <Pressable key={item.id} style={s.row} onPress={() => router.push({ pathname: "/linqasend/status", params: { id: item.id } })}><View style={s.avatar}><Text style={s.avatarText}>{item.recipientName.slice(0, 1).toUpperCase()}</Text></View><View style={{flex:1}}><Text style={s.rowTitle}>{item.recipientName}</Text><Text style={s.muted}>{new Date(item.createdAt).toLocaleString()}</Text></View><View><Text style={s.amount}>{money(item.receiveAmountMinor, item.receiveCurrency)}</Text><Text style={s.status}>{item.status.replace(/_/g, " ")}</Text></View></Pressable>)}
    <Pressable style={s.allTransactions} onPress={() => router.push("/linqasend/history")}><Text style={s.allTransactionsText}>View all transactions</Text></Pressable>
  </ScrollView></SafeAreaView>;
}

const s=StyleSheet.create({screen:{flex:1,backgroundColor:"#F6F7FB"},content:{padding:20,paddingBottom:40},top:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},brand:{fontSize:21,fontWeight:"900",color:"#101828"},greeting:{color:"#667085",marginTop:5},balanceCard:{backgroundColor:"#101828",borderRadius:20,padding:20,marginTop:22},eyebrow:{color:"#A9B4CC",fontSize:12,fontWeight:"700"},balance:{color:"white",fontSize:24,fontWeight:"900",marginTop:6},cardMuted:{color:"#D0D5DD",fontSize:12,lineHeight:18,marginTop:6},muted:{color:"#667085",fontSize:12,marginTop:4},actions:{flexDirection:"row",gap:10,marginTop:16},primary:{flex:1,height:50,borderRadius:14,backgroundColor:"#5146E5",alignItems:"center",justifyContent:"center"},primaryText:{color:"white",fontWeight:"900"},secondary:{flex:1,height:50,borderRadius:14,borderWidth:1,borderColor:"#DDE3EE",alignItems:"center",justifyContent:"center",backgroundColor:"white"},secondaryText:{color:"#312E81",fontWeight:"800"},quick:{flexDirection:"row",justifyContent:"space-between",padding:18,backgroundColor:"white",borderRadius:16,marginTop:16},quickText:{color:"#344054",fontSize:12,fontWeight:"700",marginTop:5},stats:{backgroundColor:"white",borderRadius:16,padding:16,marginTop:14,borderWidth:1,borderColor:"#E7EAF0"},stat:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",paddingVertical:8},statValue:{fontSize:16,fontWeight:"900",color:"#101828"},statLabel:{fontSize:12,color:"#667085"},jurisdiction:{borderTopWidth:1,borderTopColor:"#EAECF0",paddingTop:12,marginTop:6,color:"#667085",fontSize:11},section:{fontSize:16,fontWeight:"900",color:"#101828",marginTop:24,marginBottom:10},row:{flexDirection:"row",alignItems:"center",gap:10,paddingVertical:14,borderBottomWidth:1,borderBottomColor:"#E7EAF0"},avatar:{width:38,height:38,borderRadius:19,backgroundColor:"#E8E7FF",alignItems:"center",justifyContent:"center"},avatarText:{color:"#5146E5",fontWeight:"900"},rowTitle:{fontWeight:"800",color:"#101828"},amount:{fontWeight:"800",color:"#101828",textAlign:"right"},status:{color:"#16815E",fontSize:12,fontWeight:"800",textAlign:"right",marginTop:3},errorBox:{backgroundColor:"#FEF3F2",padding:12,borderRadius:12,marginVertical:8},error:{color:"#B42318",fontSize:12},retry:{color:"#5146E5",fontWeight:"800",marginTop:8},allTransactions:{alignItems:"center",paddingVertical:18},allTransactionsText:{color:"#5146E5",fontWeight:"800"}});
