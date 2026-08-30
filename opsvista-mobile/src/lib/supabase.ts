import { AppState, Platform } from 'react-native';
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { secureStorage } from './storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
  ?? 'https://xdttojrtosubyjunatlt.supabase.co';
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? 'sb_publishable_lXRiwPnoaeXTr3kQ2Qk4DQ_5yDlM5m-';

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', state => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
