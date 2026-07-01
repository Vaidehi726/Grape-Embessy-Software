-- Add shortcut_code column to menu_items for keyboard shortcuts
-- This allows users to assign number keys (1-9) for fast order creation

ALTER TABLE menu_items 
ADD COLUMN IF NOT EXISTS shortcut_code VARCHAR(1) CHECK (shortcut_code SIMILAR TO '[1-9]');

-- Add index for faster lookup
CREATE INDEX IF NOT EXISTS idx_menu_items_shortcut_code 
ON menu_items(restaurant_id, shortcut_code) 
WHERE shortcut_code IS NOT NULL;

-- Add comment
COMMENT ON COLUMN menu_items.shortcut_code IS 'Keyboard shortcut number (1-9) for fast order entry';
