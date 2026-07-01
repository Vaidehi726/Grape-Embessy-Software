import { useEffect, useState } from 'react';
import { useRestaurant } from '@/contexts/RestaurantContext';
import { supabase } from '@/integrations/supabase/client';
import { offlineQuery, offlineMutate, offlineDelete } from '@/services/offlineDataService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { BookOpen, Plus, Pencil, Trash2, Leaf, Drumstick, Flame, Clock } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';

interface MenuCategory {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  food_type: 'veg' | 'non_veg' | 'egg';
  spice_level: 'mild' | 'medium' | 'spicy' | 'extra_spicy' | null;
  preparation_time: number | null;
  is_available: boolean;
  image_url: string | null;
  category_id: string;
  kitchen_id: string | null;
  shortcut_code: string | null; // Keyboard shortcut (1-9)
  sort_order?: number | null;
  created_at: string;
}

interface Kitchen {
  id: string;
  name: string;
}

const FoodTypeIndicator = ({ type }: { type: 'veg' | 'non_veg' | 'egg' }) => {
  const config = {
    veg: { color: 'bg-success', icon: Leaf, label: 'Veg' },
    non_veg: { color: 'bg-destructive', icon: Drumstick, label: 'Non-Veg' },
    egg: { color: 'bg-warning', icon: Drumstick, label: 'Egg' },
  };
  const { color, icon: Icon, label } = config[type];
  
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-4 h-4 border-2 ${type === 'veg' ? 'border-success' : type === 'egg' ? 'border-warning' : 'border-destructive'} rounded flex items-center justify-center`}>
        <div className={`w-2 h-2 rounded-full ${color}`} />
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
};

const SpiceLevelIndicator = ({ level }: { level: 'mild' | 'medium' | 'spicy' | 'extra_spicy' | null }) => {
  if (!level) return null;
  
  const config = {
    mild: { flames: 1, label: 'Mild' },
    medium: { flames: 2, label: 'Medium' },
    spicy: { flames: 3, label: 'Spicy' },
    extra_spicy: { flames: 4, label: 'Extra Spicy' },
  };
  const { flames, label } = config[level];
  
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: flames }).map((_, i) => (
        <Flame key={i} className="w-3 h-3 text-orange-500 fill-orange-500" />
      ))}
      <span className="text-xs text-muted-foreground ml-1">{label}</span>
    </div>
  );
};

export default function Menu() {
  const { currentRestaurant } = useRestaurant();
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [kitchens, setKitchens] = useState<Kitchen[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<MenuCategory | null>(null);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Category form state
  const [categoryName, setCategoryName] = useState('');
  const [categoryDescription, setCategoryDescription] = useState('');
  const [categoryActive, setCategoryActive] = useState(true);

  // Item form state
  const [itemName, setItemName] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemFoodType, setItemFoodType] = useState<'veg' | 'non_veg' | 'egg'>('veg');
  const [itemSpiceLevel, setItemSpiceLevel] = useState<'mild' | 'medium' | 'spicy' | 'extra_spicy'>('medium');
  const [itemPrepTime, setItemPrepTime] = useState('15');
  const [itemAvailable, setItemAvailable] = useState(true);
  const [itemCategoryId, setItemCategoryId] = useState('');
  const [itemKitchenId, setItemKitchenId] = useState('');
  const [itemShortcutCode, setItemShortcutCode] = useState(''); // Keyboard shortcut (1-9 for quick access, or any number for search)
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null); // Drag-to-reorder

  const fetchData = async () => {
    if (!currentRestaurant) return;

    try {
      const [categoriesRes, kitchensRes] = await Promise.all([
        offlineQuery(
          async () => {
            const res = await supabase
              .from('menu_categories')
              .select('*')
              .eq('restaurant_id', currentRestaurant.id)
              .order('sort_order', { ascending: true });
            return res;
          },
          { table: 'menu_categories', filters: { restaurant_id: currentRestaurant.id } }
        ),
        offlineQuery(
          async () => {
            const res = await supabase
              .from('kitchens')
              .select('id, name')
              .eq('restaurant_id', currentRestaurant.id)
              .eq('is_active', true);
            return res;
          },
          { table: 'kitchens', filters: { restaurant_id: currentRestaurant.id, is_active: 1 } }
        ),
      ]);

      if (categoriesRes.error && !categoriesRes.fromCache) throw categoriesRes.error;
      const cats = (categoriesRes.data || []) as MenuCategory[];
      setCategories(cats);
      
      if (!kitchensRes.error || kitchensRes.fromCache) {
        setKitchens((kitchensRes.data || []) as Kitchen[]);
      }

      // Fetch menu items
      if (cats.length > 0) {
        const categoryIds = cats.map(c => c.id);
        const itemsRes = await offlineQuery(
          async () => {
            const res = await supabase
              .from('menu_items')
              .select('*')
              .in('category_id', categoryIds);
            return res;
          },
          { table: 'menu_items' }  // No restaurant_id filter - menu_items doesn't have that column
        );
        if (!itemsRes.error || itemsRes.fromCache) {
          let items = (itemsRes.data || []) as MenuItem[];
          if (itemsRes.fromCache) {
            items = items.filter(i => categoryIds.includes(i.category_id));
          }
          // Show in the saved drag order (sort_order). Tiebreak must MATCH the
          // kiosk (created_at, then name) so the default order is identical on
          // both screens when items haven't been dragged yet.
          items = items.slice().sort((a, b) =>
            ((a.sort_order ?? 0) - (b.sort_order ?? 0)) ||
            String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
            String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' })
          );
          setMenuItems(items);
        }
      }
    } catch (error) {
      console.error('Error fetching menu data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [currentRestaurant]);

  // Category handlers
  const resetCategoryForm = () => {
    setCategoryName('');
    setCategoryDescription('');
    setCategoryActive(true);
    setEditingCategory(null);
  };

  const handleOpenCategoryDialog = (category?: MenuCategory) => {
    if (category) {
      setEditingCategory(category);
      setCategoryName(category.name);
      setCategoryDescription(category.description || '');
      setCategoryActive(category.is_active);
    } else {
      resetCategoryForm();
    }
    setCategoryDialogOpen(true);
  };

  const handleCategorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentRestaurant) return;

    try {
      const catData = {
        restaurant_id: currentRestaurant.id,
        name: categoryName,
        description: categoryDescription || null,
        is_active: categoryActive,
        sort_order: categories.length,
        ...(editingCategory ? { id: editingCategory.id } : {}),
      };

      if (editingCategory) {
        const { error } = await offlineMutate('menu_categories', catData, async () => {
          const res = await supabase
            .from('menu_categories')
            .update({ name: categoryName, description: categoryDescription || null, is_active: categoryActive })
            .eq('id', editingCategory.id)
            .select().single();
          return res;
        });
        if (error) throw error;
        toast.success('Category updated successfully');
      } else {
        const { error } = await offlineMutate('menu_categories', catData, async () => {
          const res = await supabase.from('menu_categories').insert(catData).select().single();
          return res;
        });
        if (error) throw error;
        toast.success('Category created successfully');
      }

      setCategoryDialogOpen(false);
      resetCategoryForm();
      fetchData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('Are you sure? This will also delete all items in this category.')) return;

    try {
      const { error } = await offlineDelete('menu_categories', id, async () => {
        const res = await supabase.from('menu_categories').delete().eq('id', id);
        return res;
      });
      if (error) throw error;
      toast.success('Category deleted');
      fetchData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  // Item handlers
  const resetItemForm = () => {
    setItemName('');
    setItemDescription('');
    setItemPrice('');
    setItemFoodType('veg');
    setItemSpiceLevel('medium');
    setItemPrepTime('15');
    setItemAvailable(true);
    setItemCategoryId('');
    setItemKitchenId('');
    setItemShortcutCode('');
    setEditingItem(null);
  };

  const handleOpenItemDialog = (item?: MenuItem, categoryId?: string) => {
    if (item) {
      setEditingItem(item);
      setItemName(item.name);
      setItemDescription(item.description || '');
      setItemPrice(item.price.toString());
      setItemFoodType(item.food_type);
      setItemSpiceLevel(item.spice_level || 'medium');
      setItemPrepTime(item.preparation_time?.toString() || '15');
      setItemAvailable(item.is_available);
      setItemCategoryId(item.category_id);
      setItemKitchenId(item.kitchen_id || '');
      setItemShortcutCode(item.shortcut_code || '');
    } else {
      resetItemForm();
      if (categoryId) setItemCategoryId(categoryId);
    }
    setItemDialogOpen(true);
  };

  const handleItemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const itemData = {
        name: itemName,
        description: itemDescription || null,
        price: parseFloat(itemPrice),
        food_type: itemFoodType,
        spice_level: itemSpiceLevel,
        preparation_time: parseInt(itemPrepTime) || 15,
        is_available: itemAvailable,
        category_id: itemCategoryId,
        kitchen_id: itemKitchenId || null,
        shortcut_code: itemShortcutCode || null,
        // New items append to the end; edits leave sort_order untouched.
        ...(editingItem ? { id: editingItem.id } : { sort_order: menuItems.length }),
      };

      if (editingItem) {
        const { error } = await offlineMutate('menu_items', itemData, async () => {
          const res = await supabase.from('menu_items').update(itemData as any).eq('id', editingItem.id).select().single();
          return res;
        });
        if (error) throw error;
        toast.success('Menu item updated successfully');
      } else {
        const { error } = await offlineMutate('menu_items', itemData, async () => {
          const res = await supabase.from('menu_items').insert(itemData as any).select().single();
          return res;
        });
        if (error) throw error;
        toast.success('Menu item created successfully');
      }

      setItemDialogOpen(false);
      resetItemForm();
      fetchData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  // ── Drag-to-reorder menu items ──────────────────────────────────────────
  const reorderMenuItems = async (targetId: string) => {
    const sourceId = draggedItemId;
    setDraggedItemId(null);
    if (!sourceId || sourceId === targetId) return;

    const arr = [...menuItems];
    const from = arr.findIndex(i => i.id === sourceId);
    const to = arr.findIndex(i => i.id === targetId);
    if (from < 0 || to < 0) return;

    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);

    // Re-index sort_order by position and show the new order immediately.
    const reindexed = arr.map((it, idx) => ({ ...it, sort_order: idx }));
    setMenuItems(reindexed);

    // Persist the FULL ordering directly to the local SQLite (admin/server action).
    // Use the DB handle straight (not offlineMutate) so the write can't be
    // intercepted by client/offline routing, and surface any failure.
    const db = (window as any).electronAPI?.db;
    if (!db?.upsert) {
      toast.error('Database not available — order not saved');
      return;
    }
    try {
      for (let idx = 0; idx < reindexed.length; idx++) {
        const it = reindexed[idx];
        // Send the FULL item (incl. NOT NULL columns category_id/name/price) with
        // the new sort_order — a partial upsert fails the NOT NULL constraints.
        const res = await db.upsert('menu_items', {
          ...it,
          sort_order: idx,
          updated_at: new Date().toISOString(),
        });
        if (res && res.success === false) {
          throw new Error(res.error || 'upsert failed');
        }
      }
      toast.success('Menu order saved');
    } catch (err: any) {
      console.error('[Menu] save order error:', err);
      toast.error('Could not save order: ' + (err?.message || err));
      fetchData(); // revert to stored order on failure
    }
  };

  const handleDeleteItem = async (id: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return;

    try {
      const { error } = await offlineDelete('menu_items', id, async () => {
        const res = await supabase.from('menu_items').delete().eq('id', id);
        return res;
      });
      if (error) throw error;
      toast.success('Item deleted');
      fetchData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const toggleItemAvailability = async (item: MenuItem) => {
    try {
      const { error } = await offlineMutate('menu_items', { id: item.id, is_available: !item.is_available }, async () => {
        const res = await supabase.from('menu_items').update({ is_available: !item.is_available }).eq('id', item.id).select().single();
        return res;
      });
      if (error) throw error;
      toast.success(`Item ${!item.is_available ? 'available' : 'unavailable'}`);
      fetchData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  if (!currentRestaurant) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <BookOpen className="w-12 h-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold">No Restaurant Selected</h2>
          <p className="text-muted-foreground">Please select or create a restaurant first</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Menu Management</h1>
            <p className="text-muted-foreground">Manage your categories and menu items</p>
          </div>
        </div>

        <Tabs defaultValue="categories" className="space-y-6">
          <TabsList>
            <TabsTrigger value="categories">Categories</TabsTrigger>
            <TabsTrigger value="items">Menu Items</TabsTrigger>
          </TabsList>

          {/* Categories Tab */}
          <TabsContent value="categories" className="space-y-4">
            <div className="flex justify-end">
              <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="gradient" onClick={() => handleOpenCategoryDialog()}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Category
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingCategory ? 'Edit Category' : 'Add New Category'}</DialogTitle>
                    <DialogDescription>
                      {editingCategory ? 'Update category details' : 'Create a new menu category'}
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleCategorySubmit} className="space-y-4 mt-4">
                    <div className="space-y-2">
                      <Label htmlFor="cat-name">Category Name *</Label>
                      <Input
                        id="cat-name"
                        value={categoryName}
                        onChange={(e) => setCategoryName(e.target.value)}
                        placeholder="Starters"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cat-desc">Description</Label>
                      <Textarea
                        id="cat-desc"
                        value={categoryDescription}
                        onChange={(e) => setCategoryDescription(e.target.value)}
                        placeholder="Appetizers to start your meal..."
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="cat-active">Active</Label>
                      <Switch
                        id="cat-active"
                        checked={categoryActive}
                        onCheckedChange={setCategoryActive}
                      />
                    </div>
                    <div className="flex gap-3 pt-4">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setCategoryDialogOpen(false)}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                      <Button type="submit" variant="gradient" className="flex-1">
                        {editingCategory ? 'Update' : 'Create'}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            {loading ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <Card key={i} className="animate-pulse">
                    <CardContent className="p-6">
                      <div className="h-6 bg-muted rounded w-1/2 mb-4" />
                      <div className="h-4 bg-muted rounded w-3/4" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : categories.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                    <BookOpen className="w-8 h-8 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">No Categories Yet</h3>
                  <p className="text-muted-foreground text-center mb-4">
                    Add your first category to start organizing your menu
                  </p>
                  <Button variant="gradient" onClick={() => handleOpenCategoryDialog()}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Your First Category
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {categories.map((category) => {
                  const itemCount = menuItems.filter(i => i.category_id === category.id).length;
                  return (
                    <Card key={category.id} className="group hover:shadow-lg transition-all duration-200">
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                              category.is_active ? 'bg-primary/10' : 'bg-muted'
                            }`}>
                              <BookOpen className={`w-5 h-5 ${
                                category.is_active ? 'text-primary' : 'text-muted-foreground'
                              }`} />
                            </div>
                            <div>
                              <CardTitle className="text-lg">{category.name}</CardTitle>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge variant={category.is_active ? 'default' : 'secondary'}>
                                  {category.is_active ? 'Active' : 'Inactive'}
                                </Badge>
                                <span className="text-xs text-muted-foreground">{itemCount} items</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleOpenCategoryDialog(category)}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleDeleteCategory(category.id)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      {category.description && (
                        <CardContent className="pt-0">
                          <p className="text-sm text-muted-foreground">{category.description}</p>
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Menu Items Tab */}
          <TabsContent value="items" className="space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <Select value={selectedCategory || ''} onValueChange={(v) => setSelectedCategory(v || null)}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="gradient" onClick={() => handleOpenItemDialog()}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Menu Item
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>{editingItem ? 'Edit Menu Item' : 'Add New Menu Item'}</DialogTitle>
                    <DialogDescription>
                      {editingItem ? 'Update item details' : 'Add a new item to your menu'}
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleItemSubmit} className="space-y-4 mt-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-2 space-y-2">
                        <Label htmlFor="item-name">Item Name *</Label>
                        <Input
                          id="item-name"
                          value={itemName}
                          onChange={(e) => setItemName(e.target.value)}
                          placeholder="Paneer Tikka"
                          required
                        />
                      </div>
                      
                      <div className="col-span-2 space-y-2">
                        <Label htmlFor="item-desc">Description</Label>
                        <Textarea
                          id="item-desc"
                          value={itemDescription}
                          onChange={(e) => setItemDescription(e.target.value)}
                          placeholder="Marinated cottage cheese grilled to perfection..."
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="item-price">Price (₹) *</Label>
                        <Input
                          id="item-price"
                          type="number"
                          step="0.01"
                          min="0"
                          value={itemPrice}
                          onChange={(e) => setItemPrice(e.target.value)}
                          placeholder="249"
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="item-shortcut">
                          Keyboard Shortcut <span className="text-muted-foreground text-xs">(1-9 for quick keys, or any number for search)</span>
                        </Label>
                        <Input
                          id="item-shortcut"
                          type="text"
                          maxLength={5}
                          pattern="[0-9]*"
                          value={itemShortcutCode}
                          onChange={(e) => {
                            const val = e.target.value;
                            // Allow empty or any number (multi-digit support)
                            if (val === '' || /^[0-9]+$/.test(val)) {
                              setItemShortcutCode(val);
                            }
                          }}
                          placeholder="e.g., 5 or 100 or 250"
                          className="text-center text-lg font-bold"
                        />
                        <p className="text-xs text-muted-foreground">
                          1-9: Quick keyboard access in kiosk | Any number: Searchable in menu bar
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="item-category">Category *</Label>
                        <Select value={itemCategoryId} onValueChange={setItemCategoryId} required>
                          <SelectTrigger>
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map((cat) => (
                              <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="item-food-type">Food Type *</Label>
                        <Select value={itemFoodType} onValueChange={(v) => setItemFoodType(v as any)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="veg">
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-3 border-2 border-success rounded flex items-center justify-center">
                                  <div className="w-1.5 h-1.5 rounded-full bg-success" />
                                </div>
                                Vegetarian
                              </div>
                            </SelectItem>
                            <SelectItem value="non_veg">
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-3 border-2 border-destructive rounded flex items-center justify-center">
                                  <div className="w-1.5 h-1.5 rounded-full bg-destructive" />
                                </div>
                                Non-Vegetarian
                              </div>
                            </SelectItem>
                            <SelectItem value="egg">
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-3 border-2 border-warning rounded flex items-center justify-center">
                                  <div className="w-1.5 h-1.5 rounded-full bg-warning" />
                                </div>
                                Contains Egg
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="item-spice">Spice Level</Label>
                        <Select value={itemSpiceLevel} onValueChange={(v) => setItemSpiceLevel(v as any)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="mild">🌶️ Mild</SelectItem>
                            <SelectItem value="medium">🌶️🌶️ Medium</SelectItem>
                            <SelectItem value="spicy">🌶️🌶️🌶️ Spicy</SelectItem>
                            <SelectItem value="extra_spicy">🌶️🌶️🌶️🌶️ Extra Spicy</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="item-prep-time">Prep Time (mins)</Label>
                        <Input
                          id="item-prep-time"
                          type="number"
                          min="1"
                          value={itemPrepTime}
                          onChange={(e) => setItemPrepTime(e.target.value)}
                          placeholder="15"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="item-kitchen">Kitchen</Label>
                        <Select value={itemKitchenId} onValueChange={setItemKitchenId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select kitchen" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No Kitchen</SelectItem>
                            {kitchens.map((kitchen) => (
                              <SelectItem key={kitchen.id} value={kitchen.id}>{kitchen.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="col-span-2 flex items-center justify-between pt-2">
                        <Label htmlFor="item-available">Available</Label>
                        <Switch
                          id="item-available"
                          checked={itemAvailable}
                          onCheckedChange={setItemAvailable}
                        />
                      </div>
                    </div>

                    <div className="flex gap-3 pt-4">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setItemDialogOpen(false)}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                      <Button type="submit" variant="gradient" className="flex-1">
                        {editingItem ? 'Update' : 'Create'}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            {loading ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <Card key={i} className="animate-pulse">
                    <CardContent className="p-6">
                      <div className="h-6 bg-muted rounded w-1/2 mb-4" />
                      <div className="h-4 bg-muted rounded w-3/4" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : menuItems.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                    <BookOpen className="w-8 h-8 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">No Menu Items Yet</h3>
                  <p className="text-muted-foreground text-center mb-4">
                    Add your first menu item to start building your menu
                  </p>
                  <Button variant="gradient" onClick={() => handleOpenItemDialog()}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Your First Item
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {menuItems
                  .filter(item => !selectedCategory || selectedCategory === 'all' || item.category_id === selectedCategory)
                  .map((item) => {
                    const category = categories.find(c => c.id === item.category_id);
                    return (
                      <Card
                        key={item.id}
                        draggable
                        onDragStart={(e) => {
                          setDraggedItemId(item.id);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', item.id);
                        }}
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                        onDrop={(e) => { e.preventDefault(); reorderMenuItems(item.id); }}
                        onDragEnd={() => setDraggedItemId(null)}
                        className={`group hover:shadow-lg transition-all duration-200 cursor-grab active:cursor-grabbing ${!item.is_available ? 'opacity-60' : ''} ${draggedItemId === item.id ? 'opacity-40 ring-2 ring-primary' : ''}`}
                      >
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <FoodTypeIndicator type={item.food_type} />
                                <SpiceLevelIndicator level={item.spice_level} />
                              </div>
                              <CardTitle className="text-lg">{item.name}</CardTitle>
                              <div className="flex items-center gap-2 mt-2 flex-wrap">
                                <Badge variant="outline" className="text-primary font-semibold">
                                  ₹{item.price}
                                </Badge>
                                {category && (
                                  <Badge variant="secondary">{category.name}</Badge>
                                )}
                                {item.preparation_time && (
                                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Clock className="w-3 h-3" />
                                    {item.preparation_time} min
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleOpenItemDialog(item)}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleDeleteItem(item.id)}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          {item.description && (
                            <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{item.description}</p>
                          )}
                          <div className="flex items-center justify-between">
                            <span className={`text-xs px-2 py-1 rounded-full ${
                              item.is_available
                                ? 'bg-success/10 text-success'
                                : 'bg-destructive/10 text-destructive'
                            }`}>
                              {item.is_available ? 'Available' : 'Unavailable'}
                            </span>
                            <Switch
                              checked={item.is_available}
                              onCheckedChange={() => toggleItemAvailability(item)}
                            />
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}