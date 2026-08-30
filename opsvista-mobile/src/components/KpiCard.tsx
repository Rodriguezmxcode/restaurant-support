import { StyleSheet, Text, View } from 'react-native';
import { colors, shadows } from '../theme';

type Props = {
  label: string;
  value: string;
  note: string;
  status?: 'good' | 'warning' | 'pending';
};

export function KpiCard({ label, value, note, status = 'good' }: Props) {
  const accent = status === 'warning' ? colors.orange : status === 'pending' ? colors.muted : colors.teal;
  return (
    <View style={styles.card} accessibilityLabel={`${label}: ${value}. ${note}`}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={[styles.note, { color: accent }]} numberOfLines={2}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '48%', minHeight: 132, padding: 16, borderRadius: 16,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    ...shadows.card,
  },
  label: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.7 },
  value: { color: colors.ink, fontSize: 25, lineHeight: 31, fontWeight: '800', marginTop: 10 },
  note: { fontSize: 12, lineHeight: 17, fontWeight: '600', marginTop: 7 },
});
