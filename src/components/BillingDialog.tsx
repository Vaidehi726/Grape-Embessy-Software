import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Receipt, 
  Banknote, 
  CreditCard, 
  Smartphone, 
  Printer, 
  Bluetooth, 
  User, 
  ChevronUp, 
  ChevronDown,
  RefreshCw,
  Settings2,
  FileText,
  Percent,
  IndianRupee,
} from 'lucide-react';
import { Usb } from 'lucide-react';
import { useThermalPrinter } from '@/hooks/useThermalPrinter';
import { useUSBPrinter } from '@/hooks/useUSBPrinter';
import { isElectron, printerBridge } from '@/services/printerBridge';
import { getNextBillNumber } from '@/services/dailyBillNumber';
import { offlineMutate } from '@/services/offlineDataService';
import { PrinterSelector } from '@/components/PrinterSelector';
import { toast } from 'sonner';
import type { BillData, SummaryPrintData } from '@/services/thermalPrinter';

interface OrderItem {
  id: string;
  menu_item?: { name: string };
  quantity: number;
  unit_price: number;
}

interface BillingOrder {
  id: string;
  table_id: string | null;
  total_amount: number;
  discount_amount?: number | null;
  table?: { table_number: string; floor: { name: string } };
  order_items: OrderItem[];
}

interface BillingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: BillingOrder | null;
  /** Restaurant id — required so the on-print bill-number write passes the LAN
   *  server's order validation (which requires restaurant_id). */
  restaurantId?: string;
  onPaymentComplete: (
    paymentMethod: 'cash' | 'card' | 'upi',
    billing?: { subtotal: number; discountAmount: number; cgstAmount: number; sgstAmount: number; finalAmount: number }
  ) => Promise<void>;
  restaurantName?: string;
  restaurantAddress?: string;
  restaurantPhone?: string;
  restaurantGstin?: string;
  restaurantCgstPercentage?: number;
  restaurantSgstPercentage?: number;
  showQrCode?: boolean;
  paymentQrContent?: string | null;
}

export function BillingDialog({
  open,
  onOpenChange,
  order,
  restaurantId,
  onPaymentComplete,
  restaurantName,
  restaurantAddress,
  restaurantPhone,
  restaurantGstin,
  restaurantCgstPercentage = 0,
  restaurantSgstPercentage = 0,
  showQrCode = false,
  paymentQrContent,
}: BillingDialogProps) {
  const [processingPayment, setProcessingPayment] = useState(false);
  const [printerSelectorOpen, setPrinterSelectorOpen] = useState(false);
  const [showCustomerDetails, setShowCustomerDetails] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerGstin, setCustomerGstin] = useState('');
  // Discount: either a percentage of the subtotal or a flat rupee amount.
  const [discountType, setDiscountType] = useState<'percent' | 'flat'>('percent');
  const [discountInput, setDiscountInput] = useState('');

  // ── Bill math (discount applied to subtotal, GST charged on the net) ──────
  const subtotalAmount = order?.total_amount ?? 0;
  const discountAmount = (() => {
    const v = parseFloat(discountInput);
    if (!v || v <= 0) return 0;
    const raw = discountType === 'percent' ? (subtotalAmount * v) / 100 : v;
    // Never discount more than the subtotal or go negative.
    return Math.min(Math.max(raw, 0), subtotalAmount);
  })();
  const netSubtotal = Math.max(subtotalAmount - discountAmount, 0);
  const cgstAmount = (netSubtotal * restaurantCgstPercentage) / 100;
  const sgstAmount = (netSubtotal * restaurantSgstPercentage) / 100;
  // Bills are settled in whole rupees — round the payable so there is never a
  // fractional amount charged, stored, or printed.
  const grandTotal = Math.round(netSubtotal + cgstAmount + sgstAmount);

  // When the dialog opens for an order, seed the discount from its SAVED value
  // (as a flat amount) so reprinting/viewing a discounted bill from history
  // shows the same discount and grand total it was billed at. Active orders with
  // no saved discount start clean. Keyed on order id + open so it re-seeds each
  // time a (different) order is opened, but never wipes a discount being typed.
  useEffect(() => {
    if (open && order && (order.discount_amount ?? 0) > 0) {
      setDiscountType('flat');
      setDiscountInput(String(order.discount_amount));
    } else if (open) {
      setDiscountType('percent');
      setDiscountInput('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, open]);

  const { printBill: printThermal, printSummary: printSummaryThermal, connectedDevice, isBluetoothAvailable, printing } = useThermalPrinter();
  const { connectedPrinter, printing: usbPrinting, isAvailable: isUSBAvailable, connectPrinter: connectUSB, disconnectPrinter, printBill: printUSB, printSummary: printSummaryUSB, availableDevices, refreshDevices, isElectronApp } = useUSBPrinter();
  const [showDeviceList, setShowDeviceList] = useState(false);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [windowsPrinters, setWindowsPrinters] = useState<string[]>([]);
  const [selectedWindowsPrinter, setSelectedWindowsPrinter] = useState<string>('');
  const [matchingPrinters, setMatchingPrinters] = useState<string[]>([]); // Printers matching current VID/PID

  // ── Bill number: assigned lazily on the FIRST print, not at order creation ──
  // The number is reserved from the shared sequence only when a bill is actually
  // printed, then persisted onto the order so every reprint of this table shows
  // the SAME number. Orders that are booked but never printed stay unnumbered.
  const [assignedBillNumber, setAssignedBillNumber] = useState<number | null>(
    (order as any)?.bill_number ?? null
  );
  const billNumberInFlight = useRef(false);

  // Re-sync the local view whenever a different order is opened in the dialog.
  useEffect(() => {
    setAssignedBillNumber((order as any)?.bill_number ?? null);
  }, [order?.id]);

  const effectiveBillNumber: number | null = (order as any)?.bill_number ?? assignedBillNumber;

  // Reserve + persist a bill number the first time this order is printed; reused
  // on every reprint. Guarded so a double-click can't reserve two numbers.
  const ensureBillNumber = async (): Promise<number | undefined> => {
    if (!order) return undefined;
    const existing = (order as any).bill_number ?? assignedBillNumber;
    if (existing) return existing;
    if (billNumberInFlight.current) return undefined;
    billNumberInFlight.current = true;
    try {
      const n = await getNextBillNumber();
      setAssignedBillNumber(n);
      try {
        // restaurant_id is included because the LAN server validates every order
        // upsert and requires it; without it the write is rejected on client PCs.
        const patch: Record<string, any> = { id: order.id, bill_number: n };
        const rid = restaurantId ?? (order as any).restaurant_id;
        if (rid) patch.restaurant_id = rid;
        await offlineMutate('orders', patch);
      } catch (e) {
        console.warn('[BillingDialog] Failed to persist bill number:', e);
      }
      return n;
    } finally {
      billNumberInFlight.current = false;
    }
  };

  // Group order items by menu item name for display/printing
  const groupOrderItems = (items: OrderItem[]) => {
    const grouped = new Map<string, { name: string; quantity: number; unit_price: number; total: number }>();
    
    items.forEach(item => {
      const name = item.menu_item?.name || 'Item';
      if (grouped.has(name)) {
        const existing = grouped.get(name)!;
        existing.quantity += item.quantity;
        existing.total += item.unit_price * item.quantity;
      } else {
        grouped.set(name, {
          name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total: item.unit_price * item.quantity,
        });
      }
    });
    
    return Array.from(grouped.values());
  };

  // Auto-refresh device list when dialog opens in Electron
  useEffect(() => {
    if (open && isElectronApp) {
      setLoadingDevices(true);
      refreshDevices().finally(() => setLoadingDevices(false));
      
      // Also fetch Windows printers
      fetchWindowsPrinters();
    }
  }, [open, isElectronApp, refreshDevices]);

  const getBillData = (billNumberOverride?: number): BillData | null => {
    if (!order) return null;
    
    console.log('[BillingDialog] ========== BILL DIALOG DEBUG ==========');
    console.log('[BillingDialog] Full order object:', JSON.stringify(order, null, 2));
    console.log('[BillingDialog] order.bill_number:', (order as any).bill_number);
    console.log('[BillingDialog] order keys:', Object.keys(order));
    
    // GST is charged on the discounted (net) subtotal. All amounts come from the
    // component-level bill math so the printed bill matches the on-screen total.
    console.log('[BillingDialog] getBillData - paymentQrContent:', paymentQrContent);

    return {
      restaurantName: restaurantName || '',
      restaurantAddress: restaurantAddress,
      restaurantPhone: restaurantPhone,
      restaurantGstin: restaurantGstin,
      tableNumber: order.table?.table_number,
      orderId: order.id,
      billNumber: billNumberOverride ?? effectiveBillNumber ?? undefined,
      showQrCode,
      paymentQrContent,
      customerName: customerName.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      customerGstin: customerGstin.trim() || undefined,
      items: groupOrderItems(order.order_items).map(item => ({
        name: item.name,
        quantity: item.quantity,
        price: item.unit_price,
      })),
      subtotal: order.total_amount,
      discountAmount,
      cgstPercentage: restaurantCgstPercentage,
      sgstPercentage: restaurantSgstPercentage,
      cgstAmount,
      sgstAmount,
      total: grandTotal,
    };
  };

  const handlePrintBill = async (method: 'usb' | 'bluetooth' | 'browser' | 'windows' = 'usb') => {
    // Assign the bill number on the FIRST print and persist it to the order, so
    // reprints of this table reuse the same number. Orders never printed stay
    // unnumbered (paying without printing does NOT assign one).
    const billNumber = await ensureBillNumber();
    const billData = getBillData(billNumber);
    if (!billData) return;

    try {
      if (method === 'windows' && selectedWindowsPrinter) {
        // Print using Windows printer
        const api = (window as any).electronAPI?.printer;
        if (api?.printWindows) {
          const result = await api.printWindows(billData, selectedWindowsPrinter);
          if (result.success) {
            toast.success('Receipt printed via Windows printer');
          } else {
            toast.error(`Print failed: ${result.error}`);
          }
        } else {
          toast.error('Windows printer API not available');
        }
      } else if (method === 'usb' && connectedPrinter) {
        await printUSB(billData);
        toast.success('Receipt printed');
      } else if (method === 'bluetooth' && connectedDevice) {
        await printThermal(billData, true);
        toast.success('Receipt printed via Bluetooth');
      } else {
        await printThermal(billData, false);
      }
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handlePrintSummary = async (method: 'usb' | 'bluetooth' | 'browser' | 'windows' = 'usb') => {
    if (!order) return;
    
    // Create summary data (no prices)
    const summaryData: SummaryPrintData = {
      restaurantName: restaurantName || '',
      restaurantAddress: restaurantAddress,
      restaurantPhone: restaurantPhone,
      tableNumber: order.table?.table_number,
      floorName: order.table?.floor?.name,
      billNumber: effectiveBillNumber ?? undefined,
      items: groupOrderItems(order.order_items).map(item => ({
        name: item.name,
        quantity: item.quantity,
      })),
      timestamp: new Date().toISOString(),
    };
    
    try {
      if (method === 'usb' && connectedPrinter) {
        // USB thermal printer
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
        // Fallback to browser print
        printSummaryThermal(summaryData, false);
        toast.success('Summary printed');
      }
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleConnectUSB = async (vendorId?: number, productId?: number) => {
    try {
      console.log('[BillingDialog] Connecting to printer:', { vendorId, productId });
      
      // Clear previous printers before connecting
      setMatchingPrinters([]);
      setWindowsPrinters([]);
      setSelectedWindowsPrinter('');
      
      // If already connected to a different printer, disconnect first
      if (connectedPrinter) {
        console.log('[BillingDialog] Disconnecting existing printer first');
        await disconnectPrinter();
      }
      const device = await connectUSB(vendorId, productId);
      console.log('[BillingDialog] Connected device:', device);
      console.log('[BillingDialog] connectedPrinter state after connect:', connectedPrinter);
      setShowDeviceList(false);
      
      // Fetch ALL Windows printers to give user full choice
      if (isElectronApp) {
        await fetchWindowsPrinters();
        
        // Auto-switch to the Windows printer that matches the connected USB device
        if (vendorId !== undefined && productId !== undefined) {
          try {
            const api = (window as any).electronAPI?.printer;
            if (api?.listByVidPid) {
              const result = await api.listByVidPid(vendorId, productId);
              if (result.success && result.printers && result.printers.length > 0) {
                const matchingPrinter = result.printers[0];
                setSelectedWindowsPrinter(matchingPrinter);
                
                // Switch to this printer
                if (api?.switchWindowsPrinter) {
                  await api.switchWindowsPrinter(matchingPrinter);
                  console.log('[BillingDialog] Auto-switched to Windows printer:', matchingPrinter);
                }
              }
            }
          } catch (err) {
            console.error('[BillingDialog] Failed to auto-switch Windows printer:', err);
          }
        }
      }
      
      toast.success(`USB printer connected: ${device.name}`);
    } catch (error: any) {
      console.error('[BillingDialog] Connect error:', error);
      toast.error(error.message);
    }
  };

  // Fetch available Windows printers
  const fetchWindowsPrinters = async () => {
    try {
      console.log('[BillingDialog] Fetching Windows printers...');
      const api = (window as any).electronAPI?.printer;
      if (api?.listWindowsPrinters) {
        const result = await api.listWindowsPrinters();
        console.log('[BillingDialog] Windows printers result:', result);
        if (result.success && result.printers) {
          setWindowsPrinters(result.printers);
          // Auto-select the first one if none selected
          if (result.printers.length > 0 && !selectedWindowsPrinter) {
            setSelectedWindowsPrinter(result.printers[0]);
          }
        }
      } else {
        console.log('[BillingDialog] listWindowsPrinters API not available');
      }
    } catch (err) {
      console.error('[BillingDialog] Failed to fetch Windows printers:', err);
    }
  };

  // Fetch Windows printers matching a specific VID/PID
  const fetchMatchingPrinters = async (vendorId: number, productId: number) => {
    try {
      console.log('[BillingDialog] Fetching printers matching VID/PID:', { vendorId, productId });
      const api = (window as any).electronAPI?.printer;
      if (api?.listByVidPid) {
        const result = await api.listByVidPid(vendorId, productId);
        console.log('[BillingDialog] Matching printers result:', result);
        if (result.success && result.printers) {
          setMatchingPrinters(result.printers);
          // Auto-select the first one
          if (result.printers.length > 0) {
            setSelectedWindowsPrinter(result.printers[0]);
          }
        }
      }
    } catch (err) {
      console.error('[BillingDialog] Failed to fetch matching printers:', err);
    }
  };

  const handleRefreshDevices = async () => {
    setLoadingDevices(true);
    try {
      await refreshDevices();
    } catch { /* ignore */ }
    setLoadingDevices(false);
  };

  const handlePayment = async (paymentMethod: 'cash' | 'card' | 'upi') => {
    setProcessingPayment(true);
    try {
      await onPaymentComplete(paymentMethod, {
        // Store whole-rupee amounts so history/reports also stay fraction-free.
        subtotal: Math.round(subtotalAmount),
        discountAmount: Math.round(discountAmount),
        cgstAmount: Math.round(cgstAmount),
        sgstAmount: Math.round(sgstAmount),
        finalAmount: grandTotal,
      });
      // Reset customer + discount details
      setShowCustomerDetails(false);
      setCustomerName('');
      setCustomerPhone('');
      setCustomerGstin('');
      setDiscountInput('');
      setDiscountType('percent');
    } catch (error: any) {
      toast.error(error.message || 'Failed to process payment');
    } finally {
      setProcessingPayment(false);
    }
  };

  // Enter key shortcut to print bill via USB when dialog is open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;
      
      const target = e.target as HTMLElement;
      const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      
      // Number keys (1-3): Select payment method and process payment
      if (!isInputField && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const key = e.key;
        if (key === '1') {
          e.preventDefault();
          handlePayment('cash');
        } else if (key === '2') {
          e.preventDefault();
          handlePayment('card');
        } else if (key === '3') {
          e.preventDefault();
          handlePayment('upi');
        }
      }
      
      // Enter: Print bill via USB
      if (e.key === 'Enter' && !isInputField && (connectedPrinter || isElectronApp)) {
        e.preventDefault();
        if (connectedPrinter) {
          handlePrintBill('usb');
        } else if (isElectronApp && windowsPrinters.length > 0) {
          // Auto-print to first available Windows printer
          setSelectedWindowsPrinter(windowsPrinters[0]);
          setTimeout(() => handlePrintBill('windows'), 100);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, connectedPrinter, isElectronApp, windowsPrinters, handlePrintBill, handlePayment]);

  const handleOpenChange = (newOpen: boolean) => {
    onOpenChange(newOpen);
    if (!newOpen) {
      setShowCustomerDetails(false);
      setCustomerName('');
      setCustomerPhone('');
      setCustomerGstin('');
      setDiscountInput('');
      setDiscountType('percent');
      // Clear printer selection when dialog closes
      setMatchingPrinters([]);
      setWindowsPrinters([]);
      setSelectedWindowsPrinter('');
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5" />
              Bill & Payment
            </DialogTitle>
            <DialogDescription>
              {order?.table 
                ? `${order.table.table_number} - ${order.table.floor.name}`
                : 'Takeaway Order'}
            </DialogDescription>
          </DialogHeader>
          
          {order && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
              {/* ── LEFT COLUMN: bill summary + customer details ── */}
              <div className="space-y-4">
              {/* Bill Number Display */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between">
                <span className="text-sm font-medium text-blue-900">Bill Number:</span>
                <span className="text-lg font-bold text-blue-700">
                  {effectiveBillNumber ? `#${String(effectiveBillNumber).padStart(3, '0')}` : 'Not printed yet'}
                </span>
              </div>
              
              {/* Order Summary */}
              <div className="border rounded-lg p-4 space-y-2">
                {groupOrderItems(order.order_items).map((groupedItem, index) => (
                  <div key={index} className="flex justify-between text-sm">
                    <span>
                      {groupedItem.name} ×{groupedItem.quantity}
                    </span>
                    <span>₹{Math.round(groupedItem.total)}</span>
                  </div>
                ))}
                <div className="border-t pt-2 mt-2 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>Subtotal</span>
                    <span>₹{Math.round(subtotalAmount)}</span>
                  </div>

                  {/* Discount control: percentage or flat amount */}
                  <div className="flex items-center justify-between gap-2 py-1">
                    <span className="text-sm">Discount</span>
                    <div className="flex items-center gap-1">
                      <div className="flex rounded-md border overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setDiscountType('percent')}
                          className={`px-2 py-1 flex items-center justify-center ${discountType === 'percent' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground'}`}
                          title="Percentage discount"
                        >
                          <Percent className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDiscountType('flat')}
                          className={`px-2 py-1 flex items-center justify-center ${discountType === 'flat' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground'}`}
                          title="Flat amount discount"
                        >
                          <IndianRupee className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <Input
                        type="number"
                        min="0"
                        inputMode="decimal"
                        placeholder={discountType === 'percent' ? '0 %' : '₹ 0'}
                        value={discountInput}
                        onChange={(e) => setDiscountInput(e.target.value)}
                        className="h-8 w-24 text-right"
                      />
                    </div>
                  </div>
                  {discountAmount > 0 && (
                    <div className="flex justify-between text-sm text-green-600">
                      <span>
                        Discount{discountType === 'percent' && parseFloat(discountInput) > 0 ? ` (${parseFloat(discountInput)}%)` : ''}
                      </span>
                      <span>-₹{Math.round(discountAmount)}</span>
                    </div>
                  )}

                  {(restaurantCgstPercentage > 0 || restaurantSgstPercentage > 0) && (
                    <>
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>CGST ({restaurantCgstPercentage}%)</span>
                        <span>₹{Math.round(cgstAmount)}</span>
                      </div>
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>SGST ({restaurantSgstPercentage}%)</span>
                        <span>₹{Math.round(sgstAmount)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between font-bold text-lg pt-2 border-t">
                    <span>Grand Total</span>
                    <span>₹{Math.round(grandTotal)}</span>
                  </div>
                </div>
              </div>

              {/* Customer Details (Optional) */}
              <div className="border rounded-lg overflow-hidden">
                <button
                  type="button"
                  className="w-full flex items-center justify-between p-3 text-sm font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
                  onClick={() => setShowCustomerDetails(!showCustomerDetails)}
                >
                  <span className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Add Customer Details (Optional)
                  </span>
                  {showCustomerDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {showCustomerDetails && (
                  <div className="p-3 pt-0 space-y-2">
                    <Input
                      placeholder="Customer Name"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                    />
                    <Input
                      placeholder="Phone Number"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                    />
                    <Input
                      placeholder="Customer GSTIN"
                      value={customerGstin}
                      onChange={(e) => setCustomerGstin(e.target.value)}
                    />
                  </div>
                )}
              </div>

              </div>{/* ── end LEFT COLUMN ── */}

              {/* ── RIGHT COLUMN: printing + payment ── */}
              <div className="space-y-4">
              {/* Print Options */}
              <div className="space-y-2">
                <div className="flex gap-2">
                  {/* USB Thermal Print */}
                  {(isUSBAvailable || isElectronApp) && (
                    <div className="flex flex-1 gap-1">
                      <Button 
                        variant={connectedPrinter ? 'default' : 'outline'}
                        className={`flex-1 ${connectedPrinter ? 'bg-primary' : ''}`}
                        onClick={() => {
                          if (connectedPrinter) {
                            handlePrintBill('usb');
                          } else if (isElectronApp) {
                            setShowDeviceList(!showDeviceList);
                          } else {
                            handleConnectUSB();
                          }
                        }}
                        disabled={usbPrinting}
                      >
                        <Usb className="w-4 h-4 mr-2" />
                        {connectedPrinter ? `Print (${connectedPrinter.name.substring(0, 12)})` : 'Connect USB Printer'}
                        {connectedPrinter && <kbd className="ml-2 px-2 py-0.5 text-xs bg-white/20 rounded">Enter</kbd>}
                      </Button>
                      {/* Change printer button — only visible when a printer is already connected */}
                      {connectedPrinter && isElectronApp && (
                        <Button
                          variant="outline"
                          size="icon"
                          title="Change printer"
                          onClick={() => setShowDeviceList(!showDeviceList)}
                        >
                          <Settings2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  )}
                  {/* Browser Print - Fallback */}
                  <Button variant="outline" className={(isUSBAvailable || isElectronApp) ? '' : 'flex-1'} onClick={() => handlePrintBill('browser')} disabled={printing}>
                    <Printer className="w-4 h-4 mr-2" />
                    Browser
                  </Button>
                  {/* Bluetooth - Mobile only */}
                  {isBluetoothAvailable && (
                    <Button 
                      variant="outline" 
                      className={connectedDevice ? 'border-success text-success' : ''}
                      onClick={() => connectedDevice ? handlePrintBill('bluetooth') : setPrinterSelectorOpen(true)}
                      disabled={printing}
                    >
                      <Bluetooth className="w-4 h-4 mr-2" />
                      BT
                    </Button>
                  )}
                </div>

                {/* Print Summary Button - Items only, no prices */}
                <div className="flex gap-2 pt-2 border-t">
                  <Button 
                    variant="outline" 
                    className="flex-1 border-dashed"
                    onClick={() => handlePrintSummary()}  // Default to 'usb', will auto-fallback
                    disabled={printing || usbPrinting}
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

                {/* Electron Device List — shown when no printer OR when changing printer */}
                {isElectronApp && showDeviceList && (
                  <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {connectedPrinter ? 'Switch Printer' : 'Available USB Devices'}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={handleRefreshDevices} disabled={loadingDevices}>
                          <RefreshCw className={`w-3.5 h-3.5 ${loadingDevices ? 'animate-spin' : ''}`} />
                        </Button>
                        {connectedPrinter && (
                          <Button variant="ghost" size="sm" onClick={() => setShowDeviceList(false)}>
                            Cancel
                          </Button>
                        )}
                      </div>
                    </div>
                    {connectedPrinter && (
                      <p className="text-xs text-muted-foreground">
                        Currently: <span className="font-medium text-foreground">{connectedPrinter.name}</span> — select a different printer below
                      </p>
                    )}
                    {loadingDevices ? (
                      <p className="text-xs text-muted-foreground">Scanning USB devices...</p>
                    ) : availableDevices.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No USB devices found. Make sure the printer is plugged in and try refreshing.</p>
                    ) : (
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {availableDevices.map((device, i) => (
                          <button
                            key={`${device.vendorId}-${device.productId}-${i}`}
                            className={`w-full text-left px-3 py-2 rounded-md text-sm hover:bg-accent transition-colors flex items-center justify-between ${
                              connectedPrinter?.vendorId === device.vendorId && connectedPrinter?.productId === device.productId
                                ? 'bg-accent/60 font-medium'
                                : ''
                            }`}
                            onClick={() => handleConnectUSB(device.vendorId, device.productId)}
                          >
                            <span className="truncate flex items-center gap-2">
                              {connectedPrinter?.vendorId === device.vendorId && connectedPrinter?.productId === device.productId && (
                                <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                              )}
                              {device.name}
                            </span>
                            <span className="text-xs text-muted-foreground ml-2 shrink-0">
                              {device.vendorId.toString(16).padStart(4, '0')}:{device.productId.toString(16).padStart(4, '0')}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Windows Printer Selector - always show in Electron mode */}
                {isElectronApp && (
                  <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Windows Printer</Label>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">
                          {windowsPrinters.length} printer{windowsPrinters.length !== 1 ? 's' : ''} available
                        </span>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={fetchWindowsPrinters}
                          disabled={loadingDevices}
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${loadingDevices ? 'animate-spin' : ''}`} />
                        </Button>
                      </div>
                    </div>
                    
                    {windowsPrinters.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {loadingDevices ? 'Detecting printers...' : 'No Windows printers found. Make sure printers are installed.'}
                      </p>
                    ) : (
                      <>
                        <select
                          className="w-full px-3 py-2 rounded-md border text-sm bg-background"
                          value={selectedWindowsPrinter}
                          onChange={async (e) => {
                            const newPrinter = e.target.value;
                            setSelectedWindowsPrinter(newPrinter);
                            
                            // Switch the Windows printer in the backend
                            try {
                              const api = (window as any).electronAPI?.printer;
                              if (api?.switchWindowsPrinter) {
                                const result = await api.switchWindowsPrinter(newPrinter);
                                if (result.success) {
                                  toast.success(`Switched to: ${newPrinter}`);
                                } else {
                                  toast.error(`Failed to switch: ${result.error}`);
                                }
                              }
                            } catch (err: any) {
                              toast.error(`Error switching printer: ${err.message}`);
                            }
                          }}
                        >
                          <option value="">-- Select a printer --</option>
                          {windowsPrinters.map((printer) => (
                            <option key={printer} value={printer}>
                              {printer}
                            </option>
                          ))}
                        </select>
                        
                        {/* Test Print Button */}
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          disabled={!selectedWindowsPrinter || printing || usbPrinting}
                          onClick={() => handlePrintBill('windows')}
                        >
                          <Printer className="w-4 h-4 mr-2" />
                          Test Print on Selected Printer
                        </Button>
                        
                        <p className="text-xs text-muted-foreground">
                          {selectedWindowsPrinter 
                            ? `Selected: ${selectedWindowsPrinter}` 
                            : 'Select a printer above to use for printing'}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Payment Methods */}
              <div className="space-y-2">
                <Label>Select Payment Method</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    variant="outline"
                    className="flex flex-col items-center gap-1 h-auto py-4 relative"
                    onClick={() => handlePayment('cash')}
                    disabled={processingPayment}
                  >
                    <div className="absolute top-1 right-1 bg-primary text-primary-foreground text-xs font-bold w-5 h-5 rounded flex items-center justify-center">
                      1
                    </div>
                    <Banknote className="w-6 h-6" />
                    <span className="text-xs">Cash</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="flex flex-col items-center gap-1 h-auto py-4 relative"
                    onClick={() => handlePayment('card')}
                    disabled={processingPayment}
                  >
                    <div className="absolute top-1 right-1 bg-primary text-primary-foreground text-xs font-bold w-5 h-5 rounded flex items-center justify-center">
                      2
                    </div>
                    <CreditCard className="w-6 h-6" />
                    <span className="text-xs">Card</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="flex flex-col items-center gap-1 h-auto py-4 relative"
                    onClick={() => handlePayment('upi')}
                    disabled={processingPayment}
                  >
                    <div className="absolute top-1 right-1 bg-primary text-primary-foreground text-xs font-bold w-5 h-5 rounded flex items-center justify-center">
                      3
                    </div>
                    <Smartphone className="w-6 h-6" />
                    <span className="text-xs">UPI</span>
                  </Button>
                </div>
              </div>
              </div>{/* ── end RIGHT COLUMN ── */}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Printer Selector Dialog */}
      <PrinterSelector open={printerSelectorOpen} onOpenChange={setPrinterSelectorOpen} />
    </>
  );
}
