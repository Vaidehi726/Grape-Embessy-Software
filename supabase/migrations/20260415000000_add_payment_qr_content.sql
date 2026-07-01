-- Add payment_qr_content column to restaurants table
-- This stores the payment QR string provided by the bank (e.g., UPI payment link)

ALTER TABLE restaurants 
ADD COLUMN IF NOT EXISTS payment_qr_content TEXT;

COMMENT ON COLUMN restaurants.payment_qr_content IS 'Payment QR code content string provided by bank for customer payments (e.g., UPI payment link)';
