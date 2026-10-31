DROP POLICY IF EXISTS "Anyone can submit a pilot request" ON public.pilot_requests;
CREATE POLICY "Anyone can submit a well-formed pilot request" ON public.pilot_requests
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    char_length(btrim(company)) BETWEEN 1 AND 200
    AND char_length(btrim(contact_name)) BETWEEN 1 AND 120
    AND char_length(email) BETWEEN 3 AND 254
    AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    AND (business_type IS NULL OR char_length(business_type) <= 120)
    AND (monthly_volume IS NULL OR char_length(monthly_volume) <= 60)
    AND (message IS NULL OR char_length(message) <= 4000)
  );