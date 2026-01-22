-- Add RLS to sentinel_travel_data table

alter table public.sentinel_travel_data enable row level security;

-- Policy: Users can only read their own travel data
create policy sentinel_travel_data_select_self on public.sentinel_travel_data
  for select
  using (auth.uid()::text = user_id);

-- Policy: Service role can read/write all
create policy sentinel_travel_data_service_role on public.sentinel_travel_data
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
