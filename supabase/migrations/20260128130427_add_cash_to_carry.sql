-- Add cash_to_carry column to sentinel_travel_recommendations
-- Represents: travel_price_of_item * user_capacity
ALTER TABLE "public"."sentinel_travel_recommendations"
ADD COLUMN "cash_to_carry" bigint;
