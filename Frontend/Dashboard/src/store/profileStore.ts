import { create } from 'zustand';
import api from '@/lib/api';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  phone: string | null;
  timezone: string | null;
  country: string | null;
  role: string;
  membership_tier: string;
  account_status: string;
  email_verified: boolean;
  onboarding_status: string;
  last_login_at: string | null;
  created_at: string | null;
}

interface ProfileState {
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
}

interface ProfileActions {
  fetchProfile: () => Promise<void>;
  updateProfile: (data: Partial<Profile>) => Promise<void>;
  clearProfile: () => void;
}

type ProfileStore = ProfileState & ProfileActions;

export const useProfileStore = create<ProfileStore>()((set) => ({
  profile: null,
  loading: false,
  error: null,
  saving: false,

  fetchProfile: async () => {
    set({ loading: true, error: null });
    try {
      const response = await api.get('/v1/profile', { withCredentials: true });
      if (response.data?.success) {
        set({ profile: response.data.data, loading: false });
      } else {
        set({ error: 'Failed to load profile', loading: false });
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load profile',
        loading: false
      });
    }
  },

  updateProfile: async (data) => {
    set({ saving: true, error: null });
    try {
      const response = await api.put('/v1/profile', data, { withCredentials: true });
      if (response.data?.success) {
        set({ profile: response.data.data, saving: false });
      } else {
        set({ error: 'Failed to update profile', saving: false });
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to update profile',
        saving: false
      });
      throw err;
    }
  },

  clearProfile: () => set({ profile: null, loading: false, error: null })
}));
