-- Add CGST and SGST percentage columns to restaurants table
ALTER TABLE public.restaurants 
ADD COLUMN cgst_percentage NUMERIC(5, 2) DEFAULT 0,
ADD COLUMN sgst_percentage NUMERIC(5, 2) DEFAULT 0;

-- Add comments
COMMENT ON COLUMN public.restaurants.cgst_percentage IS 'Central GST percentage (e.g., 9 for 9%)';
COMMENT ON COLUMN public.restaurants.sgst_percentage IS 'State GST percentage (e.g., 9 for 9%)';
