import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { colors, radius } from "../../theme/tokens";

const contacts = [
  { name: "Ama Mensah", phone: "+233 24 123 4567", country: "Ghana", bank: "Mobile Money" },
  { name: "Kwame Boateng", phone: "+233 20 987 6543", country: "Ghana", bank: "Bank" },
  { name: "John Appleeed", phone: "+1 (202) 555-0198", country: "United States", bank: "Bank" },
  { name: "Amina Yusuf", phone: "+234 802 123 4567", country: "Nigeria", bank: "Bank" },
  { name: "Mary Wanjiku", phone: "+254 712 345 678", country: "Kenya", bank: "Mobile Money" }
];

export default function LinqaSendRecipients() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back">
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Select Recipient</Text>
        <View style={styles.plusWrap}><Text style={styles.plus}>＋</Text></View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput placeholder="Search by name, phone or email" placeholderTextColor="#7B8794" style={styles.searchInput} />
        </View>

        <View style={styles.tabRow}>
          <Text style={styles.tabActive}>Global Contacts</Text>
          <Text style={styles.tab}>Linqa Users</Text>
        </View>

        {contacts.map((person) => (
          <Pressable
            key={person.name}
            style={styles.row}
            onPress={() => router.push({ pathname: "/linqasend/amount", params: { recipientId: person.name, recipientName: person.name, recipientCountry: person.country, recipientCurrency: "GHS" } })}
          >
            <View style={styles.avatar} />
            <View style={styles.personMeta}>
              <Text style={styles.personName}>{person.name}</Text>
              <Text style={styles.personPhone}>{person.phone}</Text>
              <Text style={styles.personInfo}>{person.country} · {person.bank}</Text>
            </View>
            <Text style={styles.star}>★</Text>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F6FA" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingTop: 22, paddingBottom: 8 },
  back: { color: "#1F2A37", fontSize: 28, fontWeight: "700" },
  headerTitle: { flex: 1, color: "#111827", fontSize: 24, fontWeight: "800" },
  plusWrap: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  plus: { color: "#1F2A37", fontSize: 24, fontWeight: "700" },
  content: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 32 },
  searchBox: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 18, borderWidth: 1, borderColor: "#E4E8F0", paddingHorizontal: 14, height: 48 },
  searchIcon: { color: "#6B7280", fontSize: 20, marginRight: 8 },
  searchInput: { flex: 1, color: "#111827", fontSize: 15 },
  tabRow: { flexDirection: "row", gap: 18, marginTop: 18, borderBottomWidth: 1, borderBottomColor: "#E5E7EB", paddingBottom: 10 },
  tabActive: { color: "#1F2A37", fontWeight: "800", fontSize: 14, borderBottomWidth: 2, borderBottomColor: "#4F46E5", paddingBottom: 8 },
  tab: { color: "#667085", fontWeight: "700", fontSize: 14 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#E7EDF5" },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#D8D0F9" },
  personMeta: { flex: 1, marginLeft: 12 },
  personName: { color: "#111827", fontSize: 15, fontWeight: "800" },
  personPhone: { color: "#475467", fontSize: 12, marginTop: 2 },
  personInfo: { color: "#667085", fontSize: 11, marginTop: 2 },
  star: { color: "#F59E0B", fontSize: 18 }
});
