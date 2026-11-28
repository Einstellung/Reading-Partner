-- Accounts and devices (docs/platform/665, docs/platform/713).
--
-- accounts: one row per auth user, written by a trigger when the user is
-- created (the first Google sign-in). The trial clock starts there. Clients may
-- read their own row and nothing else; purchases, bans and trial changes are
-- written by the dashboard or by server-side functions.
--
-- devices: one row per app install, keyed by the random device id the app
-- generates. Clients write it only through report_device(), which upserts with
-- user_id = auth.uid(), so a device that switches accounts moves to the new one.
--
-- admin_overview: a summary for the dashboard. Not exposed to the API.
--
-- Safe to run more than once.

-- accounts --------------------------------------------------------------------

create table if not exists public.accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  trial_started_at timestamptz not null default now(),
  purchased_at timestamptz,
  purchase_source text,
  banned boolean not null default false
);

alter table public.accounts enable row level security;

revoke all on public.accounts from anon, authenticated;
grant select on public.accounts to authenticated;

drop policy if exists "accounts: read own row" on public.accounts;
create policy "accounts: read own row" on public.accounts
  for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.accounts (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users created before the trigger existed start their trial at sign-up.
insert into public.accounts (user_id, trial_started_at)
select id, created_at from auth.users
on conflict (user_id) do nothing;

-- devices ---------------------------------------------------------------------

create table if not exists public.devices (
  device_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text,
  os_version text,
  model text,
  app_version text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create index if not exists devices_user_id_idx on public.devices (user_id);

alter table public.devices enable row level security;

revoke all on public.devices from anon, authenticated;
grant select on public.devices to authenticated;

drop policy if exists "devices: read own rows" on public.devices;
create policy "devices: read own rows" on public.devices
  for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.report_device(
  p_device_id text,
  p_platform text,
  p_os_version text,
  p_model text,
  p_app_version text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_device_id is null or length(p_device_id) = 0 or length(p_device_id) > 100 then
    raise exception 'bad device id' using errcode = '22023';
  end if;
  insert into public.devices (device_id, user_id, platform, os_version, model, app_version)
  values (p_device_id, uid, p_platform, p_os_version, p_model, p_app_version)
  on conflict (device_id) do update set
    user_id = excluded.user_id,
    platform = excluded.platform,
    os_version = excluded.os_version,
    model = excluded.model,
    app_version = excluded.app_version,
    last_seen = now();
end;
$$;

revoke execute on function public.report_device(text, text, text, text, text) from public, anon;
grant execute on function public.report_device(text, text, text, text, text) to authenticated;

-- admin_overview --------------------------------------------------------------

create or replace view public.admin_overview
with (security_invoker = true)
as
select
  (select count(*) from auth.users) as total_users,
  (select count(*) from auth.users where last_sign_in_at >= current_date) as signed_in_today,
  (select count(*) from public.devices where last_seen >= current_date) as active_devices_today,
  (select count(*) from public.accounts
     where purchased_at is null
       and trial_started_at + interval '3 months' >= now()
       and trial_started_at + interval '3 months' < now() + interval '14 days') as trials_ending_14d,
  (select count(*) from public.accounts where purchased_at is not null) as purchases;

revoke all on public.admin_overview from public, anon, authenticated;
