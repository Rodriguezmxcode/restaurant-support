import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { availableLocations, availableModules } from '../access';
import { BottomNav, type TabKey } from '../components/BottomNav';
import { KpiCard } from '../components/KpiCard';
import { ApiError, getPerformance } from '../lib/api';
import { resolveRange, type RangeKey } from '../lib/dates';
import { colors, shadows } from '../theme';
import type { OpsVistaUser, PerformanceLocation, PerformanceResponse } from '../types';

type Props = { user: OpsVistaUser; onLogout: () => void; onSessionExpired: () => Promise<void> };
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function MainScreen({ user, onLogout, onSessionExpired }: Props) {
  const locations = useMemo(() => availableLocations(user.role, user.locations), [user]);
  const canSeeAll = ['Founder', 'Corporate', 'HR', 'Administration', 'Maintenance'].includes(user.role);
  const [tab, setTab] = useState<TabKey>('summary');
  const [range, setRange] = useState<RangeKey>('today');
  const [location, setLocation] = useState(canSeeAll ? 'All locations' : locations[0] ?? '');
  const [data, setData] = useState<PerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [readAt, setReadAt] = useState<Date | null>(null);
  const period = resolveRange(range);

  const load = useCallback(async (refresh = false) => {
    if (!location) return;
    refresh ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const result = await getPerformance(period.start, period.end, location);
      setData(result);
      setReadAt(new Date());
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        try {
          await onSessionExpired();
          const result = await getPerformance(period.start, period.end, location);
          setData(result);
          setReadAt(new Date());
          return;
        } catch {
          setError('Tu sesión expiró. Vuelve a iniciar sesión.');
        }
      } else {
        setError(cause instanceof Error ? cause.message : 'No fue posible cargar OpsVista.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [location, onSessionExpired, period.end, period.start]);

  useEffect(() => { void load(); }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.app}>
        <View style={styles.topbar}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}><Text style={styles.brandMarkText}>OV</Text></View>
            <View><Text style={styles.brand}>OpsVista</Text><Text style={styles.account}>OPS-0001 · {user.role}</Text></View>
          </View>
          <View style={styles.avatar}><Text style={styles.avatarText}>{initials(user.name)}</Text></View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.teal} />}
        >
          {tab === 'summary' && <Summary user={user} data={data} loading={loading} error={error} location={location} locations={locations} canSeeAll={canSeeAll} range={range} period={period} readAt={readAt} onLocation={setLocation} onRange={setRange} onRetry={() => void load()} />}
          {tab === 'locations' && <Locations data={data} loading={loading} error={error} />}
          {tab === 'tasks' && <Tasks data={data} loading={loading} error={error} />}
          {tab === 'more' && <More user={user} onLogout={onLogout} />}
        </ScrollView>

        <BottomNav active={tab} onChange={setTab} />
      </View>
    </SafeAreaView>
  );
}

type SummaryProps = {
  user: OpsVistaUser; data: PerformanceResponse | null; loading: boolean; error: string;
  location: string; locations: string[]; canSeeAll: boolean; range: RangeKey;
  period: { start: string; end: string; label: string }; readAt: Date | null;
  onLocation: (value: string) => void; onRange: (value: RangeKey) => void; onRetry: () => void;
};

function Summary(props: SummaryProps) {
  const total = props.data?.totals;
  const tasks = props.data?.taskCompliance?.totals;
  return (
    <>
      <Text style={styles.eyebrow}>OPERATING PERFORMANCE</Text>
      <Text style={styles.title}>Buenos días, {firstName(props.user.name)}</Text>
      <Text style={styles.subtitle}>Ventas, labor, Tasks, voids y descuentos con fuentes reales verificadas.</Text>

      <View style={styles.controlCard}>
        <Text style={styles.controlLabel}>PERIODO</Text>
        <View style={styles.segmented}>
          <Segment selected={props.range === 'today'} label="Hoy" onPress={() => props.onRange('today')} />
          <Segment selected={props.range === 'this-week'} label="Esta semana" onPress={() => props.onRange('this-week')} />
        </View>
        <Text style={[styles.controlLabel, styles.locationLabel]}>LOCACIÓN</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {props.canSeeAll && <Chip label="Todas" selected={props.location === 'All locations'} onPress={() => props.onLocation('All locations')} />}
          {props.locations.map(item => <Chip key={item} label={item} selected={props.location === item} onPress={() => props.onLocation(item)} />)}
        </ScrollView>
        <View style={[styles.sourceBar, props.error ? styles.sourceError : undefined]}>
          <Text style={[styles.sourceText, props.error ? styles.errorText : undefined]}>{props.period.label} · {props.period.start} → {props.period.end}</Text>
          <Text style={[styles.sourceText, props.error ? styles.errorText : undefined]}>{props.loading ? 'Actualizando…' : props.error || (props.readAt ? `Leído ${time(props.readAt)}` : 'Esperando fuente')}</Text>
        </View>
      </View>

      {props.error && <ErrorCard message={props.error} onRetry={props.onRetry} />}

      <View style={styles.kpiGrid}>
        <KpiCard label="VENTAS NETAS" value={props.loading ? 'Cargando…' : total ? money.format(total.netSales) : 'No disponible'} note={total ? 'Toast · datos en vivo' : 'Sin cifras de respaldo'} status={total ? 'good' : 'pending'} />
        <KpiCard label="LABOR TOTAL" value={props.loading ? 'Cargando…' : total ? `${total.totalLaborPct.toFixed(1)}%` : 'No disponible'} note={total ? `${money2.format(total.totalLaborCost)}` : 'Hourly + salary'} status={total ? (total.totalLaborPct > 30 ? 'warning' : 'good') : 'pending'} />
        <KpiCard label="TASKS" value={props.loading ? 'Cargando…' : tasks ? `${tasks.compliancePct.toFixed(1)}%` : 'No disponible'} note={tasks ? `${tasks.completed} de ${tasks.total} completadas` : props.data?.taskComplianceError || '7shifts pendiente'} status={tasks ? (tasks.compliancePct >= 80 ? 'good' : 'warning') : 'pending'} />
        <KpiCard label="OVERTIME" value={props.loading ? 'Cargando…' : total ? `${total.overtimeHours.toFixed(1)} h` : 'No disponible'} note={total ? 'Toast time entries' : 'Fuente pendiente'} status={total ? (total.overtimeHours > 0 ? 'warning' : 'good') : 'pending'} />
        <KpiCard label="VOIDS" value={props.loading ? 'Cargando…' : total ? `${total.voidPct.toFixed(2)}%` : 'No disponible'} note={total ? money2.format(total.voidAmount) : 'Fuente pendiente'} status={total ? (total.voidPct > 0.5 ? 'warning' : 'good') : 'pending'} />
        <KpiCard label="DESCUENTOS" value={props.loading ? 'Cargando…' : total ? `${total.discountPct.toFixed(2)}%` : 'No disponible'} note={total ? money2.format(total.discountAmount) : 'Meta ≤ 2.00%'} status={total ? (total.discountPct > 2 ? 'warning' : 'good') : 'pending'} />
      </View>

      <View style={styles.darkCard}>
        <Text style={styles.darkEyebrow}>ESTADO DE FUENTES</Text>
        <Text style={styles.darkTitle}>{props.data ? 'Toast y 7shifts conectados' : 'Esperando datos verificables'}</Text>
        <Text style={styles.darkCopy}>{props.data?.source ?? 'OpsVista no mostrará datos de prueba cuando una fuente no esté disponible.'}</Text>
      </View>
    </>
  );
}

function Locations({ data, loading, error }: { data: PerformanceResponse | null; loading: boolean; error: string }) {
  return (
    <>
      <Text style={styles.eyebrow}>MULTI-LOCATION PERFORMANCE</Text>
      <Text style={styles.title}>Locaciones</Text>
      <Text style={styles.subtitle}>Compara únicamente los restaurantes incluidos en tu acceso.</Text>
      {loading && <Loading />}
      {error && <ErrorCard message={error} />}
      {!loading && !error && !data?.locations.length && <Empty message="No hay información verificable para este periodo." />}
      {data?.locations.map(row => <LocationCard key={row.location} row={row} />)}
    </>
  );
}

function Tasks({ data, loading, error }: { data: PerformanceResponse | null; loading: boolean; error: string }) {
  const rows = data?.taskCompliance?.locations ?? [];
  return (
    <>
      <Text style={styles.eyebrow}>OPERATIONAL VERIFICATION</Text>
      <Text style={styles.title}>Tasks</Text>
      <Text style={styles.subtitle}>Cumplimiento directo de 7shifts, separado del Logbook.</Text>
      {loading && <Loading />}
      {error && <ErrorCard message={error} />}
      {!loading && data?.taskComplianceError && <ErrorCard message={data.taskComplianceError} />}
      {!loading && !data?.taskComplianceError && !rows.length && <Empty message="7shifts no devolvió Tasks verificables para este periodo." />}
      {rows.map(row => {
        const good = row.compliancePct >= 80;
        return (
          <View key={row.location} style={styles.listCard}>
            <View style={styles.listRow}><Text style={styles.locationName}>{row.location}</Text><Text style={[styles.score, { color: good ? colors.teal : colors.orange }]}>{row.compliancePct.toFixed(1)}%</Text></View>
            <View style={styles.progress}><View style={[styles.progressFill, { width: `${Math.min(100, Math.max(0, row.compliancePct))}%`, backgroundColor: good ? colors.teal : colors.orange }]} /></View>
            <Text style={styles.rowNote}>{row.completed} de {row.total} tareas completadas · Fuente 7shifts</Text>
          </View>
        );
      })}
    </>
  );
}

function More({ user, onLogout }: { user: OpsVistaUser; onLogout: () => void }) {
  return (
    <>
      <Text style={styles.eyebrow}>ACCESS & SECURITY</Text>
      <Text style={styles.title}>Más</Text>
      <View style={styles.profileCard}>
        <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{initials(user.name)}</Text></View>
        <View style={styles.profileCopy}><Text style={styles.profileName}>{user.name}</Text><Text style={styles.profileMeta}>{user.title} · {user.role}</Text><Text style={styles.profileEmail}>{user.email}</Text></View>
      </View>
      <Text style={styles.sectionTitle}>MÓDULOS AUTORIZADOS</Text>
      <View style={styles.moduleCard}>{availableModules(user.role).map((module, index, list) => <View key={module} style={[styles.moduleRow, index < list.length - 1 && styles.moduleBorder]}><Text style={styles.moduleBullet}>•</Text><Text style={styles.moduleName}>{module}</Text></View>)}</View>
      <View style={styles.infoCard}><Text style={styles.infoTitle}>Primera versión móvil</Text><Text style={styles.infoCopy}>Resumen, Locaciones y Tasks ya usan las fuentes reales. Action Center, Logbook, Proyectos y notificaciones se incorporarán en las siguientes entregas.</Text></View>
      <Pressable accessibilityRole="button" onPress={onLogout} style={({ pressed }) => [styles.logout, pressed && { opacity: 0.7 }]}><Text style={styles.logoutText}>Cerrar sesión</Text></Pressable>
    </>
  );
}

function LocationCard({ row }: { row: PerformanceLocation }) {
  const laborStatus = row.totalLaborPct > 30 ? colors.orange : colors.teal;
  return (
    <View style={styles.locationCard}>
      <View style={styles.locationHeader}><Text style={styles.locationName}>{row.location}</Text><Text style={styles.locationSales}>{money.format(row.netSales)}</Text></View>
      <View style={styles.metricRow}><Metric label="Labor" value={`${row.totalLaborPct.toFixed(1)}%`} color={laborStatus} /><Metric label="OT" value={`${row.overtimeHours.toFixed(1)} h`} color={row.overtimeHours > 0 ? colors.orange : colors.teal} /><Metric label="Voids" value={`${row.voidPct.toFixed(2)}%`} color={row.voidPct > 0.5 ? colors.orange : colors.teal} /><Metric label="Discounts" value={`${row.discountPct.toFixed(2)}%`} color={row.discountPct > 2 ? colors.orange : colors.teal} /></View>
      <Text style={styles.rowNote}>Toast · ventas y labor del periodo seleccionado</Text>
    </View>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) { return <View><Text style={styles.metricLabel}>{label}</Text><Text style={[styles.metricValue, { color }]}>{value}</Text></View>; }
function Segment({ selected, label, onPress }: { selected: boolean; label: string; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.segment, selected && styles.segmentActive]}><Text style={[styles.segmentText, selected && styles.segmentTextActive]}>{label}</Text></Pressable>; }
function Chip({ selected, label, onPress }: { selected: boolean; label: string; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipActive]}><Text style={[styles.chipText, selected && styles.chipTextActive]}>{label}</Text></Pressable>; }
function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) { return <View style={styles.errorCard}><Text style={styles.errorTitle}>Fuente no disponible</Text><Text style={styles.errorCopy}>{message}</Text>{onRetry && <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>Intentar nuevamente</Text></Pressable>}</View>; }
function Loading() { return <View style={styles.loading}><ActivityIndicator color={colors.teal} /><Text style={styles.loadingCopy}>Cargando fuentes verificadas…</Text></View>; }
function Empty({ message }: { message: string }) { return <View style={styles.empty}><Text style={styles.emptyText}>{message}</Text></View>; }
function initials(value: string) { return value.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase(); }
function firstName(value: string) { return value.trim().split(/\s+/)[0] || 'equipo'; }
function time(value: Date) { return new Intl.DateTimeFormat('es-US', { hour: 'numeric', minute: '2-digit' }).format(value); }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface }, app: { flex: 1, backgroundColor: colors.background },
  topbar: { height: 68, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, brandMark: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.navy }, brandMarkText: { color: '#FFF', fontSize: 12, fontWeight: '900' },
  brand: { color: colors.ink, fontSize: 17, fontWeight: '800' }, account: { color: colors.muted, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.4, marginTop: 2 },
  avatar: { width: 37, height: 37, borderRadius: 19, backgroundColor: colors.tealSoft, alignItems: 'center', justifyContent: 'center' }, avatarText: { color: colors.teal, fontSize: 12, fontWeight: '900' },
  scroll: { flex: 1 }, content: { padding: 18, paddingBottom: 30 }, eyebrow: { color: colors.teal, fontSize: 10.5, fontWeight: '900', letterSpacing: 1.05, marginBottom: 7 },
  title: { color: colors.ink, fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6 }, subtitle: { color: colors.muted, fontSize: 13.5, lineHeight: 20, marginTop: 7, marginBottom: 18 },
  controlCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 15, marginBottom: 14, ...shadows.card }, controlLabel: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 }, locationLabel: { marginTop: 16 },
  segmented: { flexDirection: 'row', backgroundColor: colors.soft, borderRadius: 11, padding: 3, marginTop: 8 }, segment: { flex: 1, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, segmentActive: { backgroundColor: colors.navy }, segmentText: { color: colors.muted, fontSize: 12.5, fontWeight: '800' }, segmentTextActive: { color: '#FFF' },
  chips: { gap: 8, paddingTop: 8 }, chip: { minHeight: 39, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#CBD8E6', backgroundColor: '#FFF' }, chipActive: { borderColor: colors.teal, backgroundColor: colors.tealSoft }, chipText: { color: colors.muted, fontSize: 12, fontWeight: '700' }, chipTextActive: { color: colors.teal },
  sourceBar: { marginTop: 14, borderRadius: 10, padding: 10, backgroundColor: colors.tealSoft, gap: 3 }, sourceError: { backgroundColor: colors.orangeSoft }, sourceText: { color: '#115E59', fontSize: 11.5, fontWeight: '600' }, errorText: { color: '#9A3412' },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 }, darkCard: { marginTop: 15, padding: 17, borderRadius: 16, backgroundColor: colors.navyDark }, darkEyebrow: { color: '#A9C4DA', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 }, darkTitle: { color: '#FFF', fontSize: 18, fontWeight: '800', marginTop: 9 }, darkCopy: { color: '#D3E0EA', fontSize: 12.5, lineHeight: 18, marginTop: 7 },
  errorCard: { backgroundColor: colors.orangeSoft, borderWidth: 1, borderColor: '#FED7AA', borderRadius: 14, padding: 15, marginBottom: 14 }, errorTitle: { color: '#9A3412', fontSize: 14, fontWeight: '800' }, errorCopy: { color: '#9A3412', fontSize: 12.5, lineHeight: 18, marginTop: 5 }, retry: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 9, backgroundColor: '#9A3412', marginTop: 11 }, retryText: { color: '#FFF', fontSize: 12, fontWeight: '800' },
  loading: { alignItems: 'center', padding: 28, gap: 10 }, loadingCopy: { color: colors.muted, fontSize: 12 }, empty: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 15, padding: 20 }, emptyText: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  locationCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 16, marginBottom: 12, ...shadows.card }, locationHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 15 }, locationName: { color: colors.ink, fontSize: 16, fontWeight: '800' }, locationSales: { color: colors.ink, fontSize: 19, fontWeight: '800' }, metricRow: { flexDirection: 'row', justifyContent: 'space-between' }, metricLabel: { color: colors.muted, fontSize: 9.5, fontWeight: '700' }, metricValue: { fontSize: 13, fontWeight: '800', marginTop: 3 }, rowNote: { color: colors.muted, fontSize: 10.5, marginTop: 14 },
  listCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 15, padding: 16, marginBottom: 11 }, listRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, score: { fontSize: 17, fontWeight: '900' }, progress: { height: 7, borderRadius: 4, backgroundColor: '#E8EEF4', overflow: 'hidden', marginTop: 13 }, progressFill: { height: 7, borderRadius: 4 },
  profileCard: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, marginBottom: 22, ...shadows.card }, profileAvatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' }, profileAvatarText: { color: '#FFF', fontSize: 16, fontWeight: '900' }, profileCopy: { marginLeft: 13, flex: 1 }, profileName: { color: colors.ink, fontSize: 16, fontWeight: '800' }, profileMeta: { color: colors.teal, fontSize: 11.5, fontWeight: '700', marginTop: 3 }, profileEmail: { color: colors.muted, fontSize: 11.5, marginTop: 3 },
  sectionTitle: { color: colors.muted, fontSize: 10.5, fontWeight: '900', letterSpacing: 0.9, marginBottom: 8 }, moduleCard: { borderWidth: 1, borderColor: colors.line, borderRadius: 15, backgroundColor: colors.surface, overflow: 'hidden', marginBottom: 15 }, moduleRow: { minHeight: 45, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center' }, moduleBorder: { borderBottomWidth: 1, borderBottomColor: '#ECF1F5' }, moduleBullet: { color: colors.teal, fontSize: 18, marginRight: 10 }, moduleName: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  infoCard: { backgroundColor: colors.tealSoft, borderRadius: 14, padding: 15, marginBottom: 15 }, infoTitle: { color: '#115E59', fontSize: 14, fontWeight: '800' }, infoCopy: { color: '#115E59', fontSize: 12.5, lineHeight: 18, marginTop: 5 }, logout: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#FDA4AF', backgroundColor: '#FFF' }, logoutText: { color: colors.red, fontSize: 14, fontWeight: '800' },
});
