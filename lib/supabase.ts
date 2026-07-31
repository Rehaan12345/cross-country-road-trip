import { createClient } from "@supabase/supabase-js";

// Server-only. Uses the service-role key, so this must never be imported from a
// client component.
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
