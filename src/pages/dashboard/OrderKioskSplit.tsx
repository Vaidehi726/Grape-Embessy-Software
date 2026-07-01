
import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useRestaurant } from '@/contexts/RestaurantContext';
import { offlineQuery, offlineMutate } from '@/services/offlineDataService';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { 
  Users, 
  Plus, 
  Minus, 
  ShoppingCart, 
  X, 
  Leaf, 
  Flame,
  Send,
  Trash2,
  Search,
  Receipt,
  CheckCircle2,
  Clock,
  ChefHat,
  CreditCard,
  Printer,
  Check,
  FileText,
} from 'lucide-react';
import { useThermalPrinter } from '@/hooks/useThermalPrinter';
import { useUSBPrinter } from '@/hooks/useUSBPrinter';
import { TableOccupiedTimer } from '@/components/TableOccupiedTimer';
import { BillingDialog } from '@/components/BillingDialog';
import { getNextBillNumber } from '@/services/dailyBillNumber';

interface Table {
  id: string;
  table_number: string;
  capacity: number;
  is_occupied: boolean;
  floor_id: string;
}

interface Floor {
  id: string;
  name: string;
  floor_number: number;
  tables: Table[];
}

interface MenuCategory {
  id: string;
  name: string;
  is_active: boolean;
}

interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  food_type: 'veg' | 'non_veg' | 'egg';
  spice_level: 'mild' | 'medium' | 'spicy' | 'extra_spicy' | null;
  is_available: boolean;
  category_id: string;
  kitchen_id: string | null;
  shortcut_code?: string | null; // Keyboard shortcut for fast ordering
}

// Unified cart item - simple, no status tracking
interface UnifiedCartItem {
  cartItemId: string;           // Unique ID for this cart item (crypto.randomUUID())
  orderItemId?: string;         // order_items.id (if from database)
  orderId?: string;             // orders.id (if from database)
  menuItem: MenuItem;
  quantity: number;
  unitPrice: number;            // Price at time of order
  notes?: string;
  isNew: boolean;               // true = new item, false = from existing order
  isModified: boolean;          // true = quantity changed from original
  originalQuantity?: number;    // Original quantity (for tracking changes)
}

const FoodTypeIndicator = ({ type }: { type: 'veg' | 'non_veg' | 'egg' }) => {
  const config = {
    veg: { color: 'bg-success', border: 'border-success' },
    non_veg: { color: 'bg-destructive', border: 'border-destructive' },
    egg: { color: 'bg-warning', border: 'border-warning' },
  };
  const { color, border } = config[type];
  
  return (
    <div className={`w-4 h-4 border-2 ${border} rounded flex items-center justify-center`}>
      <div className={`w-2 h-2 rounded-full ${color}`} />
    </div>
  );
};

const SpiceLevelIndicator = ({ level }: { level: 'mild' | 'medium' | 'spicy' | 'extra_spicy' | null }) => {
  if (!level) return null;
  
  const flames = { mild: 1, medium: 2, spicy: 3, extra_spicy: 4 }[level];
  
  return (
    <div className="flex items-center">
      {Array.from({ length: flames }).map((_, i) => (
        <Flame key={i} className="w-3 h-3 text-orange-500 fill-orange-500" />
      ))}
    </div>
  );
};

export default function OrderKioskSplit() {
  const { currentRestaurant } = useRestaurant();
  const [floors, setFloors] = useState<Floor[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFloorId, setSelectedFloorId] = useState<string>('');
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  
  // Unified cart - single list for all items (new + existing)
  const [unifiedCart, setUnifiedCart] = useState<UnifiedCartItem[]>([]);
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [submitting, setSubmitting] = useState(false);
  const [showBillDialog, setShowBillDialog] = useState(false);
  const [billingOrder, setBillingOrder] = useState<any>(null);
  const [cancelDialogItem, setCancelDialogItem] = useState<{ item: UnifiedCartItem; orderId: string; itemId: string } | null>(null);
  const [cancellingItem, setCancellingItem] = useState(false);
  const [tableOccupationTimes, setTableOccupationTimes] = useState<Record<string, string>>({});
  const [tableSearchQuery, setTableSearchQuery] = useState('');
  const [billNumberSearch, setBillNumberSearch] = useState('');
  const [hasAutoSelected, setHasAutoSelected] = useState(false); // Track if auto-selection happened for current search
  
  // Refs for search inputs
  const tableSearchRef = useRef<HTMLInputElement>(null);
  const menuSearchRef = useRef<HTMLInputElement>(null);
  
  // Ref for handleTableClick to avoid dependency issues
  const handleTableClickRef = useRef<((table: Table) => void) | null>(null);
  
  const { printBill: printThermal } = useThermalPrinter();
  const { printBill: printUSB } = useUSBPrinter();

  const fetchData = async () => {
    if (!currentRestaurant) return;

    try {
      const [floorsRes, categoriesRes] = await Promise.all([
        offlineQuery(
          async () => {
            const res = await supabase
              .from('floors')
              .select('*, tables(*)')
              .eq('restaurant_id', currentRestaurant.id)
              .order('floor_number', { ascending: true });
            return res;
          },
          { table: 'floors', filters: { restaurant_id: currentRestaurant.id } }
        ),
        offlineQuery(
          async () => {
            const res = await supabase
              .from('menu_categories')
              .select('id, name, is_active')
              .eq('restaurant_id', currentRestaurant.id)
              .eq('is_active', true)
              .order('sort_order', { ascending: true });
            return res;
          },
          { table: 'menu_categories', filters: { restaurant_id: currentRestaurant.id, is_active: 1 } }
        ),
      ]);

      if (floorsRes.error && !floorsRes.fromCache) throw floorsRes.error;
      if (categoriesRes.error && !categoriesRes.fromCache) throw categoriesRes.error;

      let floorsData: Floor[] = [];
      if (floorsRes.fromCache) {
        const rawFloors = (floorsRes.data || []) as any[];
        // Use localQuery which is LAN-aware
        const { localQuery } = await import('@/services/localDataService');
        for (const floor of rawFloors) {
          const tablesResult = await localQuery('tables', { floor_id: floor.id });
          floorsData.push({ ...floor, tables: tablesResult.data || [] });
        }
      } else {
        floorsData = (floorsRes.data || []) as Floor[];
      }

      // Fix: Update is_occupied based on actual active orders in database
      const db = (window as any).electronAPI?.db;
      if (db) {
        const ordersRes = await db.query('orders', {});
        const activeOrders = (ordersRes.data || []).filter((order: any) => 
          ['pending', 'cooking', 'ready'].includes(order.status)
        );
        
        // Create a map of table_id -> has active orders
        const tablesWithOrders = new Set<string>();
        activeOrders.forEach((order: any) => {
          if (order.table_id) {
            tablesWithOrders.add(order.table_id);
          }
        });
        
        // Update is_occupied flag for all tables based on actual orders
        floorsData = floorsData.map(floor => ({
          ...floor,
          tables: floor.tables.map(table => ({
            ...table,
            is_occupied: tablesWithOrders.has(table.id)
          }))
        }));
      }

      setFloors(floorsData);
      setCategories((categoriesRes.data || []) as MenuCategory[]);
      
      if (floorsData.length > 0 && !selectedFloorId) {
        setSelectedFloorId(floorsData[0].id);
      }

      // Fetch occupation times for occupied tables
      const occupiedTableIds = floorsData
        ?.flatMap(f => f.tables)
        ?.filter(t => t.is_occupied)
        ?.map(t => t.id) || [];

      if (occupiedTableIds.length > 0) {
        try {
          const { data: ordersData } = await supabase
            .from('orders')
            .select('table_id, created_at')
            .in('table_id', occupiedTableIds)
            .in('status', ['pending', 'cooking', 'ready'])
            .order('created_at', { ascending: true });

          if (ordersData) {
            const times: Record<string, string> = {};
            ordersData.forEach(order => {
              if (!times[order.table_id]) {
                times[order.table_id] = order.created_at;
              }
            });
            setTableOccupationTimes(times);
          }
        } catch {
          // Offline - skip occupation times
        }
      }

      // Fetch menu items
      const catData = (categoriesRes.data || []) as MenuCategory[];
      if (catData.length > 0) {
        const categoryIds = catData.map(c => c.id);
        const itemsResult = await offlineQuery(
          async () => {
            const res = await supabase
              .from('menu_items')
              .select('*')
              .in('category_id', categoryIds)
              .eq('is_available', true);
            return res;
          },
          { table: 'menu_items' }
        );

        if (!itemsResult.error || itemsResult.fromCache) {
          let items = (itemsResult.data || []) as MenuItem[];
          if (itemsResult.fromCache) {
            items = items.filter(i => i.is_available && categoryIds.includes(i.category_id));
          }
          setMenuItems(items);
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchActiveOrder = async (tableId: string) => {
    try {
      const result = await offlineQuery(
        async () => {
          const res = await supabase
            .from('orders')
            .select(`
              id, status, total_amount, bill_number, created_at,
              order_items (id, menu_item_id, quantity, unit_price, status)
            `)
            .eq('table_id', tableId)
            .in('status', ['pending', 'cooking', 'ready'])
            .order('created_at', { ascending: true });
          return res;
        },
        { table: 'orders', filters: { table_id: tableId } }
      );

      if (result.error && !result.fromCache) throw result.error;
      const data = result.data as any[];
      
      if (data && data.length > 0) {
        console.log('[fetchActiveOrder] Orders from DB/cache:', data);
        console.log('[fetchActiveOrder] First order bill_number:', data[0]?.bill_number);
        console.log('[fetchActiveOrder] First order object keys:', Object.keys(data[0]));
        
        if (result.fromCache) {
          // Use localQuery which is LAN-aware
          const { localQuery } = await import('@/services/localDataService');
          const allItems: any[] = [];
          const cartItems: CartItem[] = [];
          let totalAmount = 0;
          for (const order of data) {
            if (!['pending', 'cooking', 'ready'].includes(order.status)) continue;
            totalAmount += order.total_amount || 0;
            const itemsRes = await localQuery('order_items', { order_id: order.id });
            for (const item of (itemsRes.data || [])) {
              if (item.status === 'served' || item.status === 'cancelled') continue;
              const menuItem = menuItems.find(m => m.id === item.menu_item_id);
              if (menuItem) {
                // Consolidate items by menuItem.id + status for allItems
                const existingItem = allItems.find(i => i.menu_item_id === item.menu_item_id && i.status === item.status);
                if (existingItem) {
                  existingItem.quantity += item.quantity;
                } else {
                  allItems.push({ ...item, menu_item: menuItem, order_id: order.id });
                }
                
                // Consolidate items for cart
                const existingCartItem = cartItems.find(c => c.menuItem.id === menuItem.id && c.status === item.status);
                if (existingCartItem) {
                  existingCartItem.quantity += item.quantity;
                } else {
                  cartItems.push({ menuItem, quantity: item.quantity, status: item.status });
                }
              }
            }
          }
          const activeOrders = data.filter(o => ['pending', 'cooking', 'ready'].includes(o.status));
          if (activeOrders.length > 0) {
            console.log('[fetchActiveOrder] Setting activeOrder with bill_number:', activeOrders[0]?.bill_number);
            setActiveOrder({ ...activeOrders[0], items: allItems, total_amount: totalAmount });
            setCart(cartItems);
          } else {
            setActiveOrder(null);
            setCart([]);
          }
        } else {
          const allItems: any[] = [];
          const cartItems: CartItem[] = [];
          let totalAmount = 0;
          for (const order of data) {
            totalAmount += order.total_amount;
            for (const item of order.order_items) {
              if (item.status === 'served' || item.status === 'cancelled') continue;
              const menuItem = menuItems.find(m => m.id === item.menu_item_id);
              if (menuItem) {
                // Consolidate items by menuItem.id + status for allItems
                const existingItem = allItems.find(i => i.menu_item_id === item.menu_item_id && i.status === item.status);
                if (existingItem) {
                  existingItem.quantity += item.quantity;
                } else {
                  allItems.push({ ...item, menu_item: menuItem, order_id: order.id });
                }
                
                // Consolidate items for cart
                const existingCartItem = cartItems.find(c => c.menuItem.id === menuItem.id && c.status === item.status);
                if (existingCartItem) {
                  existingCartItem.quantity += item.quantity;
                } else {
                  cartItems.push({ menuItem, quantity: item.quantity, status: item.status });
                }
              }
            }
          }
          console.log('[fetchActiveOrder] (Supabase) Setting activeOrder with bill_number:', data[0]?.bill_number);
          setActiveOrder({ ...data[0], items: allItems, total_amount: totalAmount });
          setCart(cartItems);
        }
      } else {
        setActiveOrder(null);
      }
    } catch (error) {
      console.error('Error fetching active order:', error);
    }
  };

  // Reload both cart and activeOrder from database (for after quantity updates)
  const reloadTableData = async (tableId: string) => {
    try {
      const result = await offlineQuery(
        async () => {
          const res = await supabase
            .from('orders')
            .select(`
              id, status, total_amount, bill_number, created_at,
              order_items (id, menu_item_id, quantity, unit_price, status)
            `)
            .eq('table_id', tableId)
            .in('status', ['pending', 'cooking', 'ready'])
            .order('created_at', { ascending: true });
          return res;
        },
        { table: 'orders', filters: { table_id: tableId } }
      );

      const data = result.data as any[];
      
      if (data && data.length > 0) {
        const cartItems: CartItem[] = [];
        const allItems: any[] = [];
        let totalAmount = 0;

        if (result.fromCache) {
          const { localQuery } = await import('@/services/localDataService');
          for (const order of data) {
            if (!['pending', 'cooking', 'ready'].includes(order.status)) continue;
            totalAmount += order.total_amount || 0;
            const itemsRes = await localQuery('order_items', { order_id: order.id });
            for (const orderItem of (itemsRes.data || [])) {
              if (orderItem.status === 'served' || orderItem.status === 'cancelled') continue;
              const menuItem = menuItems.find(m => m.id === orderItem.menu_item_id);
              if (menuItem) {
                // Consolidate items by menuItem.id + status
                const existingCartItem = cartItems.find(c => c.menuItem.id === menuItem.id && c.status === orderItem.status);
                if (existingCartItem) { 
                  existingCartItem.quantity += orderItem.quantity; 
                } else { 
                  cartItems.push({ menuItem, quantity: orderItem.quantity, status: orderItem.status }); 
                }
                allItems.push({ ...orderItem, menu_item: menuItem, order_id: order.id });
              }
            }
          }
        } else {
          for (const order of data) {
            totalAmount += order.total_amount;
            for (const orderItem of order.order_items) {
              if (orderItem.status === 'served' || orderItem.status === 'cancelled') continue;
              const menuItem = menuItems.find(m => m.id === orderItem.menu_item_id);
              if (menuItem) {
                // Consolidate items by menuItem.id + status
                const existingCartItem = cartItems.find(c => c.menuItem.id === menuItem.id && c.status === orderItem.status);
                if (existingCartItem) { 
                  existingCartItem.quantity += orderItem.quantity; 
                } else { 
                  cartItems.push({ menuItem, quantity: orderItem.quantity, status: orderItem.status }); 
                }
                allItems.push({ ...orderItem, menu_item: menuItem, order_id: order.id });
              }
            }
          }
        }
        
        // Update both cart and activeOrder
        setCart(cartItems);
        const activeOrders = result.fromCache ? data.filter((o: any) => ['pending', 'cooking', 'ready'].includes(o.status)) : data;
        if (activeOrders.length > 0) {
          setActiveOrder({ ...activeOrders[0], items: allItems, total_amount: totalAmount });
        }
      } else {
        setCart([]);
        setActiveOrder(null);
      }
    } catch (error) {
      console.error('Error reloading table data:', error);
    }
  };

  useEffect(() => {
    fetchData();
  }, [currentRestaurant]);

  // LAN Client Real-time Sync
  useEffect(() => {
    const lan = (window as any).electronAPI?.lan;
    if (!lan) return;

    // Listen for order status changes
    const cleanupOrderStatus = lan.onOrderStatusChanged((_event: any, item: any) => {
      console.log('[OrderKiosk] Order item status changed:', item);
      // Refresh the active order if it's for the selected table
      if (selectedTable) {
        fetchActiveOrder(selectedTable.id);
      }
      // Also refresh all data to update table statuses
      fetchData();
    });

    // Listen for record changes (new orders, etc.)
    const cleanupRecordChange = lan.onRecordChanged((_event: any, data: any) => {
      console.log('[OrderKiosk] Record changed:', data);
      if (data?.table === 'orders' || data?.table === 'order_items') {
        // Refresh active order and table data
        if (selectedTable) {
          fetchActiveOrder(selectedTable.id);
        }
        fetchData();
      }
    });

    // Cleanup listeners on unmount
    return () => {
      cleanupOrderStatus();
      cleanupRecordChange();
    };
  }, [selectedTable, fetchActiveOrder, fetchData]);

  useEffect(() => {
    if (selectedTable && menuItems.length > 0) {
      fetchActiveOrder(selectedTable.id);
    }
  }, [selectedTable, menuItems]);

  // Poll for order updates every 5 seconds (no realtime in local mode)
  useEffect(() => {
    if (!selectedTable || !activeOrder) return;

    const interval = setInterval(() => {
      fetchActiveOrder(selectedTable.id);
    }, 5000);
    return () => clearInterval(interval);
  }, [selectedTable?.id, activeOrder?.id, fetchActiveOrder]);

  // Poll for table status changes every 5 seconds
  useEffect(() => {
    if (!currentRestaurant) return;

    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [currentRestaurant, fetchData]);

  // Auto-select table when search filters to single result
  useEffect(() => {
    if (!tableSearchQuery || !floors.length) return;
    
    // Count how many tables match the search
    let matchingTables: Table[] = [];
    for (const floor of floors) {
      for (const table of floor.tables) {
        if (
          table.table_number.toLowerCase().includes(tableSearchQuery.toLowerCase()) ||
          floor.name.toLowerCase().includes(tableSearchQuery.toLowerCase())
        ) {
          matchingTables.push(table);
        }
      }
    }
    
    // If exactly one table matches and we haven't auto-selected yet for this search
    if (matchingTables.length === 1 && !hasAutoSelected && handleTableClickRef.current) {
      const singleTable = matchingTables[0];
      console.log('[OrderKiosk] Auto-selecting table:', singleTable.table_number);
      handleTableClickRef.current(singleTable);
      setHasAutoSelected(true);
    }
    
    // Reset auto-selection flag when search query changes
    if (matchingTables.length !== 1) {
      setHasAutoSelected(false);
    }
  }, [tableSearchQuery, floors, hasAutoSelected]);

  // Dedicated bill number search - auto-select table when bill number matches
  const lastBillSearchRef = useRef<string>('');
  
  useEffect(() => {
    if (!billNumberSearch || !floors.length) return;
    
    // Only search if input is numeric
    if (/^[0-9]+$/.test(billNumberSearch.trim())) {
      // Only search if the bill number has actually changed
      if (billNumberSearch.trim() === lastBillSearchRef.current) return;
      
      const db = (window as any).electronAPI?.db;
      if (db) {
        db.query('orders', {}).then((result: any) => {
          const orders = result.data || [];
          // Find order with exact matching bill number
          const matchingOrder = orders.find((order: any) => 
            String(order.bill_number) === billNumberSearch.trim() &&
            ['pending', 'cooking', 'ready', 'served'].includes(order.status)
          );
          
          if (matchingOrder && matchingOrder.table_id) {
            // Find the table with this order
            for (const floor of floors) {
              const table = floor.tables.find(t => t.id === matchingOrder.table_id);
              if (table && handleTableClickRef.current) {
                console.log('[OrderKiosk] Auto-selecting table by bill number:', table.table_number, 'Bill #:', matchingOrder.bill_number);
                handleTableClickRef.current(table);
                toast.success(`Found table for Bill #${String(matchingOrder.bill_number).padStart(3, '0')}`);
                // Mark this bill number as searched
                lastBillSearchRef.current = billNumberSearch.trim();
                break;
              }
            }
          }
        }).catch(err => {
          console.error('[OrderKiosk] Error searching by bill number:', err);
        });
      }
    }
  }, [billNumberSearch, floors]);

  // Track if menu search has exactly one result
  const [singleMenuItem, setSingleMenuItem] = useState<MenuItem | null>(null);
  
  useEffect(() => {
    if (!searchQuery || !menuItems.length) {
      setSingleMenuItem(null);
      return;
    }
    
    // Filter items by search query
    let matchingItems = menuItems;
    if (selectedCategoryId !== 'all') {
      matchingItems = matchingItems.filter(item => item.category_id === selectedCategoryId);
    }
    
    const query = searchQuery.toLowerCase();
    matchingItems = matchingItems.filter(item => 
      item.name.toLowerCase().includes(query) ||
      item.description?.toLowerCase().includes(query) ||
      item.shortcut_code?.includes(query)
    );
    
    // If exactly one item matches, store it for +/- keyboard shortcuts
    if (matchingItems.length === 1) {
      setSingleMenuItem(matchingItems[0]);
    } else {
      setSingleMenuItem(null);
    }
  }, [searchQuery, menuItems, selectedCategoryId]);

  const handleTableClick = async (table: Table) => {
    // If clicking a different table and current table has no active order or cart items, allow switch
    // If current table has unsaved cart items, warn user
    if (selectedTable && selectedTable.id !== table.id) {
      const hasUnsavedItems = cart.some(item => !item.status);
      const hasActiveOrderForCurrentTable = activeOrder !== null;
      
      // Only block if there are unsaved items AND no active order (items would be lost)
      if (hasUnsavedItems && !hasActiveOrderForCurrentTable) {
        toast.warning('You have unsaved items in cart. Please send to kitchen or clear cart first.');
        return;
      }
    }
    
    setSelectedTable(table);
    setCart([]);
    setActiveOrder(null);
    
    // Always fetch any existing orders for this table
    try {
      const result = await offlineQuery(
        async () => {
          const res = await supabase
            .from('orders')
            .select(`
              id, status, total_amount, created_at,
              order_items (id, menu_item_id, quantity, unit_price, status)
            `)
            .eq('table_id', table.id)
            .in('status', ['pending', 'cooking', 'ready'])
            .order('created_at', { ascending: true });
          return res;
        },
        { table: 'orders', filters: { table_id: table.id } }
      );

      const data = result.data as any[];
      if (data && data.length > 0) {
        // Table has active orders - load them
        const cartItems: CartItem[] = [];
        const allItems: any[] = [];
        let totalAmount = 0;

        if (result.fromCache) {
          // Use localQuery which is LAN-aware
          const { localQuery } = await import('@/services/localDataService');
          for (const order of data) {
            if (!['pending', 'cooking', 'ready'].includes(order.status)) continue;
            totalAmount += order.total_amount || 0;
            const itemsRes = await localQuery('order_items', { order_id: order.id });
            for (const orderItem of (itemsRes.data || [])) {
              if (orderItem.status === 'served' || orderItem.status === 'cancelled') continue;
              const menuItem = menuItems.find(m => m.id === orderItem.menu_item_id);
              if (menuItem) {
                const existingCartItem = cartItems.find(c => c.menuItem.id === menuItem.id && c.status === orderItem.status);
                if (existingCartItem) { existingCartItem.quantity += orderItem.quantity; }
                else { cartItems.push({ menuItem, quantity: orderItem.quantity, status: orderItem.status }); }
                allItems.push({ ...orderItem, menu_item: menuItem, order_id: order.id });
              }
            }
          }
        } else {
          for (const order of data) {
            totalAmount += order.total_amount;
            for (const orderItem of order.order_items) {
              if (orderItem.status === 'served') continue;
              const menuItem = menuItems.find(m => m.id === orderItem.menu_item_id);
              if (menuItem) {
                const existingCartItem = cartItems.find(c => c.menuItem.id === menuItem.id && c.status === orderItem.status);
                if (existingCartItem) { existingCartItem.quantity += orderItem.quantity; }
                else { cartItems.push({ menuItem, quantity: orderItem.quantity, status: orderItem.status }); }
                allItems.push({ ...orderItem, menu_item: menuItem, order_id: order.id });
              }
            }
          }
        }
        console.log('[handleTableClick] Cart items after consolidation:', cartItems.map(i => `${i.menuItem.name} x${i.quantity} (${i.status})`));
        setCart(cartItems);
        const activeOrders = result.fromCache ? data.filter((o: any) => ['pending', 'cooking', 'ready'].includes(o.status)) : data;
        if (activeOrders.length > 0) {
          setActiveOrder({ ...activeOrders[0], items: allItems, total_amount: totalAmount });
        }
      }
      // If no active orders, table stays available (is_occupied remains false)
    } catch (error) {
      console.error('Error fetching existing order:', error);
    }
  };
  
  // Store handleTableClick in ref
  handleTableClickRef.current = handleTableClick;

  // Simplified addToCart - just increment quantity or add new item
  const addToCart = (menuItem: MenuItem) => {
    setUnifiedCart(prev => {
      // Find existing item (whether new or from database)
      const existingItem = prev.find(
        item => item.menuItem.id === menuItem.id
      );
      
      if (existingItem) {
        // Update quantity - mark as modified if from database
        return prev.map(item =>
          item.menuItem.id === menuItem.id
            ? {
                ...item,
                quantity: item.quantity + 1,
                isModified: true
              }
            : item
        );
      }
      
      // Add new item
      return [...prev, {
        cartItemId: crypto.randomUUID(),
        menuItem,
        quantity: 1,
        unitPrice: menuItem.price,
        isNew: true,
        isModified: false
      }];
    });
  };

  // Simplified updateQuantity - just change quantity, no database calls
  const updateQuantity = (cartItemId: string, delta: number) => {
    setUnifiedCart(prev =>
      prev
        .map(item => {
          if (item.cartItemId === cartItemId) {
            const newQuantity = item.quantity + delta;
            
            // Remove if quantity <= 0
            if (newQuantity <= 0) {
              return null;
            }
            
            return {
              ...item,
              quantity: newQuantity,
              isModified: true
            };
          }
          return item;
        })
        .filter(Boolean) as UnifiedCartItem[]
    );
  };

  // Remove item from cart
  const removeFromCart = (cartItemId: string) => {
    setUnifiedCart(prev => prev.filter(item => item.cartItemId !== cartItemId));
  };

  // Simple total calculation
  const totalAmount = useMemo(() => {
    return unifiedCart.reduce((sum, item) => {
      return sum + (item.unitPrice * item.quantity);
    }, 0);
  }, [unifiedCart]);

  // Keyboard shortcuts - must be after addToCart
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input/textarea
      const target = e.target as HTMLElement;
      const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      
      // Ctrl+K or Cmd+K: Focus menu search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        console.log('[OrderKiosk] Ctrl+K detected');
        e.preventDefault();
        menuSearchRef.current?.focus();
        menuSearchRef.current?.select();
        return;
      }
      
      // Ctrl+T or Cmd+T: Focus table search
      if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        console.log('[OrderKiosk] Ctrl+T detected');
        e.preventDefault();
        tableSearchRef.current?.focus();
        tableSearchRef.current?.select();
        return;
      }
      
      // / : Focus menu search (only if not in input field)
      if (e.key === '/' && !isInputField) {
        e.preventDefault();
        menuSearchRef.current?.focus();
        return;
      }
      
      // Escape: Clear search or deselect table
      if (e.key === 'Escape') {
        if (searchQuery) {
          setSearchQuery('');
          menuSearchRef.current?.blur(); // Remove focus from search bar
        } else if (tableSearchQuery) {
          setTableSearchQuery('');
          tableSearchRef.current?.blur(); // Remove focus from table search
        }
        return;
      }
      
      // +/- keys: Add/remove single matched menu item (when typing in search)
      if (isInputField && singleMenuItem && selectedTable) {
        if (e.key === '+' || e.key === '=' || e.key === 'ArrowUp') {
          e.preventDefault();
          addToCart(singleMenuItem);
          toast.success(`Added: ${singleMenuItem.name}`, { duration: 800 });
          return;
        }
        if (e.key === '-' || e.key === '_' || e.key === 'ArrowDown') {
          e.preventDefault();
          const cartItem = cart.find(item => item.menuItem.id === singleMenuItem.id && !item.status);
          if (cartItem) {
            updateQuantity(singleMenuItem.id, -1);
            toast.success(`Removed: ${singleMenuItem.name}`, { duration: 800 });
          }
          return;
        }
      }
      
      // Number keys (1-9): Add menu item by shortcut code (only when NOT in input field)
      if (!isInputField && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const key = e.key;
        if (/^[1-9]$/.test(key)) {
          // Find menu item with matching shortcut_code (single-digit quick access)
          const targetItem = menuItems.find(item => item.shortcut_code === key);
          if (targetItem && selectedTable) {
            e.preventDefault();
            addToCart(targetItem);
            toast.success(`Added: ${targetItem.name}`, { duration: 1000 });
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [menuItems, searchQuery, tableSearchQuery, selectedTable, addToCart, singleMenuItem, cart]);

  const removeFromCart = (menuItemId: string) => {
    setCart(prev => prev.filter(item => !(item.menuItem.id === menuItemId && !item.status)));
  };

  const cancelOrderItem = async (orderId: string, itemId: string, menuItemId: string, currentQuantity: number, reduceBy?: number) => {
    setCancellingItem(true);
    try {
      if (reduceBy && reduceBy < currentQuantity) {
        const newQuantity = currentQuantity - reduceBy;
        
        // Get order_id and unit_price from the order item
        const orderItemId = itemId;
        const orderItemData = activeOrder?.items.find(i => i.id === orderItemId);
        const orderIdForUpdate = orderItemData?.order_id || activeOrder?.id;
        const unitPrice = orderItemData?.unit_price || cart.find(i => i.menuItem.id === menuItemId)?.menuItem.price || 0;
        
        console.log('[cancelOrderItem] Updating order_item:', {
          id: orderItemId,
          order_id: orderIdForUpdate,
          unit_price: unitPrice,
          quantity: newQuantity
        });
        
        await offlineMutate(
          'order_items',
          { id: orderItemId, order_id: orderIdForUpdate, unit_price: unitPrice, quantity: newQuantity },
          async () => {
            const res = await supabase.from('order_items').update({ quantity: newQuantity }).eq('id', orderItemId).select().single();
            return res;
          }
        );
        
        // Get the status of the item being modified
        const itemStatus = cart.find(i => i.menuItem.id === menuItemId && i.status)?.status;
        
        // Update cart - consolidate by menuItem.id + status
        setCart(prev => {
          if (!itemStatus) return prev;
          
          // First, remove all items for this menuItem with this status
          const filtered = prev.filter(i => !(i.menuItem.id === menuItemId && i.status === itemStatus));
          
          // Then add back the consolidated quantity
          const menuItem = prev.find(i => i.menuItem.id === menuItemId && i.status === itemStatus)?.menuItem;
          if (menuItem) {
            filtered.push({ menuItem, quantity: newQuantity, status: itemStatus });
          }
          
          return filtered;
        });
        
        // Update activeOrder - consolidate items by menu_item_id + status
        setActiveOrder(prev => {
          if (!prev || !itemStatus) return null;
          
          // Remove all items for this menuItem with this status
          const remainingItems = prev.items.filter(
            i => !(i.menu_item_id === menuItemId && i.status === itemStatus)
          );
          
          // Add back consolidated item
          const menuItem = prev.items.find(i => i.menu_item_id === menuItemId)?.menu_item;
          if (menuItem) {
            remainingItems.push({
              id: itemId,
              menu_item_id: menuItemId,
              quantity: newQuantity,
              unit_price: menuItem.price,
              status: itemStatus,
              menu_item: menuItem
            });
          }
          
          const newTotal = remainingItems.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);
          return { ...prev, items: remainingItems, total_amount: newTotal };
        });
        
        toast.success('Item quantity updated');
      } else {
        await offlineMutate(
          'order_items',
          { id: itemId, status: 'cancelled' },
          async () => {
            const res = await supabase.from('order_items').update({ status: 'cancelled' }).eq('id', itemId).select().single();
            return res;
          }
        );
        
        setCart(prev => prev.filter(item => !(item.menuItem.id === menuItemId && item.status)));
        
        setActiveOrder(prev => {
          if (!prev) return null;
          const updatedItems = prev.items.filter(item => item.id !== itemId);
          const newTotal = updatedItems.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);
          return { ...prev, items: updatedItems, total_amount: newTotal };
        });
        
        toast.success('Item cancelled');
      }
      
      setCancelDialogItem(null);
    } catch (error: any) {
      toast.error(error.message || 'Failed to cancel item');
    } finally {
      setCancellingItem(false);
    }
  };

  const findOrderItemId = (menuItemId: string, status: string): { orderId: string; itemId: string } | null => {
    if (!activeOrder) return null;
    const orderItem = activeOrder.items.find(
      item => item.menu_item_id === menuItemId && item.status === status
    );
    if (orderItem) {
      return { orderId: (orderItem as any).order_id || activeOrder.id, itemId: orderItem.id };
    }
    return null;
  };

  const updateQuantity = async (menuItemId: string, delta: number) => {
    const item = cart.find(i => i.menuItem.id === menuItemId && i.status === 'pending');
    
    // For items with status, save to database first
    if (item && activeOrder) {
      const currentQty = item.quantity;
      const newQty = currentQty + delta;
      
      if (newQty <= 0) {
        // Cancel ALL pending order items for this menu item
        const orderItems = activeOrder.items.filter(
          oi => oi.menu_item_id === menuItemId && oi.status === 'pending'
        );
        
        for (const orderItem of orderItems) {
          await offlineMutate(
            'order_items',
            { id: orderItem.id, status: 'cancelled' },
            async () => {
              const res = await supabase.from('order_items').update({ status: 'cancelled' }).eq('id', orderItem.id).select().single();
              return res;
            }
          );
        }
        
        // Remove from cart and activeOrder
        setCart(prev => prev.filter(i => !(i.menuItem.id === menuItemId && i.status === 'pending')));
        setActiveOrder(prev => {
          if (!prev) return null;
          const updatedItems = prev.items.filter(
            i => !(i.menu_item_id === menuItemId && i.status === 'pending')
          );
          const newTotal = updatedItems.reduce((sum, i) => sum + (i.unit_price * i.quantity), 0);
          return { ...prev, items: updatedItems, total_amount: newTotal };
        });
        toast.success('Item removed');
      } else if (delta < 0) {
        // Reducing quantity - cancel from first available order item
        const reduceBy = Math.abs(delta);
        let remainingToCancel = reduceBy;
        
        const orderItems = activeOrder.items.filter(
          oi => oi.menu_item_id === menuItemId && oi.status === 'pending'
        );
        
        // Track which order items we modified
        const modifiedOrderItemIds: string[] = [];
        
        for (const orderItem of orderItems) {
          if (remainingToCancel <= 0) break;
          
          if (orderItem.quantity <= remainingToCancel) {
            // Cancel entire order item
            await offlineMutate(
              'order_items',
              { id: orderItem.id, status: 'cancelled' },
              async () => {
                const res = await supabase.from('order_items').update({ status: 'cancelled' }).eq('id', orderItem.id).select().single();
                return res;
              }
            );
            modifiedOrderItemIds.push(orderItem.id);
            remainingToCancel -= orderItem.quantity;
          } else {
            // Partial reduction
            const newOrderQty = orderItem.quantity - remainingToCancel;
            const unitPrice = orderItem.unit_price || (orderItem as any).menu_item?.price || 0;
            
            await offlineMutate(
              'order_items',
              { id: orderItem.id, order_id: (orderItem as any).order_id || activeOrder.id, unit_price: unitPrice, quantity: newOrderQty },
              async () => {
                const res = await supabase.from('order_items').update({ quantity: newOrderQty }).eq('id', orderItem.id).select().single();
                return res;
              }
            );
            modifiedOrderItemIds.push(orderItem.id);
            remainingToCancel = 0;
          }
        }
        
        // Update cart - consolidate by menuItem.id + status
        setCart(prev => {
          // First, remove all pending items for this menuItem
          const filtered = prev.filter(i => !(i.menuItem.id === menuItemId && i.status === 'pending'));
          
          // Then add back the consolidated quantity if > 0
          if (newQty > 0) {
            const existingItem = filtered.find(i => i.menuItem.id === menuItemId && i.status === 'pending');
            if (existingItem) {
              existingItem.quantity = newQty;
            } else {
              const menuItem = prev.find(i => i.menuItem.id === menuItemId)?.menuItem;
              if (menuItem) {
                filtered.push({ menuItem, quantity: newQty, status: 'pending' });
              }
            }
          }
          
          return filtered;
        });
        
        // Update activeOrder - consolidate items by menu_item_id + status
        setActiveOrder(prev => {
          if (!prev) return null;
          
          // Remove all pending items for this menuItem
          const remainingItems = prev.items.filter(
            i => !(i.menu_item_id === menuItemId && i.status === 'pending')
          );
          
          // Add back consolidated item if quantity > 0
          if (newQty > 0) {
            const menuItem = prev.items.find(i => i.menu_item_id === menuItemId)?.menu_item;
            if (menuItem) {
              remainingItems.push({
                id: prev.items.find(i => i.menu_item_id === menuItemId && i.status === 'pending')?.id || '',
                menu_item_id: menuItemId,
                quantity: newQty,
                unit_price: menuItem.price,
                status: 'pending',
                menu_item: menuItem
              });
            }
          }
          
          const newTotal = remainingItems.reduce((sum, i) => sum + (i.unit_price * i.quantity), 0);
          return { ...prev, items: remainingItems, total_amount: newTotal };
        });
        
        toast.success('Quantity updated');
      }
      
      // DON'T reload from database - we already updated states correctly
      // Reloading would overwrite with stale cache data
    } else {
      // For new items (no status), just update cart
      setCart(prev =>
        prev.map(i => {
          if (i.menuItem.id === menuItemId && !i.status) {
            const newQty = i.quantity + delta;
            return newQty > 0 ? { ...i, quantity: newQty } : i;
          }
          return i;
        }).filter(Boolean)
      );
    }
  };

  const cartTotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0);
  }, [cart]);

  const filteredMenuItems = useMemo(() => {
    let items = menuItems;
    
    if (selectedCategoryId !== 'all') {
      items = items.filter(item => item.category_id === selectedCategoryId);
    }
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      items = items.filter(item => 
        item.name.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query) ||
        item.shortcut_code?.includes(query) // Support searching by shortcut code
      );
    }
    
    return items;
  }, [menuItems, selectedCategoryId, searchQuery]);

  const submitOrder = async () => {
    if (!selectedTable || !currentRestaurant) return;
    
    const newItems = cart.filter(item => !item.status);
    
    if (newItems.length === 0) {
      toast.info('No new items to send to kitchen');
      return;
    }
    
    setSubmitting(true);
    try {
      const newItemsTotal = newItems.reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0);
      
      // Generate daily bill number
      const billNumber = await getNextBillNumber();

      const orderData = {
        id: crypto.randomUUID(),
        restaurant_id: currentRestaurant.id,
        table_id: selectedTable.id,
        total_amount: newItemsTotal,
        status: 'pending' as const,
        bill_number: billNumber,
      };
      
      console.log('[submitOrder] Generated bill number:', billNumber, 'for order:', orderData.id);
      console.log('[submitOrder] Complete orderData:', JSON.stringify(orderData, null, 2));

      const { data: order, error: orderError } = await offlineMutate(
        'orders',
        orderData,
        async () => {
          const res = await supabase
            .from('orders')
            .insert(orderData)
            .select()
            .single();
          return res;
        }
      );

      if (orderError) throw orderError;
      const orderId = order?.id || orderData.id;

      const orderItems = newItems.map(item => ({
        id: crypto.randomUUID(),
        order_id: orderId,
        menu_item_id: item.menuItem.id,
        kitchen_id: item.menuItem.kitchen_id,
        quantity: item.quantity,
        unit_price: item.menuItem.price,
        notes: item.notes || null,
        status: 'pending' as const
      }));

      for (const oi of orderItems) {
        await offlineMutate(
          'order_items',
          oi,
          async () => {
            const res = await supabase.from('order_items').insert(oi).select().single();
            return res;
          }
        );
      }

      toast.success('Order created! Complete payment to finalize.');
      console.log('[submitOrder] Order saved successfully, calling fetchActiveOrder...');
      
      // Mark table as occupied now that it has an active order
      setFloors(floors.map(f => ({
        ...f,
        tables: f.tables.map(t => 
          t.id === selectedTable.id ? { ...t, is_occupied: true } : t
        )
      })));
      
      setCart(prev => prev.filter(item => item.status));
      
      fetchActiveOrder(selectedTable.id);
    } catch (error: any) {
      toast.error(error.message || 'Failed to submit order');
    } finally {
      setSubmitting(false);
    }
  };

  // Enter key shortcut to submit order or open bill dialog - must be after submitOrder
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      const newItems = cart.filter(item => !item.status);
      
      // Enter: Submit order to kitchen (when cart has new items)
      if (e.key === 'Enter' && !isInputField && newItems.length > 0 && selectedTable) {
        e.preventDefault();
        submitOrder();
      }
      // Enter: Open bill dialog (when no new items but active order exists)
      else if (e.key === 'Enter' && !isInputField && newItems.length === 0 && activeOrder && activeOrder.items.length > 0 && selectedTable) {
        e.preventDefault();
        setShowBillDialog(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, selectedTable, submitOrder, activeOrder]);

  const markTableFree = async () => {
    if (!selectedTable) return;
    
    // Check for unsaved cart items
    const hasUnsavedItems = cart.some(item => !item.status);
    if (hasUnsavedItems) {
      toast.warning('You have unsaved items in cart. Please send to kitchen first.');
      return;
    }
    
    try {
      await offlineMutate(
        'tables',
        { id: selectedTable.id, is_occupied: false },
        async () => {
          const res = await supabase.from('tables').update({ is_occupied: false }).eq('id', selectedTable.id).select().single();
          return res;
        }
      );
      
      setFloors(floors.map(f => ({
        ...f,
        tables: f.tables.map(t => 
          t.id === selectedTable.id ? { ...t, is_occupied: false } : t
        )
      })));
      
      setSelectedTable(null);
      setCart([]);
      setActiveOrder(null);
      toast.success('Table marked as available');
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const grandTotal = useMemo(() => {
    // If there's an active order, use its total (already consolidated from database)
    // Otherwise, calculate from cart items
    if (activeOrder) {
      // Add new items (no status) to the active order total
      const newItemsTotal = cart
        .filter(item => !item.status)
        .reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0);
      return activeOrder.total_amount + newItemsTotal;
    }
    return cartTotal;
  }, [activeOrder, cartTotal, cart]);

  const hasNewItems = useMemo(() => {
    return cart.some(item => !item.status);
  }, [cart]);

  const newItemsTotal = useMemo(() => {
    return cart
      .filter(item => !item.status)
      .reduce((sum, item) => sum + (item.menuItem.price * item.quantity), 0);
  }, [cart]);

  const handlePaymentComplete = async (paymentMethod: 'cash' | 'card' | 'upi') => {
    const tableId = billingOrder?.table_id || selectedTable?.id;
    
    if (!tableId) {
      toast.error('No table found');
      return;
    }
    
    const db = (window as any).electronAPI?.db;
    if (db) {
      const ordersRes = await db.query('orders', { table_id: tableId });
      for (const order of (ordersRes.data || [])) {
        if (['pending', 'cooking', 'ready'].includes(order.status)) {
          await offlineMutate('orders', { 
            id: order.id, 
            status: 'served', 
            payment_method: paymentMethod,
            restaurant_id: order.restaurant_id,
            sync_status: 'pending_sync'
          }, async () => {
            const res = await supabase
              .from('orders')
              .update({ status: 'served', payment_method: paymentMethod })
              .eq('id', order.id)
              .select()
              .single();
            return res;
          });
        }
      }
    } else {
      await supabase
        .from('orders')
        .update({ status: 'served', payment_method: paymentMethod })
        .eq('table_id', tableId)
        .in('status', ['pending', 'cooking', 'ready']);
    }

    await offlineMutate(
      'tables',
      { id: tableId, is_occupied: false },
      async () => {
        const res = await supabase.from('tables').update({ is_occupied: false }).eq('id', tableId).select().single();
        return res;
      }
    );

    setFloors(floors.map(f => ({
      ...f,
      tables: f.tables.map(t => 
        t.id === tableId ? { ...t, is_occupied: false } : t
      )
    })));

    setActiveOrder(null);
    setCart([]);
    setSelectedTable(null);

    toast.success(`Payment received via ${paymentMethod.toUpperCase()}`);
    
    setBillingOrder(null);
    setShowBillDialog(false);
  };

  const openTableBilling = async (table: Table, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentRestaurant) return;
    
    try {
      const result = await offlineQuery(
        async () => {
          const res = await supabase
            .from('orders')
            .select(`id, status, total_amount, created_at, order_items (id, menu_item_id, quantity, unit_price, status, menu_item:menu_items(name))`)
            .eq('table_id', table.id)
            .in('status', ['pending', 'cooking', 'ready'])
            .order('created_at', { ascending: true });
          return res;
        },
        { table: 'orders', filters: { table_id: table.id } }
      );

      const data = result.data as any[];
      if (!data || data.length === 0) {
        toast.error('No active orders to bill');
        return;
      }

      const allItems: any[] = [];
      let totalAmount = 0;

      if (result.fromCache) {
        // Use localQuery which is LAN-aware
        const { localQuery } = await import('@/services/localDataService');
        const activeOrders = data.filter((o: any) => ['pending', 'cooking', 'ready'].includes(o.status));
        for (const order of activeOrders) {
          totalAmount += order.total_amount || 0;
          const itemsRes = await localQuery('order_items', { order_id: order.id });
          for (const oi of (itemsRes.data || [])) {
            const mi = menuItems.find(m => m.id === oi.menu_item_id);
            allItems.push({ id: oi.id, menu_item_id: oi.menu_item_id || '', quantity: oi.quantity, unit_price: oi.unit_price, status: oi.status, menu_item: mi ? { name: mi.name } : undefined });
          }
        }
        const billingOrderData = {
          id: activeOrders[0].id,
          table_id: table.id,
          total_amount: totalAmount,
          bill_number: activeOrders[0].bill_number,
          table: { table_number: table.table_number, floor: { name: floors.find(f => f.tables.some(t => t.id === table.id))?.name || '' } },
          order_items: allItems.map(item => ({ id: item.id, menu_item: item.menu_item, quantity: item.quantity, unit_price: item.unit_price }))
        };
        setBillingOrder(billingOrderData);
        setShowBillDialog(true);
      } else {
        for (const order of data) {
          totalAmount += order.total_amount;
          for (const oi of order.order_items) {
            allItems.push({ id: oi.id, menu_item_id: oi.menu_item_id || '', quantity: oi.quantity, unit_price: oi.unit_price, status: oi.status, menu_item: oi.menu_item ? { name: oi.menu_item.name } : undefined });
          }
        }
        const billingOrderData = {
          id: data[0].id,
          table_id: table.id,
          total_amount: totalAmount,
          bill_number: data[0].bill_number,
          table: { table_number: table.table_number, floor: { name: floors.find(f => f.tables.some(t => t.id === table.id))?.name || '' } },
          order_items: allItems.map(item => ({ id: item.id, menu_item: item.menu_item, quantity: item.quantity, unit_price: item.unit_price }))
        };
        setBillingOrder(billingOrderData);
        setShowBillDialog(true);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to open billing');
    }
  };

  const quickMarkAvailable = async (table: Table, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const db = (window as any).electronAPI?.db;
      if (db) {
        const ordersRes = await db.query('orders', { table_id: table.id });
        for (const order of (ordersRes.data || [])) {
          if (['pending', 'cooking', 'ready'].includes(order.status)) {
            await offlineMutate('orders', { 
              id: order.id, 
              status: 'served',
              restaurant_id: order.restaurant_id,
              sync_status: 'pending_sync'
            }, async () => {
              const res = await supabase
                .from('orders')
                .update({ status: 'served' })
                .eq('id', order.id)
                .select()
                .single();
              return res;
            });
          }
        }
      } else {
        await supabase
          .from('orders')
          .update({ status: 'served' })
          .eq('table_id', table.id)
          .in('status', ['pending', 'cooking', 'ready']);
      }

      await offlineMutate(
        'tables',
        { id: table.id, is_occupied: false },
        async () => {
          const res = await supabase.from('tables').update({ is_occupied: false }).eq('id', table.id).select().single();
          return res;
        }
      );

      setFloors(prev => prev.map(f => ({
        ...f,
        tables: f.tables.map(t => t.id === table.id ? { ...t, is_occupied: false } : t)
      })));
      toast.success(`Table ${table.table_number} is now available`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update table');
    }
  };

  if (!currentRestaurant) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-screen bg-background text-center p-4">
          <ShoppingCart className="w-16 h-16 text-muted-foreground mb-4" />
          <h2 className="text-2xl font-semibold">No Restaurant Selected</h2>
          <p className="text-muted-foreground">Please select or create a restaurant first</p>
        </div>
      </DashboardLayout>
    );
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-screen bg-background">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-4rem)] w-full bg-background flex flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b bg-card px-4 py-3 shrink-0">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-shrink">
              <h1 className="text-xl font-bold truncate">{currentRestaurant.name}</h1>
              <p className="text-sm text-muted-foreground">Order Kiosk - Split View</p>
            </div>
            {selectedTable && (
              <Badge variant="outline" className="text-base px-3 py-1.5">
                Table: {selectedTable.table_number}
              </Badge>
            )}
          </div>
        </div>

        {/* 3-Section Layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT: Tables Section */}
          <div className="w-80 border-r bg-card flex flex-col shrink-0">
            <div className="p-3 border-b shrink-0">
              <h2 className="font-semibold mb-2">Tables</h2>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  ref={tableSearchRef}
                  placeholder="Search tables... (Ctrl+T)"
                  value={tableSearchQuery}
                  onChange={(e) => setTableSearchQuery(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
              
              {/* Bill Number Search */}
              <div className="mt-2 relative">
                <FileText className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by Bill #..."
                  value={billNumberSearch}
                  onChange={(e) => setBillNumberSearch(e.target.value.replace(/[^0-9]/g, ''))}
                  className="pl-8 h-9"
                  maxLength={5}
                />
              </div>
            </div>
            
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-4">
                {floors
                  .filter(f => !tableSearchQuery || f.name.toLowerCase().includes(tableSearchQuery.toLowerCase()) || f.tables.some(t => t.table_number.toLowerCase().includes(tableSearchQuery.toLowerCase())))
                  .map((floor) => {
                    const filteredTables = floor.tables
                      .filter(t => !tableSearchQuery || t.table_number.toLowerCase().includes(tableSearchQuery.toLowerCase()))
                      .sort((a, b) => {
                        if (a.is_occupied !== b.is_occupied) return a.is_occupied ? -1 : 1;
                        return a.table_number.localeCompare(b.table_number);
                      });

                    if (filteredTables.length === 0) return null;

                    return (
                      <div key={floor.id}>
                        <div className="flex items-center gap-2 mb-2 px-1">
                          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{floor.name}</h3>
                          <Badge variant="secondary" className="text-xs">
                            {filteredTables.filter(t => t.is_occupied).length}/{filteredTables.length}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {filteredTables.map((table) => (
                            <button
                              key={table.id}
                              onClick={() => handleTableClick(table)}
                              className={`relative rounded-lg p-2 transition-all text-center ${
                                (() => {
                                  const isSelected = selectedTable?.id === table.id;
                                  const hasActiveOrderOrCart = activeOrder || cart.some(item => !item.status);
                                  
                                  // Occupied tables always show red/orange
                                  if (table.is_occupied) {
                                    return isSelected ? 'ring-2 ring-primary bg-primary/10' : 'bg-destructive/10 border border-destructive/30 hover:bg-destructive/20';
                                  }
                                  
                                  // Available tables: only highlight if selected AND has active order or cart items
                                  if (isSelected && hasActiveOrderOrCart) {
                                    return 'ring-2 ring-primary bg-primary/10';
                                  }
                                  
                                  // Available tables without orders/cart stay green
                                  return 'bg-success/10 border border-success/30 hover:bg-success/20';
                                })()
                              }`}
                            >
                              <div className={`absolute top-1 right-1 w-2 h-2 rounded-full ${
                                table.is_occupied ? 'bg-destructive' : 'bg-success'
                              }`} />
                              <div className="font-bold text-lg">{table.table_number}</div>
                              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                                <Users className="w-3 h-3" />
                                {table.capacity}
                              </div>
                              {table.is_occupied && (
                                <div className="flex items-center justify-center gap-1 mt-1">
                                  <div
                                    onClick={(e) => openTableBilling(table, e)}
                                    className="p-1 rounded bg-primary/10 hover:bg-primary/20 text-primary transition-colors cursor-pointer"
                                    title="Generate Bill"
                                  >
                                    <Printer className="w-3 h-3" />
                                  </div>
                                  <div
                                    onClick={(e) => quickMarkAvailable(table, e)}
                                    className="p-1 rounded bg-success/10 hover:bg-success/20 text-success transition-colors cursor-pointer"
                                    title="Mark Available"
                                  >
                                    <Check className="w-3 h-3" />
                                  </div>
                                </div>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </ScrollArea>
          </div>

          {/* MIDDLE: Menu Section */}
          <div className={`flex-1 flex flex-col overflow-hidden min-w-0 transition-all ${selectedTable ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
            {!selectedTable ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <ShoppingCart className="w-16 h-16 mx-auto mb-4 opacity-30" />
                  <p className="text-lg font-medium">Select a table to start ordering</p>
                  <p className="text-sm">Choose a table from the left panel</p>
                </div>
              </div>
            ) : (
              <>
                {/* Search & Categories */}
                <div className="p-3 border-b space-y-2 shrink-0 bg-card">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      ref={menuSearchRef}
                      placeholder="Search menu or type shortcut #... (Ctrl+K or /)"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                    {/* Show +/- hint when single item matches */}
                    {singleMenuItem && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        <Badge variant="secondary" className="text-xs">
                          <kbd className="px-1.5 py-0.5 text-[10px]">+</kbd>
                          <span className="mx-0.5">/</span>
                          <kbd className="px-1.5 py-0.5 text-[10px]">-</kbd>
                        </Badge>
                      </div>
                    )}
                  </div>
                  <div className="w-full overflow-x-auto">
                    <div className="flex gap-2 pb-1 whitespace-nowrap">
                      <Button
                        size="sm"
                        variant={selectedCategoryId === 'all' ? 'default' : 'outline'}
                        onClick={() => setSelectedCategoryId('all')}
                        className="shrink-0 h-8"
                      >
                        All
                      </Button>
                      {categories.map((cat) => (
                        <Button
                          key={cat.id}
                          size="sm"
                          variant={selectedCategoryId === cat.id ? 'default' : 'outline'}
                          onClick={() => setSelectedCategoryId(cat.id)}
                          className="shrink-0 h-8"
                        >
                          {cat.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Menu Items Grid */}
                <ScrollArea className="flex-1 p-3">
                  <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {filteredMenuItems.map((item) => {
                      const existingItem = cart.find(c => c.menuItem.id === item.id && c.status);
                      const newItem = cart.find(c => c.menuItem.id === item.id && !c.status);
                      
                      return (
                        <div
                          key={item.id}
                          className={`bg-card border rounded-lg p-3 cursor-pointer transition-all hover:shadow-md relative ${
                            newItem ? 'ring-2 ring-primary' : existingItem ? 'ring-1 ring-muted-foreground' : ''
                          }`}
                          onClick={() => addToCart(item)}
                        >
                          {/* Shortcut Code Badge */}
                          {item.shortcut_code && (
                            <div className="absolute top-1 right-1 bg-primary text-primary-foreground text-xs font-bold w-6 h-6 rounded flex items-center justify-center">
                              {item.shortcut_code}
                            </div>
                          )}
                          
                          <div className="flex items-start justify-between gap-2">
                            <FoodTypeIndicator type={item.food_type} />
                            <SpiceLevelIndicator level={item.spice_level} />
                          </div>
                          <h3 className="font-semibold mt-2 line-clamp-2 text-sm">{item.name}</h3>
                          {item.description && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                              {item.description}
                            </p>
                          )}
                          <div className="flex items-center justify-between mt-2">
                            <span className="font-bold text-primary text-sm">₹{item.price}</span>
                            <div className="flex items-center gap-1">
                              {existingItem && (
                                <Badge variant="outline" className="text-xs border-muted-foreground text-muted-foreground">
                                  x{existingItem.quantity}
                                </Badge>
                              )}
                              {newItem && (
                                <Badge variant="default" className="text-xs">
                                  +{newItem.quantity}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </>
            )}
          </div>

          {/* RIGHT: Cart Section */}
          {selectedTable && (
            <div className="w-80 border-l bg-card flex flex-col overflow-hidden shrink-0">
              <div className="p-3 border-b flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5" />
                  <span className="font-semibold">Cart</span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => { 
                  if (cart.some(item => !item.status)) {
                    toast.warning('You have unsaved items in cart. Please send to kitchen or clear cart first.');
                    return;
                  }
                  setSelectedTable(null); 
                  setCart([]); 
                  setActiveOrder(null); 
                }}>
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Active Order Items */}
              {activeOrder && activeOrder.items.length > 0 && (
                <div className="p-3 border-b bg-muted/50 shrink-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Receipt className="w-4 h-4" />
                    <span className="text-sm font-medium">Running Order</span>
                    <Badge 
                      variant={activeOrder.status === 'ready' ? 'default' : 'outline'} 
                      className={`text-xs ${
                        activeOrder.status === 'ready' 
                          ? 'bg-success text-success-foreground' 
                          : activeOrder.status === 'cooking'
                          ? 'border-warning text-warning'
                          : ''
                      }`}
                    >
                      {activeOrder.status === 'cooking' && <ChefHat className="w-3 h-3 mr-1" />}
                      {activeOrder.status === 'ready' && <CheckCircle2 className="w-3 h-3 mr-1" />}
                      {activeOrder.status === 'pending' && <Clock className="w-3 h-3 mr-1" />}
                      {activeOrder.status}
                    </Badge>
                  </div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {(() => {
                      // Consolidate items by menu_item_id + status for display
                      const consolidated = new Map<string, { name: string; quantity: number; unit_price: number; status: string }>();
                      
                      activeOrder.items.forEach((item) => {
                        if (item.status === 'cancelled' || item.status === 'served') return;
                        const key = `${item.menu_item_id}-${item.status}`;
                        const name = item.menu_item?.name || 'Item';
                        if (consolidated.has(key)) {
                          const existing = consolidated.get(key)!;
                          existing.quantity += item.quantity;
                        } else {
                          consolidated.set(key, {
                            name,
                            quantity: item.quantity,
                            unit_price: item.unit_price,
                            status: item.status
                          });
                        }
                      });
                      
                      return Array.from(consolidated.values()).map((item, index) => (
                        <div key={index} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            {item.status === 'ready' ? (
                              <CheckCircle2 className="w-4 h-4 text-success" />
                            ) : item.status === 'cooking' ? (
                              <ChefHat className="w-4 h-4 text-warning animate-pulse" />
                            ) : (
                              <Clock className="w-4 h-4 text-muted-foreground" />
                            )}
                            <span className="text-xs truncate max-w-[120px]">{item.name} x{item.quantity}</span>
                          </div>
                          <span className="text-xs">₹{item.unit_price * item.quantity}</span>
                        </div>
                      ));
                    })()}
                  </div>
                  <Separator className="my-2" />
                  <div className="flex justify-between text-sm font-medium">
                    <span>Subtotal</span>
                    <span>₹{activeOrder.total_amount}</span>
                  </div>
                </div>
              )}

              {/* Cart Items */}
              <ScrollArea className="flex-1">
                <div className="p-3 space-y-2">
                  {cart.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <ShoppingCart className="w-10 h-10 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">Tap items to add</p>
                    </div>
                  ) : (
                    <>
                      {/* Existing Order Items - Already consolidated during load */}
                      {cart.filter(item => item.status && item.status !== 'cancelled').length > 0 && (
                        <div className="space-y-2">
                          {cart.filter(item => item.status && item.status !== 'cancelled').map((item) => {
                            const isPending = item.status === 'pending';
                            const isCooking = item.status === 'cooking';
                            
                            return (
                              <div key={`${item.menuItem.id}-${item.status}`} className="flex items-center gap-2 bg-muted/30 border rounded-lg p-2 text-sm">
                                <div className="flex-1 min-w-0">
                                  <Badge 
                                    variant="outline" 
                                    className={`text-xs mb-1 ${
                                      item.status === 'ready' 
                                        ? 'border-success text-success' 
                                        : item.status === 'cooking'
                                        ? 'border-warning text-warning'
                                        : ''
                                    }`}
                                  >
                                    {item.status}
                                  </Badge>
                                  <p className="font-medium truncate text-sm">{item.menuItem.name}</p>
                                  <p className="text-xs text-muted-foreground">₹{item.menuItem.price} each</p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {isPending && (
                                    <>
                                      <Button
                                        size="icon"
                                        variant="outline"
                                        className="h-6 w-6"
                                        disabled={item.quantity <= 1}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          updateQuantity(item.menuItem.id, -1);
                                        }}
                                      >
                                        <Minus className="w-3 h-3" />
                                      </Button>
                                      <span className="w-5 text-center text-xs">{item.quantity}</span>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-6 w-6 text-destructive hover:bg-destructive/10"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          removeFromCart(item.menuItem.id);
                                        }}
                                      >
                                        <X className="w-3 h-3" />
                                      </Button>
                                    </>
                                  )}
                                  {(isCooking || item.status === 'ready') && (
                                    <span className="text-xs">x{item.quantity}</span>
                                  )}
                                  <span className="font-medium text-xs w-12 text-right">₹{item.menuItem.price * item.quantity}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Separator */}
                      {cart.filter(item => item.status && item.status !== 'cancelled').length > 0 && cart.filter(item => !item.status).length > 0 && (
                        <div className="relative py-2">
                          <Separator />
                          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                            New Items
                          </span>
                        </div>
                      )}

                      {/* New Items */}
                      {cart.filter(item => !item.status).length > 0 && (
                        <div className="space-y-2">
                          {cart.filter(item => !item.status).map((item) => (
                            <div key={item.menuItem.id} className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-lg p-2 text-sm">
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">{item.menuItem.name}</p>
                                <p className="text-xs text-muted-foreground">₹{item.menuItem.price} each</p>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-6 w-6"
                                  onClick={(e) => { e.stopPropagation(); updateQuantity(item.menuItem.id, -1); }}
                                >
                                  <Minus className="w-3 h-3" />
                                </Button>
                                <span className="w-5 text-center text-sm font-medium">{item.quantity}</span>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-6 w-6"
                                  onClick={(e) => { e.stopPropagation(); updateQuantity(item.menuItem.id, 1); }}
                                >
                                  <Plus className="w-3 h-3" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-destructive"
                                  onClick={(e) => { e.stopPropagation(); removeFromCart(item.menuItem.id); }}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </ScrollArea>

              {/* Cart Footer */}
              <div className="p-3 border-t space-y-2 shrink-0">
                {hasNewItems && (
                  <>
                    <div className="flex justify-between text-sm font-bold">
                      <span>New Items</span>
                      <span>₹{newItemsTotal}</span>
                    </div>
                    <Button 
                      className="w-full" 
                      size="sm"
                      onClick={submitOrder}
                      disabled={submitting}
                    >
                      <Send className="w-4 h-4 mr-2" />
                      {submitting ? 'Sending...' : 'Send to Kitchen'}
                      <kbd className="ml-2 px-2 py-0.5 text-xs bg-white/20 rounded">Enter</kbd>
                    </Button>
                  </>
                )}
                {activeOrder && activeOrder.items.length > 0 && (
                  <Button 
                    className="w-full bg-success hover:bg-success/90"
                    size="sm"
                    onClick={() => setShowBillDialog(true)}
                  >
                    <CreditCard className="w-4 h-4 mr-2" />
                    Generate Bill (₹{grandTotal})
                    <kbd className="ml-2 px-2 py-0.5 text-xs bg-white/20 rounded">Enter</kbd>
                  </Button>
                )}
                <Button 
                  variant="outline" 
                  className="w-full"
                  size="sm"
                  onClick={markTableFree}
                >
                  Mark Table Available
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Billing Dialog */}
        <BillingDialog
          open={showBillDialog}
          onOpenChange={(open) => {
            setShowBillDialog(open);
            if (!open) {
              setBillingOrder(null);
            }
          }}
          order={billingOrder || (activeOrder && selectedTable ? {
            id: activeOrder.id,
            table_id: selectedTable?.id || null,
            total_amount: grandTotal,
            bill_number: (activeOrder as any).bill_number,
            table: selectedTable ? { 
              table_number: selectedTable.table_number, 
              floor: { 
                name: floors.find(f => f.tables.some(t => t.id === selectedTable.id))?.name || '' 
              } 
            } : undefined,
            order_items: activeOrder.items.map(item => ({
              id: item.id,
              menu_item: item.menu_item ? { name: item.menu_item.name } : undefined,
              quantity: item.quantity,
              unit_price: item.unit_price,
            }))
          } : null)}
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

        {/* Cancel Cooking Item Confirmation Dialog */}
        <AlertDialog open={!!cancelDialogItem} onOpenChange={(open) => !open && setCancelDialogItem(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel Cooking Item?</AlertDialogTitle>
              <AlertDialogDescription>
                {cancelDialogItem && (
                  <>
                    The kitchen has already started cooking <strong>{cancelDialogItem.item.menuItem.name}</strong> (x{cancelDialogItem.item.quantity}).
                    <br /><br />
                    Are you sure you want to cancel this item? This action cannot be undone.
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={cancellingItem}>Keep Item</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={cancellingItem}
                onClick={() => {
                  if (cancelDialogItem) {
                    cancelOrderItem(
                      cancelDialogItem.orderId,
                      cancelDialogItem.itemId,
                      cancelDialogItem.item.menuItem.id,
                      cancelDialogItem.item.quantity
                    );
                  }
                }}
              >
                {cancellingItem ? 'Cancelling...' : 'Cancel Item'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
