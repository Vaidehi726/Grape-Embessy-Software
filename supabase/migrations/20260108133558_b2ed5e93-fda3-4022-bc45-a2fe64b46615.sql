-- Add payment_method column to orders table
ALTER TABLE public.orders 
ADD COLUMN payment_method text DEFAULT NULL;

-- Add a comment explaining the possible values
COMMENT ON COLUMN public.orders.payment_method IS 'Payment method: cash, card, upi, or null if not yet paid';