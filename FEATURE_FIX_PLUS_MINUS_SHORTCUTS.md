# FEATURE FIX: +/- Keyboard Shortcuts for Single Search Result

## Problem Description
When a user searched for menu items by typing a shortcut code number and the search filtered down to exactly one matching item, pressing the `+` and `-` keys did NOT work to add/remove that item from the cart. The keyboard shortcuts only worked when NOT focused in the search input field.

## Root Cause
The `+` and `-` key handlers were placed **inside** the `!isInputField` condition block (line 908), which meant they only executed when the user was NOT in an input field. Since users type their search in the menu search input, the shortcuts would never trigger when needed.

### Before Fix (Lines 907-937)
```typescript
// Number keys 1-9: Add menu item by shortcut code (only if not in input field)
if (!isInputField && !e.ctrlKey && !e.metaKey && !e.altKey) {
  const key = e.key;
  if (/^[1-9]$/.test(key)) {
    // ... shortcut code handling
  }
  
  // ❌ PROBLEM: +/- handlers inside !isInputField block
  if (singleMenuItem && selectedTable) {
    if (key === '+' || key === '=') {
      // This never runs when user is typing in search!
    }
  }
}
```

## The Fix
Moved the `+` and `-` key handlers **outside** the `!isInputField` condition so they work even when the user is focused in the search input field.

### After Fix (Lines 907-938)
```typescript
// Number keys 1-9: Add menu item by shortcut code (only if not in input field)
if (!isInputField && !e.ctrlKey && !e.metaKey && !e.altKey) {
  const key = e.key;
  if (/^[1-9]$/.test(key)) {
    // ... shortcut code handling
  }
}

// ✅ FIXED: +/- handlers now outside !isInputField block
if (singleMenuItem && selectedTable && !e.ctrlKey && !e.metaKey && !e.altKey) {
  const key = e.key;
  if (key === '+' || key === '=') {
    e.preventDefault();
    addToCart(singleMenuItem);  // Works even in search input!
    return;
  } else if (key === '-' || key === '_') {
    e.preventDefault();
    const cartItem = unifiedCart.find(item => item.menuItem.id === singleMenuItem.id);
    if (cartItem) {
      updateQuantity(cartItem.cartItemId, -1);  // Works even in search input!
    }
    return;
  }
}
```

## How It Works Now

### Workflow
1. **User types search query** in menu search input (e.g., types "3")
2. **Search filters menu items** → If only 1 item matches, `singleMenuItem` state is set
3. **UI shows +/- badge hint** in search bar indicating shortcuts are available
4. **User presses `+` key** (even while still in search input):
   - Calls `addToCart(singleMenuItem)` 
   - Adds item to cart with quantity 1 (or increments if already in cart)
   - Item appears in unified cart
5. **User presses `-` key**:
   - Finds the cart item matching `singleMenuItem`
   - Decreases quantity by 1
   - If quantity reaches 0, item is removed from cart

### Conditions for +/- to Work
✅ `singleMenuItem` is not null (exactly one search result)
✅ `selectedTable` is not null (a table is selected)
✅ No modifier keys pressed (Ctrl, Cmd, Alt)
✅ Key is `+`, `=`, `-`, or `_`

## Testing Scenarios

### Scenario 1: Add New Item via + Key
1. Select a table
2. Type "3" in menu search (assuming shortcut code "3" exists)
3. Search shows 1 result: "Item C"
4. Press `+` key
5. **Expected:** "Item C" added to cart with quantity 1

### Scenario 2: Increase Quantity via + Key
1. "Item C" already in cart with quantity 2
2. Search for "Item C" (only 1 result)
3. Press `+` key twice
4. **Expected:** "Item C" quantity increases to 4

### Scenario 3: Decrease Quantity via - Key
1. "Item C" in cart with quantity 3
2. Search for "Item C" (only 1 result)
3. Press `-` key twice
4. **Expected:** "Item C" quantity decreases to 1

### Scenario 4: Remove Item via - Key
1. "Item C" in cart with quantity 1
2. Search for "Item C" (only 1 result)
3. Press `-` key
4. **Expected:** "Item C" removed from cart (quantity would be 0)

### Scenario 5: Works While Typing in Search
1. Type "2" in search
2. Immediately press `+` (without leaving search input)
3. **Expected:** Item added to cart, search input keeps focus

## UI Indicator
The search input shows a visual hint when a single item matches:
```typescript
{singleMenuItem && (
  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
    <Badge variant="secondary" className="text-xs">
      <kbd className="px-1.5 py-0.5 text-[10px]">+</kbd>
      <span className="mx-0.5">/</span>
      <kbd className="px-1.5 py-0.5 text-[10px]">-</kbd>
    </Badge>
  </div>
)}
```

## Files Modified
- `/src/pages/dashboard/OrderKioskUnified.tsx` - Moved +/- key handlers outside !isInputField block (lines 920-938)

## Related Features
This fix complements the existing keyboard shortcut system:
- `Ctrl+K` / `/` : Focus menu search
- `Ctrl+T` : Focus table search
- `1-9` : Add items by shortcut code (when NOT in input)
- `+/-` : Modify single search result quantity (NOW works in input)
- `Enter` : Submit order or open billing
- `Escape` : Clear search or deselect table
