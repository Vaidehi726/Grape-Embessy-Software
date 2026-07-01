# Unified Simple Cart Implementation Plan

## Overview

Replace the complex dual-state system (cart + activeOrder) with a **single unified cart** that:
- Shows ALL items in one list (new + existing)
- Allows full mutation (add, remove, modify quantities)
- Calculates one simple total
- Submits everything together
- No complex status tracking in UI

**Estimated Time**: 3-4 hours
**Risk**: LOW - Simpler than current system

---

## Architecture

### Current (Complex):
```
cart: CartItem[]          ← New items only (no status)
activeOrder: ActiveOrder  ← Existing items (with status)
grandTotal = cart + activeOrder
```

### New (Simple):
```
unifiedCart: UnifiedCartItem[]  ← ALL items (new + existing)
totalAmount = sum of all items
```

---

## Implementation Steps

### Step 1: Define New Interface

**File**: `OrderKioskSplit.tsx`

**Replace**:
```typescript
interface CartItem {
  menuItem: MenuItem;
  quantity: number;
  notes?: string;
  status?: 'pending' | 'cooking' | 'ready' | 'served' | 'cancelled';
}

interface ActiveOrder {
  id: string;
  status: string;
  total_amount: number;
  created_at: string;
  items: {...}[];
}
```

**With**:
```typescript
interface UnifiedCartItem {
  // Database fields (for existing items)
  orderItemId?: string;      // order_items.id
  orderId?: string;          // orders.id
  
  // Item details
  menuItem: MenuItem;
  quantity: number;
  unitPrice: number;         // Price at time of order
  notes?: string;
  
  // Tracking
  isNew: boolean;            // true = new item, false = from database
  isModified: boolean;       // true = quantity changed from original
  originalQuantity?: number; // Original quantity (for detecting changes)
}
```

---

### Step 2: Replace State Declarations

**File**: `OrderKioskSplit.tsx` (around line 132-133)

**Replace**:
```typescript
const [cart, setCart] = useState<CartItem[]>([]);
const [activeOrder, setActiveOrder] = useState<ActiveOrder | null>(null);
```

**With**:
```typescript
const [unifiedCart, setUnifiedCart] = useState<UnifiedCartItem[]>([]);
const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
const [originalOrderId, setOriginalOrderId] = useState<string | null>(null); // Track if modifying existing order
```

---

### Step 3: Simplify addToCart

**Replace the complex addToCart function** with:

```typescript
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
      menuItem,
      quantity: 1,
      unitPrice: menuItem.price,
      isNew: true,
      isModified: false
    }];
  });
};
```

---

### Step 4: Simplify updateQuantity

**Replace the complex updateQuantity function** with:

```typescript
const updateQuantity = (menuItemId: string, delta: number) => {
  setUnifiedCart(prev =>
    prev
      .map(item => {
        if (item.menuItem.id === menuItemId) {
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
```

**Key Point**: No database calls here! Just update the cart state. Database updates happen only on submit.

---

### Step 5: Simplify Total Calculation

**Replace cartTotal and grandTotal with**:

```typescript
const totalAmount = useMemo(() => {
  return unifiedCart.reduce((sum, item) => {
    return sum + (item.unitPrice * item.quantity);
  }, 0);
}, [unifiedCart]);
```

---

### Step 6: Load Existing Order into Unified Cart

**Update `handleTableClick`** to load into unified cart:

```typescript
const handleTableClick = async (table: Table) => {
  setSelectedTable(table);
  setUnifiedCart([]); // Clear cart
  setCurrentOrderId(null);
  
  try {
    // Fetch existing orders for this table
    const result = await offlineQuery(
      async () => {
        const db = (window as any).electronAPI?.db;
        const orders = await db.query('orders', {
          table_id: table.id,
          status: ['pending', 'cooking', 'ready']
        });
        return { data: orders, error: null, fromCache: true };
      },
      { table: 'orders', filters: { table_id: table.id } }
    );
    
    const orders = result.data as any[];
    
    if (orders && orders.length > 0) {
      // Load all order items into unified cart
      const cartItems: UnifiedCartItem[] = [];
      let totalAmount = 0;
      
      // Use first order as the main order
      const mainOrder = orders[0];
      setCurrentOrderId(mainOrder.id);
      setOriginalOrderId(mainOrder.id);
      
      // Fetch order items
      const { localQuery } = await import('@/services/localDataService');
      
      for (const order of orders) {
        const itemsRes = await localQuery('order_items', { 
          order_id: order.id 
        });
        
        for (const orderItem of (itemsRes.data || [])) {
          // Skip served/cancelled items
          if (['served', 'cancelled'].includes(orderItem.status)) continue;
          
          // Find menu item
          const menuItem = menuItems.find(
            m => m.id === orderItem.menu_item_id
          );
          
          if (menuItem) {
            // Check if we already have this menu item (consolidate)
            const existingItem = cartItems.find(
              c => c.menuItem.id === menuItem.id
            );
            
            if (existingItem) {
              // Consolidate - add quantities
              existingItem.quantity += orderItem.quantity;
              existingItem.orderItemId += ',' + orderItem.id; // Track multiple IDs
            } else {
              // Add as existing item from database
              cartItems.push({
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
            
            totalAmount += orderItem.unit_price * orderItem.quantity;
          }
        }
      }
      
      setUnifiedCart(cartItems);
    }
  } catch (error) {
    console.error('Error loading order:', error);
    toast.error('Failed to load order');
  }
};
```

---

### Step 7: Simplified Submit Order

**Replace submitOrder with**:

```typescript
const submitOrder = async () => {
  if (!selectedTable || !currentRestaurant || unifiedCart.length === 0) {
    toast.error('Cart is empty');
    return;
  }
  
  setSubmitting(true);
  
  try {
    // Separate items by type
    const newItems = unifiedCart.filter(item => item.isNew);
    const existingItems = unifiedCart.filter(item => !item.isNew && item.isModified);
    const unchangedItems = unifiedCart.filter(item => !item.isNew && !item.isModified);
    
    // Calculate new total
    const newTotal = unifiedCart.reduce(
      (sum, item) => sum + (item.unitPrice * item.quantity),
      0
    );
    
    // Case 1: No existing order - create new one
    if (!currentOrderId) {
      const orderId = crypto.randomUUID();
      const billNumber = getNextBillNumber();
      
      // Create order
      const orderData = {
        id: orderId,
        restaurant_id: currentRestaurant.id,
        table_id: selectedTable.id,
        total_amount: newTotal,
        status: 'pending',
        bill_number: billNumber,
      };
      
      await offlineMutate('orders', orderData, async () => {
        const db = (window as any).electronAPI?.db;
        await db.insert('orders', orderData);
        return { data: orderData, error: null };
      });
      
      // Create order items
      for (const cartItem of unifiedCart) {
        const orderItem = {
          id: crypto.randomUUID(),
          order_id: orderId,
          menu_item_id: cartItem.menuItem.id,
          quantity: cartItem.quantity,
          unit_price: cartItem.unitPrice,
          status: 'pending',
        };
        
        await offlineMutate('order_items', orderItem, async () => {
          const db = (window as any).electronAPI?.db;
          await db.insert('order_items', orderItem);
          return { data: orderItem, error: null };
        });
      }
      
      toast.success('Order created!');
    }
    
    // Case 2: Existing order - update it
    else {
      // Update order total
      await offlineMutate(
        'orders',
        { id: currentOrderId, total_amount: newTotal },
        async () => {
          const db = (window as any).electronAPI?.db;
          await db.run(
            'UPDATE orders SET total_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [newTotal, currentOrderId]
          );
          return { data: { id: currentOrderId }, error: null };
        }
      );
      
      // Handle new items - insert
      for (const cartItem of newItems) {
        const orderItem = {
          id: crypto.randomUUID(),
          order_id: currentOrderId,
          menu_item_id: cartItem.menuItem.id,
          quantity: cartItem.quantity,
          unit_price: cartItem.unitPrice,
          status: 'pending',
        };
        
        await offlineMutate('order_items', orderItem, async () => {
          const db = (window as any).electronAPI?.db;
          await db.insert('order_items', orderItem);
          return { data: orderItem, error: null };
        });
      }
      
      // Handle modified items - update
      for (const cartItem of existingItems) {
        const orderItemIds = cartItem.orderItemId?.split(',') || [];
        
        for (const orderItemId of orderItemIds) {
          await offlineMutate(
            'order_items',
            {
              id: orderItemId,
              quantity: cartItem.quantity,
              unit_price: cartItem.unitPrice,
            },
            async () => {
              const db = (window as any).electronAPI?.db;
              await db.run(
                'UPDATE order_items SET quantity = ?, unit_price = ? WHERE id = ?',
                [cartItem.quantity, cartItem.unitPrice, orderItemId]
              );
              return { data: { id: orderItemId }, error: null };
            }
          );
        }
      }
      
      // Handle removed items - cancel from database
      // (Items that were in original but not in current cart)
      const originalItems = await fetchOriginalOrderItems(currentOrderId);
      for (const originalItem of originalItems) {
        const stillInCart = unifiedCart.find(
          c => c.orderItemId?.includes(originalItem.id)
        );
        
        if (!stillInCart && !['served', 'cancelled'].includes(originalItem.status)) {
          // Cancel this item
          await offlineMutate(
            'order_items',
            { id: originalItem.id, status: 'cancelled' },
            async () => {
              const db = (window as any).electronAPI?.db;
              await db.run(
                'UPDATE order_items SET status = ? WHERE id = ?',
                ['cancelled', originalItem.id]
              );
              return { data: { id: originalItem.id }, error: null };
            }
          );
        }
      }
      
      toast.success('Order updated!');
    }
    
    // Reset tracking
    setUnifiedCart([]);
    setCurrentOrderId(null);
    setOriginalOrderId(null);
    
    // Refresh to show updated order
    fetchActiveOrder(selectedTable.id);
    
  } catch (error: any) {
    console.error('[submitOrder] Error:', error);
    toast.error(error.message || 'Failed to submit order');
  } finally {
    setSubmitting(false);
  }
};

// Helper to fetch original order items
const fetchOriginalOrderItems = async (orderId: string) => {
  const { localQuery } = await import('@/services/localDataService');
  const result = await localQuery('order_items', { order_id: orderId });
  return result.data || [];
};
```

---

### Step 8: Simplified UI Rendering

**Replace the cart display section with**:

```typescript
{/* Unified Cart Display */}
<div className="space-y-2">
  <h3 className="font-semibold">
    {currentOrderId ? 'Current Order' : 'New Order'}
    {unifiedCart.length > 0 && ` (${unifiedCart.length} items)`}
  </h3>
  
  {unifiedCart.length === 0 ? (
    <p className="text-center text-muted-foreground py-8">
      {currentOrderId ? 'No active items' : 'Add items to start an order'}
    </p>
  ) : (
    <ScrollArea className="h-[400px]">
      <div className="space-y-2">
        {unifiedCart.map((item) => (
          <div
            key={item.menuItem.id}
            className="flex items-center justify-between p-3 bg-card rounded-lg border"
          >
            <div className="flex items-center gap-3 flex-1">
              <FoodTypeIndicator type={item.menuItem.food_type} />
              <div className="flex-1">
                <p className="font-medium">{item.menuItem.name}</p>
                <p className="text-xs text-muted-foreground">
                  ₹{item.unitPrice} each
                  {item.isModified && (
                    <span className="ml-2 text-orange-500">
                      (was {item.originalQuantity})
                    </span>
                  )}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8"
                onClick={() => updateQuantity(item.menuItem.id, -1)}
              >
                <Minus className="w-4 h-4" />
              </Button>
              
              <span className="w-12 text-center font-semibold">
                {item.quantity}
              </span>
              
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8"
                onClick={() => addToCart(item.menuItem)}
              >
                <Plus className="w-4 h-4" />
              </Button>
              
              <span className="w-20 text-right font-semibold">
                ₹{item.unitPrice * item.quantity}
              </span>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  )}
  
  {/* Total and Submit */}
  {unifiedCart.length > 0 && (
    <div className="space-y-3 pt-4 border-t">
      <div className="flex justify-between items-center">
        <span className="text-lg font-semibold">Total</span>
        <span className="text-2xl font-bold">₹{totalAmount}</span>
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
            Send to Kitchen
          </>
        )}
      </Button>
    </div>
  )}
</div>
```

---

### Step 9: Remove Unnecessary State

**Remove these state variables** (no longer needed):
- `activeOrder`
- `cart` (replaced by `unifiedCart`)
- Complex consolidation logic
- Status-based filtering in cart

**Keep**:
- `selectedTable`
- `menuItems`
- `floors`
- Loading states

---

### Step 10: Update Billing Dialog

**Billing dialog remains mostly the same**, but fetch from unified cart or database:

```typescript
const openBilling = async () => {
  if (!selectedTable) return;
  
  // Fetch current order from database
  const { localQuery } = await import('@/services/localDataService');
  const ordersRes = await localQuery('orders', {
    table_id: selectedTable.id,
    status: ['pending', 'cooking', 'ready']
  });
  
  const orders = ordersRes.data || [];
  if (orders.length === 0) {
    toast.error('No active orders');
    return;
  }
  
  // Calculate total from all orders
  let totalAmount = 0;
  const allItems: any[] = [];
  
  for (const order of orders) {
    totalAmount += order.total_amount;
    const itemsRes = await localQuery('order_items', { order_id: order.id });
    
    for (const item of (itemsRes.data || [])) {
      if (!['served', 'cancelled'].includes(item.status)) {
        const menuItem = menuItems.find(m => m.id === item.menu_item_id);
        allItems.push({
          id: item.id,
          menu_item: menuItem,
          quantity: item.quantity,
          unit_price: item.unit_price
        });
      }
    }
  }
  
  // Open billing dialog
  setBillingOrder({
    id: orders[0].id,
    table_id: selectedTable.id,
    total_amount: totalAmount,
    bill_number: orders[0].bill_number,
    table: { /* table info */ },
    order_items: allItems
  });
  
  setShowBillDialog(true);
};
```

---

## Benefits of This Approach

✅ **Single source of truth**: One cart, one total
✅ **Simple operations**: Add, remove, update - no status logic
✅ **Easy to understand**: What you see is what you get
✅ **Reliable**: Database updates only on submit
✅ **Maintainable**: ~300 lines vs ~800 lines
✅ **No race conditions**: State updates are simple
✅ **Clear UX**: Users can modify everything freely

---

## Testing Checklist

- [ ] Add new items to empty cart
- [ ] Click table with existing order - items load correctly
- [ ] Increase quantity of existing item
- [ ] Decrease quantity of existing item
- [ ] Remove item completely (quantity to 0)
- [ ] Add new item to existing order
- [ ] Submit new order - creates in database
- [ ] Submit updated order - updates database
- [ ] Verify totals are correct
- [ ] Open billing dialog - shows correct total
- [ ] Switch tables - cart updates correctly
- [ ] Page refresh - order loads from database

---

## Migration Strategy

1. **Backup current OrderKioskSplit.tsx**
2. **Create new simplified version**
3. **Test side-by-side** (rename file temporarily)
4. **Replace old version** when confident
5. **Remove old code** completely

---

## Estimated Timeline

- **Step 1-5**: Define interfaces and basic functions (1 hour)
- **Step 6-7**: Load and submit logic (1.5 hours)
- **Step 8-9**: UI rendering and cleanup (1 hour)
- **Step 10**: Update billing integration (30 min)
- **Testing**: Comprehensive testing (30 min)

**Total**: ~4-5 hours

---

## Next Steps

Should I proceed with implementing this simplified unified cart system?
