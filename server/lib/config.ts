// The OAuth client IDs an id_token may be issued to. The iOS and Android IDs are
// public (they ship in tauri.conf.json and the CI workflows); the desktop ID is
// kept as a GitHub secret on the app side, so here it comes from the
// GOOGLE_DESKTOP_CLIENT_ID environment variable.

export const IOS_CLIENT_ID = "379091688229-esc23unqq02igufrjr9jjvtsug49j097.apps.googleusercontent.com";
export const ANDROID_CLIENT_ID = "379091688229-8mb45l09bamhv2ln623knt4kob14folb.apps.googleusercontent.com";

export function allowedAudiences(env: Record<string, string | undefined>): string[] {
  const desktop = env.GOOGLE_DESKTOP_CLIENT_ID?.trim();
  return [IOS_CLIENT_ID, ANDROID_CLIENT_ID, ...(desktop ? [desktop] : [])];
}
