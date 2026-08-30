import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, shadows } from '../theme';
import type { LogbookEntry, TasksWeeklyResponse } from '../types';
import type { RangeKey } from '../lib/dates';

type Props = {
  data: TasksWeeklyResponse | null;
  loading: boolean;
  error: string;
  range: RangeKey;
  period: { start: string; end: string; label: string };
  location: string;
  locations: string[];
  canSeeAll: boolean;
  readAt: Date | null;
  onRange: (value: RangeKey) => void;
  onLocation: (value: string) => void;
  onRetry: () => void;
};

type ViewKey = 'tasks' | 'logbook';

export function TasksScreen(props: Props) {
  const [view, setView] = useState<ViewKey>('tasks');
  const scopedLocations = props.location === 'All locations' ? props.locations : [props.location];
  const logbookAvailable = Boolean(props.data && props.data.logbookComplete !== false && !props.data.logbookError);
  const entries = useMemo(() => sortEntries(props.data?.logbook ?? []), [props.data?.logbook]);

  return (
    <>
      <Text style={styles.eyebrow}>OPERATIONAL VERIFICATION</Text>
      <Text style={styles.title}>Tasks y Logbook</Text>
      <Text style={styles.subtitle}>Dos métricas independientes, consultadas directamente en 7shifts.</Text>

      <View style={styles.controlCard}>
        <View style={styles.segmented}>
          <Segment selected={view === 'tasks'} label="Tasks" onPress={() => setView('tasks')} />
          <Segment selected={view === 'logbook'} label="Logbook" onPress={() => setView('logbook')} />
        </View>
        <Text style={styles.controlLabel}>PERIODO</Text>
        <View style={styles.segmented}>
          <Segment selected={props.range === 'today'} label="Hoy" onPress={() => props.onRange('today')} />
          <Segment selected={props.range === 'this-week'} label="Esta semana" onPress={() => props.onRange('this-week')} />
        </View>
        <Text style={styles.controlLabel}>LOCACIÓN</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {props.canSeeAll && <Chip label="Todas" selected={props.location === 'All locations'} onPress={() => props.onLocation('All locations')} />}
          {props.locations.map(item => <Chip key={item} label={item} selected={props.location === item} onPress={() => props.onLocation(item)} />)}
        </ScrollView>
        <View style={[styles.sourceBar, (props.error || props.data?.logbookError) && styles.sourceWarning]}>
          <Text style={styles.sourceText}>{props.period.label} · {props.period.start} → {props.period.end}</Text>
          <Text style={styles.sourceText}>{props.loading ? 'Actualizando…' : props.readAt ? `7shifts leído ${formatTime(props.readAt)}` : 'Esperando fuente'}</Text>
        </View>
      </View>

      {props.loading && !props.data && <Loading />}
      {props.error && <ErrorCard message={props.error} onRetry={props.onRetry} />}

      {view === 'tasks' && !props.error && (
        <TasksPanel data={props.data} loading={props.loading} scopedLocations={scopedLocations} />
      )}
      {view === 'logbook' && !props.error && (
        <LogbookPanel
          data={props.data}
          entries={entries}
          locations={scopedLocations}
          available={logbookAvailable}
          expectedDays={inclusiveDays(props.period.start, props.period.end)}
        />
      )}
    </>
  );
}

function TasksPanel({ data, loading, scopedLocations }: { data: TasksWeeklyResponse | null; loading: boolean; scopedLocations: string[] }) {
  const rows = (data?.locations ?? []).filter(row => scopedLocations.some(location => sameLocation(location, row.locationName)));
  if (!loading && data && !rows.length) return <Empty message="7shifts no devolvió Tasks verificables para este periodo y locación." />;
  return (
    <>
      {data && (
        <View style={styles.summaryCard}>
          <View><Text style={styles.summaryLabel}>CUMPLIMIENTO</Text><Text style={styles.summaryValue}>{formatPct(data.completionPct)}</Text></View>
          <View style={styles.summaryRight}><Text style={styles.summaryLabel}>COMPLETADAS</Text><Text style={styles.summaryCount}>{data.completed}/{data.total}</Text></View>
        </View>
      )}
      {rows.map(row => {
        const pct = row.completionPct;
        const good = pct !== null && pct >= 80;
        return (
          <View key={`${row.locationId ?? ''}-${row.locationName}`} style={styles.listCard}>
            <View style={styles.listRow}><Text style={styles.locationName}>{row.locationName}</Text><Text style={[styles.score, { color: good ? colors.teal : colors.orange }]}>{formatPct(pct)}</Text></View>
            <View style={styles.progress}><View style={[styles.progressFill, { width: `${Math.min(100, Math.max(0, pct ?? 0))}%`, backgroundColor: good ? colors.teal : colors.orange }]} /></View>
            <Text style={styles.rowNote}>{row.completed} de {row.total} tareas completadas · {row.incomplete} pendientes</Text>
          </View>
        );
      })}
    </>
  );
}

function LogbookPanel({ data, entries, locations, available, expectedDays }: { data: TasksWeeklyResponse | null; entries: LogbookEntry[]; locations: string[]; available: boolean; expectedDays: number }) {
  if (data && !available) {
    return <ErrorCard message={data.logbookError || '7shifts no confirmó que el periodo del Logbook esté completo. OpsVista no mostrará ceros ni aplicará penalizaciones.'} />;
  }
  if (!data) return null;
  return (
    <>
      <View style={styles.logbookSummary}>
        {locations.map(location => {
          const rows = entries.filter(entry => sameLocation(location, entry.locationName));
          const days = new Set(rows.map(entry => entry.date)).size;
          return (
            <View key={location} style={styles.logbookLocation}>
              <View><Text style={styles.locationName}>{location}</Text><Text style={styles.rowNote}>{rows.length} entradas verificadas</Text></View>
              <Text style={[styles.dayCount, { color: days >= expectedDays ? colors.teal : colors.orange }]}>{days}/{expectedDays} días</Text>
            </View>
          );
        })}
      </View>
      {!entries.length && <Empty message="El periodo completo fue consultado y 7shifts no devolvió entradas de Logbook para este alcance." />}
      {entries.slice(0, 30).map(entry => <LogbookCard key={`${entry.id}-${entry.date}-${entry.locationName}`} entry={entry} />)}
      {entries.length > 30 && <Text style={styles.limitNote}>Mostrando las 30 entradas más recientes de {entries.length}.</Text>}
    </>
  );
}

function LogbookCard({ entry }: { entry: LogbookEntry }) {
  return (
    <View style={styles.logCard}>
      <View style={styles.logHeader}><View><Text style={styles.logDate}>{displayDate(entry.date)}</Text><Text style={styles.logLocation}>{entry.locationName} · {entry.category || 'General'}</Text></View>{entry.attachments > 0 && <Text style={styles.attachment}>{entry.attachments} adj.</Text>}</View>
      <Text style={styles.logMessage}>{entry.message || 'Entrada guardada sin descripción.'}</Text>
      <Text style={styles.logAuthor}>{entry.author || 'Autor no devuelto por 7shifts'} · Fuente 7shifts</Text>
    </View>
  );
}

function Segment({ selected, label, onPress }: { selected: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.segment, selected && styles.segmentActive]}><Text style={[styles.segmentText, selected && styles.segmentTextActive]}>{label}</Text></Pressable>;
}
function Chip({ selected, label, onPress }: { selected: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipActive]}><Text style={[styles.chipText, selected && styles.chipTextActive]}>{label}</Text></Pressable>;
}
function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <View style={styles.errorCard}><Text style={styles.errorTitle}>Fuente pendiente</Text><Text style={styles.errorCopy}>{message}</Text>{onRetry && <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>Intentar nuevamente</Text></Pressable>}</View>;
}
function Loading() { return <View style={styles.loading}><ActivityIndicator color={colors.teal} /><Text style={styles.loadingCopy}>Cargando 7shifts…</Text></View>; }
function Empty({ message }: { message: string }) { return <View style={styles.empty}><Text style={styles.emptyText}>{message}</Text></View>; }
function formatPct(value: number | null | undefined) { return value === null || value === undefined ? 'No disponible' : `${value.toFixed(1)}%`; }
function normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/puerto\s+vallarta|mexican\s+restaurant|restaurant/g, '').replace(/[^a-z0-9]/g, ''); }
function sameLocation(left: string, right: string) { const a = normalize(left); const b = normalize(right); return Boolean(a && b && (a === b || a.includes(b) || b.includes(a))); }
function sortEntries(entries: LogbookEntry[]) { return [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id); }
function inclusiveDays(start: string, end: string) { return Math.max(1, Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86400000) + 1); }
function displayDate(value: string) { return new Intl.DateTimeFormat('es-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00Z`)); }
function formatTime(value: Date) { return new Intl.DateTimeFormat('es-US', { hour: 'numeric', minute: '2-digit' }).format(value); }

const styles = StyleSheet.create({
  eyebrow: { color: colors.teal, fontSize: 10.5, fontWeight: '900', letterSpacing: 1.05, marginBottom: 7 },
  title: { color: colors.ink, fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { color: colors.muted, fontSize: 13.5, lineHeight: 20, marginTop: 7, marginBottom: 18 },
  controlCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 15, marginBottom: 14, gap: 9, ...shadows.card },
  controlLabel: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 0.8, marginTop: 7 },
  segmented: { flexDirection: 'row', backgroundColor: colors.soft, borderRadius: 11, padding: 3 },
  segment: { flex: 1, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: colors.navy },
  segmentText: { color: colors.muted, fontSize: 12.5, fontWeight: '800' },
  segmentTextActive: { color: '#FFF' },
  chips: { gap: 8 },
  chip: { minHeight: 39, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#CBD8E6', backgroundColor: '#FFF' },
  chipActive: { borderColor: colors.teal, backgroundColor: colors.tealSoft },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: colors.teal },
  sourceBar: { borderRadius: 10, padding: 10, backgroundColor: colors.tealSoft, gap: 3 },
  sourceWarning: { backgroundColor: colors.orangeSoft },
  sourceText: { color: '#115E59', fontSize: 11.5, fontWeight: '600' },
  summaryCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.navyDark, borderRadius: 16, padding: 18, marginBottom: 12 },
  summaryRight: { alignItems: 'flex-end' },
  summaryLabel: { color: '#A9C4DA', fontSize: 9.5, fontWeight: '900', letterSpacing: 0.7 },
  summaryValue: { color: '#FFF', fontSize: 27, fontWeight: '900', marginTop: 5 },
  summaryCount: { color: '#FFF', fontSize: 18, fontWeight: '900', marginTop: 7 },
  listCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 15, padding: 16, marginBottom: 11 },
  listRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  locationName: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  score: { fontSize: 17, fontWeight: '900' },
  progress: { height: 7, borderRadius: 4, backgroundColor: '#E8EEF4', overflow: 'hidden', marginTop: 13 },
  progressFill: { height: 7, borderRadius: 4 },
  rowNote: { color: colors.muted, fontSize: 10.5, marginTop: 5 },
  logbookSummary: { borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden', marginBottom: 13 },
  logbookLocation: { minHeight: 66, paddingHorizontal: 15, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#ECF1F5', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayCount: { fontSize: 15, fontWeight: '900' },
  logCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 15, padding: 15, marginBottom: 10, ...shadows.card },
  logHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  logDate: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  logLocation: { color: colors.teal, fontSize: 11, fontWeight: '700', marginTop: 3 },
  attachment: { color: colors.navy, backgroundColor: colors.tealSoft, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5, fontSize: 10, fontWeight: '800' },
  logMessage: { color: colors.ink, fontSize: 13, lineHeight: 19, marginTop: 12 },
  logAuthor: { color: colors.muted, fontSize: 10.5, marginTop: 11 },
  limitNote: { color: colors.muted, fontSize: 11, textAlign: 'center', marginVertical: 10 },
  errorCard: { backgroundColor: colors.orangeSoft, borderWidth: 1, borderColor: '#FED7AA', borderRadius: 14, padding: 15, marginBottom: 14 },
  errorTitle: { color: '#9A3412', fontSize: 14, fontWeight: '800' },
  errorCopy: { color: '#9A3412', fontSize: 12.5, lineHeight: 18, marginTop: 5 },
  retry: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 9, backgroundColor: '#9A3412', marginTop: 11 },
  retryText: { color: '#FFF', fontSize: 12, fontWeight: '800' },
  loading: { alignItems: 'center', padding: 28, gap: 10 },
  loadingCopy: { color: colors.muted, fontSize: 12 },
  empty: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 15, padding: 20, marginBottom: 12 },
  emptyText: { color: colors.muted, fontSize: 13, lineHeight: 19 },
});
