# Unified Cart Migration Guide

## What's Been Done ✅

1. ✅ Replaced `CartItem` and `ActiveOrder` interfaces with `UnifiedCartItem`
2. ✅ Updated state declarations:
   - Removed: `cart`, `activeOrder`
   - Added: `unifiedCart`, `currentOrderId`
3. ✅ Implemented simplified functions:
   - `addToCart` - Just increment quantity
   - `updateQuantity` - Just change quantity, no DB calls
   - `removeFromCart` - Filter out item
   - `totalAmount` - Simple reduce calculation

## What Needs To Be Updated 📝

### 1. Remove Old Functions (Delete These)

Search for and DELETE these functions entirely:
- `fetchActiveOrder` (lines ~291-400) - We'll create a simpler version
- `reloadTableData` (lines ~403-470) - No longer needed
- `cancelOrderItem` (lines ~876-978) - Replace with simple removeFromCart
- `findOrderItemId` (lines ~980-989) - No longer needed
- Old `updateQuantity` (complex version with DB calls) - Already replaced
- `groupCartItems` - Already removed

### 2. Update handleTableClick (Replace Completely)

**Current**: Loads into separate `cart` and `activeOrder`
**New**: Load everything into `unifiedCart`

```typescript
const handleTableClick = async (table: Table) => {
  setSelectedTable(table);
  setUnifiedCart([]); // Clear cart
  setCurrentOrderId(null);
  
  try {
    // Fetch existing orders for this table from SQLite
    const { localQuery } = await import('@/services/localDataService');
    const ordersRes = await localQuery('orders', {
      table_id: table.id
    });
    
    const orders = (ordersRes.data || []).filter((o: any) => 
      ['pending', 'cooking', 'ready'].includes(o.status)
    );
    
    if (orders && orders.length > 0) {
      // Load all order items into unified cart
      const cartItems: UnifiedCartItem[] = [];
      
      // Use first order as the main order
      const mainOrder = orders[0];
      setCurrentOrderId(mainOrder.id);
      
      for (const order of orders) {
        const itemsRes = await localQuery('order_items', { 
          order_id: order.id 
        });
        
        for (const orderItem of (itemsRes.data || [])) {
          // Skip served/cancelled items
          if (['served', 'cancelled'].includes(orderItem.status)) continue;
          
          // Find menu item
          const menuItem = menuItems.find(
            (m: any) => m.id === orderItem.menu_item_id
          );
          
          if (menuItem) {
            // Add to unified cart
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
      }
      
      setUnifiedCart(cartItems);
    }
  } catch (error) {
    console.error('Error loading order:', error);
    toast.error('Failed to load order');
  }
};
```

### 3. Replace submitOrder (Complete Rewrite)

```typescript
const submitOrder = async () => {
  if (!selectedTable || !currentRestaurant || unifiedCart.length === 0) {
    toast.error('Cart is empty');
    return;
  }
  
  setSubmitting(true);
  
  try {
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
      
      const db = (window as any).electronAPI?.db;
      await db.insert('orders', orderData);
      
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
        
        await db.insert('order_items', orderItem);
      }
      
      toast.success('Order created!');
    }
    
    // Case 2: Existing order - update it
    else {
      const db = (window as any).electronAPI?.db;
      
      // Update order total
      await db.run(
        'UPDATE orders SET total_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [newTotal, currentOrderId]
      );
      
      // Handle new items - insert
      const newItems = unifiedCart.filter(item => item.isNew);
      for (const cartItem of newItems) {
        const orderItem = {
          id: crypto.randomUUID(),
          order_id: currentOrderId,
          menu_item_id: cartItem.menuItem.id,
          quantity: cartItem.quantity,
          unit_price: cartItem.unitPrice,
          status: 'pending',
        };
        
        await db.insert('order_items', orderItem);
      }
      
      // Handle modified items - update
      const modifiedItems = unifiedCart.filter(
        item => !item.isNew && item.isModified && item.orderItemId
      );
      
      for (const cartItem of modifiedItems) {
        await db.run(
          'UPDATE order_items SET quantity = ?, unit_price = ? WHERE id = ?',
          [cartItem.quantity, cartItem.unitPrice, cartItem.orderItemId]
        );
      }
      
      // Handle removed items - cancel from database
      const allOrderItems = await db.query('order_items', { 
        order_id: currentOrderId 
      });
      
      for (const dbItem of (allOrderItems || [])) {
        if (['served', 'cancelled'].includes(dbItem.status)) continue;
        
        // Check if this item is still in cart
        const stillInCart = unifiedCart.find(
          c => c.orderItemId === dbItem.id
        );
        
        if (!stillInCart) {
          // Cancel this item
          await db.run(
            'UPDATE order_items SET status = ? WHERE id = ?',
            ['cancelled', dbItem.id]
          );
        }
      }
      
      toast.success('Order updated!');
    }
    
    // Reset and reload
    setUnifiedCart([]);
    setCurrentOrderId(null);
    
    // Reload to show updated order
    if (selectedTable) {
      handleTableClick(selectedTable);
    }
    
  } catch (error: any) {
    console.error('[submitOrder] Error:', error);
    toast.error(error.message || 'Failed to submit order');
  } finally {
    setSubmitting(false);
  }
};
```

### 4. Update All References

Search and replace throughout the file:

| Old Code | New Code |
|----------|----------|
| `cart` | `unifiedCart` |
| `setCart(...)` | `setUnifiedCart(...)` |
| `activeOrder` | `currentOrderId ? { items: unifiedCart.filter(i => !i.isNew), total_amount: totalAmount } : null` |
| `setActiveOrder(...)` | Remove or update unifiedCart |
| `cartTotal` | `totalAmount` |
| `grandTotal` | `totalAmount` |
| `item.status` | Remove or check `item.isNew` |
| `item.menuItem.id` | `item.cartItemId` (for updates) |

### 5. Update UI Rendering

Replace the cart display section with:

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
            key={item.cartItemId}
            className="flex items-center justify-between p-3 bg-card rounded-lg border"
          >
            <div className="flex items-center gap-3 flex-1">
              <FoodTypeIndicator type={item.menuItem.food_type} />
              <div className="flex-1">
                <p className="font-medium">{item.menuItem.name}</p>
                <p className="text-xs text-muted-foreground">
                  ₹{item.unitPrice} each
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8"
                onClick={() => updateQuantity(item.cartItemId, -1)}
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
                onClick={() => updateQuantity(item.cartItemId, 1)}
              >
                <Plus className="w-4 h-4" />
              </Button>
              
              <span className="w-20 text-right font-semibold">
                ₹{item.unitPrice * item.quantity}
              </span>
              
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-destructive"
                onClick={() => removeFromCart(item.cartItemId)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
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

### 6. Remove Unused Variables

Delete these from the component:
- Any references to `activeOrder.items`
- Any references to `activeOrder.total_amount`
- `hasNewItems` (no longer needed)
- `newItemsTotal` (no longer needed)
- `cartTotal` (replaced by `totalAmount`)
- `grandTotal` (replaced by `totalAmount`)

### 7. Update Billing Dialog

The billing dialog should fetch from database directly:

```typescript
const openBilling = async () => {
  if (!selectedTable) {
    toast.error('No table selected');
    return;
  }
  
  try {
    const { localQuery } = await import('@/services/localDataService');
    
    // Fetch all active orders for this table
    const ordersRes = await localQuery('orders', {
      table_id: selectedTable.id
    });
    
    const orders = (ordersRes.data || []).filter((o: any) => 
      ['pending', 'cooking', 'ready'].includes(o.status)
    );
    
    if (orders.length === 0) {
      toast.error('No active orders');
      return;
    }
    
    // Calculate total and collect items
    let totalAmount = 0;
    const allItems: any[] = [];
    
    for (const order of orders) {
      totalAmount += order.total_amount || 0;
      
      const itemsRes = await localQuery('order_items', { 
        order_id: order.id 
      });
      
      for (const item of (itemsRes.data || [])) {
        if (!['served', 'cancelled'].includes(item.status)) {
          const menuItem = menuItems.find((m: any) => m.id === item.menu_item_id);
          allItems.push({
            id: item.id,
            menu_item: menuItem,
            quantity: item.quantity,
            unit_price: item.unit_price
          });
        }
      }
    }
    
    // Set billing order
    setBillingOrder({
      id: orders[0].id,
      table_id: selectedTable.id,
      total_amount: totalAmount,
      bill_number: orders[0].bill_number,
      table: {
        table_number: selectedTable.table_number,
        floor: { name: '' } // Add floor lookup if needed
      },
      order_items: allItems
    });
    
    setShowBillDialog(true);
  } catch (error) {
    console.error('Error opening billing:', error);
    toast.error('Failed to open billing');
  }
};
```

## Testing Checklist

After making all changes:

- [ ] TypeScript compiles without errors
- [ ] Can add items to empty cart
- [ ] Can click table with existing order - items load
- [ ] Can increase quantity of any item
- [ ] Can decrease quantity of any item
- [ ] Can remove item completely
- [ ] Submit new order creates in database
- [ ] Submit update modifies database correctly
- [ ] Totals are correct everywhere
- [ ] Billing dialog shows correct total
- [ ] Switching tables works correctly

## Estimated Time

- **Step 1-2**: Remove old functions (30 min)
- **Step 3**: Update handleTableClick (30 min)
- **Step 4**: Replace submitOrder (45 min)
- **Step 5**: Update all references (1 hour)
- **Step 6**: Update UI rendering (45 min)
- **Step 7**: Update billing dialog (30 min)
- **Step 8**: Testing (30 min)

**Total**: ~4-5 hours
