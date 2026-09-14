/* ---------------------------------------------------------------
   Iron Ledger — configuration

   Paste your two Supabase values between the quotes below, then
   save. Both are meant to be public: the anon key is a client key,
   protected by the database rules in supabase-setup.sql.

   Find them in Supabase:  Project Settings -> API Keys
     SUPABASE_URL  = the "API URL" under Project Settings -> Data API
                     (older projects label it "Project URL")
     SUPABASE_ANON = the "publishable" key, sb_publishable_...
                     (on older projects this is the "anon public"
                      key on the Legacy tab -- either one works)
   --------------------------------------------------------------- */

window.IRON_LEDGER_CONFIG = {
  SUPABASE_URL:  "https://ovswozozyyqpokhevyom.supabase.co",
  SUPABASE_ANON: "sb_publishable_r0BKrGQUgWID3I8D3UJD2g_qLx_wzuA"
};
