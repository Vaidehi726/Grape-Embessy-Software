-- Add missing customer and payment fields to orders table
-- Date: 2026-04-14
-- Purpose: Match local SQLite and LAN server schema for proper sync
-- Phase: 3

-- Add customer information fields for billing
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_gstin TEXT;

-- Add payment tracking fields
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cgst_amount REAL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sgst_amount REAL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount REAL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS final_amount REAL DEFAULT 0;

-- Add staff tracking
ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES staff_members(id);

-- Add indexes for performance on new fields
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_by ON orders(created_by);
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_customer_gstin ON orders(customer_gstin);

-- Add helpful comments for documentation
COMMENT ON COLUMN orders.customer_name IS 'Customer name for billing';
COMMENT ON COLUMN orders.customer_phone IS 'Customer phone number';
COMMENT ON COLUMN orders.customer_gstin IS 'Customer GST number for invoicing';
COMMENT ON COLUMN orders.payment_status IS 'Payment status: pending, paid, partial, refunded, void';
COMMENT ON COLUMN orders.cgst_amount IS 'Central GST amount (INR)';
COMMENT ON COLUMN orders.sgst_amount IS 'State GST amount (INR)';
COMMENT ON COLUMN orders.discount_amount IS 'Discount amount applied (INR)';
COMMENT ON COLUMN orders.final_amount IS 'Final amount after tax and discount (INR)';
COMMENT ON COLUMN orders.created_by IS 'Staff member UUID who created the order';

-- Verify the changes
DO $$
BEGIN
  RAISE NOTICE 'Orders table schema updated successfully';
  RAISE NOTICE 'Added columns: customer_name, customer_phone, customer_gstin';
  RAISE NOTICE 'Added columns: payment_status, cgst_amount, sgst_amount, discount_amount, final_amount';
  RAISE NOTICE 'Added column: created_by';
  RAISE NOTICE 'Added indexes: idx_orders_payment_status, idx_orders_created_by, idx_orders_customer_phone, idx_orders_customer_gstin';
END $$;
