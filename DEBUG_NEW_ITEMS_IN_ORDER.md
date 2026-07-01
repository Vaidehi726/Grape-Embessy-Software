# Debugging: Adding New Items to Existing Order

## Issue Description
After creating an order and clicking "Send to Kitchen", attempting to add NEW menu items to the same order fails to save them. However, modifying quantities of existing items works correctly.

## Debugging Added

I've added comprehensive console logging to trace the exact flow:

### 1. Order Loading (`loadTableOrder`)
- Logs when an order is loaded
- Shows all cart items with their properties:
  - `name`: Menu item name
  - `quantity`: Current quantity
  - `isNew`: Whether it's a new item (should be `false` for loaded items)
  - `orderItemId`: Database ID (should be set for loaded items)

### 2. Order Submission (`submitOrder`)
- Logs which case is being executed (new order vs existing order)
- Validates that `currentOrderId` is set for existing orders
- Shows all cart items before processing:
  - `isNew` flags
  - `isModified` flags  
  - `orderItemId` values
  - Quantities
- Logs each new item being inserted into the database
- Confirms successful insertion or logs errors

## Testing Steps

### Step 1: Create Initial Order
1. Select a table
2. Add 2-3 menu items
3. Click "Send to Kitchen"
4. **Check console for:**
   ```
   [submitOrder] Creating new order
   [submitOrder] Order created!
   [loadTableOrder] Loaded X items for order: <uuid>
   [loadTableOrder] Cart items: [...]
   ```

### Step 2: Add New Items
1. With the same table still selected, add a NEW menu item (one not in the original order)
2. **Check console for:**
   ```
   [addToCart] Adding: <item name>
   ```
3. Verify the item appears in the cart with `isNew: true`

### Step 3: Submit Updated Order
1. Click "Send to Kitchen" again
2. **Check console for:**
   ```
   [submitOrder] Updating existing order: <uuid>
   [submitOrder] Cart items: [
     { name: "Item1", isNew: false, isModified: false, ... },  // Original item
     { name: "NewItem", isNew: true, isModified: false, ... }  // New item
   ]
   [submitOrder] New items to insert: 1 ["NewItem"]
   [submitOrder] Inserting new order_item: { id: ..., order_id: ..., ... }
   [submitOrder] ✓ Successfully inserted: NewItem
   [submitOrder] All new items inserted successfully
   ```

### Step 4: Verify in Database
1. After submission, the order should reload
2. **Check console for:**
   ```
   [loadTableOrder] Loaded X items for order: <uuid>
   [loadTableOrder] Cart items: [
     // Should now include the new item with isNew: false
   ]
   ```

## Expected Behavior

### Scenario A: Adding Completely New Item
- Item should have `isNew: true` in cart
- Should be inserted into `order_items` table
- After reload, item should show with `isNew: false`

### Scenario B: Increasing Quantity of Existing Item
- Item should have `isModified: true` in cart
- Should update existing `order_items` record
- After reload, quantity should be updated

### Scenario C: Adding Item That's Already in Order
- Item should have `isModified: true` (quantity increases)
- Should update existing record, NOT create new one
- This is correct behavior

## Common Issues to Look For

### Issue 1: currentOrderId is null
**Console shows:**
```
[submitOrder] ERROR: currentOrderId is null/undefined but we're in Case 2!
```

**Cause:** Order wasn't loaded properly or state was cleared
**Fix:** Reload the table by clicking on it again

### Issue 2: No new items detected
**Console shows:**
```
[submitOrder] New items to insert: 0 []
```

**Cause:** Items are not marked as `isNew: true`
**Possible reasons:**
- Items were already in the order
- Cart state wasn't updated correctly
- `addToCart` function has a bug

### Issue 3: Insert fails
**Console shows:**
```
[submitOrder] Failed to insert new item: ItemName Error: ...
```

**Cause:** Database constraint violation or connection issue
**Fix:** Check error message for details

### Issue 4: Item appears to be added but isn't saved
**Console shows:** Successful insertion, but item doesn't appear after reload

**Cause:** 
- `loadTableOrder` query might be filtering it out
- Order items might have wrong status
- Database transaction issue

## Next Steps

After testing with the logging:
1. Share the console output showing the exact flow
2. Note which scenario matches your issue
3. I'll provide a targeted fix based on the actual behavior

## Files Modified
- `/src/pages/dashboard/OrderKioskUnified.tsx` - Added comprehensive logging

## How to Remove Logging After Fix
Once the issue is resolved, we can remove all `console.log` statements to clean up the code.
