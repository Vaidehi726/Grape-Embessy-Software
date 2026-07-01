
import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useRestaurant } from '@/contexts/RestaurantContext';
import { offlineQuery, offlineMutate } from '@/services/offlineDataService';
import { getDataClient } from '@/services/localDataService';
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
  ArrowLeftRight,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
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
  shortcut_code?: string | null;
}

// Unified cart item - simple, no status tracking
interface UnifiedCartItem {
  cartItemId: string;           // Unique ID for this cart item
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
  const [currentBillNumber, setCurrentBillNumber] = useState<number | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [submitting, setSubmitting] = useState(false);
  const [showBillDialog, setShowBillDialog] = useState(false);
  const [billingOrder, setBillingOrder] = useState<any>(null);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveSourceTable, setMoveSourceTable] = useState<Table | null>(null);
  const [tableOccupationTimes, setTableOccupationTimes] = useState<Record<string, string>>({});
  const [tableAmounts, setTableAmounts] = useState<Record<string, number>>({});
  // Tables whose current order has already been printed (bill number assigned) →
  // rendered in green on the grid so staff can see at a glance which are billed.
  const [printedTableIds, setPrintedTableIds] = useState<Record<string, boolean>>({});
  const [tableSearchQuery, setTableSearchQuery] = useState('');
  const [billNumberSearch, setBillNumberSearch] = useState('');
  const [hasAutoSelected, setHasAutoSelected] = useState(false);
  const [singleMenuItem, setSingleMenuItem] = useState<MenuItem | null>(null);
  
  // Refs for search inputs
  const tableSearchRef = useRef<HTMLInputElement>(null);
  const menuSearchRef = useRef<HTMLInputElement>(null);
  const billSearchRef = useRef<HTMLInputElement>(null);
  const handleTableClickRef = useRef<((table: Table) => void) | null>(null);
  const lastBillSearchRef = useRef<string>('');
  const lanRefreshTimerRef = useRef<any>(null);
  const kioskRootRef = useRef<HTMLDivElement>(null);
  
  const { printBill: printThermal } = useThermalPrinter();
  const { printBill: printUSB } = useUSBPrinter();

  // When enabled in Settings, items already saved to an order can only be
  // increased — never reduced or removed — so a taken order can't be lowered.
  const lockSavedItems = Boolean((currentRestaurant as any)?.lock_saved_items);

  // ============================================================================
  // DATA FETCHING
  // ============================================================================

  const fetchData = async () => {
    if (!currentRestaurant) return;

    try {
      const { localQuery } = await import('@/services/localDataService');
      
      // Fetch floors and tables
      const floorsRes = await localQuery('floors');
      // Stable ordering: the DB returns rows by updated_at DESC, which would make
      // a table/floor jump position whenever its occupancy changes. Sort by a
      // fixed key instead so positions never move (muscle memory).
      const floorsData = ((floorsRes.data || []) as any[]).slice().sort(
        (a, b) =>
          (a.floor_number ?? 0) - (b.floor_number ?? 0) ||
          String(a.created_at || '').localeCompare(String(b.created_at || ''))
      );

      const byTableNumber = (a: any, b: any) =>
        String(a.table_number ?? '').localeCompare(
          String(b.table_number ?? ''),
          undefined,
          { numeric: true, sensitivity: 'base' }
        );

      const floorsWithTables: Floor[] = [];
      for (const floor of floorsData) {
        const tablesRes = await localQuery('tables', { floor_id: floor.id });
        const tables = ((tablesRes.data || []) as any[]).slice().sort(byTableNumber);
        floorsWithTables.push({
          ...floor,
          tables,
        });
      }

      setFloors(floorsWithTables);
      
      if (floorsWithTables.length > 0 && !selectedFloorId) {
        setSelectedFloorId(floorsWithTables[0].id);
      }

      // Fetch categories — sorted by their fixed sort_order (then creation
      // order) so the category tabs never reshuffle.
      const categoriesRes = await localQuery('menu_categories', { is_active: 1 });
      const catData = ((categoriesRes.data || []) as any[]).slice().sort(
        (a, b) =>
          (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
          String(a.created_at || '').localeCompare(String(b.created_at || ''))
      ) as MenuCategory[];
      setCategories(catData);

      // Fetch menu items — sorted by a fixed key (creation order, then name) so
      // a menu item always stays in the same grid position regardless of when it
      // was last edited/touched (the DB otherwise returns them updated_at DESC).
      if (catData.length > 0) {
        const categoryIds = catData.map(c => c.id);
        const itemsRes = await localQuery('menu_items');
        let items = (itemsRes.data || []) as MenuItem[];
        items = items
          .filter(i => i.is_available && categoryIds.includes(i.category_id))
          .sort((a: any, b: any) =>
            ((a.sort_order ?? 0) - (b.sort_order ?? 0)) ||
            String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
            String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' })
          );
        setMenuItems(items);
      }

      // Fetch table occupation times
      const occupiedTableIds = floorsWithTables
        .flatMap(f => f.tables)
        .filter(t => t.is_occupied)
        .map(t => t.id);

      if (occupiedTableIds.length > 0) {
        try {
          const ordersRes = await localQuery('orders');
          const ordersData = (ordersRes.data || []).filter((o: any) => 
            occupiedTableIds.includes(o.table_id) && 
            ['pending', 'cooking', 'ready'].includes(o.status)
          );

          if (ordersData) {
            const times: Record<string, string> = {};
            const subtotals: Record<string, number> = {};
            const printed: Record<string, boolean> = {};
            ordersData.forEach(order => {
              if (!times[order.table_id]) {
                times[order.table_id] = order.created_at;
              }
              subtotals[order.table_id] = (subtotals[order.table_id] || 0) + (Number(order.total_amount) || 0);
              // An assigned bill number means this table's bill has been printed.
              if ((order as any).bill_number != null) printed[order.table_id] = true;
            });
            setTableOccupationTimes(times);
            setPrintedTableIds(printed);

            // GST-inclusive amount per occupied table (for the table card).
            const cgstPct = (currentRestaurant as any)?.cgst_percentage || 0;
            const sgstPct = (currentRestaurant as any)?.sgst_percentage || 0;
            const amounts: Record<string, number> = {};
            Object.entries(subtotals).forEach(([tableId, sub]) => {
              amounts[tableId] = sub + (sub * cgstPct) / 100 + (sub * sgstPct) / 100;
            });
            setTableAmounts(amounts);
          }
        } catch {
          // Offline - skip occupation times
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [currentRestaurant]);

  // Grab keyboard focus when the kiosk mounts so shortcuts (Ctrl+T, /, 1-9,
  // Enter…) work immediately after arriving via the global Ctrl+K — without
  // first having to click the page to give the document focus.
  useEffect(() => {
    const t = setTimeout(() => {
      try { (window as any).focus?.(); } catch { /* ignore */ }
      kioskRootRef.current?.focus({ preventScroll: true });
    }, 60);
    return () => clearTimeout(t);
  }, []);

  // Real-time: when ANY station creates/changes an order, order item, or table,
  // refresh the floor/table list and occupancy immediately instead of waiting up
  // to 10s for the next poll. This only re-reads floors/tables/menu/orders — it
  // never touches the in-progress cart, so a cashier mid-order is not disturbed.
  // Bursts (e.g. a 6-item order = many broadcasts) are debounced into one refresh.
  useEffect(() => {
    const lan = (window as any).electronAPI?.lan;
    if (!lan?.onRecordChanged) return;

    const unsub = lan.onRecordChanged((_e: any, payload: any) => {
      if (payload?.table && !['orders', 'order_items', 'tables'].includes(payload.table)) return;
      if (lanRefreshTimerRef.current) clearTimeout(lanRefreshTimerRef.current);
      lanRefreshTimerRef.current = setTimeout(() => { fetchData(); }, 600);
    });

    return () => {
      unsub?.();
      if (lanRefreshTimerRef.current) clearTimeout(lanRefreshTimerRef.current);
    };
  }, [currentRestaurant]);

  // ============================================================================
  // UNIFIED CART FUNCTIONS
  // ============================================================================

  // Load existing order into unified cart
  const loadTableOrder = async (table: Table) => {
    try {
      const { localQuery } = await import('@/services/localDataService');
      const ordersRes = await localQuery('orders');
      
      const orders = (ordersRes.data || []).filter((o: any) => 
        o.table_id === table.id && 
        ['pending', 'cooking', 'ready'].includes(o.status)
      );
      
      if (orders && orders.length > 0) {
        const cartItems: UnifiedCartItem[] = [];
        const mainOrder = orders[0];
        setCurrentOrderId(mainOrder.id);
        setCurrentBillNumber((mainOrder as any).bill_number ?? null);
        
        for (const order of orders) {
          const itemsRes = await localQuery('order_items', { order_id: order.id });
          
          console.log('[loadTableOrder] Found', (itemsRes.data || []).length, 'order_items in database for order:', order.id);
          console.log('[loadTableOrder] Raw order_items:', (itemsRes.data || []).map((item: any) => ({
            id: item.id,
            menu_item_id: item.menu_item_id,
            status: item.status,
            quantity: item.quantity
          })));
          
          for (const orderItem of (itemsRes.data || [])) {
            if (['served', 'cancelled'].includes(orderItem.status)) {
              console.log('[loadTableOrder] Skipping item (status:', orderItem.status, '):', orderItem.id);
              continue;
            }
            
            const menuItem = menuItems.find((m: any) => m.id === orderItem.menu_item_id);
            
            if (!menuItem) {
              console.log('[loadTableOrder] Skipping item (menu item not found):', orderItem.menu_item_id);
              continue;
            }
            
            cartItems.push({
              cartItemId: crypto.randomUUID(),
              orderItemId: orderItem.id,
              orderId: order.id,
              menuItem,
              quantity: orderItem.quantity,
              unitPrice: orderItem.unit_price,
              isNew: false,
              isModified: false,
              originalQuantity: orderItem.quantity
            });
          }
        }
        
        setUnifiedCart(cartItems);
        console.log('[loadTableOrder] Loaded', cartItems.length, 'items for order:', mainOrder.id);
        console.log('[loadTableOrder] Cart items:', cartItems.map(item => ({
          name: item.menuItem.name,
          quantity: item.quantity,
          isNew: item.isNew,
          orderItemId: item.orderItemId
        })));
      } else {
        setUnifiedCart([]);
        setCurrentOrderId(null);
    setCurrentBillNumber(null);
        console.log('[loadTableOrder] No order found for table');
      }
    } catch (error) {
      console.error('Error loading order:', error);
      toast.error('Failed to load order');
    }
  };

  // Handle table click. Switching tables immediately drops any unsaved
  // (not-yet-sent) items and loads the new table — no confirmation, no manual
  // clearing, so billing stays fast. Saved items are untouched (they're in the DB).
  const handleTableClick = async (table: Table) => {
    setSelectedTable(table);
    setUnifiedCart([]);
    setCurrentOrderId(null);
    setCurrentBillNumber(null);
    await loadTableOrder(table);
  };

  // Update ref when handleTableClick changes
  useEffect(() => {
    handleTableClickRef.current = handleTableClick;
  }, [handleTableClick]);

  // ============================================================================
  // MOVE / CHANGE TABLE
  // ============================================================================

  // Open the "move to…" picker for a table. Works no matter the bill status.
  const openMoveDialog = (table: Table, e: React.MouseEvent) => {
    e.stopPropagation();
    // Only guard against losing UNSAVED new items on the table being moved.
    if (selectedTable?.id === table.id && unifiedCart.some(item => item.isNew)) {
      toast.warning('Please submit or clear the unsaved items before moving this table.');
      return;
    }
    setMoveSourceTable(table);
    setMoveDialogOpen(true);
  };

  // Move every active order on the source table to an empty destination table.
  // Status-agnostic: pending / cooking / ready / served / billed-but-unpaid all
  // move together (only fully cancelled orders are skipped). Changing table_id
  // automatically re-labels the order on the Kitchen view and the bill, and the
  // upsert broadcasts so every station updates occupancy in real time.
  const moveTableTo = async (dest: Table) => {
    const source = moveSourceTable;
    if (!source) return;
    if (dest.id === source.id) { setMoveDialogOpen(false); return; }
    if (dest.is_occupied) {
      toast.error(`${dest.table_number} is occupied — pick an empty table.`);
      return;
    }

    try {
      const db = getDataClient();

      // All non-cancelled orders currently on the source table.
      const ordersRes = await db.query('orders', { table_id: source.id });
      const ordersToMove = (ordersRes.data || []).filter((o: any) => o.status !== 'cancelled');

      if (ordersToMove.length === 0) {
        toast.error('No order found on this table to move.');
        setMoveDialogOpen(false);
        setMoveSourceTable(null);
        return;
      }

      const now = new Date().toISOString();

      // Spread the full order so restaurant_id (required by the LAN validator) is
      // included; the non-destructive upsert preserves every other field/total.
      for (const order of ordersToMove) {
        const res = await db.upsert('orders', { ...order, table_id: dest.id, updated_at: now });
        if (!res.success) throw new Error(res.error || 'Failed to move order');
      }

      // Destination becomes occupied; source frees up.
      await db.upsert('tables', { ...dest, is_occupied: 1, updated_at: now });
      await db.upsert('tables', { ...source, is_occupied: 0, updated_at: now });

      // Optimistic local update so the moving station reflects instantly.
      setFloors(prev => prev.map(f => ({
        ...f,
        tables: f.tables.map(t =>
          t.id === dest.id ? { ...t, is_occupied: true }
            : t.id === source.id ? { ...t, is_occupied: false }
            : t
        )
      })));

      // If the moved table is the one open in the cart, follow it to the new table.
      if (selectedTable?.id === source.id) {
        setSelectedTable({ ...dest, is_occupied: true });
      }

      toast.success(`Moved ${source.table_number} → ${dest.table_number}`);
      setMoveDialogOpen(false);
      setMoveSourceTable(null);
      fetchData();
    } catch (err: any) {
      console.error('[MoveTable] error:', err);
      toast.error(err?.message || 'Failed to move table');
    }
  };

  // Add to cart - simple increment or add new
  const addToCart = (menuItem: MenuItem) => {
    setUnifiedCart(prev => {
      const existingItem = prev.find(item => item.menuItem.id === menuItem.id);
      
      if (existingItem) {
        return prev.map(item =>
          item.menuItem.id === menuItem.id
            ? { ...item, quantity: item.quantity + 1, isModified: true }
            : item
        );
      }
      
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

  // Update quantity - just change quantity
  const updateQuantity = (cartItemId: string, delta: number) => {
    // Lock check: a saved item can't drop below the quantity it was saved at.
    if (delta < 0 && lockSavedItems) {
      const item = unifiedCart.find(i => i.cartItemId === cartItemId);
      if (item && !item.isNew) {
        const floor = item.originalQuantity ?? item.quantity;
        if (item.quantity + delta < floor) {
          toast.warning('Saved items can only be increased, not reduced.');
          return;
        }
      }
    }
    setUnifiedCart(prev =>
      prev
        .map(item => {
          if (item.cartItemId === cartItemId) {
            const newQuantity = item.quantity + delta;
            if (newQuantity <= 0) return null;
            return { ...item, quantity: newQuantity, isModified: true };
          }
          return item;
        })
        .filter(Boolean) as UnifiedCartItem[]
    );
  };

  // Remove from cart
  const removeFromCart = (cartItemId: string) => {
    if (lockSavedItems) {
      const item = unifiedCart.find(i => i.cartItemId === cartItemId);
      if (item && !item.isNew) {
        toast.warning('Saved items cannot be removed.');
        return;
      }
    }
    setUnifiedCart(prev => prev.filter(item => item.cartItemId !== cartItemId));
  };

  // Set an absolute quantity (used by the editable quantity field — type a big
  // number instead of tapping + many times).
  const setItemQuantity = (cartItemId: string, value: string | number) => {
    setUnifiedCart(prev =>
      prev.map(item => {
        if (item.cartItemId !== cartItemId) return item;
        let q = Math.floor(Number(value));
        if (!Number.isFinite(q) || q < 1) q = 1;
        // Respect the lock: saved items can't drop below their saved quantity.
        if (lockSavedItems && !item.isNew) {
          const floor = item.originalQuantity ?? item.quantity;
          if (q < floor) {
            toast.warning('Saved items can only be increased, not reduced.');
            q = floor;
          }
        }
        return { ...item, quantity: q, isModified: true };
      })
    );
  };

  // Simple total calculation (subtotal of items)
  const totalAmount = useMemo(() => {
    return unifiedCart.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
  }, [unifiedCart]);

  // GST-inclusive total shown on the cart, so it matches what the customer pays.
  const cartCgstPct = (currentRestaurant as any)?.cgst_percentage || 0;
  const cartSgstPct = (currentRestaurant as any)?.sgst_percentage || 0;
  const cartCgstAmount = (totalAmount * cartCgstPct) / 100;
  const cartSgstAmount = (totalAmount * cartSgstPct) / 100;
  const cartTotalWithGst = totalAmount + cartCgstAmount + cartSgstAmount;
  const cartHasGst = cartCgstPct > 0 || cartSgstPct > 0;

  // ============================================================================
  // BILL NUMBER SEARCH & AUTO-SELECTION
  // ============================================================================

  // Load a SPECIFIC order (any status) into the cart — used by bill-number search
  // so a closed/served bill can be reopened to add items and be re-billed.
  const loadSpecificOrder = async (order: any) => {
    try {
      const { localQuery } = await import('@/services/localDataService');
      let tableObj: Table | null = null;
      for (const f of floors) {
        const t = f.tables.find(tt => tt.id === order.table_id);
        if (t) { tableObj = t; break; }
      }
      setSelectedTable(tableObj);
      setCurrentOrderId(order.id);
      setCurrentBillNumber(order.bill_number ?? null);

      const itemsRes = await localQuery('order_items', { order_id: order.id });
      const cartItems: UnifiedCartItem[] = [];
      for (const oi of (itemsRes.data || [])) {
        if (['cancelled', 'void'].includes(oi.status)) continue;
        const menuItem = menuItems.find(m => m.id === oi.menu_item_id);
        if (!menuItem) continue;
        cartItems.push({
          cartItemId: crypto.randomUUID(),
          orderItemId: oi.id,
          menuItem,
          quantity: oi.quantity,
          unitPrice: oi.unit_price,
          isNew: false,
          isModified: false,
          originalQuantity: oi.quantity,
        });
      }
      setUnifiedCart(cartItems);
    } catch (err) {
      console.error('[OrderKiosk] loadSpecificOrder error:', err);
      toast.error('Failed to load bill');
    }
  };

  // Bill-number search (on Enter). Loads the matching bill for TODAY regardless
  // of status — so a served/closed bill can be reopened, added to, and re-billed.
  // Scoped to today because bill numbers reset daily.
  const searchBillNumber = () => {
    const q = billNumberSearch.trim();
    if (!q || !/^[0-9]+$/.test(q)) return;
    const db = getDataClient();
    if (!db) return;
    db.query('orders', {}).then((result: any) => {
      const orders = result.data || [];
      const today = new Date().toDateString();
      const matchingOrder = orders.find((o: any) => {
        if (String(o.bill_number) !== q || o.status === 'cancelled') return false;
        try { return new Date(o.created_at).toDateString() === today; } catch { return false; }
      });
      if (matchingOrder) {
        loadSpecificOrder(matchingOrder);
        toast.success(`Loaded Bill #${String(matchingOrder.bill_number).padStart(3, '0')}`);
        setBillNumberSearch('');
        billSearchRef.current?.blur();
        kioskRootRef.current?.focus({ preventScroll: true });
      } else {
        toast.info(`No bill #${q} found for today`);
      }
    }).catch((err: any) => console.error('[OrderKiosk] Error searching by bill number:', err));
  };

  // Track if menu search has exactly one result
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
    
    if (matchingItems.length === 1) {
      setSingleMenuItem(matchingItems[0]);
    } else {
      setSingleMenuItem(null);
    }
  }, [searchQuery, menuItems, selectedCategoryId]);

  // ============================================================================
  // TABLE ACTIONS
  // ============================================================================

  // Quick mark table as available
  const quickMarkAvailable = async (table: Table, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      // Check for unsaved cart items
      const hasUnsavedItems = unifiedCart.some(item => item.isNew);
      if (hasUnsavedItems && selectedTable?.id === table.id) {
        toast.warning('You have unsaved items. Please submit or clear them first.');
        return;
      }

      const db = getDataClient();
      if (db) {
        // Mark all active orders as served
        const ordersRes = await db.query('orders', { table_id: table.id });
        for (const order of (ordersRes.data || [])) {
          if (['pending', 'cooking', 'ready'].includes(order.status)) {
            await db.upsert('orders', {
              ...order,
              status: 'served',
              updated_at: new Date().toISOString()
            });
          }
        }
        
        // Mark table as not occupied
        const tablesRes = await db.query('tables', { id: table.id });
        if (tablesRes.data && tablesRes.data.length > 0) {
          const t = tablesRes.data[0];
          await db.upsert('tables', {
            ...t,
            is_occupied: 0,
            updated_at: new Date().toISOString()
          });
        }
      }

      // Update UI
      setFloors(floors.map(f => ({
        ...f,
        tables: f.tables.map(t => 
          t.id === table.id ? { ...t, is_occupied: false } : t
        )
      })));

      // Clear cart if this was the selected table
      if (selectedTable?.id === table.id) {
        setSelectedTable(null);
        setUnifiedCart([]);
        setCurrentOrderId(null);
    setCurrentBillNumber(null);
      }

      toast.success(`Table ${table.table_number} marked as available`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to mark table available');
    }
  };

  // ============================================================================
  // ORDER SUBMISSION
  // ============================================================================

  const submitOrder = async () => {
    if (!selectedTable || !currentRestaurant || unifiedCart.length === 0) {
      toast.error('Cart is empty');
      return;
    }
    
    setSubmitting(true);
    
    try {
      const db = getDataClient();
      if (!db) {
        toast.error('Database not available');
        return;
      }

      const newTotal = unifiedCart.reduce(
        (sum, item) => sum + (item.unitPrice * item.quantity),
        0
      );
      
      // Case 1: No existing order - create new one
      if (!currentOrderId) {
        const orderId = crypto.randomUUID();
        // Bill number is NOT assigned here. It is reserved on the first print
        // (see BillingDialog.ensureBillNumber) so numbers follow the printing
        // sequence, and orders that are never printed stay unnumbered.
        const orderData = {
          id: orderId,
          restaurant_id: currentRestaurant.id,
          table_id: selectedTable.id,
          total_amount: newTotal,
          status: 'pending',
        };
        
        await db.upsert('orders', orderData);
        
        for (const cartItem of unifiedCart) {
          await db.upsert('order_items', {
            id: crypto.randomUUID(),
            order_id: orderId,
            menu_item_id: cartItem.menuItem.id,
            quantity: cartItem.quantity,
            unit_price: cartItem.unitPrice,
            status: 'pending',
          });
        }
        
        // Mark table as occupied
        const tablesRes = await db.query('tables', { id: selectedTable.id });
        if (tablesRes.data && tablesRes.data.length > 0) {
          const table = tablesRes.data[0];
          await db.upsert('tables', {
            ...table,
            is_occupied: 1,
            updated_at: new Date().toISOString()
          });
        }
        
        toast.success('Order created!');
      }
      
      // Case 2: Existing order - update it
      else {
        console.log('[submitOrder] Updating existing order:', currentOrderId);
        
        if (!currentOrderId) {
          console.error('[submitOrder] ERROR: currentOrderId is null/undefined but we\'re in Case 2!');
          toast.error('Order ID is missing. Please reload the table.');
          return;
        }
        
        console.log('[submitOrder] Cart items:', unifiedCart.map(item => ({
          name: item.menuItem.name,
          isNew: item.isNew,
          isModified: item.isModified,
          orderItemId: item.orderItemId,
          quantity: item.quantity
        })));
        
        // Update order total
        const ordersRes = await db.query('orders', { id: currentOrderId });
        if (ordersRes.data && ordersRes.data.length > 0) {
          const order = ordersRes.data[0];
          // If this bill was already served/closed (reopened via bill-number
          // search to add items), re-activate it so the kitchen sees the new
          // items and the table shows occupied again.
          const reopened = ['served', 'completed'].includes(order.status);
          await db.upsert('orders', {
            ...order,
            total_amount: newTotal,
            status: reopened ? 'pending' : order.status,
            updated_at: new Date().toISOString()
          });
          if (reopened && order.table_id) {
            const tRes = await db.query('tables', { id: order.table_id });
            if (tRes.data && tRes.data.length > 0) {
              await db.upsert('tables', { ...tRes.data[0], is_occupied: 1, updated_at: new Date().toISOString() });
            }
          }
        }
        
        // Handle new items - insert
        const newItems = unifiedCart.filter(item => item.isNew);
        const newlyInsertedItemIds = new Set<string>(); // Track newly inserted item IDs
        console.log('[submitOrder] New items to insert:', newItems.length, newItems.map(i => i.menuItem.name));
        
        for (const cartItem of newItems) {
          const newItemId = crypto.randomUUID();
          console.log('[submitOrder] Inserting new order_item:', {
            id: newItemId,
            order_id: currentOrderId,
            menu_item_id: cartItem.menuItem.id,
            quantity: cartItem.quantity,
            unit_price: cartItem.unitPrice
          });
          
          try {
            await db.upsert('order_items', {
              id: newItemId,
              order_id: currentOrderId,
              menu_item_id: cartItem.menuItem.id,
              quantity: cartItem.quantity,
              unit_price: cartItem.unitPrice,
              status: 'pending',
            });
            
            newlyInsertedItemIds.add(newItemId); // Track this newly inserted item
            console.log('[submitOrder] ✓ Successfully inserted:', cartItem.menuItem.name);
          } catch (error) {
            console.error('[submitOrder] Failed to insert new item:', cartItem.menuItem.name, error);
            throw error; // Re-throw to be caught by outer try-catch
          }
        }
        
        console.log('[submitOrder] All new items inserted successfully');
        
        // Handle modified items - update
        const modifiedItems = unifiedCart.filter(
          item => !item.isNew && item.isModified && item.orderItemId
        );
        
        for (const cartItem of modifiedItems) {
          const itemsRes = await db.query('order_items', { id: cartItem.orderItemId });
          if (itemsRes.data && itemsRes.data.length > 0) {
            const item = itemsRes.data[0];
            await db.upsert('order_items', {
              ...item,
              quantity: cartItem.quantity,
              unit_price: cartItem.unitPrice,
              updated_at: new Date().toISOString()
            });
          }
        }
        
        // Handle removed items - cancel from database
        const allOrderItems = await db.query('order_items', { order_id: currentOrderId });
        
        for (const dbItem of (allOrderItems.data || [])) {
          if (['served', 'cancelled'].includes(dbItem.status)) continue;
          
          // Skip newly inserted items (they won't be in cart with orderItemId yet)
          if (newlyInsertedItemIds.has(dbItem.id)) {
            console.log('[submitOrder] Skipping newly inserted item:', dbItem.id);
            continue;
          }
          
          const stillInCart = unifiedCart.find(c => c.orderItemId === dbItem.id);
          
          if (!stillInCart) {
            console.log('[submitOrder] Cancelling removed item:', dbItem.id);
            await db.upsert('order_items', {
              ...dbItem,
              status: 'cancelled',
              updated_at: new Date().toISOString()
            });
          }
        }
        
        toast.success('Order updated!');
      }
      
      // Reset and reload
      setUnifiedCart([]);
      setCurrentOrderId(null);
    setCurrentBillNumber(null);
      
      console.log('[submitOrder] Cart cleared, reloading order...');
      
      // Reload to show updated order
      if (selectedTable) {
        await loadTableOrder(selectedTable);
        console.log('[submitOrder] Order reloaded successfully');
      }
      
      // Update floors state
      setFloors(floors.map(f => ({
        ...f,
        tables: f.tables.map(t => 
          t.id === selectedTable.id ? { ...t, is_occupied: true } : t
        )
      })));
      
    } catch (error: any) {
      console.error('[submitOrder] Error:', error);
      toast.error(error.message || 'Failed to submit order');
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================================
  // BILLING & PAYMENT (UNCHANGED - PRESERVING EXISTING FUNCTIONALITY)
  // ============================================================================

  const handlePaymentComplete = async (
    paymentMethod: 'cash' | 'card' | 'upi',
    billing?: { subtotal: number; discountAmount: number; cgstAmount: number; sgstAmount: number; finalAmount: number }
  ) => {
    const tableId = billingOrder?.table_id || selectedTable?.id;

    if (!tableId) {
      toast.error('No table found');
      return;
    }

    const db = getDataClient();
    if (db) {
      const ordersRes = await db.query('orders', { table_id: tableId });
      const activeOrders = (ordersRes.data || []).filter((order: any) =>
        ['pending', 'cooking', 'ready'].includes(order.status)
      );
      let isPrimary = true;
      for (const order of activeOrders) {
        const update: Record<string, any> = {
          ...order,
          status: 'served',
          payment_method: paymentMethod,
          payment_status: 'paid',
          updated_at: new Date().toISOString(),
        };
        // Persist the bill-level discount/GST/final on the primary order only,
        // so a table with multiple active orders doesn't double-count the discount.
        if (isPrimary && billing) {
          update.discount_amount = billing.discountAmount;
          update.cgst_amount = billing.cgstAmount;
          update.sgst_amount = billing.sgstAmount;
          update.final_amount = billing.finalAmount;
        }
        await db.upsert('orders', update);
        isPrimary = false;
      }
      
      // Update table to not occupied
      const tablesRes = await db.query('tables', { id: tableId });
      if (tablesRes.data && tablesRes.data.length > 0) {
        const table = tablesRes.data[0];
        await db.upsert('tables', {
          ...table,
          is_occupied: 0,
          updated_at: new Date().toISOString()
        });
      }
    }

    setFloors(floors.map(f => ({
      ...f,
      tables: f.tables.map(t => 
        t.id === tableId ? { ...t, is_occupied: false } : t
      )
    })));

    setUnifiedCart([]);
    setCurrentOrderId(null);
    setCurrentBillNumber(null);
    setSelectedTable(null);

    toast.success(`Payment received via ${paymentMethod.toUpperCase()}`);
    
    setBillingOrder(null);
    setShowBillDialog(false);
  };

  const openTableBilling = async (table: Table, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!currentRestaurant) return;
    
    try {
      const { localQuery } = await import('@/services/localDataService');
      const ordersRes = await localQuery('orders');
      
      const orders = (ordersRes.data || []).filter((o: any) => 
        o.table_id === table.id && 
        ['pending', 'cooking', 'ready'].includes(o.status)
      );
      
      if (!orders || orders.length === 0) {
        toast.error('No active orders to bill');
        return;
      }

      // Use the unified cart state if we have unsaved changes, otherwise use database
      const hasUnsavedChanges = unifiedCart.some(item => item.isNew || item.isModified);
      
      let allItems: any[] = [];
      let totalAmount = 0;

      if (hasUnsavedChanges && currentOrderId) {
        // Use current cart state for accurate billing
        totalAmount = unifiedCart.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
        
        allItems = unifiedCart.map(item => ({
          id: item.orderItemId || item.cartItemId,
          menu_item_id: item.menuItem.id,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          status: 'pending',
          menu_item: { name: item.menuItem.name }
        }));
      } else {
        // Use database state
        for (const order of orders) {
          totalAmount += order.total_amount || 0;
          const itemsRes = await localQuery('order_items', { order_id: order.id });
          
          for (const oi of (itemsRes.data || [])) {
            if (!['served', 'cancelled'].includes(oi.status)) {
              const mi = menuItems.find((m: any) => m.id === oi.menu_item_id);
              allItems.push({
                id: oi.id,
                menu_item_id: oi.menu_item_id || '',
                quantity: oi.quantity,
                unit_price: oi.unit_price,
                status: oi.status,
                menu_item: mi ? { name: mi.name } : undefined
              });
            }
          }
        }
      }

      // Find the floor for this table from the already-loaded floors state
      const currentFloor = floors.find(f => 
        f.tables.some(t => t.id === table.id)
      );

      const billingOrderData = {
        id: orders[0].id,
        table_id: table.id,
        total_amount: totalAmount,
        bill_number: orders[0].bill_number,
        table: { 
          table_number: table.table_number, 
          floor: { name: currentFloor?.name || 'Unknown Floor' } 
        },
        order_items: allItems.map(item => ({ 
          id: item.id, 
          menu_item: item.menu_item, 
          quantity: item.quantity, 
          unit_price: item.unit_price 
        }))
      };
      
      setBillingOrder(billingOrderData);
      setShowBillDialog(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to open billing');
    }
  };

  // ============================================================================
  // KEYBOARD SHORTCUTS
  // ============================================================================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      
      // Debug: Log Ctrl/Cmd combinations for troubleshooting
      if (e.ctrlKey || e.metaKey) {
        console.log('[OrderKiosk Shortcut] Key event:', {
          key: e.key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          isInputField,
          target: target.tagName,
        });
      }
      
      // (Ctrl+K is reserved for global "jump to Order Kiosk"; use "/" to focus
      // the menu search here.)

      // Ctrl+T or Cmd+T: Focus table search
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
        console.log('[OrderKiosk Shortcut] Ctrl+T - focusing table search');
        e.preventDefault();
        e.stopPropagation();
        tableSearchRef.current?.focus();
        tableSearchRef.current?.select();
        return;
      }

      // Ctrl+B or Cmd+B: Focus the "Search by Bill #" box
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        console.log('[OrderKiosk Shortcut] Ctrl+B - focusing bill search');
        e.preventDefault();
        e.stopPropagation();
        billSearchRef.current?.focus();
        billSearchRef.current?.select();
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
          menuSearchRef.current?.blur();
        } else if (tableSearchQuery) {
          setTableSearchQuery('');
          tableSearchRef.current?.blur();
        } else if (billNumberSearch) {
          setBillNumberSearch('');
          billSearchRef.current?.blur();
        }
        return;
      }
      
      // Number keys 1-9: Add menu item by shortcut code (only if not in input field)
      if (!isInputField && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const key = e.key;
        if (/^[1-9]$/.test(key)) {
          // Find menu item with matching shortcut code
          const menuItem = menuItems.find(item => item.shortcut_code === key);
          if (menuItem && selectedTable) {
            e.preventDefault();
            addToCart(menuItem);
            toast.success(`Added ${menuItem.name}`);
            return;
          }
        }
      }
      
      // +/- keys: Modify single search result quantity (works even in input field)
      if (singleMenuItem && selectedTable && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const key = e.key;
        if (key === '+' || key === '=') {
          e.preventDefault();
          addToCart(singleMenuItem);
          return;
        } else if (key === '-' || key === '_') {
          e.preventDefault();
          // Find the cart item and decrease quantity
          const cartItem = unifiedCart.find(item => item.menuItem.id === singleMenuItem.id);
          if (cartItem) {
            updateQuantity(cartItem.cartItemId, -1);
          }
          return;
        }
      }
      
      // Enter: Submit order or open billing
      if (e.key === 'Enter' && !isInputField && selectedTable) {
        if (unifiedCart.some(item => item.isNew || item.isModified)) {
          // First Enter: Submit/update order
          e.preventDefault();
          submitOrder();
        } else if (unifiedCart.length > 0 && currentOrderId) {
          // Second Enter (after submit): Open billing dialog
          e.preventDefault();
          openTableBilling(selectedTable);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [unifiedCart, selectedTable, submitOrder, menuItems, addToCart, updateQuantity, singleMenuItem, searchQuery, tableSearchQuery, billNumberSearch]);

  // ============================================================================
  // FILTERED MENU ITEMS
  // ============================================================================

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
        item.shortcut_code?.includes(query)
      );
    }
    
    return items;
  }, [menuItems, selectedCategoryId, searchQuery]);

  // ============================================================================
  // AUTO-SELECT TABLE WHEN ONLY ONE REMAINS
  // ============================================================================

  // Select a table from the search box ON ENTER (not while typing), so multi-
  // digit names like "p16" aren't grabbed prematurely by a prefix match ("p1").
  // Picks an exact match, else the single visible result. Then clears the search,
  // unfocuses, and moves focus to the page so number keys add menu items.
  const selectTableFromSearch = () => {
    const q = tableSearchQuery.trim().toLowerCase();
    if (!q || !floors.length) return;

    const allTables = floors.flatMap(f => f.tables);
    const exactMatch = allTables.find(t => (t.table_number || '').toLowerCase() === q);
    const visibleTables = allTables.filter(t => (t.table_number || '').toLowerCase().includes(q));
    const target = exactMatch || (visibleTables.length === 1 ? visibleTables[0] : null);

    if (!target || !handleTableClickRef.current) {
      if (visibleTables.length > 1) toast.info('Multiple tables match — type the full name.');
      return;
    }

    handleTableClickRef.current(target);
    toast.success(`Selected ${target.table_number}`);
    setTableSearchQuery('');
    tableSearchRef.current?.blur();
    kioskRootRef.current?.focus({ preventScroll: true });
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col h-[calc(100vh-4rem)]">
        {/* Header */}
        <div className="p-4 border-b bg-card">
          <h1 className="text-2xl font-bold">Order Kiosk</h1>
          <p className="text-sm text-muted-foreground">Select a table and manage orders</p>
        </div>

        <div ref={kioskRootRef} tabIndex={-1} className="flex flex-1 overflow-hidden outline-none">
          {/* Left Panel - Tables */}
          <div className="w-[26rem] border-r bg-card flex flex-col">
            <div className="p-4 border-b space-y-2">
              <Input
                ref={tableSearchRef}
                placeholder="Search tables, press Enter to select... (Ctrl+T)"
                value={tableSearchQuery}
                onChange={(e) => {
                  setTableSearchQuery(e.target.value);
                  setHasAutoSelected(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    selectTableFromSearch();
                  }
                }}
              />
              <Input
                ref={billSearchRef}
                placeholder="Bill #, press Enter to open... (Ctrl+B)"
                value={billNumberSearch}
                onChange={(e) => setBillNumberSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    searchBillNumber();
                  }
                }}
              />
            </div>
            
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
                {floors.map(floor => (
                  <div key={floor.id}>
                    <h3 className="font-semibold mb-2">{floor.name}</h3>
                    <div className="grid grid-cols-4 gap-2">
                      {floor.tables
                        .filter(table => 
                          tableSearchQuery === '' || 
                          table.table_number.toLowerCase().includes(tableSearchQuery.toLowerCase())
                        )
                        .map(table => {
                          // Calculate visible tables for auto-selection
                          const isVisible = tableSearchQuery === '' || 
                            table.table_number.toLowerCase().includes(tableSearchQuery.toLowerCase());
                          
                          return isVisible ? (
                            <button
                              key={table.id}
                              onClick={() => handleTableClick(table)}
                              className={`p-2 rounded-lg border transition-all relative h-[104px] flex flex-col items-center text-center ${
                                selectedTable?.id === table.id
                                  ? 'border-primary bg-primary/10'
                                  : table.is_occupied && printedTableIds[table.id]
                                  ? 'border-success bg-success/10 hover:border-success/50'
                                  : table.is_occupied
                                  ? 'border-warning bg-warning/10 hover:border-warning/50'
                                  : 'border-muted bg-muted/50 hover:border-primary/50'
                              }`}
                            >
                              {/* Status indicator dot: red = occupied unbilled, green = printed or free */}
                              <div className={`absolute top-1 right-1 w-2 h-2 rounded-full ${
                                table.is_occupied && !printedTableIds[table.id] ? 'bg-destructive' : 'bg-success'
                              }`} />

                              <div className="font-semibold text-sm leading-tight">{table.table_number}</div>
                              {table.is_occupied ? (
                                <>
                                  <div className="text-xs font-bold text-primary leading-tight">
                                    ₹{Math.round(tableAmounts[table.id] ?? 0)}
                                  </div>
                                  {tableOccupationTimes[table.id] && (
                                    <TableOccupiedTimer occupiedSince={tableOccupationTimes[table.id]} />
                                  )}
                                </>
                              ) : (
                                <div className="text-xs text-muted-foreground">Available</div>
                              )}

                              {/* Action icons for occupied tables */}
                              {table.is_occupied && (
                                <div className="flex items-center justify-center gap-1 mt-auto">
                                  <div
                                    onClick={(e) => openTableBilling(table, e)}
                                    className="p-1 rounded bg-primary/10 hover:bg-primary/20 text-primary transition-colors cursor-pointer"
                                    title="Generate Bill"
                                  >
                                    <CreditCard className="w-3 h-3" />
                                  </div>
                                  <div
                                    onClick={(e) => quickMarkAvailable(table, e)}
                                    className="p-1 rounded bg-success/10 hover:bg-success/20 text-success transition-colors cursor-pointer"
                                    title="Mark Available"
                                  >
                                    <Check className="w-3 h-3" />
                                  </div>
                                  <div
                                    onClick={(e) => openMoveDialog(table, e)}
                                    className="p-1 rounded bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 transition-colors cursor-pointer"
                                    title="Move / change table"
                                  >
                                    <ArrowLeftRight className="w-3 h-3" />
                                  </div>
                                </div>
                              )}
                            </button>
                          ) : null;
                        }).filter(Boolean)}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Middle Panel - Menu */}
          <div className="flex-1 flex flex-col bg-background">
            <div className="p-4 border-b space-y-3">
              <div className="relative">
                <Input
                  ref={menuSearchRef}
                  placeholder="Search menu or type shortcut #... (press /)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
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
              
              <div className="flex gap-2 overflow-x-auto">
                <Button
                  variant={selectedCategoryId === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedCategoryId('all')}
                >
                  All
                </Button>
                {categories.map(cat => (
                  <Button
                    key={cat.id}
                    variant={selectedCategoryId === cat.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedCategoryId(cat.id)}
                  >
                    {cat.name}
                  </Button>
                ))}
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-3 grid grid-cols-3 lg:grid-cols-4 gap-2">
                {filteredMenuItems.map(item => {
                  // Check if item is in cart
                  const inCart = unifiedCart.find(c => c.menuItem.id === item.id);

                  return (
                    <button
                      key={item.id}
                      onClick={() => addToCart(item)}
                      className={`p-2.5 bg-card rounded-lg border transition-all text-left relative h-[92px] overflow-hidden flex flex-col ${
                        inCart
                          ? 'ring-2 ring-primary border-primary/50 hover:border-primary'
                          : 'hover:border-primary/50'
                      }`}
                    >
                      {/* Shortcut Code Badge */}
                      {item.shortcut_code && (
                        <div className="absolute top-1 right-1 bg-primary text-primary-foreground text-[10px] font-bold w-5 h-5 rounded flex items-center justify-center">
                          {item.shortcut_code}
                        </div>
                      )}

                      <div className="flex items-start gap-1.5 pr-5">
                        <FoodTypeIndicator type={item.food_type} />
                        <p className="font-semibold text-sm leading-tight line-clamp-2">{item.name}</p>
                      </div>
                      <div className="flex items-center justify-between mt-auto">
                        <span className="font-bold text-sm">₹{item.price}</span>
                        <div className="flex items-center gap-1">
                          <SpiceLevelIndicator level={item.spice_level} />
                          {inCart && (
                            <Badge variant={inCart.isNew ? 'default' : 'outline'} className="text-xs">
                              {inCart.isNew ? `+${inCart.quantity}` : `x${inCart.quantity}`}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {/* Right Panel - Unified Cart */}
          <div className="w-96 border-l bg-card flex flex-col">
            <div className="p-4 border-b">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold text-lg">
                  {currentOrderId ? 'Current Order' : 'New Order'}
                </h2>
                {currentBillNumber != null && (
                  <span className="text-sm font-bold text-primary whitespace-nowrap">
                    Bill #{String(currentBillNumber).padStart(3, '0')}
                  </span>
                )}
              </div>
              {selectedTable && (
                <p className="text-sm text-muted-foreground">
                  Table {selectedTable.table_number}
                </p>
              )}
            </div>

            <ScrollArea className="flex-1">
              <div className="p-4 space-y-2">
                {unifiedCart.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    {currentOrderId ? 'No active items' : 'Add items to start an order'}
                  </p>
                ) : (
                  unifiedCart.map(item => (
                    <div
                      key={item.cartItemId}
                      className="flex items-center justify-between p-3 bg-background rounded-lg border"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <FoodTypeIndicator type={item.menuItem.food_type} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{item.menuItem.name}</p>
                          <p className="text-xs text-muted-foreground">₹{item.unitPrice} each</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7"
                          onClick={() => updateQuantity(item.cartItemId, -1)}
                          disabled={lockSavedItems && !item.isNew && item.quantity <= (item.originalQuantity ?? item.quantity)}
                        >
                          <Minus className="w-3 h-3" />
                        </Button>
                        
                        <input
                          type="text"
                          inputMode="numeric"
                          value={item.quantity}
                          onChange={(e) => setItemQuantity(item.cartItemId, e.target.value.replace(/[^0-9]/g, ''))}
                          onFocus={(e) => e.currentTarget.select()}
                          title="Click and type a quantity"
                          className="w-10 h-7 text-center font-semibold text-sm border rounded bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7"
                          onClick={() => updateQuantity(item.cartItemId, 1)}
                        >
                          <Plus className="w-3 h-3" />
                        </Button>
                        
                        <span className="w-16 text-right font-semibold text-sm">
                          ₹{item.unitPrice * item.quantity}
                        </span>
                        
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive"
                          onClick={() => removeFromCart(item.cartItemId)}
                          disabled={lockSavedItems && !item.isNew}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>

            {unifiedCart.length > 0 && (
              <div className="p-4 border-t space-y-3">
                {cartHasGst && (
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span>₹{Math.round(totalAmount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>CGST ({cartCgstPct}%)</span>
                      <span>₹{Math.round(cartCgstAmount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>SGST ({cartSgstPct}%)</span>
                      <span>₹{Math.round(cartSgstAmount)}</span>
                    </div>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-lg font-semibold">{cartHasGst ? 'Total (incl. GST)' : 'Total'}</span>
                  <span className="text-2xl font-bold">₹{Math.round(cartTotalWithGst)}</span>
                </div>
                
                <Button
                  variant="gradient"
                  size="lg"
                  className="w-full"
                  onClick={submitOrder}
                  disabled={submitting || unifiedCart.length === 0}
                >
                  {submitting ? (
                    'Submitting...'
                  ) : currentOrderId ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Update Order
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Send KOT
                    </>
                  )}
                </Button>

                {currentOrderId && (
                  <Button
                    className="w-full bg-green-600 hover:bg-green-700 text-white border-green-600"
                    onClick={() => openTableBilling(selectedTable!)}
                  >
                    <CreditCard className="w-4 h-4 mr-2" />
                    Generate Bill
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Billing Dialog - UNCHANGED */}
      <BillingDialog
        open={showBillDialog}
        onOpenChange={(open) => {
          setShowBillDialog(open);
          if (!open) {
            setBillingOrder(null);
            // Refresh the grid so a table just printed shows green immediately.
            fetchData();
          }
        }}
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

      {/* Move / change table */}
      <Dialog open={moveDialogOpen} onOpenChange={(open) => { setMoveDialogOpen(open); if (!open) setMoveSourceTable(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Move {moveSourceTable?.table_number ?? 'table'} to…</DialogTitle>
            <DialogDescription>
              Pick an empty table. The order, items and bill move with it — works at any stage of the bill.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4 p-1">
              {floors.map(floor => {
                const empties = floor.tables.filter(
                  t => !t.is_occupied && t.id !== moveSourceTable?.id
                );
                if (empties.length === 0) return null;
                return (
                  <div key={floor.id}>
                    <h4 className="text-sm font-semibold mb-2">{floor.name}</h4>
                    <div className="grid grid-cols-3 gap-2">
                      {empties.map(t => (
                        <Button key={t.id} variant="outline" onClick={() => moveTableTo(t)}>
                          {t.table_number}
                        </Button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {floors.every(
                f => f.tables.filter(t => !t.is_occupied && t.id !== moveSourceTable?.id).length === 0
              ) && (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No empty tables available to move to.
                </p>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
