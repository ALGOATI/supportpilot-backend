-- ============================================================
-- Migration: Add RPC function to look up auth user by email
-- Date: 2026-04-01
-- ============================================================
-- Replaces paginated listUsers() scans with a direct index lookup.
-- Requires service_role key (the function is SECURITY DEFINER).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_auth_user_by_email(lookup_email text)
RETURNS TABLE (id uuid, email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT au.id, au.email
  FROM auth.users au
  WHERE au.email = lower(lookup_email)
  LIMIT 1;
$$;

-- Only service_role (authenticated via supabaseAdmin) should call this
REVOKE ALL ON FUNCTION public.get_auth_user_by_email(text) FROM public;
REVOKE ALL ON FUNCTION public.get_auth_user_by_email(text) FROM anon;
REVOKE ALL ON FUNCTION public.get_auth_user_by_email(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_user_by_email(text) TO service_role;
