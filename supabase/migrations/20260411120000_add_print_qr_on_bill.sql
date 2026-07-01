-- Add print_qr_on_bill column to restaurants table
ALTER TABLE public.restaurants 
ADD COLUMN print_qr_on_bill BOOLEAN DEFAULT true;

-- Add comment
COMMENT ON COLUMN public.restaurants.print_qr_on_bill IS 'Whether to print order ID QR code on the bill receipt';
