-- Add policy to allow users to view and update their own unlinked staff records by email match
CREATE POLICY "Users can view staff records matching their email" 
ON public.staff_members 
FOR SELECT 
USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- Allow users to link their account to staff records with matching email
CREATE POLICY "Users can link their account to matching staff records" 
ON public.staff_members 
FOR UPDATE 
USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()) AND user_id IS NULL)
WITH CHECK (user_id = auth.uid());