-- SQL to create Supabase tables for Lost & Found app
-- Run this in: Supabase Dashboard → SQL Editor
-- https://supabase.com/dashboard/project/wzdjjtttszukvfdbxluf/sql

-- NOTE: This will DROP existing tables if they exist!
-- Remove the DROP statements below if you want to keep existing data.

-- Drop existing tables (optional, uncomment if needed)
-- DROP TABLE IF EXISTS public.claims;
-- DROP TABLE IF EXISTS public.notifications;
-- DROP TABLE IF EXISTS public.system_config;
-- DROP TABLE IF EXISTS public.foundItems;
-- DROP TABLE IF EXISTS public.lostReports;
-- DROP TABLE IF EXISTS public.pendingFoundReports;
-- DROP TABLE IF EXISTS public.lostItemLeads;
-- DROP TABLE IF EXISTS public.studentProfiles;
-- DROP TABLE IF EXISTS public.auditLogs;

-- Create tables with JSONB data column (schemaless, like Firestore)
CREATE TABLE IF NOT EXISTS public.foundItems (
  id TEXT PRIMARY KEY,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.claims (
  id TEXT PRIMARY KEY,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lostReports (
  id TEXT PRIMARY KEY,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pendingFoundReports (
  id TEXT PRIMARY KEY,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lostItemLeads (
  id TEXT PRIMARY KEY,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.studentProfiles (
  email TEXT PRIMARY KEY,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.auditLogs (
  id TEXT PRIMARY KEY,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id TEXT PRIMARY KEY,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.system_config (
  id INT PRIMARY KEY,
  data JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Disable Row Level Security (simpler for this app)
ALTER TABLE public.foundItems DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.claims DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lostReports DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.pendingFoundReports DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lostItemLeads DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.studentProfiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditLogs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config DISABLE ROW LEVEL SECURITY;

-- Enable Realtime for live sync
BEGIN;
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
      CREATE PUBLICATION supabase_realtime FOR TABLE public.foundItems, public.claims, public.pendingFoundReports;
    ELSE
      ALTER PUBLICATION supabase_realtime ADD TABLE public.foundItems;
      ALTER PUBLICATION supabase_realtime ADD TABLE public.claims;
      ALTER PUBLICATION supabase_realtime ADD TABLE public.pendingFoundReports;
      ALTER PUBLICATION supabase_realtime ADD TABLE public.lostReports;
      ALTER PUBLICATION supabase_realtime ADD TABLE public.lostItemLeads;
    END IF;
  END
  $$;
COMMIT;

-- Grant permissions to anon role (so the app can read/write)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;

-- Insert default system config
INSERT INTO public.system_config (id, data)
VALUES (1, '{"categories": ["Electronics", "Accessories", "Clothing", "Documents", "Bags", "Others"], "matchingMinOverlap": 1, "notificationsEnabled": true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Done!
SELECT 'Tables created successfully!' as message;
