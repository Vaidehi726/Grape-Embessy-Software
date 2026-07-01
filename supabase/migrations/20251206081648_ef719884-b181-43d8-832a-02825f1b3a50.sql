
-- Create enum for staff roles
CREATE TYPE public.staff_role AS ENUM ('owner', 'manager', 'waiter', 'chef');

-- Create staff_members table (links users to restaurants with roles)
CREATE TABLE public.staff_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  role staff_role NOT NULL DEFAULT 'waiter',
  is_active BOOLEAN NOT NULL DEFAULT true,
  invited_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  joined_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, email)
);

-- Create shifts table for scheduling
CREATE TABLE public.shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  staff_member_id UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

-- Security definer function to check staff role (prevents RLS recursion)
CREATE OR REPLACE FUNCTION public.get_staff_role(_user_id UUID, _restaurant_id UUID)
RETURNS staff_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.staff_members
  WHERE user_id = _user_id 
    AND restaurant_id = _restaurant_id
    AND is_active = true
  LIMIT 1
$$;

-- Function to check if user is owner of restaurant
CREATE OR REPLACE FUNCTION public.is_restaurant_owner(_user_id UUID, _restaurant_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurants
    WHERE id = _restaurant_id AND owner_id = _user_id
  )
$$;

-- Function to check if user has management access (owner or manager)
CREATE OR REPLACE FUNCTION public.has_management_access(_user_id UUID, _restaurant_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    public.is_restaurant_owner(_user_id, _restaurant_id) 
    OR public.get_staff_role(_user_id, _restaurant_id) IN ('owner', 'manager')
$$;

-- RLS Policies for staff_members
-- Owners can do everything
CREATE POLICY "Restaurant owners can manage staff"
ON public.staff_members
FOR ALL
USING (public.is_restaurant_owner(auth.uid(), restaurant_id))
WITH CHECK (public.is_restaurant_owner(auth.uid(), restaurant_id));

-- Managers can view and add staff (but not other managers/owners)
CREATE POLICY "Managers can view staff"
ON public.staff_members
FOR SELECT
USING (public.has_management_access(auth.uid(), restaurant_id));

-- Staff can view their own record
CREATE POLICY "Staff can view own record"
ON public.staff_members
FOR SELECT
USING (auth.uid() = user_id);

-- RLS Policies for shifts
CREATE POLICY "Owners and managers can manage shifts"
ON public.shifts
FOR ALL
USING (public.has_management_access(auth.uid(), restaurant_id))
WITH CHECK (public.has_management_access(auth.uid(), restaurant_id));

-- Staff can view their own shifts
CREATE POLICY "Staff can view own shifts"
ON public.shifts
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.staff_members sm
    WHERE sm.id = shifts.staff_member_id
    AND sm.user_id = auth.uid()
  )
);

-- Trigger for updated_at
CREATE TRIGGER update_staff_members_updated_at
BEFORE UPDATE ON public.staff_members
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_shifts_updated_at
BEFORE UPDATE ON public.shifts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create owner as staff member when restaurant is created
CREATE OR REPLACE FUNCTION public.add_owner_as_staff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_email TEXT;
  owner_name TEXT;
BEGIN
  SELECT email, COALESCE(raw_user_meta_data->>'full_name', email)
  INTO owner_email, owner_name
  FROM auth.users WHERE id = NEW.owner_id;
  
  INSERT INTO public.staff_members (restaurant_id, user_id, email, full_name, role, joined_at)
  VALUES (NEW.id, NEW.owner_id, owner_email, owner_name, 'owner', now());
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_restaurant_created_add_owner
AFTER INSERT ON public.restaurants
FOR EACH ROW
EXECUTE FUNCTION public.add_owner_as_staff();
