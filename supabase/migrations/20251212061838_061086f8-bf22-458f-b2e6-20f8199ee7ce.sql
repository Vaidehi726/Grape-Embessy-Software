-- Create expense_categories table
CREATE TABLE public.expense_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create suppliers table
CREATE TABLE public.suppliers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create expenses table
CREATE TABLE public.expenses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL,
  description TEXT,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method TEXT DEFAULT 'cash',
  receipt_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

-- RLS policies for expense_categories
CREATE POLICY "Users can manage expense categories of their restaurants"
ON public.expense_categories FOR ALL
USING (is_restaurant_owner(auth.uid(), restaurant_id))
WITH CHECK (is_restaurant_owner(auth.uid(), restaurant_id));

CREATE POLICY "Staff can view expense categories"
ON public.expense_categories FOR SELECT
USING (has_management_access(auth.uid(), restaurant_id));

-- RLS policies for suppliers
CREATE POLICY "Users can manage suppliers of their restaurants"
ON public.suppliers FOR ALL
USING (is_restaurant_owner(auth.uid(), restaurant_id))
WITH CHECK (is_restaurant_owner(auth.uid(), restaurant_id));

CREATE POLICY "Staff can view suppliers"
ON public.suppliers FOR SELECT
USING (has_management_access(auth.uid(), restaurant_id));

-- RLS policies for expenses
CREATE POLICY "Users can manage expenses of their restaurants"
ON public.expenses FOR ALL
USING (is_restaurant_owner(auth.uid(), restaurant_id))
WITH CHECK (is_restaurant_owner(auth.uid(), restaurant_id));

CREATE POLICY "Staff can view expenses"
ON public.expenses FOR SELECT
USING (has_management_access(auth.uid(), restaurant_id));

-- Create indexes for better performance
CREATE INDEX idx_expenses_restaurant_date ON public.expenses(restaurant_id, expense_date);
CREATE INDEX idx_expenses_category ON public.expenses(category_id);
CREATE INDEX idx_expenses_supplier ON public.expenses(supplier_id);

-- Trigger for updated_at
CREATE TRIGGER update_expenses_updated_at
BEFORE UPDATE ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();