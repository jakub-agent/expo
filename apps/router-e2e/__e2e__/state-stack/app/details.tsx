import { unstable_useLocalRouter as useLocalRouter, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function Details() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useLocalRouter();
  return (
    <View style={styles.center}>
      <Text testID="details-title" style={styles.title}>Details</Text>
      <Text testID="details-id" style={styles.id}>id = {id}</Text>
      <Pressable testID="push-more" style={styles.button} onPress={() => router.push('details', { id: String(Number(id) + 1) })}>
        <Text style={styles.buttonText}>Push another (id: {String(Number(id) + 1)})</Text>
      </Pressable>
      <Pressable testID="go-back" style={[styles.button, styles.back]} onPress={() => router.back()}>
        <Text style={styles.buttonText}>Back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  title: { fontSize: 22, fontWeight: '700' },
  id: { fontSize: 18, color: '#0a7ea4' },
  button: { backgroundColor: '#0a7ea4', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10 },
  back: { backgroundColor: '#687076' },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
});
