# Summary Print - Direct Thermal Printing Implementation

## Overview
Updated the "Print Summary" button in BillingDialog to prioritize direct thermal printing (USB/Windows/Bluetooth) instead of defaulting to browser printing. Now behaves the same as the main orange "Print" button.

## Changes Made

### 1. printerBridge.ts - Added Summary Print Support

#### Added to PrinterBridge Interface:
```typescript
printSummary(summary: SummaryPrintData): Promise<void>;
printWindowsSummary?(summary: SummaryPrintData, printerName: string): Promise<{ success: boolean; error?: string }>;
```

#### Added to Convenience Object:
```typescript
printSummary: (s) => getPrinterBridge().printSummary(s),
printWindowsSummary: (summary, printerName) => getPrinterBridge().printWindowsSummary?.(summary, printerName) ?? Promise.resolve({ success: false, error: 'Not available' }),
```

#### Added buildSummaryReceipt Function (Lines 215-283):
- Creates ESC/POS formatted receipt bytes for summary printing
- Includes: restaurant info, floor/table, bill number, items with quantities
- Excludes: prices, subtotal, taxes, totals, QR codes, payment info
- Header: "ORDER SUMMARY"
- Footer: "Please verify order contents"

#### Added to ElectronPrinterBridge Class:
```typescript
async printSummary(summary: SummaryPrintData): Promise<void> {
  // Uses buildSummaryReceipt and sends to USB printer
}

async printWindowsSummary(summary: SummaryPrintData, printerName: string): Promise<{ success: boolean; error?: string }> {
  // Uses buildSummaryReceipt and sends to Windows printer
}
```

#### Added to WebPrinterBridge Class:
```typescript
async printSummary(summary: SummaryPrintData): Promise<void> {
  return usbPrinter.printSummary(summary);
}
```

### 2. usbPrinter.ts - Added USB Summary Print Support

#### Added printSummary Method (Lines 372-391):
```typescript
async printSummary(summary: SummaryPrintData): Promise<void> {
  if (!this.device) {
    throw new Error('No printer connected. Please connect a USB thermal printer first.');
  }

  const receiptData = this.buildSummaryReceipt(summary);

  try {
    const chunkSize = 64;
    for (let i = 0; i < receiptData.length; i += chunkSize) {
      const chunk = receiptData.slice(i, i + chunkSize);
      await this.device.transferOut(this.endpointOut, chunk);
    }
  } catch (error: any) {
    console.error('USB summary print failed:', error);
    this.device = null;
    throw new Error('Summary print failed. Reconnect the printer and try again.');
  }
}
```

#### Added buildSummaryReceipt Method (Lines 352-426):
- Private method that creates ESC/POS formatted summary receipt
- Same structure as buildSummaryReceipt in printerBridge.ts
- Used for WebUSB printing

### 3. useUSBPrinter.ts - Exposed printSummary Function

#### Added to Hook Return:
```typescript
const printSummary = useCallback(async (summary: SummaryPrintData) => {
  setPrinting(true);
  try {
    await printerBridge.printSummary(summary);
  } finally {
    setPrinting(false);
  }
}, []);

return {
  // ... other returns
  printSummary,  // Added
  // ...
};
```

### 4. BillingDialog.tsx - Updated handlePrintSummary Function

#### Updated Function Signature:
```typescript
// BEFORE: Default was 'browser'
const handlePrintSummary = async (method: 'usb' | 'bluetooth' | 'browser' | 'windows' = 'browser')

// AFTER: Default is 'usb' with auto-fallback
const handlePrintSummary = async (method: 'usb' | 'bluetooth' | 'browser' | 'windows' = 'usb')
```

#### Updated Print Priority Logic:
```typescript
try {
  if (method === 'usb' && connectedPrinter) {
    // USB thermal printer - HIGHEST PRIORITY
    await printSummaryUSB(summaryData);
    toast.success('Summary printed via USB');
  } else if (method === 'windows' && selectedWindowsPrinter) {
    // Windows printer
    const result = await printerBridge.printWindowsSummary?.(summaryData, selectedWindowsPrinter);
    if (result?.success) {
      toast.success('Summary printed via Windows printer');
    } else {
      toast.error(result?.error || 'Windows summary print failed');
    }
  } else if (method === 'bluetooth' && connectedDevice) {
    // Bluetooth thermal printer
    await printSummaryThermal(summaryData, true);
    toast.success('Summary printed via Bluetooth');
  } else {
    // Fallback to browser print - LOWEST PRIORITY
    printSummaryThermal(summaryData, false);
    toast.success('Summary printed');
  }
} catch (error: any) {
  toast.error(error.message);
}
```

#### Updated Button UI:
```tsx
// BEFORE: Always opened browser print
<Button 
  onClick={() => handlePrintSummary('browser')}
  disabled={printing}
>

// AFTER: Tries USB first, auto-fallbacks to other methods
<Button 
  onClick={() => handlePrintSummary()}  // Default to 'usb', will auto-fallback
  disabled={printing || usbPrinting}
>
```

#### Added Imports:
```typescript
import { isElectron, printerBridge } from '@/services/printerBridge';
```

#### Updated Hook Usage:
```typescript
// Added printSummaryUSB to destructured values
const { 
  connectedPrinter, 
  printing: usbPrinting, 
  // ... 
  printSummary: printSummaryUSB,  // Added
  // ...
} = useUSBPrinter();
```

## Print Priority Order

When user clicks "Print Summary (Items Only)" button:

1. **USB Thermal Printer** (if `connectedPrinter` exists)
   - Direct ESC/POS printing via printerBridge
   - Fast, no browser dialog
   - Uses `printSummaryUSB()`

2. **Windows Printer** (if `selectedWindowsPrinter` exists and `isElectronApp`)
   - Uses Windows Print Spooler API
   - Direct printing without browser dialog
   - Uses `printerBridge.printWindowsSummary()`

3. **Bluetooth Thermal Printer** (if `connectedDevice` exists)
   - Direct ESC/POS printing via Bluetooth
   - Uses `printSummaryThermal(summaryData, true)`

4. **Browser Print** (fallback - no thermal printers connected)
   - Opens browser print dialog
   - Uses `printSummaryThermal(summaryData, false)`

## Benefits

1. **Consistent User Experience**: Summary print now works exactly like the main "Print" button
2. **Faster Printing**: Direct thermal printing avoids browser dialog overhead
3. **Automatic Fallback**: If no USB printer is connected, automatically tries other methods
4. **No Manual Selection Needed**: Users don't need to choose print method - system picks best available
5. **Works Offline**: Thermal printing doesn't depend on browser capabilities

## Testing Checklist

- [ ] Click "Print Summary" with USB printer connected → Should print directly to USB
- [ ] Click "Print Summary" with Windows printer selected → Should print via Windows
- [ ] Click "Print Summary" with Bluetooth printer connected → Should print via Bluetooth
- [ ] Click "Print Summary" with no thermal printers → Should open browser print dialog
- [ ] Verify summary output contains: items, quantities, floor/table, bill number
- [ ] Verify summary output excludes: prices, totals, taxes, QR codes
- [ ] Test Bluetooth button separately → Should print via Bluetooth
- [ ] Verify print state disables button during printing (both `printing` and `usbPrinting`)

## Files Modified

1. `/src/services/printerBridge.ts` - Added summary print interface and implementations
2. `/src/services/usbPrinter.ts` - Added USB summary print method and receipt builder
3. `/src/hooks/useUSBPrinter.ts` - Exposed printSummary function from hook
4. `/src/components/BillingDialog.tsx` - Updated handlePrintSummary to prioritize thermal printing

## Summary Print Content

The summary receipt includes:
- Restaurant name (bold, double-width)
- Restaurant address (if available)
- Restaurant phone (if available)
- "ORDER SUMMARY" title (centered, bold)
- Floor name (if available)
- Table number
- Date/time
- Bill number (padded to 3 digits)
- Items list (name + quantity only)
- "Please verify order contents" message
- "Thank you!" message
- Paper cut

The summary receipt **excludes**:
- Individual item prices
- Subtotal
- CGST/SGST amounts
- Total amount
- QR codes
- Payment information
- Customer details
