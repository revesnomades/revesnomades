import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const SUPABASE_URL = "https://qxrxwgrgjvesevjkjmry.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_oWFV8tUaYN0UdERhCqh13w_PIMegdiw";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
