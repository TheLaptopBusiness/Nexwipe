CREATE TABLE public.pilot_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company text NOT NULL CHECK (char_length(company) BETWEEN 1 AND 160),
  contact_name text NOT NULL CHECK (char_length(contact_name) BETWEEN 1 AND 120),
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254 AND position('@' in email) > 1),
  business_type text CHECK (business_type IS NULL OR char_length(business_type) <= 60),
  monthly_volume text CHECK (monthly_volume IS NULL OR char_length(monthly_volume) <= 60),
  message text CHECK (message IS NULL OR char_length(message) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT INSERT ON public.pilot_requests TO anon, authenticated;
GRANT SELECT ON public.pilot_requests TO authenticated;
GRANT ALL ON public.pilot_requests TO service_role;
ALTER TABLE public.pilot_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can submit a pilot request" ON public.pilot_requests FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Platform admins read pilot requests" ON public.pilot_requests FOR SELECT TO authenticated USING (public.is_platform_admin());