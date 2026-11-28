-- Server-side switches (docs/platform/713).
--
-- app_config: key/value rows read by the Edge Functions with the service role.
-- No client can read or write it.
--
-- licensing_enforced: false until trials and purchases are enforced. While it
-- is not true, license-status answers "open" for everyone.
--
-- Safe to run more than once.

create table if not exists public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;

revoke all on public.app_config from anon, authenticated;

insert into public.app_config (key, value)
values ('licensing_enforced', 'false'::jsonb)
on conflict (key) do nothing;
