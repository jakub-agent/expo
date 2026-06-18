import { unstable_useLocalRouter as useLocalRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function Index() {
  const router = useLocalRouter();
  return (
    <View style={styles.center}>
      <Text testID="home-title" style={styles.title}>New State Model — Home</Text>
      <Text style={styles.sub}>Single useReducer · homogeneous tree</Text>
      <Pressable testID="go-details" style={styles.button} onPress={() => router.push('details', { id: '42' })}>
        <Text style={styles.buttonText}>Push details (id: 42)</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  title: { fontSize: 22, fontWeight: '700' },
  sub: { fontSize: 14, color: '#666' },
  button: { backgroundColor: '#0a7ea4', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10 },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
});
