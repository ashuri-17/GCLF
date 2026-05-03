-- SQL to create Supabase tables for Lost & Found app
-- Run this in: Supabase Dashboard → SQL Editor
-- https://supabase.com/dashboard/project/wzdjjtttszukvfdbxluf/sql
--
-- Uses lowercase table names (PostgreSQL convention).
-- The Supabase JS client sends names unquoted, so "foundItems" → founditems automatically.

-- Create tables with JSONB data column (schemaless, like Firestore)
CREATE TABLE IF NOT EXISTS public.founditems (
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

CREATE TABLE IF NOT EXISTS public.lostreports (
  id TEXT PRIMARY KEY,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pendingfoundreports (
  id TEXT PRIMARY KEY,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lostitemleads (
  id TEXT PRIMARY KEY,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.studentprofiles (
  email TEXT PRIMARY KEY,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.auditlogs (
  id TEXT PRIMARY KEY,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id TEXT PRIMARY KEY,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.system_config (
  id INT PRIMARY KEY,
  data JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Disable Row Level Security (simpler for this app)
ALTER TABLE public.founditems DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.claims DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lostreports DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.pendingfoundreports DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lostitemleads DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.studentprofiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditlogs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config DISABLE ROW LEVEL SECURITY;

-- Enable Realtime for live sync.
-- Uses a DO block that checks table existence before adding to publication.
DO $$
DECLARE
  pub_exists BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') INTO pub_exists;

  IF NOT pub_exists THEN
    CREATE PUBLICATION supabase_realtime FOR TABLE public.founditems, public.claims, public.pendingfoundreports, public.lostreports, public.lostitemleads;
  ELSE
    -- Add tables only if they exist and are not already members
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'founditems') THEN
      BEGIN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.founditems'; EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'claims') THEN
      BEGIN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.claims'; EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pendingfoundreports') THEN
      BEGIN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.pendingfoundreports'; EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'lostreports') THEN
      BEGIN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.lostreports'; EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'lostitemleads') THEN
      BEGIN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.lostitemleads'; EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END IF;
END
$$;

-- Grant permissions to anon role (so the app can read/write)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;

-- Insert default system config
INSERT INTO public.system_config (id, data)
VALUES (1, '{"categories": ["Electronics", "Accessories", "Clothing", "Documents", "Bags", "Others"], "matchingMinOverlap": 1, "notificationsEnabled": true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Done!
SELECT 'Tables created successfully!' as message;
