-- Add category_id column to sentinel_torn_items
ALTER TABLE sentinel_torn_items 
ADD COLUMN IF NOT EXISTS category_id integer;

-- Add foreign key constraint to sentinel_torn_categories
ALTER TABLE sentinel_torn_items
DROP CONSTRAINT IF EXISTS fk_category_id;

ALTER TABLE sentinel_torn_items
ADD CONSTRAINT fk_category_id 
FOREIGN KEY (category_id) 
REFERENCES sentinel_torn_categories(id) 
ON DELETE SET NULL;
