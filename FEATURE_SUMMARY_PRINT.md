# FEATURE: Summary Print (Order Confirmation Receipt)

## Overview
Added a new "Summary Print" functionality that prints order details **without any financial information**. This serves as a confirmation receipt for kitchen staff or customers to verify order contents without showing prices, totals, or payment information.

## Features

### What Summary Print Includes
✅ Restaurant name and header information  
✅ Restaurant address and phone (if available)  
✅ Floor name and table number  
✅ Bill number  
✅ Date and time of print  
✅ **List of menu items with quantities ONLY**  
✅ "Please verify order contents" message  

### What Summary Print Excludes
❌ Item prices  
❌ Subtotal  
❌ Tax information (CGST/SGST)  
❌ Grand total  
❌ QR codes  
❌ Payment information  
❌ Customer details  

## Implementation

### 1. New Interface: SummaryPrintData
**File:** `/src/services/thermalPrinter.ts`

```typescript
export interface SummaryPrintData {
  restaurantName: string;
  restaurantAddress?: string | null;
  restaurantPhone?: string | null;
  tableNumber?: string;
  floorName?: string;
  billNumber?: number;
  items: {
    name: string;
    quantity: number;
  }[];
  timestamp?: string;
}
```

**Key Differences from BillData:**
- No `price` field in items
- No `subtotal`, `cgstAmount`, `sgstAmount`, `total` fields
- No `showQrCode`, `paymentQrContent` fields
- Added `floorName` field for better table identification
- Added `timestamp` field for tracking

### 2. Thermal Printer Service Methods
**File:** `/src/services/thermalPrinter.ts`

#### printSummaryViaBluetooth()
- Prints summary receipt via Bluetooth thermal printer
- Uses ESC/POS commands for formatting
- Layout:
  ```
  Restaurant Name (centered, bold, double width)
  Address
  Phone
  --------------------------------
  ORDER SUMMARY (centered, bold)
  --------------------------------
  Floor: Ground Floor
  Table: T1
  Date: Apr 17, 2026, 2:30 PM
  Bill #: 001
  --------------------------------
  Item                  Qty
  --------------------------------
  Chicken Biryani       2
  Naan                  4
  Raita                 1
  --------------------------------
  
  Please verify order contents
  Thank you!
  ```

#### printSummaryViaBrowser()
- Opens browser print dialog with summary receipt
- Clean HTML formatting optimized for thermal printers (300px width)
- Monospace font for alignment
- Simple table layout with Item and Qty columns only
- No prices or totals displayed

### 3. Hook Integration
**File:** `/src/hooks/useThermalPrinter.ts`

Added `printSummary` function:
```typescript
const printSummary = useCallback(async (summary: SummaryPrintData, useBluetooth: boolean = false) => {
  setPrinting(true);
  try {
    if (useBluetooth && isBluetoothAvailable) {
      await thermalPrinter.printSummaryViaBluetooth(summary);
    } else {
      thermalPrinter.printSummaryViaBrowser(summary);
    }
  } finally {
    setPrinting(false);
  }
}, [isBluetoothAvailable]);
```

### 4. BillingDialog Integration
**File:** `/src/components/BillingDialog.tsx`

#### New Handler: handlePrintSummary()
```typescript
const handlePrintSummary = async (method: 'usb' | 'bluetooth' | 'browser' | 'windows' = 'browser') => {
  if (!order) return;
  
  const summaryData: SummaryPrintData = {
    restaurantName: restaurantName || '',
    restaurantAddress: restaurantAddress,
    restaurantPhone: restaurantPhone,
    tableNumber: order.table?.table_number,
    floorName: order.table?.floor?.name,
    billNumber: (order as any).bill_number,
    items: groupOrderItems(order.order_items).map(item => ({
      name: item.name,
      quantity: item.quantity,
    })),
    timestamp: new Date().toISOString(),
  };
  
  // Print via selected method
  if (method === 'bluetooth' && connectedDevice) {
    await printSummaryThermal(summaryData, true);
    toast.success('Summary printed via Bluetooth');
  } else {
    printSummaryThermal(summaryData, false);
    toast.success('Summary printed');
  }
};
```

#### UI Button
Added new button section in BillingDialog:
```tsx
{/* Print Summary Button - Items only, no prices */}
<div className="flex gap-2 pt-2 border-t">
  <Button 
    variant="outline" 
    className="flex-1 border-dashed"
    onClick={() => handlePrintSummary('browser')}
    disabled={printing}
  >
    <FileText className="w-4 h-4 mr-2" />
    Print Summary (Items Only)
  </Button>
  {isBluetoothAvailable && (
    <Button 
      variant="outline"
      onClick={() => handlePrintSummary('bluetooth')}
      disabled={printing || !connectedDevice}
    >
      <Bluetooth className="w-4 h-4" />
    </Button>
  )}
</div>
```

**Design Choices:**
- Separated from regular print buttons with a border-top
- Dashed border to visually distinguish from bill print
- FileText icon to represent document/summary
- Bluetooth button only appears on mobile devices
- Defaults to browser print for simplicity

## Usage Scenarios

### Scenario 1: Kitchen Order Verification
1. Customer places order at table
2. Staff opens billing dialog
3. Clicks "Print Summary (Items Only)"
4. Takes summary to kitchen for order preparation
5. Kitchen staff verifies items without seeing prices

### Scenario 2: Customer Order Confirmation
1. Customer wants to verify their order
2. Staff prints summary receipt
3. Customer receives receipt showing only items ordered
4. No financial information disclosed
5. Customer can confirm order accuracy

### Scenario 3: Order Reconciliation
1. End of shift order counting
2. Manager prints summaries for all orders
3. Counts items prepared vs items ordered
4. No revenue information visible to staff
5. Focus on operational accuracy

## Testing

### Test Case 1: Browser Print
1. Open billing dialog for any order
2. Click "Print Summary (Items Only)"
3. **Expected:** Browser print dialog opens
4. **Expected:** Receipt shows items and quantities only
5. **Expected:** No prices or totals visible

### Test Case 2: Bluetooth Print (Mobile)
1. Connect Bluetooth printer on mobile device
2. Open billing dialog
3. Click Bluetooth icon next to summary button
4. **Expected:** Summary prints via Bluetooth
5. **Expected:** Formatted correctly for thermal paper

### Test Case 3: Multiple Items
1. Order with 5+ different items
2. Some items with quantity > 1
3. Print summary
4. **Expected:** All items listed with correct quantities
5. **Expected:** Items grouped by name (duplicates combined)

### Test Case 4: No Table (Takeaway)
1. Create takeaway order (no table assigned)
2. Print summary
3. **Expected:** Shows "Table: Takeaway"
4. **Expected:** All other info present

## Files Modified

1. **`/src/services/thermalPrinter.ts`**
   - Added `SummaryPrintData` interface
   - Added `printSummaryViaBluetooth()` method
   - Added `printSummaryViaBrowser()` method
   - Added `floorName` to `BillData` interface

2. **`/src/hooks/useThermalPrinter.ts`**
   - Imported `SummaryPrintData`
   - Added `printSummary` function
   - Exported `printSummary` in return object

3. **`/src/components/BillingDialog.tsx`**
   - Imported `SummaryPrintData` and `FileText` icon
   - Added `printSummary` from useThermalPrinter hook
   - Added `handlePrintSummary` handler function
   - Added summary print button UI
   - Integrated with existing print infrastructure

## Benefits

1. **Privacy:** No financial information visible to kitchen staff
2. **Clarity:** Simple, focused receipt for order verification
3. **Efficiency:** Quick print without opening separate systems
4. **Consistency:** Uses same print infrastructure as billing
5. **Flexibility:** Supports both browser and Bluetooth printing
6. **Professional:** Clean formatting optimized for thermal printers

## Future Enhancements (Optional)

1. **USB Printer Support:** Add USB printing for summary (currently browser/Bluetooth only)
2. **Windows Printer Support:** Add Windows spooler printing
3. **Custom Header:** Allow custom messages in summary header
4. **Barcode:** Add order barcode for scanning
5. **Kitchen Display:** Integrate with kitchen display system
6. **Multi-language:** Support for different languages in summary

## Notes

- Summary print uses the same item grouping logic as bill print (duplicate items combined)
- Browser print opens in new tab/window (requires popup permission)
- Bluetooth print requires connected device
- Summary print does not affect order status or database
- Can be printed multiple times without side effects
