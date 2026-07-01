# Cart & Billing Fix Implementation Plan (Local-First)

## Overview

This plan provides a **step-by-step, prioritized approach** to fix all critical, moderate, and minor issues in the cart and billing system. **Supabase has been removed** - all operations now use local SQLite database via `offlineQuery` and `offlineMutate`.

**Estimated Total Time**: 1-2 days for all fixes

---

## Phase 1: Critical Bug Fixes (Priority 1)

### Fix #1: Inconsistent Status Filtering
**Priority**: CRITICAL - Causes data leakage (cancelled items appearing in cart)
**Estimated Time**: 20 minutes
**Risk**: LOW - Simple filter fix
**Files**: `OrderKioskSplit.tsx`

#### Problem
Different code paths filter order items inconsistently. Some exclude only 'served', others exclude both 'served' and 'cancelled'.

#### Implementation Steps

**Step 1.1**: Create helper function
- **File**: `OrderKioskSplit.tsx`
- **Location**: After line 122 (before component function)
- **Action**: Add helper function
```typescript
const isActiveStatus = (status: string): boolean => {
  return status !== 'served' && status !== 'cancelled';
};
```

**Step 1.2**: Replace ALL status filters with helper
- **File**: `OrderKioskSplit.tsx`
- **Locations**: Lines 332, 369, 435, 453, 701, 715
- **Current Code**: Various (some check 'served', some check both)
- **New Code**: `if (!isActiveStatus(item.status)) continue;`

**Step 1.3**: Test
- Create order with 3 items
- Cancel 1 item
- Switch to different table
- Switch back - verify cancelled item doesn't appear

---

### Fix #2: Recalculate Order Totals After Item Changes
**Priority**: CRITICAL - Billing shows wrong amounts
**Estimated Time**: 1 hour
**Risk**: MEDIUM - Affects billing calculations
**Files**: `OrderKioskSplit.tsx`

#### Problem
When items are cancelled or quantities change, `order.total_amount` is never updated in SQLite database.

#### Implementation Steps

**Step 2.1**: Create recalculate function
- **File**: `OrderKioskSplit.tsx`
- **Location**: After line 1138 (after `updateQuantity` function)
- **Action**: Add new function
```typescript
const recalculateOrderTotal = async (orderId: string, items: ActiveOrder['items']) => {
  const newTotal = items.reduce((sum, item) => {
    // Only count active items (not served/cancelled)
    if (!isActiveStatus(item.status)) return sum;
    return sum + (item.unit_price * item.quantity);
  }, 0);
  
  // Update local state
  setActiveOrder(prev => {
    if (!prev || prev.id !== orderId) return prev;
    return { ...prev, total_amount: newTotal };
  });
  
  // Update SQLite database
  try {
    await offlineMutate(
      'orders',
      { id: orderId, total_amount: newTotal },
      async () => {
        const db = (window as any).electronAPI?.db;
        if (db) {
          await db.run(
            'UPDATE orders SET total_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [newTotal, orderId]
          );
        }
        return { data: { id: orderId, total_amount: newTotal }, error: null };
      }
    );
  } catch (error) {
    console.error('[recalculateOrderTotal] Failed to update order total:', error);
    // Don't throw - local state is already updated
  }
  
  return newTotal;
};
```

**Step 2.2**: Call in `cancelOrderItem` (partial reduction)
- **File**: `OrderKioskSplit.tsx`
- **Location**: Line 946 (after updating activeOrder state)
- **Action**: Add recalculation call
```typescript
// After line 946
if (activeOrder?.id) {
  await recalculateOrderTotal(activeOrder.id, remainingItems);
}
```

**Step 2.3**: Call in `cancelOrderItem` (full cancellation)
- **File**: `OrderKioskSplit.tsx`
- **Location**: Line 966 (after updating activeOrder state)
- **Action**: Add recalculation call
```typescript
// After line 966
if (activeOrder?.id) {
  await recalculateOrderTotal(activeOrder.id, updatedItems);
}
```

**Step 2.4**: Call in `updateQuantity` (quantity reduction)
- **File**: `OrderKioskSplit.tsx`
- **Location**: Line 1119 (after updating activeOrder state)
- **Action**: Add recalculation call
```typescript
// After line 1119
if (activeOrder?.id) {
  await recalculateOrderTotal(activeOrder.id, remainingItems);
}
```

**Step 2.5**: Call in `updateQuantity` (full cancellation)
- **File**: `OrderKioskSplit.tsx`
- **Location**: Line 1025 (after updating activeOrder state)
- **Action**: Add recalculation call
```typescript
// After line 1025
if (activeOrder?.id) {
  await recalculateOrderTotal(activeOrder.id, updatedItems);
}
```

**Step 2.6**: Test
- Create order with items totaling ₹500
- Cancel one item worth ₹100
- Verify order total updates to ₹400
- Open billing dialog - verify shows ₹400

---

### Fix #3: Prevent Race Conditions in Quantity Updates
**Priority**: CRITICAL - Data integrity issue
**Estimated Time**: 45 minutes
**Risk**: LOW - Simple locking mechanism
**Files**: `OrderKioskSplit.tsx`

#### Problem
Rapid clicks on quantity buttons cause concurrent async operations with stale data.

#### Implementation Steps

**Step 3.1**: Add state for update locking
- **File**: `OrderKioskSplit.tsx`
- **Location**: Line 140 (with other state declarations)
- **Action**: Add state
```typescript
const [isUpdatingQuantity, setIsUpdatingQuantity] = useState(false);
```

**Step 3.2**: Add guard to `updateQuantity`
- **File**: `OrderKioskSplit.tsx`
- **Location**: Line 991 (start of function)
- **Action**: Add early return
```typescript
const updateQuantity = async (menuItemId: string, delta: number) => {
  // Prevent concurrent updates
  if (isUpdatingQuantity) {
    toast.info('Please wait...');
    return;
  }
  
  setIsUpdatingQuantity(true);
  
  try {
  } finally {
    setIsUpdatingQuantity(false);
  }
};
```

**Step 3.3**: Disable buttons during updates (UI feedback)
- **File**: `OrderKioskSplit.tsx`
- **Location**: Find the quantity update buttons in cart UI
- **Action**: Add disabled prop
```typescript
<Button
  size="icon"
  variant="outline"
  className="h-7 w-7"
  onClick={() => updateQuantity(item.menuItem.id, -1)}
  disabled={isUpdatingQuantity || cancellingItem}
>
  <Minus className="w-3 h-3" />
</Button>
```

**Step 3.4**: Test
- Rapidly click "-" button 5 times
- Verify only first click processes
- Verify quantity only decreases by 1

---

### Fix #4: Fix addToCart Consolidation Logic
**Priority**: CRITICAL - Core workflow issue
**Estimated Time**: 45 minutes
**Risk**: MEDIUM - Changes user behavior
**Files**: `OrderKioskSplit.tsx`

#### Problem
When adding a menu item that already exists as "pending", it increments the pending quantity instead of creating a new separate item.

#### Implementation Steps

**Step 4.1**: Replace `addToCart` function
- **File**: `OrderKioskSplit.tsx`
- **Location**: Lines 742-771
- **Action**: Replace entire function
```typescript
const addToCart = (menuItem: MenuItem) => {
  setCart(prev => {
    // ONLY consolidate with new items (no status)
    const existingNewItem = prev.find(
      item => item.menuItem.id === menuItem.id && !item.status
    );
    
    if (existingNewItem) {
      // Consolidate with existing new item
      return prev.map(item =>
        item.menuItem.id === menuItem.id && !item.status
          ? { ...item, quantity: item.quantity + 1 }
          : item
      );
    }
    
    // ALWAYS create new item without status
    // Never add to pending/cooking/ready items - those are already in kitchen
    return [...prev, { menuItem, quantity: 1 }];
  });
};
```

**Step 4.2**: Update UI to show visual distinction
- **File**: `OrderKioskSplit.tsx`
- **Location**: Cart items display section
- **Action**: Add visual indicator for pending vs new items
```typescript
// In cart item rendering:
{item.status && (
  <Badge variant="outline" className="text-xs">
    {item.status}
  </Badge>
)}
{!item.status && (
  <Badge variant="secondary" className="text-xs">
    New
  </Badge>
)}
```

**Step 4.3**: Test
- Add Item A (qty 1) → cart shows "Item A × 1 (New)"
- Submit to kitchen → cart shows "Item A × 1 (pending)"
- Add Item A again → cart shows TWO entries:
  - "Item A × 1 (pending)"
  - "Item A × 1 (New)"

---

## Phase 2: Moderate Issues (Priority 2)

### Fix #5: Fix Mutable State Updates
**Priority**: MODERATE - React best practice
**Estimated Time**: 30 minutes
**Risk**: LOW - Pure refactoring
**Files**: `OrderKioskSplit.tsx`

#### Problem
Direct mutation of state objects instead of creating new references.

#### Implementation Steps

**Step 5.1**: Fix in `updateQuantity` (line 1079)
- **Current**: `existingItem.quantity = newQty;`
- **New**: Use immutable update
```typescript
setCart(prev => {
  const filtered = prev.filter(i => !(i.menuItem.id === menuItemId && i.status === 'pending'));
  
  if (newQty > 0) {
    const menuItem = prev.find(i => i.menuItem.id === menuItemId)?.menuItem;
    if (menuItem) {
      filtered.push({ menuItem, quantity: newQty, status: 'pending' });
    }
  }
  
  return filtered;
});
```

**Step 5.2**: Fix in `cancelOrderItem` (line 917)
- **Current**: Direct mutation pattern
- **New**: Use immutable update (same pattern as 5.1)

**Step 5.3**: Test
- Update quantities
- Verify UI updates correctly

---

### Fix #6: Track Order Item IDs in Cart
**Priority**: MODERATE - Needed for proper cancellation
**Estimated Time**: 1.5 hours
**Risk**: MEDIUM - Changes CartItem interface
**Files**: `OrderKioskSplit.tsx`

#### Problem
When consolidating multiple order_items into one cart item, individual IDs are lost.

#### Implementation Steps

**Step 6.1**: Update CartItem interface
- **File**: `OrderKioskSplit.tsx`
- **Location**: Line 73-78
- **Action**: Add orderItemIds array
```typescript
interface CartItem {
  menuItem: MenuItem;
  quantity: number;
  notes?: string;
  status?: 'pending' | 'cooking' | 'ready' | 'served' | 'cancelled';
  orderItemIds?: string[]; // Track all order_item.id values this represents
}
```

**Step 6.2**: Update ALL consolidation logic to track IDs
- **Locations**: 
  - `fetchActiveOrder` (lines 343-349)
  - `handleTableClick` (lines 704-707, 718-721)
  - `reloadTableData` (lines 439-444, 457-462)
- **Action**: Track IDs when consolidating
```typescript
const existingCartItem = cartItems.find(
  c => c.menuItem.id === menuItem.id && c.status === item.status
);
if (existingCartItem) {
  existingCartItem.quantity += item.quantity;
  existingCartItem.orderItemIds = [
    ...(existingCartItem.orderItemIds || []),
    item.id
  ];
} else {
  cartItems.push({ 
    menuItem, 
    quantity: item.quantity, 
    status: item.status,
    orderItemIds: [item.id]
  });
}
```

**Step 6.3**: Update `cancelOrderItem` to use tracked IDs
- **File**: `OrderKioskSplit.tsx`
- **Location**: Line 876+
- **Action**: Use orderItemIds for precise cancellation

**Step 6.4**: Test
- Create order with 2x Item A, submit again with 3x Item A
- Cart should show "Item A × 5" with orderItemIds: ['id1', 'id2']
- Cancel 2 items - verify correct order_items are updated

---

### Fix #7: Unify Total Calculation
**Priority**: MODERATE - Billing accuracy
**Estimated Time**: 1 hour
**Risk**: MEDIUM - Changes multiple calculations
**Files**: `OrderKioskSplit.tsx`

#### Problem
Multiple total calculations (`cartTotal`, `grandTotal`, `activeOrder.total_amount`) cause confusion.

#### Implementation Steps

**Step 7.1**: Create single source of truth function
- **File**: `OrderKioskSplit.tsx`
- **Location**: After line 1138
- **Action**: Add calculation function
```typescript
const calculateTotalFromItems = (items: typeof cart): number => {
  return items.reduce((sum, item) => {
    // Only count active items
    if (item.status && !isActiveStatus(item.status)) return sum;
    return sum + (item.menuItem.price * item.quantity);
  }, 0);
};
```

**Step 7.2**: Replace `cartTotal` calculation
- **File**: `OrderKioskSplit.tsx`
- **Location**: Lines 1140-1142
- **Action**: Use new function
```typescript
const cartTotal = useMemo(() => {
  return calculateTotalFromItems(cart);
}, [cart]);
```

**Step 7.3**: Replace `grandTotal` calculation
- **File**: `OrderKioskSplit.tsx`
- **Location**: Lines 1310-1321
- **Action**: Simplify to use cart only
```typescript
const grandTotal = useMemo(() => {
  // Cart contains all items (active order + new items)
  // Just calculate from cart directly
  return calculateTotalFromItems(cart);
}, [cart]);
```

**Step 7.4**: Test
- Add items to cart - verify total correct
- Submit to kitchen - verify total unchanged
- Cancel items - verify total decreases
- Compare with billing dialog total - should match

---

### Fix #8: Add Comprehensive Error Handling
**Priority**: MODERATE - Reliability
**Estimated Time**: 1.5 hours
**Risk**: LOW - Adding try-catch blocks
**Files**: `OrderKioskSplit.tsx`

#### Problem
Some async operations have no error handling, failures are silent.

#### Implementation Steps

**Step 8.1**: Wrap `updateQuantity` in try-catch with rollback
- **File**: `OrderKioskSplit.tsx`
- **Location**: Line 991+
- **Action**: Add complete error recovery
```typescript
const updateQuantity = async (menuItemId: string, delta: number) => {
  if (isUpdatingQuantity) return;
  
  setIsUpdatingQuantity(true);
  
  // Store previous state for rollback
  const prevCart = [...cart];
  const prevOrder = activeOrder ? {...activeOrder} : null;
  
  try {
    // ... existing logic ...
  } catch (error: any) {
    console.error('[updateQuantity] Error:', error);
    toast.error('Failed to update quantity. Please try again.');
    
    // Rollback to previous state
    setCart(prevCart);
    if (prevOrder) setActiveOrder(prevOrder);
  } finally {
    setIsUpdatingQuantity(false);
  }
};
```

**Step 8.2**: Add error handling to `fetchActiveOrder`
- **File**: `OrderKioskSplit.tsx`
- **Location**: Lines 397-399
- **Action**: Show user-friendly message
```typescript
} catch (error: any) {
  console.error('[fetchActiveOrder] Error:', error);
  toast.error('Failed to load order data. Please refresh.');
}
```

**Step 8.3**: Test
- Simulate database error
- Verify error message shows
- Verify UI doesn't break

---

## Phase 3: Minor Issues & Improvements (Priority 3)

### Fix #9: Fix Stale Closure in Keyboard Handler
**Priority**: MINOR - UX improvement
**Estimated Time**: 20 minutes
**Risk**: LOW
**Files**: `OrderKioskSplit.tsx`

#### Implementation Steps

**Step 9.1**: Use refs for latest values
- **File**: `OrderKioskSplit.tsx`
- **Location**: Line 1252+
- **Action**: Use refs instead of dependencies
```typescript
const cartRef = useRef(cart);
cartRef.current = cart;

useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    const newItems = cartRef.current.filter(item => !item.status);
    
    if (e.key === 'Enter' && !isInputField && newItems.length > 0 && selectedTable) {
      e.preventDefault();
      submitOrder();
    }
  };
  
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [selectedTable, submitOrder]);
```

---

### Fix #10: Add Validation for Quantities
**Priority**: MINOR - Edge case protection
**Estimated Time**: 15 minutes
**Risk**: LOW
**Files**: `OrderKioskSplit.tsx`

#### Implementation Steps

**Step 10.1**: Add validation in `updateQuantity`
- **Location**: After calculating newQty
- **Action**: Add validation
```typescript
if (newQty < 0) {
  console.error('[updateQuantity] Negative quantity detected:', newQty);
  newQty = 0;
}

if (newQty > 999) {
  toast.error('Maximum quantity is 999');
  return;
}
```

---

### Fix #11: Fix Billing Dialog Grouping
**Priority**: MINOR - Edge case
**Estimated Time**: 20 minutes
**Risk**: LOW
**Files**: `BillingDialog.tsx`

#### Implementation Steps

**Step 11.1**: Change grouping key from name to ID
- **File**: `BillingDialog.tsx`
- **Location**: Line 93-113
- **Action**: Use menu_item_id instead of name
```typescript
const groupOrderItems = (items: OrderItem[]) => {
  const grouped = new Map<string, {...}>();
  
  items.forEach(item => {
    // Use menu_item_id as key (more reliable than name)
    const key = item.menu_item_id || 'unknown';
    if (grouped.has(key)) {
      const existing = grouped.get(key)!;
      existing.quantity += item.quantity;
      existing.total += item.unit_price * item.quantity;
    } else {
      grouped.set(key, {
        name: item.menu_item?.name || 'Item',
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.unit_price * item.quantity,
      });
    }
  });
  
  return Array.from(grouped.values());
};
```

---

## Phase 4: Storage Consistency (Priority 4)

### Fix #12: Persist Cart State to localStorage
**Priority**: LOW - Nice to have
**Estimated Time**: 1 hour
**Risk**: LOW
**Files**: `OrderKioskSplit.tsx`

#### Implementation Steps

**Step 12.1**: Load cart from localStorage on table selection
- **Location**: In `handleTableClick` after loading order
- **Action**: Check localStorage
```typescript
// After loading existing order
const savedCart = localStorage.getItem(`cart_${table.id}`);
if (savedCart && cart.length === 0) {
  try {
    const parsed = JSON.parse(savedCart);
    setCart(parsed);
  } catch (e) {
    console.error('Failed to load saved cart');
  }
}
```

**Step 12.2**: Save cart to localStorage on change
- **Action**: Add useEffect
```typescript
useEffect(() => {
  if (selectedTable && cart.length > 0) {
    localStorage.setItem(`cart_${selectedTable.id}`, JSON.stringify(cart));
  }
}, [cart, selectedTable]);
```

**Step 12.3**: Clear cart after successful submit
- **Location**: In `submitOrder` after success
- **Action**: Clear localStorage
```typescript
localStorage.removeItem(`cart_${selectedTable.id}`);
```

**Step 12.4**: Test
- Add items to cart
- Refresh page
- Verify cart is restored
- Submit order
- Verify cart is cleared

---

## Testing Strategy

### Unit Tests (Per Fix)
Each fix should be tested independently:

1. **Fix #1**: Test status filtering with all combinations
2. **Fix #2**: Verify totals update in SQLite database
3. **Fix #3**: Rapid click test (10 clicks in 1 second)
4. **Fix #4**: Test all consolidation scenarios
5. **Fix #5**: Verify React DevTools shows proper state updates
6. **Fix #6**: Test cancellation with multiple order_items
7. **Fix #7**: Compare all total calculations - should match
8. **Fix #8**: Simulate database error, verify error handling
9. **Fix #9**: Test keyboard shortcuts
10. **Fix #10**: Try to set quantity to -1, 1000
11. **Fix #11**: Create items with same name, different IDs
12. **Fix #12**: Refresh page, verify cart persists

### Integration Tests
After all fixes:

1. **Complete order flow**: Add items → submit → add more → bill → pay
2. **Cancellation flow**: Add items → cancel some → verify totals
3. **Multi-table**: Switch between tables, verify cart isolation
4. **Offline mode**: All operations work without network

---

## Implementation Order Recommendation

**Day 1 - Morning** (3 hours):
- Fix #1: Status filtering (20 min)
- Fix #3: Race condition prevention (45 min)
- Fix #4: addToCart consolidation (45 min)
- Fix #2: Order total recalculation (1 hr)

**Day 1 - Afternoon** (3 hours):
- Fix #5: Mutable state updates (30 min)
- Fix #7: Unify total calculation (1 hr)
- Fix #8: Error handling (1.5 hrs)

**Day 2 - Morning** (2.5 hours):
- Fix #6: Track order item IDs (1.5 hrs)
- Fix #9: Keyboard handler (20 min)
- Fix #10: Quantity validation (15 min)
- Fix #11: Billing dialog grouping (20 min)

**Day 2 - Afternoon** (1.5 hours):
- Fix #12: Cart persistence (1 hr)
- Integration testing (30 min)

---

## Notes

- **All Supabase code removed** - using SQLite via offlineQuery/offlineMutate
- **Commit after each fix** with descriptive message
- **Test thoroughly** before moving to next fix
- **Backup SQLite database** before starting (located in electron data directory)

---

## Success Criteria

✅ **Phase 1 Complete**:
- No cancelled items in cart
- Order totals always match sum of items
- No race conditions on rapid clicks
- New items separate from pending items

✅ **Phase 2 Complete**:
- All state updates immutable
- Cart tracks order_item IDs
- Single total calculation source
- All errors caught and displayed

✅ **Phase 3 Complete**:
- No stale closures
- Quantity validation works
- Billing groups by ID not name

✅ **Phase 4 Complete**:
- Cart persists across page refresh
- Cart cleared after submission
