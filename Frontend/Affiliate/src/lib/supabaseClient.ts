import { createClient } from '@supabase/supabase-js';

// Read configuration from Vite environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Verify if the credentials are set and are not placeholder template strings
export const isSupabaseConfigured = (): boolean => {
  if (!supabaseUrl || !supabaseAnonKey) return false;
  if (supabaseUrl.includes('your-supabase-project') || supabaseAnonKey.includes('your-supabase-public')) {
    return false;
  }
  try {
    new URL(supabaseUrl);
    return true;
  } catch {
    return false;
  }
};

// Lazy initialization of Supabase client to prevent app crash if credentials are empty at boot
let supabaseInstance: ReturnType<typeof createClient> | null = null;

export const getSupabase = () => {
  if (!isSupabaseConfigured()) {
    return null;
  }
  if (!supabaseInstance) {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      }
    });
  }
  return supabaseInstance;
};

// Export fallback local db engine for seamless onboarding experiences
// This persistent storage ensures that even when DB keys are omitted,
// the dashboard calculates values based on real persistent user alterations
const getLocalStorageItem = <T>(key: string, defaultValue: T): T => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
};

const setLocalStorageItem = <T>(key: string, value: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`Local Storage write failed for ${key}:`, err);
  }
};

export const localDB = {
  getProfiles: () => getLocalStorageItem<unknown[]>('rev_luma_profiles', []),
  setProfiles: (data: unknown[]) => setLocalStorageItem('rev_luma_profiles', data),

  getWithdrawals: () => getLocalStorageItem<unknown[]>('rev_luma_withdrawals', []),
  setWithdrawals: (data: unknown[]) => setLocalStorageItem('rev_luma_withdrawals', data),

  getBroadcasts: () => getLocalStorageItem<unknown[]>('rev_luma_broadcasts', []),
  setBroadcasts: (data: unknown[]) => setLocalStorageItem('rev_luma_broadcasts', data),

  getNotifications: () => getLocalStorageItem<unknown[]>('rev_luma_notifications', []),
  setNotifications: (data: unknown[]) => setLocalStorageItem('rev_luma_notifications', data),

  getReferredUsers: () => getLocalStorageItem<unknown[]>('rev_luma_referred_users', []),
  setReferredUsers: (data: unknown[]) => setLocalStorageItem('rev_luma_referred_users', data),

  getCommissions: () => getLocalStorageItem<unknown[]>('rev_luma_commissions', []),
  setCommissions: (data: unknown[]) => setLocalStorageItem('rev_luma_commissions', data),

  getCampaigns: () => getLocalStorageItem<unknown[]>('rev_luma_campaigns', []),
  setCampaigns: (data: unknown[]) => setLocalStorageItem('rev_luma_campaigns', data),
};
