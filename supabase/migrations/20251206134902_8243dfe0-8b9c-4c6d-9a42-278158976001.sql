-- The problem: orders, order_items, tables, floors, menu_items, menu_categories 
-- only have RLS policies for owners, not for staff members

-- Add staff access policy for orders
CREATE POLICY "Staff can view orders of their restaurants" 
ON public.orders 
FOR SELECT 
USING (can_access_restaurant_as_staff(auth.uid(), restaurant_id));

CREATE POLICY "Staff can manage orders of their restaurants" 
ON public.orders 
FOR ALL 
USING (can_access_restaurant_as_staff(auth.uid(), restaurant_id))
WITH CHECK (can_access_restaurant_as_staff(auth.uid(), restaurant_id));

-- Add staff access policy for order_items
CREATE POLICY "Staff can view order items of their restaurants" 
ON public.order_items 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM orders o 
  WHERE o.id = order_items.order_id 
  AND can_access_restaurant_as_staff(auth.uid(), o.restaurant_id)
));

CREATE POLICY "Staff can manage order items of their restaurants" 
ON public.order_items 
FOR ALL 
USING (EXISTS (
  SELECT 1 FROM orders o 
  WHERE o.id = order_items.order_id 
  AND can_access_restaurant_as_staff(auth.uid(), o.restaurant_id)
))
WITH CHECK (EXISTS (
  SELECT 1 FROM orders o 
  WHERE o.id = order_items.order_id 
  AND can_access_restaurant_as_staff(auth.uid(), o.restaurant_id)
));

-- Add staff access policy for tables
CREATE POLICY "Staff can view tables of their restaurants" 
ON public.tables 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM floors f 
  WHERE f.id = tables.floor_id 
  AND can_access_restaurant_as_staff(auth.uid(), f.restaurant_id)
));

-- Add staff access policy for floors
CREATE POLICY "Staff can view floors of their restaurants" 
ON public.floors 
FOR SELECT 
USING (can_access_restaurant_as_staff(auth.uid(), restaurant_id));

-- Add staff access policy for menu_items
CREATE POLICY "Staff can view menu items of their restaurants" 
ON public.menu_items 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM menu_categories mc 
  WHERE mc.id = menu_items.category_id 
  AND can_access_restaurant_as_staff(auth.uid(), mc.restaurant_id)
));

-- Add staff access policy for menu_categories
CREATE POLICY "Staff can view menu categories of their restaurants" 
ON public.menu_categories 
FOR SELECT 
USING (can_access_restaurant_as_staff(auth.uid(), restaurant_id));

-- Add staff access policy for kitchens
CREATE POLICY "Staff can view kitchens of their restaurants" 
ON public.kitchens 
FOR SELECT 
USING (can_access_restaurant_as_staff(auth.uid(), restaurant_id));