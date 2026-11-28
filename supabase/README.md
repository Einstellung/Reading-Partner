# Supabase

The app's backend for accounts and device registration (docs/platform/665, docs/platform/713). The app talks to it with plain HTTP using the project's publishable key (`src/platform/account/endpoint.ts`).

## Apply the schema

Open the project's SQL Editor in the Supabase dashboard, paste `migrations/20261127000000_accounts.sql` and run it. It is safe to run again. With the Supabase CLI linked to the project, `supabase db push` does the same.

## Auth settings

Under Authentication > Sign In / Providers > Google: enable the provider, list the app's OAuth client IDs (desktop, iOS, Android) under Client IDs, and turn on "Skip nonce checks" (the app's Google flow sends no nonce).

## What the schema gives clients

- `accounts`: a signed-in user can read their own row. Rows are created by a trigger on `auth.users`; nothing is writable from the client.
- `devices`: a signed-in user can read their own devices and write only through `rpc/report_device`, which upserts by device id under the caller's user id.
- `admin_overview`: a summary view for the dashboard, not readable through the API.
