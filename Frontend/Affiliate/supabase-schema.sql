-- ====================================================================
-- REV_LUMA (By Luminor Terminal) - SQL database design and migration framework
-- Production PostgreSQL Schema for Supabase Integration
-- ====================================================================

-- Enable UUID generation extension
create extension if not exists "uuid-ossp";

-- Define custom types on Postgres
create type approval_status as enum ('pending', 'approved', 'rejected');
create type partner_tier as enum ('Affiliate', 'Growth', 'Elite', 'Founding Ambassador');
create type referral_status as enum ('Waitlist Joined', 'Account Created', 'Trial Started', 'Active Subscriber', 'Cancelled', 'Pending');
create type earning_status as enum ('pending', 'cleared', 'withdrawn');
create type notification_type as enum ('commission', 'signup', 'badge', 'payout', 'broadcast');

-- 1. Profiles Table (Extends Supabase Auth profiles)
create table public.profiles (
    id uuid references auth.users on delete cascade primary key,
    full_name text not null,
    username text unique not null,
    phone_number text not null,
    country text not null,
    twitter_handle text,
    instagram_handle text,
    linkedin_profile text,
    website text,
    audience_niche text not null,
    audience_size text not null,
    affiliate_experience text not null,
    why_join text not null,
    status public.approval_status default 'pending'::public.approval_status,
    role text default 'user' check (role in ('user', 'admin')),
    tier public.partner_tier default 'Affiliate'::public.partner_tier,
    commission_rate numeric(4, 2) default 0.20,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

comment on table public.profiles is 'Stores enterprise partner information linked directly to Supabase Auth.';

-- 2. Campaigns Table (Custom promo campaign identifiers)
create table public.campaigns (
    id uuid default uuid_generate_v4() primary key,
    partner_id uuid references public.profiles(id) on delete cascade not null,
    tag text not null,
    source text not null,
    clicks integer default 0 not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    unique(partner_id, tag)
);

-- 3. Referred Users Table (Tracks individual traffic referrals)
create table public.referred_users (
    id uuid default uuid_generate_v4() primary key,
    partner_id uuid references public.profiles(id) on delete cascade not null,
    email_masked text not null,
    status public.referral_status default 'Waitlist Joined'::public.referral_status,
    plan_name text default 'None'::text,
    monthly_value numeric(10, 2) default 0.00 not null,
    lifetime_value numeric(10, 2) default 0.00 not null,
    campaign_tag text,
    last_active timestamp with time zone default timezone('utc'::text, now()) not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Earnings & Commissions Table
create table public.earnings (
    id uuid default uuid_generate_v4() primary key,
    partner_id uuid references public.profiles(id) on delete cascade not null,
    referral_id uuid references public.referred_users(id) on delete set null,
    amount numeric(10, 2) not null,
    recurring boolean default true not null,
    status public.earning_status default 'pending'::public.earning_status,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. Founder Broadcasts Table
create table public.broadcasts (
    id uuid default uuid_generate_v4() primary key,
    title text not null,
    content text not null,
    author text not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 6. Notifications Table
create table public.notifications (
    id uuid default uuid_generate_v4() primary key,
    partner_id uuid references public.profiles(id) on delete cascade not null,
    title text not null,
    message text not null,
    type public.notification_type not null,
    is_read boolean default false not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- PROD INDEXES (Optimize high-throughput relational joins during referral spikes)
create index idx_profiles_username on public.profiles(username);
create index idx_profiles_status on public.profiles(status);
create index idx_campaigns_partner_tag on public.campaigns(partner_id, tag);
create index idx_referred_users_partner on public.referred_users(partner_id);
create index idx_referred_users_status on public.referred_users(status);
create index idx_earnings_partner on public.earnings(partner_id);
create index idx_notifications_partner_unread on public.notifications(partner_id) where is_read = false;

-- ROW LEVEL SECURITY (RLS) policies
alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.referred_users enable row level security;
alter table public.earnings enable row level security;
alter table public.broadcasts enable row level security;
alter table public.notifications enable row level security;

-- Profiles Policies
create policy "Allow public read for basic statistics" on public.profiles
    for select using (true);

create policy "Allow users to view own profile" on public.profiles
    for select using (auth.uid() = id);

create policy "Allow users to update own profile fields" on public.profiles
    for update using (auth.uid() = id);

create policy "Allow admins complete access to all profiles" on public.profiles
    for all using (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and role = 'admin'
        )
    );

-- Campaigns Policies
create policy "Users can manipulate own campaigns" on public.campaigns
    for all using (auth.uid() = partner_id);

-- Referred Users Policies
create policy "Users can read own referred traffic" on public.referred_users
    for select using (auth.uid() = partner_id);

create policy "Admins can update referred status details" on public.referred_users
    for all using (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and role = 'admin'
        )
    );

-- Earnings Policies
create policy "Users can read own earnings statement" on public.earnings
    for select using (auth.uid() = partner_id);

create policy "Admins can add/edit commission statements" on public.earnings
    for all using (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and role = 'admin'
        )
    );

-- Broadcasts Policies
create policy "Anyone authenticated can view announcements" on public.broadcasts
    for select using (true);

create policy "Only admins can author notifications and broadcasts" on public.broadcasts
    for all using (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and role = 'admin'
        )
    );

-- Notifications Policies
create policy "Users can handle own inbox" on public.notifications
    for all using (auth.uid() = partner_id);


-- TRIGGER ACTIONS for Supabase auth synchronization
-- Auto-create public profile when new user signs up in oauth/auth
create or replace function public.handle_new_partner_registration()
returns trigger as $$
declare
    metadata_full_name text;
    metadata_username text;
    metadata_phone text;
    metadata_country text;
    metadata_niche text;
    metadata_aud_size text;
    metadata_exp text;
    metadata_why text;
begin
    -- Extract user metadata supplied during custom Supabase auth.signUp()
    metadata_full_name := coalesce(new.raw_user_meta_data->>'full_name', 'Affiliate Partner');
    metadata_username := coalesce(new.raw_user_meta_data->>'username', 'partner_' || substr(new.id::text, 1, 8));
    metadata_phone := coalesce(new.raw_user_meta_data->>'phone_number', '+1-555-0000');
    metadata_country := coalesce(new.raw_user_meta_data->>'country', 'US');
    metadata_niche := coalesce(new.raw_user_meta_data->>'audience_niche', 'E-commerce Automation');
    metadata_aud_size := coalesce(new.raw_user_meta_data->>'audience_size', '10k - 50k');
    metadata_exp := coalesce(new.raw_user_meta_data->>'affiliate_experience', 'Intermediate');
    metadata_why := coalesce(new.raw_user_meta_data->>'why_join', 'Interested in AI eCommerce tools.');

    insert into public.profiles (
        id,
        full_name,
        username,
        phone_number,
        country,
        twitter_handle,
        instagram_handle,
        linkedin_profile,
        website,
        audience_niche,
        audience_size,
        affiliate_experience,
        why_join,
        status,
        role,
        tier,
        commission_rate
    ) values (
        new.id,
        metadata_full_name,
        metadata_username,
        metadata_phone,
        metadata_country,
        new.raw_user_meta_data->>'twitter_handle',
        new.raw_user_meta_data->>'instagram_handle',
        new.raw_user_meta_data->>'linkedin_profile',
        new.raw_user_meta_data->>'website',
        metadata_niche,
        metadata_aud_size,
        metadata_exp,
        metadata_why,
        'pending'::public.approval_status, -- Selectivity-first (defaults to pending approval)
        'user',
        'Affiliate'::public.partner_tier,
        0.20
    );
    return new;
end;
$$ language plpgsql security definer;

-- Orchestrate registration sync trigger
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_partner_registration();
