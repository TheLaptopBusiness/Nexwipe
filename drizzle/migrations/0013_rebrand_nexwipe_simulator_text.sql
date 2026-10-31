-- Brand rename: NextDrive -> NexWipe in the simulator's user-visible text and existing records.
DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.simulator_prepare(uuid,text)'::regprocedure);
  EXECUTE replace(def, 'NextDrive', 'NexWipe');
END $$;
UPDATE public.devices SET notes = replace(notes, 'NextDrive', 'NexWipe') WHERE notes LIKE '%NextDrive%';
UPDATE public.policies SET description = replace(description, 'NextDrive', 'NexWipe'), name = replace(name, 'NextDrive', 'NexWipe')
  WHERE description LIKE '%NextDrive%' OR name LIKE '%NextDrive%';
