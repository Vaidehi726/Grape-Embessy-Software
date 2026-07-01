-- Add slug column to restaurants table
ALTER TABLE public.restaurants
ADD COLUMN slug text UNIQUE;

-- Create a function to generate slug from name
CREATE OR REPLACE FUNCTION public.generate_restaurant_slug(name text, owner_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  base_slug text;
  final_slug text;
  counter integer := 0;
BEGIN
  -- Generate base slug from name (lowercase, replace spaces with hyphens, remove special chars)
  base_slug := lower(regexp_replace(trim(name), '[^a-zA-Z0-9\s]', '', 'g'));
  base_slug := regexp_replace(base_slug, '\s+', '-', 'g');
  base_slug := regexp_replace(base_slug, '-+', '-', 'g');
  base_slug := trim(both '-' from base_slug);
  
  -- If empty, use 'restaurant'
  IF base_slug = '' THEN
    base_slug := 'restaurant';
  END IF;
  
  -- Check uniqueness and add counter if needed
  final_slug := base_slug;
  WHILE EXISTS (SELECT 1 FROM restaurants WHERE slug = final_slug) LOOP
    counter := counter + 1;
    final_slug := base_slug || '-' || counter::text;
  END LOOP;
  
  RETURN final_slug;
END;
$$;

-- Create trigger to auto-generate slug on insert
CREATE OR REPLACE FUNCTION public.set_restaurant_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := public.generate_restaurant_slug(NEW.name, NEW.owner_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_restaurant_slug_trigger
BEFORE INSERT ON public.restaurants
FOR EACH ROW
EXECUTE FUNCTION public.set_restaurant_slug();

-- Update existing restaurants with slugs
UPDATE public.restaurants
SET slug = public.generate_restaurant_slug(name, owner_id)
WHERE slug IS NULL;

-- Make slug NOT NULL after populating existing records
ALTER TABLE public.restaurants
ALTER COLUMN slug SET NOT NULL;