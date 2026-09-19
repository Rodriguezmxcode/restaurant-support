import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View} from 'react-native';
import {actionApi, authApi, performanceApi} from './src/api';
import {listenForActionPush, registerPushDevice} from './src/push';
import type {ActionNotificationDetail, ActionRecord, OpsVistaUser, PerformanceResponse, SuggestedAssignee} from './src/types';
import {colors, shadow} from './src/theme';
import {inLocation, isOpen, money, number, prioritize, summarize} from './src/presentation';

type Tab = 'home' | 'actions' | 'mine' | 'alerts' | 'profile';
const tabs: {key: Tab; icon: string; label: string}[] = [
  {key: 'home', icon: '⌂', label: 'Inicio'}, {key: 'actions', icon: '◎', label: 'Acciones'},
  {key: 'mine', icon: '✓', label: 'Mis tareas'}, {key: 'alerts', icon: '!', label: 'Alertas'},
  {key: 'profile', icon: '●', label: 'Cuenta'},
];
const dateTime = (value?: string) => value ? new Date(value).toLocaleString('es-MX', {timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}) : '—';
const message = (reason: unknown) => reason instanceof Error ? reason.message : 'No se pudo conectar. Intenta de nuevo.';

function Login({onLogin}: {onLogin: (user: OpsVistaUser) => void}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (busy) return;
    if (!email.trim() || !password) {setError('Escribe tu correo y contraseña.'); return;}
    setBusy(true); setError('');
    try {onLogin((await authApi.login(email.trim(), password)).user);}
    catch (reason) {setError(message(reason));} finally {setBusy(false);}
  };
  return <SafeAreaView style={styles.loginSafe}>
    <StatusBar barStyle="light-content"/>
    <KeyboardAvoidingView style={{flex: 1}} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{flexGrow: 1}}>
        <View style={styles.loginHero}>
          <Text style={styles.loginBrand}>OPSVISTA</Text>
          <Text style={styles.loginTitle}>Tu operación.{'\n'}Siempre contigo.</Text>
          <Text style={styles.loginCopy}>Detecta lo importante. Actúa con tu equipo. Mantén cada restaurante bajo control.</Text>
        </View>
        <View style={styles.loginCard}>
          <Text style={styles.loginHeading}>Bienvenido de nuevo</Text>
          <Text style={styles.inputLabel}>Correo de trabajo</Text>
          <TextInput accessibilityLabel="Correo de trabajo" style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="username" keyboardType="email-address" placeholder="tu@restaurante.com" placeholderTextColor={colors.muted}/>
          <Text style={styles.inputLabel}>Contraseña</Text>
          <TextInput accessibilityLabel="Contraseña" style={styles.input} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" placeholder="Tu contraseña" placeholderTextColor={colors.muted} returnKeyType="go" onSubmitEditing={() => void submit()}/>
          {error ? <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityState={{disabled: busy, busy}} style={[styles.button, busy && styles.disabled]} disabled={busy} onPress={() => void submit()}>
            {busy ? <ActivityIndicator color={colors.navy}/> : <Text style={styles.buttonText}>Entrar a OpsVista →</Text>}
          </Pressable>
          <Text style={styles.security}>Usa la cuenta de tu organización. Si necesitas acceso, contacta a tu administrador.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
function Badge({text, tone = 'blue'}: {text: string; tone?: 'red' | 'amber' | 'blue' | 'green'}) {
  const palette = {red: [colors.softRed, colors.red], amber: [colors.softAmber, colors.amber], blue: [colors.softBlue, colors.blue], green: [colors.softGreen, colors.green]};
  return <View style={[styles.badge, {backgroundColor: palette[tone][0]}]}><Text style={[styles.badgeText, {color: palette[tone][1]}]}>{text}</Text></View>;
}
function Metric({label, value, note, tone}: {label: string; value: string; note: string; tone: string}) {
  return <View style={styles.metric}><View style={[styles.metricLine, {backgroundColor: tone}]}/><Text style={styles.metricLabel}>{label}</Text><Text style={[styles.metricValue, {color: tone}]}>{value}</Text><Text style={styles.metricNote}>{note}</Text></View>;
}
function Empty({title, copy}: {title: string; copy: string}) {
  return <View style={styles.empty}><Text style={styles.emptyMark}>○</Text><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyCopy}>{copy}</Text></View>;
}
function ActionCard({item, onOpen}: {item: ActionRecord; onOpen: (item: ActionRecord) => void}) {
  const tone = item.severity === 'High' ? 'red' : item.severity === 'Medium' ? 'amber' : 'blue';
  return <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}. ${item.location}. ${item.ownerName || 'Sin responsable'}`} style={styles.card} onPress={() => onOpen(item)}>
    <View style={[styles.cardTop, {flexWrap: 'wrap', gap: 8}]}><Badge text={item.severity === 'High' ? 'Prioridad alta' : item.severity === 'Medium' ? 'Atención' : 'Seguimiento'} tone={tone}/><Text style={styles.age}>{item.location}</Text></View>
    <Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardCopy} numberOfLines={2}>{item.signal}</Text>
    <View style={styles.cardBottom}><View style={{flex: 1}}><Text style={styles.cardOwner}>{item.ownerName || 'Asignar responsable'}</Text><Text style={styles.quiet}>{item.status}</Text></View><Text style={styles.chevron}>›</Text></View>
  </Pressable>;
}
function ActionDetail({item,user,onClose,onChanged}:{item:ActionRecord;user:OpsVistaUser;onClose:()=>void;onChanged:()=>Promise<void>}){
  const [detail,setDetail]=useState<ActionNotificationDetail>({state:null,events:[]});const [suggestions,setSuggestions]=useState<SuggestedAssignee[]>([]);const [strategy,setStrategy]=useState('');const [verified,setVerified]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const load=useCallback(async()=>{setError('');try{const [actionDetail,suggested]=await Promise.all([actionApi.detail(item.id),actionApi.suggestions(item)]);setDetail(actionDetail.notification||{state:null,events:[]});setSuggestions(suggested.suggestions||[]);setStrategy(suggested.strategy);setVerified(suggested.onDutyVerified);}catch(reason){setError(reason instanceof Error?reason.message:'No se pudo cargar la acción');}},[item.id,item.location,item.category]);
  useEffect(()=>{void load();},[load]);
  const assign=async(owner:SuggestedAssignee)=>{setBusy(true);setError('');try{await actionApi.assign(item.id,owner.id,strategy==='maintenance'?10:strategy==='commercial'?15:30);await load();await onChanged();}catch(reason){setError(reason instanceof Error?reason.message:'No se pudo asignar');}finally{setBusy(false);}};
  const receipt=async(status:'Seen'|'Accepted'|'In progress')=>{setBusy(true);setError('');try{setDetail(await actionApi.receipt(item.id,status));await onChanged();}catch(reason){setError(reason instanceof Error?reason.message:'No se pudo actualizar');}finally{setBusy(false);}};
  const isOwner=item.ownerId===user.id;
  return <SafeAreaView style={styles.detailSafe}><View style={styles.detailHeader}><Pressable accessibilityRole="button" style={{minHeight:44,justifyContent:"center"}} onPress={onClose}><Text style={styles.back}>‹ Volver</Text></Pressable><Text style={styles.detailLocation}>{item.location}</Text></View><ScrollView contentContainerStyle={styles.detailContent}><View style={styles.detailTitleRow}><Badge text={item.severity} tone={item.severity==='High'?'red':item.severity==='Medium'?'amber':'blue'}/><Text style={styles.age}>{item.status}</Text></View><Text style={styles.detailTitle}>{item.title}</Text><Text style={styles.detailMeta}>{item.category} · Actualizada {dateTime(item.updatedAt)}</Text><View style={styles.detailBlock}><Text style={styles.detailLabel}>SEÑAL</Text><Text style={styles.detailText}>{item.signal}</Text></View><View style={styles.detailBlock}><Text style={styles.detailLabel}>CAUSA PROBABLE</Text><Text style={styles.detailText}>{item.cause}</Text></View><View style={styles.recommendation}><Text style={styles.recommendationLabel}>RECOMENDACIÓN OPSVISTA</Text><Text style={styles.recommendationText}>{item.recommendation}</Text></View><View style={styles.smartBox}><Text style={styles.smartEyebrow}>ASIGNACIÓN INTELIGENTE</Text><Text style={styles.smartTitle}>{strategy==='maintenance'?'Responsable de mantenimiento':strategy==='commercial'?'Responsable de impulso de ventas':'Manager del turno'}</Text><Text style={styles.smartNote}>{strategy==='manager_on_duty'?(verified?'Verificado con el horario actual de 7shifts':'Managers autorizados de esta locación'):'Seleccionado según el tipo de alerta'}</Text>{suggestions.map(owner=><Pressable key={owner.id} disabled={busy} style={styles.assignButton} onPress={()=>void assign(owner)}><Text style={styles.assignButtonText}>Enviar a {owner.name}</Text><Text style={styles.assignReason}>{owner.reason}</Text></Pressable>)}</View>{detail.state?<View style={styles.tracking}><View style={styles.trackingHead}><View><Text style={styles.detailLabel}>SEGUIMIENTO</Text><Text style={styles.trackingStatus}>{detail.state.latestStatus}</Text></View><Text style={styles.acceptBy}>Aceptar antes de{`\n`}{dateTime(detail.state.acceptBy)}</Text></View>{detail.events.slice(0,8).map(event=><View key={event.id} style={styles.event}><Text style={styles.eventCheck}>✓</Text><View style={styles.eventCopy}><Text style={styles.eventTitle}>{event.status}</Text><Text style={styles.eventMeta}>{event.actorName} · {dateTime(event.at)}</Text>{event.note?<Text style={styles.eventNote}>{event.note}</Text>:null}</View></View>)}{isOwner?<View style={styles.ownerActions}><Pressable disabled={busy} style={[styles.ownerButton,busy&&styles.disabled]} onPress={()=>void receipt('Seen')}><Text style={styles.ownerButtonText}>Ya la vi</Text></Pressable><Pressable disabled={busy} style={[styles.ownerButton,styles.ownerButtonPrimary,busy&&styles.disabled]} onPress={()=>void receipt('Accepted')}><Text style={[styles.ownerButtonText,styles.ownerButtonPrimaryText]}>Aceptar responsabilidad</Text></Pressable><Pressable disabled={busy} style={[styles.ownerButton,busy&&styles.disabled]} onPress={()=>void receipt('In progress')}><Text style={styles.ownerButtonText}>Iniciar trabajo</Text></Pressable><Text style={styles.helper}>Adjunta la evidencia desde OpsVista web.</Text></View>:null}</View>:null}{error?<Text style={styles.errorText}>{error}</Text>:null}</ScrollView></SafeAreaView>;
}


export default function App() {
  const [user, setUser] = useState<OpsVistaUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>('home');
  const [performance, setPerformance] = useState<PerformanceResponse | null>(null);
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [actionsReady, setActionsReady] = useState(false);
  const [selected, setSelected] = useState<ActionRecord | null>(null);
  const [location, setLocation] = useState('');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState('');
  const [pushStatus, setPushStatus] = useState('Recibe avisos de las acciones asignadas a ti.');
  const [pushBusy, setPushBusy] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const sessionId = useRef(user?.id);
  sessionId.current = user?.id;
  const requestSequence = useRef(0);
  const load = useCallback(async () => {
    if (!user) return;
    const sequence = ++requestSequence.current;
    const [daily, actionList] = await Promise.allSettled([performanceApi.today(), actionApi.list()]);
    if (sessionId.current !== user.id || sequence !== requestSequence.current) return;
    const errors: string[] = [];
    if (daily.status === 'fulfilled') setPerformance(daily.value);
    else errors.push(`Indicadores: ${message(daily.reason)}`);
    if (actionList.status === 'fulfilled') {setActions(actionList.value.actions); setActionsReady(true);}
    else errors.push(`Acciones: ${message(actionList.reason)}`);
    setError(errors.join('\n'));
    if (!errors.length) setUpdated(new Date().toISOString());
  }, [user?.id]);
  useEffect(() => {authApi.session().then(result => setUser(result.authenticated ? result.user : null)).catch(() => setUser(null)).finally(() => setChecking(false));}, []);
  useEffect(() => {if (user) void load();}, [load]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    const unsubscribe = listenForActionPush(actionId => {
      if (!active) return;
      setTab('alerts');
      // Fetch at tap time: a notification can refer to an action absent from the last list.
      if (actionId) void actionApi.detail(actionId).then(result => {
        if (active && sessionId.current === user.id) setSelected(result.action);
      }).catch(reason => {if (active) setError(message(reason));});
    });
    return () => {active = false; unsubscribe();};
  }, [user?.id]);
  const refresh = async () => {setRefreshing(true); try {await load();} finally {setRefreshing(false);}};
  const enablePush = async () => {
    setPushBusy(true);
    try {const result = await registerPushDevice(); setPushStatus(result.message); setPushEnabled(result.registered);}
    catch (reason) {setPushStatus(message(reason));} finally {setPushBusy(false);}
  };
  const logout = async () => {
    try {
      await authApi.logout(); sessionId.current = undefined; ++requestSequence.current;
      setUser(null); setPerformance(null); setActions([]); setActionsReady(false); setSelected(null);
      setLocation(''); setQuery(''); setError(''); setUpdated(''); setPushEnabled(false);
      setPushStatus('Recibe avisos de las acciones asignadas a ti.');
    } catch (reason) {setError(`No se pudo cerrar la sesión: ${message(reason)}`);}
  };
  const locations = useMemo(() => [...new Set([...(performance?.locations.map(row => row.location) || []), ...actions.map(item => item.location)])].sort(), [performance, actions]);
  const rows = useMemo(() => inLocation(performance?.locations || [], location), [performance, location]);
  const total = useMemo(() => summarize(rows), [rows]);
  const scoped = useMemo(() => prioritize(inLocation(actions, location)), [actions, location]);
  const open = useMemo(() => scoped.filter(isOpen), [scoped]);
  const mine = useMemo(() => open.filter(item => item.ownerId === user?.id), [open, user?.id]);
  const visible = (tab === 'mine' || tab === 'alerts' ? mine : open).filter(item => `${item.title} ${item.location} ${item.ownerName || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  if (checking) return <View style={styles.loading}><StatusBar barStyle="light-content"/><ActivityIndicator size="large" color={colors.green}/><Text style={styles.loadingText}>Abriendo OpsVista…</Text></View>;
  if (!user) return <Login onLogin={value => {setUser(value); setTab('home');}}/>;
  if (selected) return <ActionDetail item={actions.find(item => item.id === selected.id) || selected} user={user} onClose={() => setSelected(null)} onChanged={load}/>;
  const initials = user.name.split(' ').slice(0, 2).map(value => value[0]).join('');
  const maxSales = Math.max(0, ...rows.map(row => row.netSales));
  const changeTab = (next: Tab) => {setTab(next); setQuery('');};
  const title = {home: 'Tu operación, hoy', actions: 'Centro de acciones', mine: 'Mis tareas', alerts: 'Alertas', profile: 'Mi cuenta'}[tab];
  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="light-content"/>
    <View style={styles.header}><View style={{flex: 1}}><Text style={styles.brand}>OPSVISTA</Text><Text style={styles.pageTitle}>{title}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Abrir mi cuenta" style={[styles.avatar, {minWidth: 44, minHeight: 44}]} onPress={() => changeTab('profile')}><Text style={styles.avatarText}>{initials}</Text></Pressable></View>
    {tab !== 'profile' && <View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scopeRow}>
      {['', ...locations].map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{selected: value === location}} style={[styles.scopeChip, location === value && styles.scopeActive]} onPress={() => setLocation(value)}><Text style={[styles.scopeText, location === value && styles.scopeTextActive]}>{value || 'Todas las locaciones'}</Text></Pressable>)}
    </ScrollView></View>}
    <ScrollView style={styles.content} contentContainerStyle={styles.contentPad} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.green}/>}>
      {error ? <View accessibilityRole="alert"><Text style={styles.errorBanner}>{error}{updated ? '\nSe muestran los últimos datos recibidos.' : ''}</Text><Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.textButton}><Text style={styles.textButtonLabel}>Reintentar actualización</Text></Pressable></View> : null}
      {tab === 'home' && <>
        <Text style={styles.sync}>{updated ? `Última actualización · ${dateTime(updated)} · ET` : 'Esperando datos de tu operación'}</Text>
        <View style={styles.hero}><Text style={styles.heroEyebrow}>CADA DECISIÓN CUENTA</Text><Text style={styles.heroTitle}>Hola, {user.name.split(' ')[0]}</Text><Text style={styles.heroCopy}>{actionsReady ? `${open.length} acciones abiertas${location ? ` en ${location}` : ''}. ${mine.length} necesitan tu seguimiento.` : 'Estamos consultando tus acciones e indicadores.'}</Text><Pressable accessibilityRole="button" style={styles.button} onPress={() => changeTab('mine')}><Text style={styles.buttonText}>Ver mis tareas →</Text></Pressable></View>
        <View style={styles.metrics}>
          <Metric label="Ventas netas" value={money(total?.netSales)} note="Hoy · USD · hora del Este" tone={colors.green}/>
          <Metric label="Costo de labor" value={number(total?.totalLaborPct, '%')} note={`${money(total?.totalLaborCost)} de las ventas`} tone={colors.blue}/>
          <Metric label="Horas trabajadas" value={number(total?.hourlyHours)} note={`${number(total?.overtimeHours)} h extra`} tone={colors.blue}/>
          <Metric label="Prioridad alta" value={actionsReady ? String(open.filter(item => item.severity === 'High').length) : '—'} note="Acciones abiertas" tone={colors.amber}/>
        </View>
        <View style={styles.sectionHead}><Text style={styles.sectionLabel}>Ventas por restaurante</Text><Badge text="Hoy · USD"/></View>
        {rows.length ? <View style={styles.chart}>{rows.map(row => <View key={row.location} style={styles.chartRow} accessible accessibilityLabel={`${row.location}: ventas netas ${money(row.netSales)}, labor ${number(row.totalLaborPct, '%')}`}>
          <View style={styles.chartLabels}><Text style={styles.chartName}>{row.location}</Text><Text style={styles.chartValue}>{money(row.netSales)}</Text></View>
          <View style={styles.barTrack}><View style={[styles.bar, {width: `${maxSales > 0 ? Math.max(0, row.netSales) / maxSales * 100 : 0}%`}]}/></View>
          <Text style={styles.chartMeta}>Labor {number(row.totalLaborPct, '%')} · {money(row.totalLaborCost)}</Text>
        </View>)}<Text style={[styles.chartMeta, {marginTop: 18}]}>Ventas netas reportadas; no representan utilidad neta.</Text></View> : <Empty title={performance ? 'Sin ventas disponibles' : 'Indicadores pendientes'} copy="Actualiza para consultar los datos de hoy."/>}
        <View style={styles.sectionHead}><Text style={styles.sectionLabel}>Primero lo importante</Text><Pressable accessibilityRole="button" style={styles.textButton} onPress={() => changeTab('actions')}><Text style={styles.textButtonLabel}>Ver todo →</Text></Pressable></View>
        {open.slice(0, 3).map(item => <ActionCard key={item.id} item={item} onOpen={setSelected}/>)}
        {actionsReady && !open.length && <Empty title="Todo al día" copy="No hay acciones abiertas en esta selección."/>}
      </>}
      {(tab === 'actions' || tab === 'mine' || tab === 'alerts') && <>
        {tab === 'alerts' ? <View style={styles.pushCard}><Text style={styles.pushTitle}>Tu equipo, conectado</Text><Text style={styles.pushStatus}>{pushStatus}</Text>{!pushEnabled && <Pressable accessibilityRole="button" disabled={pushBusy} style={[styles.button, pushBusy && styles.disabled]} onPress={() => void enablePush()}><Text style={styles.buttonText}>{pushBusy ? 'Activando…' : 'Activar notificaciones'}</Text></Pressable>}</View> : <Text style={styles.helper}>{tab === 'mine' ? 'Tus responsabilidades, ordenadas por prioridad.' : 'De la señal a la solución. Asigna y da seguimiento.'}</Text>}
        <TextInput accessibilityLabel="Buscar acciones" style={styles.search} placeholder="Buscar acción o responsable" placeholderTextColor={colors.muted} value={query} onChangeText={setQuery} clearButtonMode="while-editing"/>
        {visible.map(item => <ActionCard key={item.id} item={item} onOpen={setSelected}/>)}
        {!visible.length && <Empty title={!actionsReady ? 'Acciones pendientes de cargar' : query ? 'Sin coincidencias' : 'Todo al día'} copy={!actionsReady ? 'Actualiza para consultar tus responsabilidades.' : query ? 'Prueba otra búsqueda o cambia de restaurante.' : 'No hay acciones abiertas en esta selección.'}/>}
      </>}
      {tab === 'profile' && <View style={styles.profile}>
        <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{initials}</Text></View><Text style={styles.profileName}>{user.name}</Text><Text style={styles.profileRole}>{user.title} · {user.role}</Text><View style={styles.divider}/>
        <Text style={styles.setting}>Correo{`\n`}{user.email}</Text><Text style={styles.setting}>Locaciones autorizadas{`\n`}{user.locations.length ? user.locations.join(', ') : 'Según tu acceso de organización'}</Text>
        <Text style={styles.setting}>Notificaciones{`\n`}{pushStatus}</Text>
        <Pressable accessibilityRole="button" style={styles.textButton} onPress={() => changeTab('alerts')}><Text style={styles.textButtonLabel}>Configurar notificaciones →</Text></Pressable>
        <Pressable accessibilityRole="button" style={[styles.logout, {minHeight: 48}]} onPress={() => void logout()}><Text style={styles.logoutText}>Cerrar sesión</Text></Pressable>
      </View>}
    </ScrollView>
    <View style={styles.tabBar} accessibilityRole="tablist">{tabs.map(item => <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{selected: tab === item.key}} style={styles.tabItem} onPress={() => changeTab(item.key)}><Text style={[styles.tabIcon, tab === item.key && styles.tabActive]}>{item.icon}</Text><Text style={[styles.tabLabel, tab === item.key && styles.tabActive]}>{item.label}</Text></Pressable>)}</View>
  </SafeAreaView>;
}
const styles=StyleSheet.create({
  scopeRow:{paddingHorizontal:20,paddingBottom:10,gap:8},scopeChip:{minHeight:44,paddingHorizontal:16,justifyContent:'center',borderRadius:22,borderWidth:1,borderColor:colors.line,backgroundColor:colors.surface},scopeActive:{backgroundColor:colors.softGreen,borderColor:colors.green},scopeText:{color:colors.muted,fontSize:14,fontWeight:'600'},scopeTextActive:{color:colors.green},sync:{color:colors.muted,fontSize:12,marginBottom:14},sectionHead:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,marginTop:22,marginBottom:12},sectionLabel:{color:colors.ink,fontSize:19,fontWeight:'800',flex:1},textButton:{minHeight:44,justifyContent:'center'},textButtonLabel:{color:colors.blue,fontSize:14,fontWeight:'700'},chart:{backgroundColor:colors.surface,padding:18,borderRadius:20,borderWidth:1,borderColor:colors.line},chartRow:{marginTop:16},chartLabels:{flexDirection:'row',justifyContent:'space-between',gap:12,marginBottom:8},chartName:{color:colors.ink,fontSize:14,fontWeight:'700',flex:1},chartValue:{color:colors.green,fontSize:14,fontWeight:'700'},barTrack:{height:8,backgroundColor:colors.line,borderRadius:4,overflow:'hidden'},bar:{height:8,backgroundColor:colors.green,borderRadius:4},chartMeta:{color:colors.muted,fontSize:12,marginTop:8,lineHeight:19},search:{backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:colors.line,padding:14,fontSize:16,color:colors.ink,marginBottom:16},button:{minHeight:48,backgroundColor:colors.green,borderRadius:14,padding:14,alignItems:'center',justifyContent:'center',marginTop:12},buttonText:{color:colors.navy,fontSize:15,fontWeight:'800'},inputLabel:{color:colors.ink,fontSize:14,fontWeight:'600',marginBottom:8},emptyMark:{color:colors.green,fontSize:32,marginBottom:10},statusRow:{flexDirection:'row',alignItems:'center',gap:8,flexWrap:'wrap',marginTop:10},quiet:{color:colors.muted,fontSize:13,lineHeight:20},safe:{flex:1,backgroundColor:colors.background},loading:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:colors.background},loadingText:{marginTop:12,color:colors.muted,fontWeight:'700'},loginSafe:{flex:1,backgroundColor:colors.navy},loginHero:{paddingHorizontal:28,paddingTop:Platform.OS==='android'?70:52,paddingBottom:36},loginBrand:{color:'#7EDBF3',fontSize:13,fontWeight:'900',letterSpacing:3},loginTitle:{color:'#fff',fontSize:34,fontWeight:'900',lineHeight:40,marginTop:22,maxWidth:310},loginCopy:{color:'#C6D6E8',fontSize:15,lineHeight:23,marginTop:12,maxWidth:320},loginCard:{flex:1,backgroundColor:colors.background,borderTopLeftRadius:32,borderTopRightRadius:32,padding:26},loginHeading:{color:colors.ink,fontSize:22,fontWeight:'900',marginBottom:20},input:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:14,paddingHorizontal:15,height:52,color:colors.ink,fontSize:16,marginBottom:12},loginButton:{height:52,borderRadius:14,backgroundColor:colors.blue,alignItems:'center',justifyContent:'center',marginTop:4},loginButtonText:{color:'#fff',fontSize:15,fontWeight:'900'},security:{color:colors.muted,fontSize:13,lineHeight:20,textAlign:'center',marginTop:18},disabled:{opacity:.55},errorText:{color:colors.red,fontSize:13,lineHeight:18,marginVertical:8},errorBanner:{color:colors.red,backgroundColor:colors.softRed,borderRadius:12,padding:12,marginBottom:12,fontSize:13,fontWeight:'700'},header:{paddingHorizontal:20,paddingVertical:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},brand:{color:colors.cyan,fontSize:13,fontWeight:'900',letterSpacing:2.4},pageTitle:{color:colors.ink,fontSize:23,fontWeight:'900',marginTop:2},avatar:{width:42,height:42,borderRadius:14,backgroundColor:colors.navy,alignItems:'center',justifyContent:'center'},avatarText:{color:'#fff',fontWeight:'900'},content:{flex:1},contentPad:{padding:20,paddingTop:8,paddingBottom:32},hero:{backgroundColor:colors.softBlue,padding:22,borderRadius:24,marginBottom:16,...shadow},heroEyebrow:{color:'#7FD8F1',fontSize:13,fontWeight:'900',letterSpacing:1.4},heroTitle:{color:'#fff',fontSize:26,fontWeight:'900',marginTop:8},heroCopy:{color:'#C8D5E7',fontSize:13,lineHeight:20,marginTop:8},metrics:{flexDirection:'row',flexWrap:'wrap',gap:10},metric:{flexGrow:1,flexBasis:145,backgroundColor:colors.surface,borderRadius:18,padding:15,borderWidth:1,borderColor:colors.line},metricLine:{width:25,height:4,borderRadius:3,marginBottom:10},metricLabel:{color:colors.muted,fontSize:13,fontWeight:'800'},metricValue:{color:colors.ink,fontSize:22,fontWeight:'900',marginVertical:3},metricNote:{color:colors.muted,fontSize:13,lineHeight:19},sectionTitle:{color:colors.ink,fontSize:18,fontWeight:'900',marginTop:24,marginBottom:10},locationTable:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:18,overflow:'hidden'},locationRow:{minHeight:67,padding:13,flexDirection:'row',alignItems:'center',borderBottomWidth:1,borderBottomColor:colors.line,gap:8},locationMain:{flex:1.2},locationName:{color:colors.ink,fontSize:13,fontWeight:'900'},locationHours:{color:colors.muted,fontSize:13,marginTop:4},locationSales:{color:colors.ink,fontSize:13,fontWeight:'900',textAlign:'right'},locationLabor:{fontSize:13,fontWeight:'900',textAlign:'right'},locationCaption:{color:colors.muted,fontSize:13,textAlign:'right',marginTop:3},helper:{color:colors.muted,fontSize:13,lineHeight:19,marginBottom:14},card:{backgroundColor:colors.surface,borderRadius:18,padding:16,borderWidth:1,borderColor:colors.line,marginBottom:12,...shadow},cardTop:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},badge:{paddingHorizontal:9,paddingVertical:5,borderRadius:10},badgeText:{fontSize:13,fontWeight:'900'},age:{color:colors.muted,fontSize:13,fontWeight:'700'},cardTitle:{color:colors.ink,fontSize:15,fontWeight:'900',marginTop:12},cardCopy:{color:colors.muted,fontSize:13,lineHeight:18,marginTop:6},cardBottom:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:12},cardOwner:{color:colors.blue,fontSize:13,fontWeight:'800'},chevron:{color:colors.blue,fontSize:23},empty:{backgroundColor:colors.surface,borderRadius:18,padding:30,alignItems:'center',borderWidth:1,borderColor:colors.line},emptyTitle:{color:colors.ink,fontSize:17,fontWeight:'900'},emptyCopy:{color:colors.muted,fontSize:13,marginTop:6},pushCard:{backgroundColor:colors.softBlue,borderRadius:18,padding:18,borderWidth:1,borderColor:colors.line,marginBottom:14},pushTitle:{color:colors.ink,fontSize:16,fontWeight:'900'},pushStatus:{color:colors.blue,fontSize:13,marginTop:5},profile:{backgroundColor:colors.surface,borderRadius:24,padding:24,alignItems:'center',borderWidth:1,borderColor:colors.line},profileAvatar:{width:76,height:76,borderRadius:25,backgroundColor:colors.navy,alignItems:'center',justifyContent:'center'},profileAvatarText:{color:'#fff',fontSize:23,fontWeight:'900'},profileName:{color:colors.ink,fontSize:20,fontWeight:'900',marginTop:14},profileRole:{color:colors.blue,fontSize:13,fontWeight:'700',marginTop:4},divider:{width:'100%',height:1,backgroundColor:colors.line,marginVertical:20},setting:{alignSelf:'flex-start',color:colors.ink,fontSize:13,marginBottom:15},logout:{width:'100%',borderWidth:1,borderColor:'#E8AAB2',borderRadius:12,padding:12,alignItems:'center',marginTop:8},logoutText:{color:colors.red,fontWeight:'800'},tabBar:{flexDirection:'row',backgroundColor:colors.surface,borderTopWidth:1,borderTopColor:colors.line,paddingVertical:8},tabItem:{flex:1,alignItems:'center',justifyContent:'center',minHeight:56,paddingVertical:5},tabIcon:{color:colors.muted,fontSize:18,fontWeight:'900'},tabLabel:{color:colors.muted,fontSize:11,fontWeight:'700',marginTop:2},tabActive:{color:colors.green},detailSafe:{flex:1,backgroundColor:colors.background},detailHeader:{paddingHorizontal:18,paddingVertical:14,flexDirection:'row',justifyContent:'space-between',alignItems:'center',borderBottomWidth:1,borderBottomColor:colors.line,backgroundColor:colors.surface},back:{color:colors.blue,fontSize:14,fontWeight:'800'},detailLocation:{color:colors.ink,fontSize:13,fontWeight:'900'},detailContent:{padding:20,paddingBottom:50},detailTitleRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},detailTitle:{color:colors.ink,fontSize:26,fontWeight:'900',lineHeight:32,marginTop:14},detailMeta:{color:colors.muted,fontSize:13,marginTop:6},detailBlock:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:14,padding:15,marginTop:14},detailLabel:{color:colors.muted,fontSize:13,fontWeight:'900',letterSpacing:.8},detailText:{color:colors.ink,fontSize:13,lineHeight:19,marginTop:6},recommendation:{backgroundColor:colors.softBlue,borderWidth:1,borderColor:colors.line,borderRadius:14,padding:15,marginTop:14},recommendationLabel:{color:colors.blue,fontSize:13,fontWeight:'900',letterSpacing:.8},recommendationText:{color:colors.ink,fontSize:13,lineHeight:20,fontWeight:'700',marginTop:6},smartBox:{backgroundColor:colors.navy,borderRadius:18,padding:17,marginTop:14},smartEyebrow:{color:'#7FD8F1',fontSize:13,fontWeight:'900',letterSpacing:1},smartTitle:{color:'#fff',fontSize:18,fontWeight:'900',marginTop:5},smartNote:{color:'#C7D7E9',fontSize:13,marginTop:4,marginBottom:8},assignButton:{backgroundColor:colors.surface,borderRadius:12,padding:12,marginTop:8},assignButtonText:{color:colors.ink,fontSize:13,fontWeight:'900'},assignReason:{color:colors.muted,fontSize:13,marginTop:3},tracking:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:18,padding:16,marginTop:14},trackingHead:{flexDirection:'row',justifyContent:'space-between'},trackingStatus:{color:colors.green,fontSize:18,fontWeight:'900',marginTop:3},acceptBy:{color:colors.amber,fontSize:13,textAlign:'right',lineHeight:19},event:{flexDirection:'row',borderTopWidth:1,borderTopColor:colors.line,paddingVertical:10,marginTop:8},eventCheck:{color:colors.green,fontWeight:'900',marginRight:10},eventCopy:{flex:1},eventTitle:{color:colors.ink,fontSize:13,fontWeight:'900'},eventMeta:{color:colors.muted,fontSize:13,marginTop:3},eventNote:{color:colors.muted,fontSize:13,lineHeight:19,marginTop:3},ownerActions:{gap:8,marginTop:12},ownerButton:{borderWidth:1,borderColor:'#9CB8D5',borderRadius:11,padding:11,alignItems:'center'},ownerButtonText:{color:colors.blue,fontSize:13,fontWeight:'900'},ownerButtonPrimary:{backgroundColor:colors.blue,borderColor:colors.blue},ownerButtonPrimaryText:{color:colors.navy}
});
