import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, shadows } from '../theme';

export type AuthStage = 'loading' | 'password' | 'mfa' | 'setup-required' | 'error';

type Props = {
  stage: AuthStage;
  email: string;
  password: string;
  code: string;
  busy: boolean;
  message: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onLogin: () => void;
  onVerify: () => void;
  onReset: () => void;
  onRetry: () => void;
};

export function AuthScreen(props: Props) {
  if (props.stage === 'loading') {
    return (
      <SafeAreaView style={styles.loading}>
        <Brand />
        <ActivityIndicator size="large" color={colors.teal} style={styles.loader} />
        <Text style={styles.loadingText}>Validando acceso seguro…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Brand />

            {props.stage === 'password' && (
              <>
                <Text style={styles.title}>Bienvenido a OpsVista</Text>
                <Text style={styles.subtitle}>Usa la misma cuenta segura de la aplicación web.</Text>
                <Field label="Correo electrónico">
                  <TextInput
                    style={styles.input}
                    value={props.email}
                    onChangeText={props.onEmailChange}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="username"
                    autoComplete="email"
                    returnKeyType="next"
                    placeholder="nombre@puertovallartausa.com"
                    placeholderTextColor="#94A3B8"
                  />
                </Field>
                <Field label="Contraseña">
                  <TextInput
                    style={styles.input}
                    value={props.password}
                    onChangeText={props.onPasswordChange}
                    secureTextEntry
                    textContentType="password"
                    autoComplete="current-password"
                    returnKeyType="go"
                    onSubmitEditing={props.onLogin}
                    placeholder="Tu contraseña"
                    placeholderTextColor="#94A3B8"
                  />
                </Field>
                <Message value={props.message} />
                <PrimaryButton label={props.busy ? 'Verificando…' : 'Entrar de forma segura'} disabled={props.busy || !props.email || !props.password} onPress={props.onLogin} />
                <Text style={styles.securityNote}>Tu contraseña y verificación en dos pasos son administradas por Supabase. OpsVista no puede ver tu contraseña.</Text>
              </>
            )}

            {props.stage === 'mfa' && (
              <>
                <Text style={styles.title}>Verificación en dos pasos</Text>
                <Text style={styles.subtitle}>Escribe el código de seis dígitos de tu aplicación de autenticación.</Text>
                <Field label="Código de seguridad">
                  <TextInput
                    style={[styles.input, styles.code]}
                    value={props.code}
                    onChangeText={value => props.onCodeChange(value.replace(/\D/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="one-time-code"
                    maxLength={6}
                    autoFocus
                    onSubmitEditing={props.onVerify}
                  />
                </Field>
                <Message value={props.message} />
                <PrimaryButton label={props.busy ? 'Verificando…' : 'Verificar y entrar'} disabled={props.busy || props.code.length !== 6} onPress={props.onVerify} />
                <SecondaryButton label="Usar otra cuenta" onPress={props.onReset} />
              </>
            )}

            {props.stage === 'setup-required' && (
              <>
                <Text style={styles.title}>Completa primero tu activación</Text>
                <Text style={styles.subtitle}>Por seguridad, configura tu contraseña y autenticador desde el enlace privado de invitación. Después podrás iniciar sesión en esta app.</Text>
                <Message value={props.message} />
                <PrimaryButton label="Volver al inicio" onPress={props.onReset} />
              </>
            )}

            {props.stage === 'error' && (
              <>
                <Text style={styles.title}>No pudimos validar la sesión</Text>
                <Text style={styles.subtitle}>Comprueba tu conexión e intenta nuevamente.</Text>
                <Message value={props.message} />
                <PrimaryButton label="Intentar nuevamente" onPress={props.onRetry} />
                <SecondaryButton label="Usar otra cuenta" onPress={props.onReset} />
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Brand() {
  return (
    <View style={styles.brand}>
      <View style={styles.brandMark}><Text style={styles.brandMarkText}>OV</Text></View>
      <View>
        <Text style={styles.brandName}>OpsVista</Text>
        <Text style={styles.brandCaption}>OPERATIONS CENTER</Text>
      </View>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text>{children}</View>;
}

function Message({ value }: { value: string }) {
  return value ? <View style={styles.message}><Text style={styles.messageText}>{value}</Text></View> : null;
}

function PrimaryButton({ label, disabled = false, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryButton, disabled && styles.disabled, pressed && !disabled && styles.pressed]}><Text style={styles.primaryButtonText}>{label}</Text></Pressable>;
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}><Text style={styles.secondaryButtonText}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: 24 },
  loader: { marginTop: 48 },
  loadingText: { color: colors.muted, fontSize: 14, marginTop: 14 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  card: { backgroundColor: colors.surface, borderRadius: 22, borderWidth: 1, borderColor: colors.line, padding: 25, ...shadows.card },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 30 },
  brandMark: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.navy },
  brandMarkText: { color: '#FFF', fontSize: 15, fontWeight: '900' },
  brandName: { color: colors.ink, fontSize: 21, fontWeight: '800' },
  brandCaption: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.1, marginTop: 2 },
  title: { color: colors.ink, fontSize: 27, lineHeight: 33, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 24 },
  field: { marginBottom: 17 },
  fieldLabel: { color: colors.ink, fontSize: 12.5, fontWeight: '800', marginBottom: 7 },
  input: { minHeight: 52, borderWidth: 1, borderColor: '#CBD8E6', borderRadius: 12, paddingHorizontal: 14, fontSize: 16, color: colors.ink, backgroundColor: '#FFF' },
  code: { textAlign: 'center', fontSize: 25, fontWeight: '800', letterSpacing: 8 },
  message: { padding: 12, borderRadius: 10, backgroundColor: colors.redSoft, marginBottom: 14 },
  messageText: { color: colors.red, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  primaryButton: { minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.navy },
  primaryButtonText: { color: '#FFF', fontSize: 15, fontWeight: '800' },
  secondaryButton: { minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 10, borderWidth: 1, borderColor: '#CBD8E6' },
  secondaryButtonText: { color: colors.navy, fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.72 },
  securityNote: { color: colors.muted, fontSize: 11.5, lineHeight: 17, marginTop: 18, textAlign: 'center' },
});
