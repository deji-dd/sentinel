-- Add unlocked column to sentinel_torn_gyms
ALTER TABLE sentinel_torn_gyms
ADD COLUMN unlocked BOOLEAN DEFAULT false;

-- Create index on unlocked for faster filtering
CREATE INDEX idx_torn_gyms_unlocked ON sentinel_torn_gyms(unlocked);
