import { useEffect, useState, useCallback } from 'react';
import { useRestaurant } from '@/contexts/RestaurantContext';
import { offlineQuery, offlineMutate, isElectron } from '@/services/offlineDataService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  ShoppingBag,
  Plus,
  Minus,
  Trash2,
  Clock,
  ChefHat,
  CheckCircle,
  XCircle,
  Leaf,
  Drumstick,
  Flame,
  Bell,
  Receipt,
} from 'lucide-react';
import { useThermalPrinter } from '@/hooks/useThermalPrinter';
import { useUSBPrinter } from '@/hooks/useUSBPrinter';
import { BillingDialog } from '@/components/BillingDialog';
import { getNextBillNumber } from '@/services/dailyBillNumber';
import { getDataClient } from '@/services/localDataService';
import type { Database } from '@/integrations/supabase/types';
import DashboardLayout from '@/components/layout/DashboardLayout';

type OrderStatus = Database['public']['Enums']['order_status'];
type FoodType = Database['public']['Enums']['food_type'];
type SpiceLevel = Database['public']['Enums']['spice_level'];

interface Table {
  id: string;
  table_number: string;
  floor: { name: string };
}

interface MenuItem {
  id: string;
  name: string;
  price: number;
  food_type: FoodType;
  spice_level: SpiceLevel | null;
  is_available: boolean;
  category: { name: string };
}

interface OrderItem {
  id: string;
  menu_item_id: string | null;
  quantity: number;
  unit_price: number;
  status: OrderStatus;
  notes: string | null;
  menu_item?: { name: string; food_type: FoodType };
}

interface Order {
  id: string;
  restaurant_id: string;
  table_id: string | null;
  status: OrderStatus;
  total_amount: number;
  notes: string | null;
  created_at: string;
  table?: { table_number: string; floor: { name: string } };
  order_items: OrderItem[];
}

interface CartItem {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  food_type: FoodType;
}

const STATUS_CONFIG: Record<OrderStatus, { label: string; color: string; icon: React.ElementType }> = {
  pending: { label: 'Pending', color: 'bg-warning/10 text-warning border-warning/30', icon: Clock },
  cooking: { label: 'Cooking', color: 'bg-primary/10 text-primary border-primary/30', icon: ChefHat },
  ready: { label: 'Ready', color: 'bg-success/10 text-success border-success/30', icon: CheckCircle },
  served: { label: 'Served', color: 'bg-muted text-muted-foreground border-muted', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-destructive/10 text-destructive border-destructive/30', icon: XCircle },
};

const SPICE_ICONS: Record<string, number> = {
  mild: 1,
  medium: 2,
  spicy: 3,
  extra_spicy: 4,
};

export default function Orders() {
  const { currentRestaurant } = useRestaurant();
  const isMobile = useIsMobile();
  const [orders, setOrders] = useState<Order[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  // New order form
  const [selectedTableId, setSelectedTableId] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Billing state
  const [billingDialogOpen, setBillingDialogOpen] = useState(false);
  const [billingOrder, setBillingOrder] = useState<Order | null>(null);
  const [printerSelectorOpen, setPrinterSelectorOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [orderToCancel, setOrderToCancel] = useState<Order | null>(null);

  const openCancelDialog = (order: Order) => {
    setOrderToCancel(order);
    setCancelDialogOpen(true);
  };

  const confirmCancelOrder = async () => {
    if (!orderToCancel) return;
    await handleUpdateOrderStatus(orderToCancel.id, 'cancelled');
    setCancelDialogOpen(false);
    setOrderToCancel(null);
  };

  const fetchData = useCallback(async () => {
    if (!currentRestaurant) return;

    try {
      const [ordersRes, tablesRes, menuRes] = await Promise.all([
        offlineQuery(
          async () => {
            const res = await supabase
              .from('orders')
              .select(`
                *,
                table:tables(table_number, floor:floors(name)),
                order_items(*, menu_item:menu_items(name, food_type))
              `)
              .eq('restaurant_id', currentRestaurant.id)
              .order('created_at', { ascending: false });
            return res;
          },
          { table: 'orders', filters: { restaurant_id: currentRestaurant.id } }
        ),
        offlineQuery(
          async () => {
            const res = await supabase
              .from('tables')
              .select('id, table_number, floor:floors!inner(name, restaurant_id)')
              .eq('floor.restaurant_id', currentRestaurant.id);
            return res;
          },
          { table: 'tables' }
        ),
        offlineQuery(
          async () => {
            const res = await supabase
              .from('menu_items')
              .select('id, name, price, food_type, spice_level, is_available, category:menu_categories!inner(name, restaurant_id)')
              .eq('category.restaurant_id', currentRestaurant.id)
              .eq('is_available', true);
            return res;
          },
          { table: 'menu_items', filters: { restaurant_id: currentRestaurant.id } }
        ),
      ]);

      if (ordersRes.error && !ordersRes.fromCache) throw ordersRes.error;
      if (tablesRes.error && !tablesRes.fromCache) throw tablesRes.error;
      if (menuRes.error && !menuRes.fromCache) throw menuRes.error;

      // Handle cached orders - need to assemble order_items and table
      if (ordersRes.fromCache) {
        const rawOrders = (ordersRes.data || []) as any[];
        console.log('[Orders] Raw orders from SQLite:', rawOrders.map(o => ({ id: o.id, status: o.status, updated_at: o.updated_at })));
        // Use localQuery which is LAN-aware
        const { localQuery } = await import('@/services/localDataService');
        const assembled: Order[] = [];
        
        // Fetch all menu_items and tables from local/LAN for joining
        let localMenuItems: any[] = [];
        let localTables: any[] = [];
        let localFloors: any[] = [];
        
        const [menuResult, tablesResult, floorsResult] = await Promise.all([
          localQuery('menu_items'),
          localQuery('tables'),
          localQuery('floors')
        ]);
        localMenuItems = menuResult.data || [];
        localTables = tablesResult.data || [];
        localFloors = floorsResult.data || [];
        
        for (const order of rawOrders) {
          let orderItems: any[] = [];
          const itemsRes = await localQuery('order_items', { order_id: order.id });
          // Join with menu_items to get the name and food_type
          orderItems = (itemsRes.data || []).map((item: any) => {
            const menuItem = localMenuItems.find((m: any) => m.id === item.menu_item_id);
            return {
              ...item,
              menu_item: menuItem ? {
                name: menuItem.name,
                food_type: menuItem.food_type
              } : null
            };
          });
          
          // Join with tables and floors to get table info
          let tableInfo = null;
          if (order.table_id) {
            const table = localTables.find((t: any) => t.id === order.table_id);
            if (table) {
              const floor = localFloors.find((f: any) => f.id === table.floor_id);
              tableInfo = {
                table_number: table.table_number,
                floor: floor ? { name: floor.name } : { name: 'Unknown' }
              };
            }
          }
          
          assembled.push({ ...order, order_items: orderItems, table: tableInfo } as any);
        }
        console.log('[Orders] Setting assembled orders:', assembled.map(o => ({ id: o.id, status: o.status, table: o.table?.table_number })));
        setOrders(assembled);
      } else {
        console.log('[Orders] Setting orders from cloud:', (ordersRes.data || []).map((o: any) => ({ id: o.id, status: o.status })));
        setOrders((ordersRes.data || []) as Order[]);
      }

      setTables(((tablesRes.data as any) || []) as Table[]);

      if (menuRes.fromCache) {
        const items = (menuRes.data || []) as any[];
        console.log('[Orders] Raw menu items from SQLite:', items.length, 'items');
        console.log('[Orders] Menu items sample:', items.slice(0, 2));
        
        // Join with menu_categories to get category names
        const db = getDataClient();
        let categories: any[] = [];
        if (db) {
          const catRes = await db.query('menu_categories');
          categories = catRes.data || [];
        }
        
        const menuWithCategories = items.map((item: any) => {
          const category = categories.find((c: any) => c.id === item.category_id);
          return {
            ...item,
            category: category ? { name: category.name } : { name: 'Uncategorized' }
          };
        });
        
        const availableItems = menuWithCategories.filter((i: any) => i.is_available !== false);
        console.log('[Orders] Available menu items:', availableItems.length, 'items');
        setMenuItems(availableItems);
      } else {
        setMenuItems(((menuRes.data as any) || []) as MenuItem[]);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, [currentRestaurant]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Refresh data when page becomes visible (e.g., after navigating back from Kiosk)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[Orders] Page visible, refreshing data...');
        fetchData();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [fetchData]);

  // Poll for order updates every 5 seconds (no realtime in local mode)
  useEffect(() => {
    if (!currentRestaurant) return;

    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [currentRestaurant, fetchData]);

  const resetForm = () => {
    setSelectedTableId('');
    setOrderNotes('');
    setCart([]);
    setSearchTerm('');
  };

  const addToCart = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.menuItemId === item.id);
      if (existing) {
        return prev.map((c) =>
          c.menuItemId === item.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, { menuItemId: item.id, name: item.name, price: item.price, quantity: 1, food_type: item.food_type }];
    });
  };

  const updateCartQuantity = (menuItemId: string, delta: number) => {
    setCart((prev) => {
      return prev
        .map((c) =>
          c.menuItemId === menuItemId ? { ...c, quantity: c.quantity + delta } : c
        )
        .filter((c) => c.quantity > 0);
    });
  };

  const removeFromCart = (menuItemId: string) => {
    setCart((prev) => prev.filter((c) => c.menuItemId !== menuItemId));
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const handleCreateOrder = async () => {
    if (!currentRestaurant || cart.length === 0) {
      toast.error('Please add items to the order');
      return;
    }

    try {
      // Create order
      const orderId = crypto.randomUUID();

      // Bill number is NOT assigned here — it is reserved on the first print
      // (see BillingDialog.ensureBillNumber) so numbers follow the printing
      // sequence, and orders that are never printed stay unnumbered.
      const orderData = {
        id: orderId,
        restaurant_id: currentRestaurant.id,
        table_id: selectedTableId && selectedTableId !== 'takeaway' ? selectedTableId : null,
        total_amount: cartTotal,
        notes: orderNotes || null,
        status: 'pending' as const,
      };

      const { data: order, error: orderError } = await offlineMutate(
        'orders',
        orderData,
        async () => {
          const res = await supabase.from('orders').insert(orderData).select().single();
          return res;
        }
      );

      if (orderError) throw orderError;

      // Create order items
      const orderItems = cart.map((item) => ({
        id: crypto.randomUUID(),
        order_id: order?.id || orderId,
        menu_item_id: item.menuItemId,
        quantity: item.quantity,
        unit_price: item.price,
        status: 'pending' as OrderStatus,
      }));

      for (const oi of orderItems) {
        await offlineMutate('order_items', oi, async () => {
          const res = await supabase.from('order_items').insert(oi).select().single();
          return res;
        });
      }

      // Update table to occupied if selected
      if (selectedTableId) {
        await offlineMutate('tables', { id: selectedTableId, is_occupied: true }, async () => {
          const res = await supabase.from('tables').update({ is_occupied: true }).eq('id', selectedTableId).select().single();
          return res;
        });
      }

      toast.success('Order created successfully');
      setDialogOpen(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleUpdateOrderStatus = async (orderId: string, newStatus: OrderStatus) => {
    try {
      // Get the current order to preserve restaurant_id
      const currentOrder = orders.find((o) => o.id === orderId);
      if (!currentOrder) return;

      // Update local state immediately for responsive UI
      setOrders(prevOrders => 
        prevOrders.map(order => 
          order.id === orderId ? { ...order, status: newStatus } : order
        )
      );

      await offlineMutate('orders', { 
        id: orderId, 
        status: newStatus,
        restaurant_id: currentOrder.restaurant_id || currentRestaurant?.id
      }, async () => {
        const res = await supabase.from('orders').update({ status: newStatus }).eq('id', orderId).select().single();
        return res;
      });

      // If served or cancelled, free up the table
      if (newStatus === 'served' || newStatus === 'cancelled') {
        if (currentOrder?.table_id) {
          await offlineMutate('tables', { id: currentOrder.table_id, is_occupied: false }, async () => {
            const res = await supabase.from('tables').update({ is_occupied: false }).eq('id', currentOrder.table_id).select().single();
            return res;
          });
        }
      }

      toast.success(`Order marked as ${newStatus}`);
    } catch (error: any) {
      toast.error(error.message);
      // Don't revert - keep the UI state even if background save failed
      // The sync mechanism will handle retries
    }
  };

  // Billing functions
  const openBillingDialog = (order: Order) => {
    setBillingOrder(order);
    setBillingDialogOpen(true);
  };

  const handlePaymentComplete = async (
    paymentMethod: 'cash' | 'card' | 'upi',
    billing?: { subtotal: number; discountAmount: number; cgstAmount: number; sgstAmount: number; finalAmount: number }
  ) => {
    if (!billingOrder) return;

    // Persist the discount/GST breakdown so the saved bill matches what was charged.
    const billingFields = billing
      ? {
          discount_amount: billing.discountAmount,
          cgst_amount: billing.cgstAmount,
          sgst_amount: billing.sgstAmount,
          final_amount: billing.finalAmount,
        }
      : {};

    // Update local state immediately
    setOrders(prevOrders =>
      prevOrders.map(order =>
        order.id === billingOrder.id
          ? { ...order, status: 'served', payment_method: paymentMethod, ...billingFields }
          : order
      )
    );

    // Mark order as served and record payment method
    await offlineMutate('orders', {
      id: billingOrder.id,
      status: 'served',
      payment_method: paymentMethod,
      payment_status: 'paid',
      ...billingFields,
      restaurant_id: billingOrder.restaurant_id || currentRestaurant?.id
    }, async () => {
      const res = await supabase.from('orders').update({ status: 'served', payment_method: paymentMethod }).eq('id', billingOrder.id).select().single();
      return res;
    });

    // Free up the table
    if (billingOrder.table_id) {
      await offlineMutate('tables', { id: billingOrder.table_id, is_occupied: false }, async () => {
        const res = await supabase.from('tables').update({ is_occupied: false }).eq('id', billingOrder.table_id).select().single();
        return res;
      });
    }

    setBillingDialogOpen(false);
    setBillingOrder(null);
    toast.success(`Payment received via ${paymentMethod.toUpperCase()}`);
  };

  const filteredMenuItems = menuItems.filter(
    (item) =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.category?.name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeOrders = orders.filter((o) => ['pending', 'cooking', 'ready'].includes(o.status));
  const completedOrders = orders.filter((o) => ['served', 'cancelled'].includes(o.status));

  if (!currentRestaurant) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <ShoppingBag className="w-12 h-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold">No Restaurant Selected</h2>
          <p className="text-muted-foreground">Please select or create a restaurant first</p>
        </div>
      </DashboardLayout>
    );
  }

  const renderFoodTypeIcon = (type: FoodType) => (
    <span className={type === 'veg' ? 'text-success' : 'text-destructive'}>
      {type === 'veg' ? <Leaf className="w-4 h-4" /> : <Drumstick className="w-4 h-4" />}
    </span>
  );

  const renderOrderCard = (order: Order) => {
    const StatusIcon = STATUS_CONFIG[order.status].icon;
    return (
      <Card key={order.id} className="hover:shadow-md transition-shadow">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {order.table ? (
                <div className="flex flex-col">
                  <span className="font-semibold">{order.table.table_number}</span>
                  <span className="text-xs text-muted-foreground">{order.table.floor.name}</span>
                </div>
              ) : (
                <span className="font-semibold">Takeaway</span>
              )}
              <Badge variant="outline" className={STATUS_CONFIG[order.status].color}>
                <StatusIcon className="w-3 h-3 mr-1" />
                {STATUS_CONFIG[order.status].label}
              </Badge>
              {(order as any).bill_number != null && (
                <Badge variant="secondary" className="font-mono">
                  Bill #{String((order as any).bill_number).padStart(3, '0')}
                </Badge>
              )}
            </div>
            <div className="text-right">
              <p className="font-bold text-lg">₹{Math.round(order.total_amount)}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2 mb-4">
            {order.order_items.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  {item.menu_item && renderFoodTypeIcon(item.menu_item.food_type)}
                  <span>{item.menu_item?.name || 'Unknown'}</span>
                  <span className="text-muted-foreground">×{item.quantity}</span>
                </div>
                <span>₹{item.unit_price * item.quantity}</span>
              </div>
            ))}
          </div>
          {order.notes && (
            <p className="text-sm text-muted-foreground italic mb-4">Note: {order.notes}</p>
          )}
          {order.status !== 'served' && order.status !== 'cancelled' && (
            <div className="flex gap-2 flex-wrap">
              {order.status === 'pending' && (
                <>
                  <Button size="sm" onClick={() => handleUpdateOrderStatus(order.id, 'cooking')}>
                    <ChefHat className="w-4 h-4 mr-1" />
                    Start Cooking
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    onClick={() => openCancelDialog(order)}
                  >
                    <XCircle className="w-4 h-4 mr-1" />
                    Cancel
                  </Button>
                </>
              )}
              {order.status === 'cooking' && (
                <>
                  <Button size="sm" onClick={() => handleUpdateOrderStatus(order.id, 'ready')}>
                    <CheckCircle className="w-4 h-4 mr-1" />
                    Mark Ready
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    onClick={() => openCancelDialog(order)}
                  >
                    <XCircle className="w-4 h-4 mr-1" />
                    Cancel
                  </Button>
                </>
              )}
              {order.status === 'ready' && (
                <>
                  <Button size="sm" onClick={() => openBillingDialog(order)}>
                    <Receipt className="w-4 h-4 mr-1" />
                    Generate Bill
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    onClick={() => openCancelDialog(order)}
                  >
                    <XCircle className="w-4 h-4 mr-1" />
                    Cancel
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Orders</h1>
          <p className="text-muted-foreground">Create and manage table orders</p>
        </div>
        {isMobile ? (
          <Drawer open={dialogOpen} onOpenChange={setDialogOpen}>
            <DrawerTrigger asChild>
              <Button variant="gradient" onClick={resetForm}>
                <Plus className="w-4 h-4 mr-2" />
                New Order
              </Button>
            </DrawerTrigger>
            <DrawerContent className="max-h-[95vh]">
              <DrawerHeader className="pb-2">
                <DrawerTitle>Create New Order</DrawerTitle>
                <DrawerDescription>Select a table and add menu items</DrawerDescription>
              </DrawerHeader>
              <div className="flex flex-col px-4 pb-4 overflow-hidden">
                {/* Table Selection */}
                <div className="space-y-2 mb-3">
                  <Label>Table (optional)</Label>
                  <Select value={selectedTableId} onValueChange={setSelectedTableId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Takeaway / No Table" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="takeaway">Takeaway / No Table</SelectItem>
                      {tables.map((table) => (
                        <SelectItem key={table.id} value={table.id}>
                          {table.table_number} ({table.floor?.name || 'Unknown'})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                {/* Search */}
                <div className="space-y-2 mb-3">
                  <Label>Search Menu</Label>
                  <Input
                    placeholder="Search items or categories..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                
                {/* Menu Items List */}
                <ScrollArea className="h-[35vh] border rounded-lg p-2 mb-3">
                  <div className="space-y-2">
                    {filteredMenuItems.length === 0 ? (
                      <p className="text-center text-muted-foreground py-4">No menu items found</p>
                    ) : (
                      filteredMenuItems.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between p-2 bg-card rounded-lg border hover:border-primary/50 cursor-pointer transition-colors"
                          onClick={() => addToCart(item)}
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {renderFoodTypeIcon(item.food_type)}
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{item.name}</p>
                              <p className="text-xs text-muted-foreground">{item.category?.name || 'Uncategorized'}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {item.spice_level && (
                              <div className="flex">
                                {[...Array(SPICE_ICONS[item.spice_level] || 0)].map((_, i) => (
                                  <Flame key={i} className="w-3 h-3 text-destructive" />
                                ))}
                              </div>
                            )}
                            <span className="font-semibold text-sm">₹{item.price}</span>
                            <Button size="icon" variant="ghost" className="h-7 w-7">
                              <Plus className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
                
                {/* Cart Section */}
                <div className="space-y-2 border-t pt-3 pb-16">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Order Items ({cart.length})</Label>
                      <p className="text-sm text-muted-foreground">Total: <span className="font-bold text-foreground">₹{Math.round(cartTotal)}</span></p>
                    </div>
                  </div>
                  {cart.length === 0 ? (
                    <p className="text-center text-muted-foreground py-4 text-sm">No items added yet</p>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setMobileCartOpen(true)}
                        className="shrink-0"
                      >
                        <ShoppingBag className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="gradient"
                        className="flex-1"
                        onClick={handleCreateOrder}
                        disabled={cart.length === 0}
                      >
                        Create Order
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Mobile Cart Sheet */}
              <Drawer open={mobileCartOpen} onOpenChange={setMobileCartOpen}>
                <DrawerContent className="max-h-[85vh]">
                  <DrawerHeader>
                    <DrawerTitle>Order Items ({cart.length})</DrawerTitle>
                  </DrawerHeader>
                  <div className="px-4 pb-4">
                    <ScrollArea className="h-[40vh] mb-4">
                      <div className="space-y-2">
                        {cart.map((item) => (
                          <div key={item.menuItemId} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg gap-2">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              {renderFoodTypeIcon(item.food_type)}
                              <span className="font-medium text-sm truncate">{item.name}</span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                size="icon"
                                variant="outline"
                                className="h-7 w-7"
                                onClick={() => updateCartQuantity(item.menuItemId, -1)}
                              >
                                <Minus className="w-3 h-3" />
                              </Button>
                              <span className="w-6 text-center font-medium text-sm">{item.quantity}</span>
                              <Button
                                size="icon"
                                variant="outline"
                                className="h-7 w-7"
                                onClick={() => updateCartQuantity(item.menuItemId, 1)}
                              >
                                <Plus className="w-3 h-3" />
                              </Button>
                              <span className="w-14 text-right font-semibold text-sm">
                                ₹{item.price * item.quantity}
                              </span>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive"
                                onClick={() => removeFromCart(item.menuItemId)}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                    <div className="space-y-2 mb-4">
                      <Label>Order Notes (optional)</Label>
                      <Textarea
                        placeholder="Special instructions..."
                        value={orderNotes}
                        onChange={(e) => setOrderNotes(e.target.value)}
                        className="h-16"
                      />
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t">
                      <div>
                        <p className="text-sm text-muted-foreground">Total</p>
                        <p className="text-xl font-bold">₹{Math.round(cartTotal)}</p>
                      </div>
                      <Button
                        variant="gradient"
                        onClick={() => {
                          setMobileCartOpen(false);
                          handleCreateOrder();
                        }}
                        disabled={cart.length === 0}
                      >
                        Create Order
                      </Button>
                    </div>
                  </div>
                </DrawerContent>
              </Drawer>
            </DrawerContent>
          </Drawer>
        ) : (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="gradient" onClick={resetForm}>
                <Plus className="w-4 h-4 mr-2" />
                New Order
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh]">
              <DialogHeader>
                <DialogTitle>Create New Order</DialogTitle>
                <DialogDescription>Select a table and add menu items</DialogDescription>
              </DialogHeader>
              <div className="grid md:grid-cols-2 gap-6 mt-4">
                {/* Menu Items */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Table (optional)</Label>
                    <Select value={selectedTableId} onValueChange={setSelectedTableId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Takeaway / No Table" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="takeaway">Takeaway / No Table</SelectItem>
                        {tables.map((table) => (
                          <SelectItem key={table.id} value={table.id}>
                            {table.table_number} ({table.floor?.name || 'Unknown'})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Search Menu</Label>
                    <Input
                      placeholder="Search items or categories..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                  <ScrollArea className="h-[300px] border rounded-lg p-2">
                    <div className="space-y-2">
                      {filteredMenuItems.length === 0 ? (
                        <p className="text-center text-muted-foreground py-4">No menu items found</p>
                      ) : (
                        filteredMenuItems.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between p-3 bg-card rounded-lg border hover:border-primary/50 cursor-pointer transition-colors"
                            onClick={() => addToCart(item)}
                          >
                            <div className="flex items-center gap-3">
                              {renderFoodTypeIcon(item.food_type)}
                              <div>
                                <p className="font-medium">{item.name}</p>
                                <p className="text-xs text-muted-foreground">{item.category?.name || 'Uncategorized'}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {item.spice_level && (
                                <div className="flex">
                                  {[...Array(SPICE_ICONS[item.spice_level] || 0)].map((_, i) => (
                                    <Flame key={i} className="w-3 h-3 text-destructive" />
                                  ))}
                                </div>
                              )}
                              <span className="font-semibold">₹{item.price}</span>
                              <Button size="icon" variant="ghost" className="h-8 w-8">
                                <Plus className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>

                {/* Cart */}
                <div className="space-y-4">
                  <Label>Order Items ({cart.length})</Label>
                  <ScrollArea className="h-[250px] border rounded-lg p-2">
                    {cart.length === 0 ? (
                      <p className="text-center text-muted-foreground py-8">No items added yet</p>
                    ) : (
                      <div className="space-y-2">
                        {cart.map((item) => (
                          <div key={item.menuItemId} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                            <div className="flex items-center gap-2">
                              {renderFoodTypeIcon(item.food_type)}
                              <span className="font-medium">{item.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="icon"
                                variant="outline"
                                className="h-7 w-7"
                                onClick={() => updateCartQuantity(item.menuItemId, -1)}
                              >
                                <Minus className="w-3 h-3" />
                              </Button>
                              <span className="w-8 text-center font-medium">{item.quantity}</span>
                              <Button
                                size="icon"
                                variant="outline"
                                className="h-7 w-7"
                                onClick={() => updateCartQuantity(item.menuItemId, 1)}
                              >
                                <Plus className="w-3 h-3" />
                              </Button>
                              <span className="w-16 text-right font-semibold">
                                ₹{item.price * item.quantity}
                              </span>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive"
                                onClick={() => removeFromCart(item.menuItemId)}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                  <div className="space-y-2">
                    <Label>Order Notes (optional)</Label>
                    <Textarea
                      placeholder="Special instructions..."
                      value={orderNotes}
                      onChange={(e) => setOrderNotes(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t">
                    <div>
                      <p className="text-sm text-muted-foreground">Total</p>
                      <p className="text-2xl font-bold">₹{Math.round(cartTotal)}</p>
                    </div>
                    <Button
                      variant="gradient"
                      size="lg"
                      onClick={handleCreateOrder}
                      disabled={cart.length === 0}
                    >
                      Create Order
                    </Button>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'active' | 'completed')}>
        <TabsList>
          <TabsTrigger value="active">
            Active ({activeOrders.length})
          </TabsTrigger>
          <TabsTrigger value="completed">
            Completed ({completedOrders.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="active" className="mt-4">
          {loading ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="animate-pulse">
                  <CardContent className="p-6">
                    <div className="h-6 bg-muted rounded w-1/2 mb-4" />
                    <div className="h-4 bg-muted rounded w-full mb-2" />
                    <div className="h-4 bg-muted rounded w-3/4" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : activeOrders.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                  <ShoppingBag className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">No Active Orders</h3>
                <p className="text-muted-foreground text-center mb-4">
                  Create a new order to get started
                </p>
                <Button variant="gradient" onClick={() => setDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  New Order
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeOrders.map(renderOrderCard)}
            </div>
          )}
        </TabsContent>
        <TabsContent value="completed" className="mt-4">
          {completedOrders.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <p className="text-muted-foreground">No completed orders yet</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {completedOrders.map(renderOrderCard)}
            </div>
          )}
        </TabsContent>
      </Tabs>
      </div>

      {/* Billing Dialog */}
      <BillingDialog
        open={billingDialogOpen}
        onOpenChange={setBillingDialogOpen}
        order={billingOrder}
        restaurantId={currentRestaurant?.id}
        onPaymentComplete={handlePaymentComplete}
        restaurantName={currentRestaurant?.name}
        restaurantAddress={currentRestaurant?.address}
        restaurantPhone={currentRestaurant?.phone}
        restaurantGstin={currentRestaurant?.gstin}
        restaurantCgstPercentage={currentRestaurant?.cgst_percentage || 0}
        restaurantSgstPercentage={currentRestaurant?.sgst_percentage || 0}
        showQrCode={currentRestaurant?.print_qr_on_bill !== false}
        paymentQrContent={(currentRestaurant as any)?.payment_qr_content}
      />

      {/* Cancel Order Confirmation Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Order?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this order
              {orderToCancel?.table ? ` for ${orderToCancel.table.table_number}` : ''}?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Order</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmCancelOrder}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancel Order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
