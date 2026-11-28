# Supabase

The app's backend for accounts and device registration (docs/platform/665, docs/platform/713). The app talks to it with plain HTTP using the project's publishable key (`src/platform/account/endpoint.ts`).

## Apply the schema

Open the project's SQL Editor in the Supabase dashboard, paste each file in `migrations/` in order and run it. It is safe to run again. With the Supabase CLI linked to the project, `supabase db push` does the same.

## Auth settings

Under Authentication > Sign In / Providers > Google: enable the provider, list the app's OAuth client IDs (desktop, iOS, Android) under Client IDs, and turn on "Skip nonce checks" (the app's Google flow sends no nonce).

## What the schema gives clients

- `accounts`: a signed-in user can read their own row. Rows are created by a trigger on `auth.users`; nothing is writable from the client.
- `devices`: a signed-in user can read their own devices and write only through `rpc/report_device`, which upserts by device id under the caller's user id.
- `admin_overview`: a summary view for the dashboard, not readable through the API.
- `app_config`: server switches, readable only by the Edge Functions. `licensing_enforced` (default false) decides whether `license-status` answers anything but `open`.

## Edge Functions

Not deployed yet; licensing is dormant (docs/platform/713 says how to turn it on).

- `license-status`: the caller's license status, signed with ECDSA P-256 (secret `LICENSE_SIGNING_KEY`, a private JWK).
- `revenuecat-webhook`: sets or clears `accounts.purchased_at` for the lifetime product (secrets `REVENUECAT_WEBHOOK_AUTH`, `LIFETIME_PRODUCT_ID`). Deploy with `--no-verify-jwt`; it checks RevenueCat's Authorization header itself.
- `delete-account`: deletes the caller's auth user; accounts and devices rows cascade.

The decision and the webhook mapping live in `functions/_shared/license.ts` and `functions/_shared/revenuecat.ts`, plain TypeScript with no Deno import, tested by the app's `bun test` (`tests/supabase/`).

Generate the signing key pair with `bun scripts/license-keygen.ts`: the private JWK goes into the function secret, the public JWK into `LICENSE_PUBLIC_KEY` in `src/platform/license/config.ts`. Keep the private key out of the repository.

```sh
supabase secrets set LICENSE_SIGNING_KEY='<private JWK>' REVENUECAT_WEBHOOK_AUTH='<random string>' LIFETIME_PRODUCT_ID='<product id>'
supabase functions deploy license-status
supabase functions deploy delete-account
supabase functions deploy revenuecat-webhook --no-verify-jwt
```
