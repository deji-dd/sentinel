-- Add can_boost_energy_perk column to sentinel_user_snapshots
-- Stores the percentage bonus from perks like "+ 50% energy gain from energy drinks"
-- Used to calculate actual energy gain when using cans/energy drinks

ALTER TABLE "public"."sentinel_user_snapshots"
    ADD COLUMN IF NOT EXISTS "can_boost_energy_perk" NUMERIC DEFAULT 0;

COMMENT ON COLUMN "public"."sentinel_user_snapshots"."can_boost_energy_perk" 
    IS 'Percentage bonus to energy gain from perks affecting energy drinks (e.g., 50 for +50%)';
