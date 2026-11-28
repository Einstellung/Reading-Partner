// Where the account registration goes (docs/platform/665): the Supabase project
// and its publishable key. The key is public by design (it ships in every
// build); what a signed-in user may touch is decided by the database's row-level
// security and the report_device function (supabase/migrations/). An empty url
// turns the whole report off.
export const ACCOUNT_BACKEND = {
  url: "https://sphvnnmuydyunbzktsyb.supabase.co",
  key: "sb_publishable_3lHt9M_Fc1aTs5mJC3gjIg_lnRpV9j5",
};
