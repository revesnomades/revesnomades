// assets/js/supabaseClient.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = "https://qxrxwgrgjvesevjkjmry.supabase.co";

// ✅ Clé ANON publique (Supabase > Settings > API > anon public)
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4cnh3Z3JnanZlc2V2amtqbXJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczNzE4MTIsImV4cCI6MjA4Mjk0NzgxMn0.WQCWMfqGbhbdnYdkcpBAarVJBBstSFAK3_YYn5uNbKI";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
