import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { canVerifyActions } from '../access';
import { colors, shadows } from '../theme';
import type { ActionPatch, ActionRecord, OpsVistaUser } from '../types';

type Props = {
  user: OpsVistaUser;
  actions: ActionRecord[];
  locations: string[];
  loading: boolean;
  error: string;
  readAt: Date | null;
  onRetry: () => void;
  onUpdate: (id: string, patch: ActionPatch, reason: string) => Promise<ActionRecord>;
};

type StatusFilter = 'Active' | 'All';

export function ActionCenterScreen(props: Props) {
  const [location, setLocation] = useState('All locations');
  const [status, setStatus] = useState<StatusFilter>('Active');
  const [selectedId, setSelectedId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState('');

  const filtered = useMemo(() => props.actions.filter(action => {
    const locationMatch = location === 'All locations' || action.location === location;
    const statusMatch = status === 'All' || !['Completed', 'Dismissed'].includes(action.status);
    return locationMatch && statusMatch;
  }).sort((left, right) => right.priorityScore - left.priorityScore || Date.parse(right.updatedAt) - Date.parse(left.updatedAt)), [location, props.actions, status]);

  useEffect(() => {
    if (!filtered.length) {
      setSelectedId('');
      return;
    }
    if (!filtered.some(action => action.id === selectedId)) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  const selected = filtered.find(action => action.id === selectedId);
  const active = props.actions.filter(action => !['Completed', 'Dismissed'].includes(action.status));
  const high = active.filter(action => action.severity === 'High').length;
  const unassigned = active.filter(action => !action.ownerName).length;
  const overdue = active.filter(action => action.dueAt && action.dueAt < easternDate()).length;
  const canVerify = canVerifyActions(props.user.role);

  const mutate = async (patch: ActionPatch, reason: string) => {
    if (!selected) return;
    setSaving(true);
    setLocalError('');
    try {
      await props.onUpdate(selected.id, patch, reason);
      setNote('');
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : 'No fue posible guardar el cambio.');
    } finally {
      setSaving(false);
    }
  };

  const verify = (result: 'Worked' | 'Did not work' | 'Not enough evidence yet') => {
    if (!note.trim()) return;
    const nextStatus = result === 'Worked' ? 'Completed' : result === 'Did not work' ? 'Investigating' : 'Assigned';
    void mutate({ verificationStatus: result, verificationNote: note.trim(), verifiedAt: new Date().toISOString(), status: nextStatus }, 'Resultado de verificación registrado desde OpsVista Mobile');
  };

  return (
    <>
      <Text style={styles.eyebrow}>OPERATIONAL ACCOUNTABILITY</Text>
      <Text style={styles.title}>Action Center</Text>
      <Text style={styles.subtitle}>Responsables, seguimiento y verificación guardados con auditoría permanente.</Text>

      <View style={styles.metrics}>
        <Metric label="ABIERTAS" value={active.length} />
        <Metric label="ALTA" value={high} warning={high > 0} />
        <Metric label="SIN ASIGNAR" value={unassigned} warning={unassigned > 0} />
        <Metric label="VENCIDAS" value={overdue} warning={overdue > 0} />
      </View>

      <View style={styles.controlCard}>
        <View style={styles.segmented}>
          <Segment label="Activas" selected={status === 'Active'} onPress={() => setStatus('Active')} />
          <Segment label="Todas" selected={status === 'All'} onPress={() => setStatus('All')} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="Todas" selected={location === 'All locations'} onPress={() => setLocation('All locations')} />
          {props.locations.map(item => <Chip key={item} label={item} selected={location === item} onPress={() => setLocation(item)} />)}
        </ScrollView>
        <View style={styles.sourceBar}>
          <Text style={styles.sourceText}>{props.loading ? 'Actualizando acciones…' : props.readAt ? `OpsVista leído ${formatTime(props.readAt)}` : 'Esperando servidor'}</Text>
          <Pressable accessibilityRole="button" onPress={props.onRetry} disabled={props.loading}><Text style={styles.refreshText}>Actualizar</Text></Pressable>
        </View>
      </View>

      {props.loading && !props.actions.length && <Loading />}
      {(props.error || localError) && <ErrorCard message={localError || props.error} onRetry={props.onRetry} />}
      {!props.loading && !props.error && !filtered.length && <Empty message="No hay acciones reales dentro de este filtro. OpsVista no agregó acciones de prueba." />}

      {filtered.map(action => (
        <ActionCard key={action.id} action={action} selected={action.id === selectedId} onPress={() => setSelectedId(action.id)} />
      ))}

      {selected && (
        <View style={styles.detailCard}>
          <View style={styles.detailHeader}>
            <View style={[styles.severityPill, severityStyle(selected.severity)]}><Text style={styles.severityText}>{severityLabel(selected.severity)}</Text></View>
            <Text style={styles.detailId}>{selected.id}</Text>
          </View>
          <Text style={styles.detailTitle}>{selected.title}</Text>
          <Text style={styles.detailMeta}>{selected.location} · {selected.category} · {statusLabel(selected.status)}</Text>
          <Detail label="SEÑAL" value={selected.signal} />
          <Detail label="CAUSA PROBABLE" value={selected.cause} />
          <View style={styles.recommendation}><Text style={styles.detailLabel}>RECOMENDACIÓN OPSVISTA</Text><Text style={styles.detailCopy}>{selected.recommendation}</Text></View>
          <View style={styles.assignment}>
            <Text style={styles.assignmentLabel}>RESPONSABLE</Text>
            <Text style={styles.assignmentValue}>{selected.ownerName || 'Sin asignar'}{selected.dueAt ? ` · vence ${displayDate(selected.dueAt)}` : ''}</Text>
            {!selected.ownerName && <ActionButton label={saving ? 'Guardando…' : 'Asignarme esta acción'} disabled={saving} onPress={() => void mutate({ ownerName: props.user.name, status: 'Assigned' }, 'Acción asumida desde OpsVista Mobile')} />}
            {!['Investigating', 'Completed', 'Dismissed'].includes(selected.status) && <SecondaryButton label="Iniciar investigación" disabled={saving} onPress={() => void mutate({ status: 'Investigating' }, 'Investigación iniciada desde OpsVista Mobile')} />}
          </View>

          {canVerify && !['Dismissed'].includes(selected.status) && (
            <View style={styles.verification}>
              <Text style={styles.verifyEyebrow}>VERIFICATION LOOP</Text>
              <Text style={styles.verifyTitle}>¿La acción funcionó?</Text>
              <TextInput
                style={styles.noteInput}
                value={note}
                onChangeText={setNote}
                multiline
                textAlignVertical="top"
                placeholder="Describe la evidencia o el resultado medido…"
                placeholderTextColor="#94A3B8"
              />
              <View style={styles.verifyButtons}>
                <VerifyButton label="Funcionó" tone="good" disabled={saving || !note.trim()} onPress={() => verify('Worked')} />
                <VerifyButton label="No funcionó" tone="warning" disabled={saving || !note.trim()} onPress={() => verify('Did not work')} />
              </View>
              <SecondaryButton label="Aún no hay evidencia suficiente" disabled={saving || !note.trim()} onPress={() => verify('Not enough evidence yet')} />
              {selected.verificationNote && <Text style={styles.previousNote}>Última verificación: {selected.verificationNote}</Text>}
            </View>
          )}
        </View>
      )}
    </>
  );
}

function Metric({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={[styles.metricValue, warning && styles.warning]}>{value}</Text></View>;
}
function ActionCard({ action, selected, onPress }: { action: ActionRecord; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.actionCard, selected && styles.actionSelected, pressed && styles.pressed]}>
      <View style={[styles.severityMark, severityStyle(action.severity)]}><Text style={styles.severityMarkText}>{action.severity === 'High' ? '!' : action.severity === 'Medium' ? '•' : '○'}</Text></View>
      <View style={styles.actionCopy}>
        <Text style={styles.actionMeta}>{action.location} · {action.category}{action.automated ? ` · AUTO ${action.priorityScore}/100` : ''}</Text>
        <Text style={styles.actionTitle}>{action.title}</Text>
        <Text style={styles.actionSignal} numberOfLines={2}>{action.signal}</Text>
        <View style={styles.actionFooter}><Text style={styles.status}>{statusLabel(action.status)}</Text><Text style={styles.owner}>{action.ownerName || 'Sin asignar'}</Text></View>
      </View>
    </Pressable>
  );
}
function Detail({ label, value }: { label: string; value: string }) { return <View style={styles.detailBlock}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailCopy}>{value}</Text></View>; }
function Segment({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.segment, selected && styles.segmentActive]}><Text style={[styles.segmentText, selected && styles.segmentTextActive]}>{label}</Text></Pressable>; }
function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipActive]}><Text style={[styles.chipText, selected && styles.chipTextActive]}>{label}</Text></Pressable>; }
function ActionButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.primaryButton, disabled && styles.disabled]}><Text style={styles.primaryText}>{label}</Text></Pressable>; }
function SecondaryButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.secondaryButton, disabled && styles.disabled]}><Text style={styles.secondaryText}>{label}</Text></Pressable>; }
function VerifyButton({ label, tone, disabled, onPress }: { label: string; tone: 'good' | 'warning'; disabled: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.verifyButton, tone === 'good' ? styles.verifyGood : styles.verifyWarning, disabled && styles.disabled]}><Text style={styles.verifyText}>{label}</Text></Pressable>; }
function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) { return <View style={styles.errorCard}><Text style={styles.errorTitle}>No fue posible cargar Action Center</Text><Text style={styles.errorCopy}>{message}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>Intentar nuevamente</Text></Pressable></View>; }
function Empty({ message }: { message: string }) { return <View style={styles.empty}><Text style={styles.emptyText}>{message}</Text></View>; }
function Loading() { return <View style={styles.loading}><ActivityIndicator color={colors.teal} /><Text style={styles.loadingText}>Cargando acciones guardadas…</Text></View>; }
function severityStyle(value: ActionRecord['severity']) { return value === 'High' ? styles.high : value === 'Medium' ? styles.medium : styles.low; }
function severityLabel(value: ActionRecord['severity']) { return value === 'High' ? 'PRIORIDAD ALTA' : value === 'Medium' ? 'PRIORIDAD MEDIA' : 'PRIORIDAD BAJA'; }
function statusLabel(value: ActionRecord['status']) { return ({ Open: 'Abierta', Assigned: 'Asignada', Investigating: 'Investigando', Completed: 'Completada', Dismissed: 'Descartada' } as const)[value]; }
function easternDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function displayDate(value: string) { return new Intl.DateTimeFormat('es-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${value}T12:00:00Z`)); }
function formatTime(value: Date) { return new Intl.DateTimeFormat('es-US', { hour: 'numeric', minute: '2-digit' }).format(value); }

const styles = StyleSheet.create({
  eyebrow: { color: colors.teal, fontSize: 10.5, fontWeight: '900', letterSpacing: 1.05, marginBottom: 7 },
  title: { color: colors.ink, fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { color: colors.muted, fontSize: 13.5, lineHeight: 20, marginTop: 7, marginBottom: 18 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginBottom: 12 },
  metric: { width: '48.5%', minHeight: 82, borderRadius: 14, padding: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  metricLabel: { color: colors.muted, fontSize: 9.5, fontWeight: '900', letterSpacing: 0.7 },
  metricValue: { color: colors.ink, fontSize: 26, fontWeight: '900', marginTop: 7 },
  warning: { color: colors.orange },
  controlCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 14, marginBottom: 13, gap: 10, ...shadows.card },
  segmented: { flexDirection: 'row', backgroundColor: colors.soft, borderRadius: 11, padding: 3 },
  segment: { flex: 1, minHeight: 39, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: colors.navy },
  segmentText: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  segmentTextActive: { color: '#FFF' },
  chips: { gap: 8 },
  chip: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 19, borderWidth: 1, borderColor: '#CBD8E6', backgroundColor: '#FFF' },
  chipActive: { borderColor: colors.teal, backgroundColor: colors.tealSoft },
  chipText: { color: colors.muted, fontSize: 11.5, fontWeight: '700' },
  chipTextActive: { color: colors.teal },
  sourceBar: { minHeight: 38, borderRadius: 10, paddingHorizontal: 11, backgroundColor: colors.tealSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sourceText: { color: '#115E59', fontSize: 11.5, fontWeight: '600' },
  refreshText: { color: colors.teal, fontSize: 11.5, fontWeight: '900' },
  actionCard: { flexDirection: 'row', gap: 11, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 15, padding: 14, marginBottom: 10 },
  actionSelected: { borderColor: colors.teal, backgroundColor: '#FBFEFD' },
  pressed: { opacity: 0.72 },
  severityMark: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  severityMarkText: { color: '#FFF', fontSize: 16, fontWeight: '900' },
  high: { backgroundColor: colors.red },
  medium: { backgroundColor: colors.orange },
  low: { backgroundColor: colors.teal },
  actionCopy: { flex: 1 },
  actionMeta: { color: colors.teal, fontSize: 9.5, fontWeight: '900', letterSpacing: 0.35 },
  actionTitle: { color: colors.ink, fontSize: 14, fontWeight: '800', lineHeight: 19, marginTop: 5 },
  actionSignal: { color: colors.muted, fontSize: 11.5, lineHeight: 17, marginTop: 5 },
  actionFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, gap: 8 },
  status: { color: colors.navy, fontSize: 10.5, fontWeight: '800' },
  owner: { color: colors.muted, fontSize: 10.5, flexShrink: 1 },
  detailCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 18, padding: 17, marginTop: 6, ...shadows.card },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  severityPill: { borderRadius: 12, paddingVertical: 5, paddingHorizontal: 9 },
  severityText: { color: '#FFF', fontSize: 9.5, fontWeight: '900', letterSpacing: 0.45 },
  detailId: { color: colors.muted, fontSize: 9.5, fontWeight: '700' },
  detailTitle: { color: colors.ink, fontSize: 21, lineHeight: 27, fontWeight: '800', marginTop: 14 },
  detailMeta: { color: colors.teal, fontSize: 11.5, fontWeight: '700', marginTop: 6 },
  detailBlock: { borderTopWidth: 1, borderTopColor: '#ECF1F5', paddingTop: 14, marginTop: 14 },
  detailLabel: { color: colors.muted, fontSize: 9.5, fontWeight: '900', letterSpacing: 0.7 },
  detailCopy: { color: colors.ink, fontSize: 12.5, lineHeight: 19, marginTop: 6 },
  recommendation: { backgroundColor: colors.tealSoft, borderRadius: 13, padding: 14, marginTop: 14 },
  assignment: { borderTopWidth: 1, borderTopColor: '#ECF1F5', paddingTop: 14, marginTop: 14 },
  assignmentLabel: { color: colors.muted, fontSize: 9.5, fontWeight: '900', letterSpacing: 0.7 },
  assignmentValue: { color: colors.ink, fontSize: 13, fontWeight: '800', marginTop: 5, marginBottom: 11 },
  primaryButton: { minHeight: 46, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.navy, marginTop: 6 },
  primaryText: { color: '#FFF', fontSize: 12.5, fontWeight: '800' },
  secondaryButton: { minHeight: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#CBD8E6', marginTop: 8, paddingHorizontal: 10 },
  secondaryText: { color: colors.navy, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  verification: { backgroundColor: colors.navyDark, borderRadius: 15, padding: 15, marginTop: 15 },
  verifyEyebrow: { color: '#A9C4DA', fontSize: 9.5, fontWeight: '900', letterSpacing: 0.8 },
  verifyTitle: { color: '#FFF', fontSize: 18, fontWeight: '800', marginTop: 6 },
  noteInput: { minHeight: 88, borderRadius: 11, backgroundColor: '#FFF', color: colors.ink, padding: 12, fontSize: 13, lineHeight: 18, marginTop: 12 },
  verifyButtons: { flexDirection: 'row', gap: 8, marginTop: 9 },
  verifyButton: { flex: 1, minHeight: 43, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  verifyGood: { backgroundColor: colors.teal },
  verifyWarning: { backgroundColor: colors.orange },
  verifyText: { color: '#FFF', fontSize: 11.5, fontWeight: '800' },
  previousNote: { color: '#D3E0EA', fontSize: 10.5, lineHeight: 16, marginTop: 11 },
  disabled: { opacity: 0.45 },
  errorCard: { backgroundColor: colors.orangeSoft, borderWidth: 1, borderColor: '#FED7AA', borderRadius: 14, padding: 15, marginBottom: 14 },
  errorTitle: { color: '#9A3412', fontSize: 14, fontWeight: '800' },
  errorCopy: { color: '#9A3412', fontSize: 12.5, lineHeight: 18, marginTop: 5 },
  retry: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 9, backgroundColor: '#9A3412', marginTop: 11 },
  retryText: { color: '#FFF', fontSize: 12, fontWeight: '800' },
  empty: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 15, padding: 20 },
  emptyText: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  loading: { alignItems: 'center', padding: 28, gap: 10 },
  loadingText: { color: colors.muted, fontSize: 12 },
});
