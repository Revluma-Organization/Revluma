import { create } from 'zustand';

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

const MOCK_PROFILE: Profile = {
  id: "mock-user-001",
  email: "alex@mystore.com",
  full_name: "Alex Johnson",
  display_name: "Alex",
  avatar_url: null,
  bio: "E-commerce entrepreneur",
  phone: null,
  timezone: "America/New_York",
  country: "US",
  role: "admin",
  membership_tier: "pro",
  account_status: "active",
  email_verified: true,
  onboarding_status: "completed",
  last_login_at: new Date().toISOString(),
  created_at: "2024-01-15T00:00:00Z",
};

export const useProfileStore = create<ProfileStore>()((set) => ({
  profile: MOCK_PROFILE,
  loading: false,
  error: null,
  saving: false,

  fetchProfile: async () => {
    set({ profile: MOCK_PROFILE, loading: false, error: null });
  },

  updateProfile: async (data) => {
    set((state) => ({
      profile: state.profile ? { ...state.profile, ...data } : state.profile,
      saving: false,
      error: null,
    }));
  },

  clearProfile: () => set({ profile: null, loading: false, error: null })
}));
