// The Neon-backed RegisterStore. DATABASE_URL is injected by Vercel's Neon
// integration. Tables are in ../schema.sql.

import { neon } from "@neondatabase/serverless";
import type { RegisterStore } from "./register";

export function neonStore(databaseUrl: string): RegisterStore {
  const sql = neon(databaseUrl);
  return {
    async upsertUser(user, now) {
      await sql`
        INSERT INTO users (sub, email, name, first_seen, last_seen)
        VALUES (${user.sub}, ${user.email}, ${user.name}, ${now}, ${now})
        ON CONFLICT (sub) DO UPDATE SET
          email = EXCLUDED.email,
          name = COALESCE(EXCLUDED.name, users.name),
          last_seen = EXCLUDED.last_seen`;
    },
    async upsertDevice(device, userSub, now) {
      await sql`
        INSERT INTO devices (id, user_sub, platform, os_version, model, app_version, first_seen, last_seen)
        VALUES (${device.id}, ${userSub}, ${device.platform}, ${device.osVersion}, ${device.model},
                ${device.appVersion}, ${now}, ${now})
        ON CONFLICT (id) DO UPDATE SET
          user_sub = EXCLUDED.user_sub,
          platform = EXCLUDED.platform,
          os_version = EXCLUDED.os_version,
          model = EXCLUDED.model,
          app_version = EXCLUDED.app_version,
          last_seen = EXCLUDED.last_seen`;
    },
  };
}
