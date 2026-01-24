-- Check if travel_recommendations_worker is registered
SELECT name, enabled, cadence_seconds, next_run_at 
FROM public.sentinel_worker_schedules 
WHERE worker_id = (SELECT id FROM public.sentinel_workers WHERE name = 'travel_recommendations_worker')
LIMIT 1;

-- If not, insert it
INSERT INTO public.sentinel_workers (name)
VALUES ('travel_recommendations_worker')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.sentinel_worker_schedules (worker_id, enabled, cadence_seconds, next_run_at)
SELECT id, true, 300, now()
FROM public.sentinel_workers
WHERE name = 'travel_recommendations_worker'
ON CONFLICT (worker_id) DO NOTHING;

-- Verify it's registered
SELECT w.name, ws.enabled, ws.cadence_seconds, ws.next_run_at 
FROM public.sentinel_workers w
LEFT JOIN public.sentinel_worker_schedules ws ON w.id = ws.worker_id
WHERE w.name = 'travel_recommendations_worker';
