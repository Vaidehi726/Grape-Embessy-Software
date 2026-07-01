import { useState, useEffect } from "react";
import { useRestaurant } from "@/contexts/RestaurantContext";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { offlineQuery, offlineMutate } from "@/services/offlineDataService";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, TrendingUp, TrendingDown, Wallet, RefreshCw } from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";

interface ExpenseCategory {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

interface Supplier {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  is_active: boolean;
}

interface Expense {
  id: string;
  amount: number;
  description: string | null;
  expense_date: string;
  payment_method: string | null;
  category_id: string | null;
  supplier_id: string | null;
  category?: ExpenseCategory;
  supplier?: Supplier;
}

export default function Expenses() {
  const { currentRestaurant: restaurant } = useRestaurant();
  const [activeTab, setActiveTab] = useState("overview");
  
  // Categories state
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [categoryDialog, setCategoryDialog] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ExpenseCategory | null>(null);
  const [categoryForm, setCategoryForm] = useState({ name: "", description: "" });
  
  // Suppliers state
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierDialog, setSupplierDialog] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [supplierForm, setSupplierForm] = useState({ 
    name: "", contact_person: "", phone: "", email: "", address: "" 
  });
  
  // Expenses state
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expenseDialog, setExpenseDialog] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [expenseForm, setExpenseForm] = useState({
    amount: "", description: "", expense_date: format(new Date(), "yyyy-MM-dd"),
    payment_method: "cash", category_id: "", supplier_id: ""
  });
  
  // Report state
  const [dateRange, setDateRange] = useState({
    start: format(startOfMonth(new Date()), "yyyy-MM-dd"),
    end: format(endOfMonth(new Date()), "yyyy-MM-dd")
  });
  const [earnings, setEarnings] = useState(0);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (restaurant?.id) {
      fetchCategories();
      fetchSuppliers();
      fetchExpenses();
      fetchEarnings();
    }
  }, [restaurant?.id, dateRange]);

  const fetchCategories = async () => {
    const { data } = await offlineQuery(
      async () => ({ data: null, error: null }),
      { table: "expense_categories", filters: { restaurant_id: restaurant!.id } }
    );
    if (data) setCategories(data as any);
  };

  const fetchSuppliers = async () => {
    const { data } = await offlineQuery(
      async () => ({ data: null, error: null }),
      { table: "suppliers", filters: { restaurant_id: restaurant!.id } }
    );
    if (data) setSuppliers(data as any);
  };

  const fetchExpenses = async () => {
    const { data } = await offlineQuery(
      async () => ({ data: null, error: null }),
      { table: "expenses", filters: { restaurant_id: restaurant!.id } }
    );
    if (data) {
      const expensesData = data as any[];
      setExpenses(expensesData);
      setTotalExpenses(expensesData.reduce((sum, e) => sum + Number(e.amount), 0));
    }
  };

  const fetchEarnings = async () => {
    const { data } = await offlineQuery(
      async () => ({ data: null, error: null }),
      { table: "orders", filters: { restaurant_id: restaurant!.id, status: "served" } }
    );
    if (data) {
      const orders = data as any[];
      const filtered = orders.filter(o => {
        const orderDate = o.created_at?.split('T')[0];
        return orderDate >= dateRange.start && orderDate <= dateRange.end;
      });
      setEarnings(filtered.reduce((sum, o) => sum + Number(o.total_amount), 0));
    }
  };

  // Category handlers
  const handleSaveCategory = async () => {
    if (!categoryForm.name.trim()) {
      toast.error("Category name is required");
      return;
    }
    setLoading(true);
    if (editingCategory) {
      const { error } = await offlineMutate(
        "expense_categories",
        { id: editingCategory.id, name: categoryForm.name, description: categoryForm.description || null },
        async () => ({ data: null, error: null })
      );
      if (error) toast.error(error.message);
      else toast.success("Category updated");
    } else {
      const { error } = await offlineMutate(
        "expense_categories",
        { restaurant_id: restaurant!.id, name: categoryForm.name, description: categoryForm.description || null },
        async () => ({ data: null, error: null })
      );
      if (error) toast.error(error.message);
      else toast.success("Category created");
    }
    setLoading(false);
    setCategoryDialog(false);
    setEditingCategory(null);
    setCategoryForm({ name: "", description: "" });
    fetchCategories();
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm("Delete this category?")) return;
    const { error } = await offlineMutate(
      "expense_categories",
      { id, _delete: true },
      async () => ({ data: null, error: null })
    );
    if (error) toast.error(error.message);
    else { toast.success("Category deleted"); fetchCategories(); }
  };

  // Supplier handlers
  const handleSaveSupplier = async () => {
    if (!supplierForm.name.trim()) {
      toast.error("Supplier name is required");
      return;
    }
    setLoading(true);
    const payload = {
      name: supplierForm.name,
      contact_person: supplierForm.contact_person || null,
      phone: supplierForm.phone || null,
      email: supplierForm.email || null,
      address: supplierForm.address || null
    };
    if (editingSupplier) {
      const { error } = await offlineMutate(
        "suppliers",
        { id: editingSupplier.id, ...payload },
        async () => ({ data: null, error: null })
      );
      if (error) toast.error(error.message);
      else toast.success("Supplier updated");
    } else {
      const { error } = await offlineMutate(
        "suppliers",
        { ...payload, restaurant_id: restaurant!.id },
        async () => ({ data: null, error: null })
      );
      if (error) toast.error(error.message);
      else toast.success("Supplier created");
    }
    setLoading(false);
    setSupplierDialog(false);
    setEditingSupplier(null);
    setSupplierForm({ name: "", contact_person: "", phone: "", email: "", address: "" });
    fetchSuppliers();
  };

  const handleDeleteSupplier = async (id: string) => {
    if (!confirm("Delete this supplier?")) return;
    const { error } = await offlineMutate(
      "suppliers",
      { id, _delete: true },
      async () => ({ data: null, error: null })
    );
    if (error) toast.error(error.message);
    else { toast.success("Supplier deleted"); fetchSuppliers(); }
  };

  // Expense handlers
  const handleSaveExpense = async () => {
    if (!expenseForm.amount || Number(expenseForm.amount) <= 0) {
      toast.error("Valid amount is required");
      return;
    }
    setLoading(true);
    const payload = {
      amount: Number(expenseForm.amount),
      description: expenseForm.description || null,
      expense_date: expenseForm.expense_date,
      payment_method: expenseForm.payment_method,
      category_id: expenseForm.category_id || null,
      supplier_id: expenseForm.supplier_id || null
    };
    if (editingExpense) {
      const { error } = await offlineMutate(
        "expenses",
        { id: editingExpense.id, ...payload },
        async () => ({ data: null, error: null })
      );
      if (error) toast.error(error.message);
      else toast.success("Expense updated");
    } else {
      const { error } = await offlineMutate(
        "expenses",
        { ...payload, restaurant_id: restaurant!.id },
        async () => ({ data: null, error: null })
      );
      if (error) toast.error(error.message);
      else toast.success("Expense recorded");
    }
    setLoading(false);
    setExpenseDialog(false);
    setEditingExpense(null);
    setExpenseForm({
      amount: "", description: "", expense_date: format(new Date(), "yyyy-MM-dd"),
      payment_method: "cash", category_id: "", supplier_id: ""
    });
    fetchExpenses();
  };

  const handleDeleteExpense = async (id: string) => {
    if (!confirm("Delete this expense?")) return;
    const { error } = await offlineMutate(
      "expenses",
      { id, _delete: true },
      async () => ({ data: null, error: null })
    );
    if (error) toast.error(error.message);
    else { toast.success("Expense deleted"); fetchExpenses(); }
  };

  const openEditCategory = (cat: ExpenseCategory) => {
    setEditingCategory(cat);
    setCategoryForm({ name: cat.name, description: cat.description || "" });
    setCategoryDialog(true);
  };

  const openEditSupplier = (sup: Supplier) => {
    setEditingSupplier(sup);
    setSupplierForm({
      name: sup.name,
      contact_person: sup.contact_person || "",
      phone: sup.phone || "",
      email: sup.email || "",
      address: sup.address || ""
    });
    setSupplierDialog(true);
  };

  const openEditExpense = (exp: Expense) => {
    setEditingExpense(exp);
    setExpenseForm({
      amount: String(exp.amount),
      description: exp.description || "",
      expense_date: exp.expense_date,
      payment_method: exp.payment_method || "cash",
      category_id: exp.category_id || "",
      supplier_id: exp.supplier_id || ""
    });
    setExpenseDialog(true);
  };

  const netIncome = earnings - totalExpenses;

  const setQuickRange = (months: number) => {
    const end = new Date();
    const start = subMonths(startOfMonth(end), months - 1);
    setDateRange({
      start: format(start, "yyyy-MM-dd"),
      end: format(end, "yyyy-MM-dd")
    });
  };

  return (
    <DashboardLayout>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Expense Management</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="flex flex-wrap gap-2 items-center">
            <Button variant="outline" size="sm" onClick={() => setQuickRange(1)}>This Month</Button>
            <Button variant="outline" size="sm" onClick={() => setQuickRange(3)}>Last 3 Months</Button>
            <Button variant="outline" size="sm" onClick={() => setQuickRange(6)}>Last 6 Months</Button>
            <div className="flex items-center gap-2 ml-auto">
              <Input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                className="w-auto"
              />
              <span>to</span>
              <Input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                className="w-auto"
              />
              <Button variant="ghost" size="icon" onClick={() => { fetchExpenses(); fetchEarnings(); }}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Total Earnings</CardTitle>
                <TrendingUp className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">₹{earnings.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground">From served orders</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
                <TrendingDown className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">₹{totalExpenses.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground">{expenses.length} expense records</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Net Income</CardTitle>
                <Wallet className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${netIncome >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  ₹{netIncome.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">Earnings - Expenses</p>
              </CardContent>
            </Card>
          </div>

          {/* Expense by Category breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Expenses by Category</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {categories.map(cat => {
                  const catTotal = expenses
                    .filter(e => e.category_id === cat.id)
                    .reduce((sum, e) => sum + Number(e.amount), 0);
                  const percentage = totalExpenses > 0 ? (catTotal / totalExpenses) * 100 : 0;
                  return (
                    <div key={cat.id} className="flex items-center gap-4">
                      <div className="w-32 truncate font-medium">{cat.name}</div>
                      <div className="flex-1 bg-muted rounded-full h-2">
                        <div 
                          className="bg-primary h-2 rounded-full transition-all" 
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <div className="w-24 text-right text-sm">₹{catTotal.toLocaleString()}</div>
                      <div className="w-16 text-right text-xs text-muted-foreground">
                        {percentage.toFixed(1)}%
                      </div>
                    </div>
                  );
                })}
                {expenses.filter(e => !e.category_id).length > 0 && (
                  <div className="flex items-center gap-4">
                    <div className="w-32 truncate font-medium text-muted-foreground">Uncategorized</div>
                    <div className="flex-1 bg-muted rounded-full h-2">
                      <div 
                        className="bg-muted-foreground h-2 rounded-full" 
                        style={{ 
                          width: `${totalExpenses > 0 ? (expenses.filter(e => !e.category_id).reduce((s, e) => s + Number(e.amount), 0) / totalExpenses) * 100 : 0}%` 
                        }}
                      />
                    </div>
                    <div className="w-24 text-right text-sm">
                      ₹{expenses.filter(e => !e.category_id).reduce((s, e) => s + Number(e.amount), 0).toLocaleString()}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Expenses Tab */}
        <TabsContent value="expenses" className="space-y-4">
          <div className="flex justify-between items-center">
            <div className="flex gap-2 items-center">
              <Input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                className="w-auto"
              />
              <span>to</span>
              <Input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                className="w-auto"
              />
            </div>
            <Button onClick={() => { setEditingExpense(null); setExpenseForm({
              amount: "", description: "", expense_date: format(new Date(), "yyyy-MM-dd"),
              payment_method: "cash", category_id: "", supplier_id: ""
            }); setExpenseDialog(true); }}>
              <Plus className="h-4 w-4 mr-2" /> Add Expense
            </Button>
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No expenses recorded for this period
                    </TableCell>
                  </TableRow>
                ) : (
                  expenses.map(exp => (
                    <TableRow key={exp.id}>
                      <TableCell>{format(new Date(exp.expense_date), "dd MMM yyyy")}</TableCell>
                      <TableCell>{exp.description || "-"}</TableCell>
                      <TableCell>
                        {exp.category ? <Badge variant="outline">{exp.category.name}</Badge> : "-"}
                      </TableCell>
                      <TableCell>{exp.supplier?.name || "-"}</TableCell>
                      <TableCell className="capitalize">{exp.payment_method}</TableCell>
                      <TableCell className="text-right font-medium">₹{Number(exp.amount).toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditExpense(exp)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteExpense(exp.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* Categories Tab */}
        <TabsContent value="categories" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => { setEditingCategory(null); setCategoryForm({ name: "", description: "" }); setCategoryDialog(true); }}>
              <Plus className="h-4 w-4 mr-2" /> Add Category
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {categories.map(cat => (
              <Card key={cat.id}>
                <CardHeader className="flex flex-row items-start justify-between pb-2">
                  <div>
                    <CardTitle className="text-lg">{cat.name}</CardTitle>
                    {cat.description && (
                      <p className="text-sm text-muted-foreground mt-1">{cat.description}</p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEditCategory(cat)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDeleteCategory(cat.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardHeader>
              </Card>
            ))}
            {categories.length === 0 && (
              <p className="text-muted-foreground col-span-full text-center py-8">
                No categories yet. Add one to organize your expenses.
              </p>
            )}
          </div>
        </TabsContent>

        {/* Suppliers Tab */}
        <TabsContent value="suppliers" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => { setEditingSupplier(null); setSupplierForm({ name: "", contact_person: "", phone: "", email: "", address: "" }); setSupplierDialog(true); }}>
              <Plus className="h-4 w-4 mr-2" /> Add Supplier
            </Button>
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact Person</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      No suppliers yet
                    </TableCell>
                  </TableRow>
                ) : (
                  suppliers.map(sup => (
                    <TableRow key={sup.id}>
                      <TableCell className="font-medium">{sup.name}</TableCell>
                      <TableCell>{sup.contact_person || "-"}</TableCell>
                      <TableCell>{sup.phone || "-"}</TableCell>
                      <TableCell>{sup.email || "-"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditSupplier(sup)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteSupplier(sup.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Category Dialog */}
      <Dialog open={categoryDialog} onOpenChange={setCategoryDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCategory ? "Edit Category" : "Add Category"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name *</Label>
              <Input
                value={categoryForm.name}
                onChange={(e) => setCategoryForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Groceries, Utilities"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={categoryForm.description}
                onChange={(e) => setCategoryForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Optional description"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleSaveCategory} disabled={loading}>
              {editingCategory ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Supplier Dialog */}
      <Dialog open={supplierDialog} onOpenChange={setSupplierDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSupplier ? "Edit Supplier" : "Add Supplier"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name *</Label>
              <Input
                value={supplierForm.name}
                onChange={(e) => setSupplierForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Supplier name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Contact Person</Label>
                <Input
                  value={supplierForm.contact_person}
                  onChange={(e) => setSupplierForm(prev => ({ ...prev, contact_person: e.target.value }))}
                />
              </div>
              <div>
                <Label>Phone</Label>
                <Input
                  value={supplierForm.phone}
                  onChange={(e) => setSupplierForm(prev => ({ ...prev, phone: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={supplierForm.email}
                onChange={(e) => setSupplierForm(prev => ({ ...prev, email: e.target.value }))}
              />
            </div>
            <div>
              <Label>Address</Label>
              <Textarea
                value={supplierForm.address}
                onChange={(e) => setSupplierForm(prev => ({ ...prev, address: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleSaveSupplier} disabled={loading}>
              {editingSupplier ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Expense Dialog */}
      <Dialog open={expenseDialog} onOpenChange={setExpenseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingExpense ? "Edit Expense" : "Add Expense"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Amount (₹) *</Label>
                <Input
                  type="number"
                  value={expenseForm.amount}
                  onChange={(e) => setExpenseForm(prev => ({ ...prev, amount: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label>Date *</Label>
                <Input
                  type="date"
                  value={expenseForm.expense_date}
                  onChange={(e) => setExpenseForm(prev => ({ ...prev, expense_date: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Input
                value={expenseForm.description}
                onChange={(e) => setExpenseForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="What was this expense for?"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Category</Label>
                <Select
                  value={expenseForm.category_id}
                  onValueChange={(v) => setExpenseForm(prev => ({ ...prev, category_id: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(cat => (
                      <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Supplier</Label>
                <Select
                  value={expenseForm.supplier_id}
                  onValueChange={(v) => setExpenseForm(prev => ({ ...prev, supplier_id: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map(sup => (
                      <SelectItem key={sup.id} value={sup.id}>{sup.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Payment Method</Label>
              <Select
                value={expenseForm.payment_method}
                onValueChange={(v) => setExpenseForm(prev => ({ ...prev, payment_method: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleSaveExpense} disabled={loading}>
              {editingExpense ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </DashboardLayout>
  );
}