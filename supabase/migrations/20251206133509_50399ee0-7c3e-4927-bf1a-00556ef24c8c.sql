-- Add RLS policy to allow staff to view restaurants they work at
CREATE POLICY "Staff can view restaurants they work at" 
ON public.restaurants 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.staff_members sm
    WHERE sm.restaurant_id = id 
    AND (sm.user_id = auth.uid() OR sm.email = (SELECT email FROM auth.users WHERE id = auth.uid()))
    AND sm.is_active = true
  )
);

-- Insert missing owner staff records for existing restaurants
INSERT INTO public.staff_members (restaurant_id, user_id, email, full_name, role, joined_at)
SELECT 
  r.id,
  r.owner_id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'full_name', u.email),
  'owner'::staff_role,
  now()
FROM public.restaurants r
JOIN auth.users u ON u.id = r.owner_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.staff_members sm 
  WHERE sm.restaurant_id = r.id AND sm.user_id = r.owner_id
);