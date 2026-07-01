# BUG FIX: New Items Being Cancelled After Insertion

## Problem Description
After creating an order and clicking "Send to Kitchen", adding NEW menu items to the existing order would fail. The items were being inserted into the database successfully, but immediately marked as 'cancelled', causing them to not appear when the order was reloaded.

## Root Cause Analysis

### The Bug Flow
1. User adds new item to cart → Item has `isNew: true` and **NO** `orderItemId`
2. User clicks "Send to Kitchen" → `submitOrder` runs
3. New item is inserted into database with a new UUID (e.g., `909d6c67-...`)
4. **BUG:** The "Handle removed items" section runs (lines 660-675)
5. It queries ALL order_items from database (including the newly inserted one)
6. For each database item, it checks: `unifiedCart.find(c => c.orderItemId === dbItem.id)`
7. For the new item: `undefined === '909d6c67-...'` → `false` (not found in cart)
8. Code thinks item was removed → **Marks it as 'cancelled'** ❌
9. Order reloads → Filter skips 'cancelled' items → New item doesn't appear

### Why Existing Items Worked
- Existing items loaded from DB have `orderItemId` set to their database ID
- When checking `c.orderItemId === dbItem.id`, it matches correctly
- So existing items are not cancelled

### Why Quantity Modifications Worked
- Modifying quantity marks item as `isModified: true`, NOT `isNew: true`
- Item already has `orderItemId` from initial load
- Goes through "Handle modified items" section, not "Handle new items"
- Not affected by the bug

## The Fix

### Solution: Track Newly Inserted Items
Added a `Set` to track the IDs of newly inserted items, and skip them in the "removed items" check.

### Code Changes

#### 1. Track New Item IDs (Line 597)
```typescript
const newItems = unifiedCart.filter(item => item.isNew);
const newlyInsertedItemIds = new Set<string>(); // Track newly inserted item IDs
```

#### 2. Add Inserted IDs to Set (Line 634)
```typescript
await db.upsert('order_items', {
  id: newItemId,
  order_id: currentOrderId,
  menu_item_id: cartItem.menuItem.id,
  quantity: cartItem.quantity,
  unit_price: cartItem.unitPrice,
  status: 'pending',
});

newlyInsertedItemIds.add(newItemId); // Track this newly inserted item
```

#### 3. Skip New Items in Removal Check (Lines 669-673)
```typescript
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
```

## Testing Verification

### Before Fix (Console Output)
```
[submitOrder] Inserting new order_item: {id: '909d6c67-...', ...}
[submitOrder] ✓ Successfully inserted: bb
[submitOrder] All new items inserted successfully
[loadTableOrder] Found 2 order_items in database
[loadTableOrder] Skipping item (status: cancelled): 909d6c67-...  ❌
[loadTableOrder] Loaded 1 items  ❌ (Should be 2)
```

### After Fix (Expected Console Output)
```
[submitOrder] Inserting new order_item: {id: '909d6c67-...', ...}
[submitOrder] ✓ Successfully inserted: bb
[submitOrder] Skipping newly inserted item: 909d6c67-...  ✅
[submitOrder] All new items inserted successfully
[loadTableOrder] Found 2 order_items in database
[loadTableOrder] Loaded 2 items  ✅ (Correct!)
```

## Impact Analysis

### What This Fixes
✅ Adding new items to existing orders now works correctly
✅ Items persist in database and appear after reload
✅ Cart state accurately reflects database state

### What This Doesn't Break
✅ Existing item quantity modifications still work
✅ Removing items from cart still cancels them correctly
✅ New order creation still works
✅ All other order operations unaffected

### Edge Cases Handled
- Multiple new items added at once → All tracked in Set
- Mix of new, modified, and removed items → Each handled correctly
- Error during insertion → Set only contains successfully inserted items

## Files Modified
- `/src/pages/dashboard/OrderKioskUnified.tsx` - Added tracking Set and skip logic

## Additional Debugging Added
- Log when newly inserted items are skipped in removal check
- Log when items are actually cancelled (for verification)

## Future Improvements (Optional)
Consider updating cart items with their `orderItemId` immediately after insertion to maintain consistency:
```typescript
// After successful insertion:
setUnifiedCart(prev => 
  prev.map(item => 
    item.cartItemId === cartItem.cartItemId 
      ? { ...item, orderItemId: newItemId, isNew: false }
      : item
  )
);
```
This would make the cart state more accurate, but is not strictly necessary since we clear and reload the cart after submission anyway.
