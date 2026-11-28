-- The payment behind a purchase (docs/platform/713).
--
-- purchase_ref: the Stripe payment intent of a web checkout purchase, written
-- by stripe-webhook. A full refund finds the account by it and clears the
-- purchase. Clients read it with the rest of their own row; the grants are
-- unchanged.
--
-- Safe to run more than once.

alter table public.accounts add column if not exists purchase_ref text;

create index if not exists accounts_purchase_ref_idx on public.accounts (purchase_ref);
