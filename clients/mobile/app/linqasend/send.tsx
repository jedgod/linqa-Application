import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

export default function LinqaSendMode() {
  const router = useRouter();
  return <SafeAreaView style={s.screen}><View style={s.header}><Pressable onPress={() => router.back()}><Text style={s.back}>‹</Text></Pressable><Text style={s.title}>Send Money</Text></View><View style={s.content}>
    <Text style={s.copy}>Choose how your recipient will receive funds.</Text>
    <Pressable style={[s.card,s.primary]} onPress={() => router.push("/linqasend/recipients")}><Text style={s.cardTitle}>To a Linqa user</Text><Text style={s.cardCopy}>Find a verified Linqa account by phone or email.</Text></Pressable>
    <Pressable style={s.card} onPress={() => router.push("/linqasend/external-recipient")}><Text style={s.cardTitle}>Outside Linqa</Text><Text style={s.cardCopy}>Use a certified bank, card, mobile-money, phone-claim, or email-claim payout endpoint.</Text></Pressable>
  </View></SafeAreaView>;
}
const s=StyleSheet.create({screen:{flex:1,backgroundColor:"#F6F7FB"},header:{flexDirection:"row",alignItems:"center",padding:18,gap:12},back:{fontSize:34,color:"#101828"},title:{fontSize:22,fontWeight:"900",color:"#101828"},content:{padding:18},copy:{color:"#667085",marginBottom:20},card:{backgroundColor:"white",borderWidth:1,borderColor:"#DDE3EC",borderRadius:18,padding:20,marginBottom:14},primary:{backgroundColor:"#EEEDFF",borderColor:"#8B83F6"},cardTitle:{fontSize:17,fontWeight:"900",color:"#101828"},cardCopy:{fontSize:13,lineHeight:19,color:"#667085",marginTop:6}});
