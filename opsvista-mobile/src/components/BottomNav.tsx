import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

export type TabKey = 'summary' | 'locations' | 'tasks' | 'more';

const items: Array<{ key: TabKey; icon: string; label: string }> = [
  { key: 'summary', icon: '⌂', label: 'Resumen' },
  { key: 'locations', icon: '▦', label: 'Locaciones' },
  { key: 'tasks', icon: '✓', label: 'Tasks' },
  { key: 'more', icon: '•••', label: 'Más' },
];

export function BottomNav({ active, onChange }: { active: TabKey; onChange: (tab: TabKey) => void }) {
  return (
    <View style={styles.shell} accessibilityRole="tablist">
      {items.map(item => {
        const selected = item.key === active;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={item.label}
            onPress={() => onChange(item.key)}
            style={({ pressed }) => [styles.item, selected && styles.activeItem, pressed && styles.pressed]}
          >
            <Text style={[styles.icon, selected && styles.activeText]}>{item.icon}</Text>
            <Text style={[styles.label, selected && styles.activeText]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.line,
    backgroundColor: colors.surface, paddingHorizontal: 8, paddingTop: 7, paddingBottom: 5,
  },
  item: { flex: 1, minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  activeItem: { backgroundColor: colors.tealSoft },
  pressed: { opacity: 0.68 },
  icon: { color: colors.muted, fontSize: 18, lineHeight: 20, fontWeight: '800' },
  label: { color: colors.muted, fontSize: 10.5, marginTop: 3, fontWeight: '700' },
  activeText: { color: colors.teal },
});
