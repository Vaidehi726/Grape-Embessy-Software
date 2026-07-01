-- Drop the problematic policies that query auth.users directly
DROP POLICY IF EXISTS "Users can view staff records matching their email" ON public.staff_members;
DROP POLICY IF EXISTS "Users can link their account to matching staff records" ON public.staff_members;
DROP POLICY IF EXISTS "Staff can view restaurants they work at" ON public.restaurants;

-- Create a security definer function to get user email safely
CREATE OR REPLACE FUNCTION public.get_user_email(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email FROM auth.users WHERE id = _user_id
$$;

-- Create a security definer function to check if user can access restaurant via staff
CREATE OR REPLACE FUNCTION public.can_access_restaurant_as_staff(_user_id uuid, _restaurant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_members sm
    WHERE sm.restaurant_id = _restaurant_id 
    AND sm.is_active = true
    AND (sm.user_id = _user_id OR sm.email = (SELECT email FROM auth.users WHERE id = _user_id))
  )
$$;

-- Create a function to check if user has unlinked staff record by email
CREATE OR REPLACE FUNCTION public.has_unlinked_staff_record_by_email(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_members sm
    WHERE sm.email = (SELECT email FROM auth.users WHERE id = _user_id)
    AND sm.user_id IS NULL
  )
$$;

-- Recreate policies using security definer functions
CREATE POLICY "Staff can view restaurants they work at" 
ON public.restaurants 
FOR SELECT 
USING (can_access_restaurant_as_staff(auth.uid(), id));

CREATE POLICY "Users can view staff records matching their email" 
ON public.staff_members 
FOR SELECT 
USING (email = get_user_email(auth.uid()));

CREATE POLICY "Users can link their account to matching staff records" 
ON public.staff_members 
FOR UPDATE 
USING (email = get_user_email(auth.uid()) AND user_id IS NULL)
WITH CHECK (user_id = auth.uid());