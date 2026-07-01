import { useState, useEffect, useMemo, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useRestaurant } from '@/contexts/RestaurantContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend
} from 'recharts';
import { 
  CalendarIcon, 
  IndianRupee, 
  ShoppingBag, 
  TrendingUp, 
  Clock,
  Utensils,
  Flame,
  Filter,
  ChevronLeft,
  ChevronRight,
  FileText,
  Download,
  FileSpreadsheet,
  Printer,
  Banknote,
  CreditCard,
  Smartphone,
  Pencil,
  Trash2,
  Bluetooth,
  Usb,
  RefreshCw,
  Settings2
} from 'lucide-react';
import { format, startOfDay, endOfDay, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval, parseISO, eachDayOfInterval, eachHourOfInterval, addHours } from 'date-fns';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { offlineQuery, offlineMutate, offlineDelete, isOffline } from '@/services/offlineDataService';
import { getDataClient } from '@/services/localDataService';
import { buildReportReceipt } from '@/services/printerBridge';
import { BillingDialog } from '@/components/BillingDialog';
import { BillEditDialog } from '@/components/BillEditDialog';
import { useThermalPrinter } from '@/hooks/useThermalPrinter';
import { useUSBPrinter } from '@/hooks/useUSBPrinter';

type OrderStatus = 'pending' | 'cooking' | 'ready' | 'served' | 'cancelled';

interface Order {
  id: string;
  status: OrderStatus;
  total_amount: number;
  created_at: string;
  notes: string | null;
  table_id: string | null;
  payment_method: string | null;
  table?: { 
    table_number: string;
    floor: { name: string };
  } | null;
  order_items: {
    id: string;
    quantity: number;
    unit_price: number;
    menu_item: {
      name: string;
      food_type: string;
    } | null;
  }[];
}

interface MenuItem {
  name: string;
  quantity: number;
  revenue: number;
}

const STATUS_CONFIG: Record<OrderStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'status-pending' },
  cooking: { label: 'Cooking', className: 'status-cooking' },
  ready: { label: 'Ready', className: 'status-ready' },
  served: { label: 'Served', className: 'status-served' },
  cancelled: { label: 'Cancelled', className: 'bg-destructive/10 text-destructive' },
};

const CHART_COLORS = [
  'hsl(18, 76%, 52%)',   // primary
  'hsl(38, 92%, 50%)',   // accent
  'hsl(142, 76%, 36%)',  // success
  'hsl(220, 70%, 50%)',  // blue
  'hsl(280, 70%, 50%)',  // purple
  'hsl(180, 70%, 40%)',  // teal
];

type DateRange = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

// ── Report Print Dialog (mirrors BillingDialog printer UX) ──────────────────
interface ReportStats {
  totalRevenue: number;
  completedOrders: number;
  avgOrderValue: number;
  cashRevenue: number;
  onlineRevenue: number;
  cgstTotal: number;
  sgstTotal: number;
  grandTotal: number;
}

interface ReportPrintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentRestaurant: { name: string; address?: string | null; phone?: string | null; cgst_percentage?: number | null; sgst_percentage?: number | null } | null;
  dateRange: string;
  stats: ReportStats;
  popularItems: { name: string; quantity: number; revenue: number }[];
  allSoldItems: { name: string; quantity: number; revenue: number }[];
}

function ReportPrintDialogInner({
  open,
  onOpenChange,
  currentRestaurant,
  dateRange,
  stats,
  popularItems,
  allSoldItems,
}: ReportPrintDialogProps) {
  const { printBill: printThermal, connectedDevice, isBluetoothAvailable, printing: thermalPrinting } = useThermalPrinter();
  const {
    connectedPrinter: usbPrinter,
    printing: usbPrinting,
    isAvailable: isUSBAvailable,
    connectPrinter: connectUSB,
    disconnectPrinter,
    printBill: printUSB,
    availableDevices,
    refreshDevices,
    isElectronApp,
  } = useUSBPrinter();

  const [showDeviceList, setShowDeviceList] = useState(false);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [windowsPrinters, setWindowsPrinters] = useState<string[]>([]);
  const [selectedWindowsPrinter, setSelectedWindowsPrinter] = useState('');
  const [matchingPrinters, setMatchingPrinters] = useState<string[]>([]); // Printers matching current VID/PID

  // Auto-refresh device list when dialog opens
  useEffect(() => {
    if (open && isElectronApp) {
      setLoadingDevices(true);
      refreshDevices().finally(() => setLoadingDevices(false));
    }
  }, [open, isElectronApp, refreshDevices]);

  const fetchWindowsPrinters = async () => {
    try {
      const api = (window as any).electronAPI?.printer;
      if (api?.listWindowsPrinters) {
        const result = await api.listWindowsPrinters();
        if (result.success && result.printers) {
          setWindowsPrinters(result.printers);
          if (result.printers.length > 0 && !selectedWindowsPrinter) {
            setSelectedWindowsPrinter(result.printers[0]);
          }
        }
      }
    } catch (err) {
      console.error('[ReportPrintDialog] Failed to fetch Windows printers:', err);
    }
  };

  // Fetch Windows printers matching a specific VID/PID
  const fetchMatchingPrinters = async (vendorId: number, productId: number) => {
    try {
      console.log('[ReportPrintDialog] Fetching printers matching VID/PID:', { vendorId, productId });
      const api = (window as any).electronAPI?.printer;
      if (api?.listByVidPid) {
        const result = await api.listByVidPid(vendorId, productId);
        if (result.success && result.printers) {
          setMatchingPrinters(result.printers);
          if (result.printers.length > 0) {
            setSelectedWindowsPrinter(result.printers[0]);
          }
        }
      }
    } catch (err) {
      console.error('[ReportPrintDialog] Failed to fetch matching printers:', err);
    }
  };

  const handleConnectUSB = async (vendorId?: number, productId?: number) => {
    try {
      // Clear previous printers before connecting
      setMatchingPrinters([]);
      setWindowsPrinters([]);
      setSelectedWindowsPrinter('');
      
      if (usbPrinter) await disconnectPrinter();
      await connectUSB(vendorId, productId);
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
                  console.log('[ReportPrintDialog] Auto-switched to Windows printer:', matchingPrinter);
                }
              }
            }
          } catch (err) {
            console.error('[ReportPrintDialog] Failed to auto-switch Windows printer:', err);
          }
        }
      }
    } catch (error: any) {
      console.error('[ReportPrintDialog] Connect error:', error);
    }
  };

  const handleRefreshDevices = async () => {
    setLoadingDevices(true);
    try { await refreshDevices(); } catch { /* ignore */ }
    setLoadingDevices(false);
  };

  // Build BillData for the report and print
  const handlePrint = async (method: 'usb' | 'bluetooth' | 'browser') => {
    if (!currentRestaurant) return;

    const dateRangeLabel = dateRange === 'today' ? 'Today' :
      dateRange === 'yesterday' ? 'Yesterday' :
      dateRange === 'week' ? 'This Week' :
      dateRange === 'month' ? 'This Month' : 'Custom Range';

    const reportBillData = {
      restaurantName: currentRestaurant.name,
      restaurantAddress: currentRestaurant.address,
      restaurantPhone: currentRestaurant.phone,
      tableNumber: 'REPORT',
      items: [
        { name: `Period: ${dateRangeLabel}`, quantity: 1, price: 0 },
        { name: '--- REVENUE SUMMARY ---', quantity: 1, price: 0 },
        { name: 'Subtotal (excl. GST)', quantity: 1, price: stats.totalRevenue },
        { name: 'Completed Orders', quantity: stats.completedOrders, price: 0 },
        { name: 'Average Order Value', quantity: 1, price: Math.round(stats.avgOrderValue) },
        { name: '--- PAYMENT BREAKDOWN ---', quantity: 1, price: 0 },
        { name: 'Cash Payments', quantity: 1, price: stats.cashRevenue },
        { name: 'Online Payments', quantity: 1, price: stats.onlineRevenue },
        { name: '--- ITEM SALES ---', quantity: 1, price: 0 },
        ...allSoldItems.map(item => ({
          name: item.name,
          quantity: item.quantity,
          // Pass the average UNIT price so the receipt's amount column
          // (price × qty) resolves to this item's total revenue. Passing the
          // revenue directly here double-multiplied it into a garbage figure.
          price: item.quantity > 0 ? item.revenue / item.quantity : item.revenue,
        })),
      ],
      subtotal: stats.totalRevenue,
      total: stats.grandTotal,
      cgstPercentage: currentRestaurant.cgst_percentage ?? 0,
      sgstPercentage: currentRestaurant.sgst_percentage ?? 0,
      cgstAmount: stats.cgstTotal,
      sgstAmount: stats.sgstTotal,
    };

    // Dedicated report layout (full-width label→value rows + item table) so big
    // money values never overflow the bill's narrow columns.
    const reportReceipt = {
      restaurantName: currentRestaurant.name,
      restaurantAddress: currentRestaurant.address,
      restaurantPhone: currentRestaurant.phone,
      restaurantGstin: (currentRestaurant as any).gstin,
      periodLabel: dateRangeLabel,
      totalRevenue: stats.totalRevenue,
      completedOrders: stats.completedOrders,
      avgOrderValue: stats.avgOrderValue,
      cashRevenue: stats.cashRevenue,
      onlineRevenue: stats.onlineRevenue,
      cgstPercentage: currentRestaurant.cgst_percentage ?? 0,
      sgstPercentage: currentRestaurant.sgst_percentage ?? 0,
      cgstAmount: stats.cgstTotal,
      sgstAmount: stats.sgstTotal,
      grandTotal: stats.grandTotal,
      items: allSoldItems.map(i => ({ name: i.name, quantity: i.quantity, revenue: i.revenue })),
    };

    try {
      if (method === 'usb') {
        const api = (window as any).electronAPI?.printer;
        if (isElectronApp && api?.print) {
          // Desktop: send the dedicated report bytes to the connected/selected printer.
          const bytes = buildReportReceipt(reportReceipt);
          const result = await api.print(Array.from(bytes));
          if (result?.success === false) {
            toast.error(`Print failed: ${result.error || 'unknown error'}`);
          } else {
            onOpenChange(false);
          }
        } else {
          // Non-Electron WebUSB fallback: reuse the bill-format path.
          await printUSB(reportBillData);
          onOpenChange(false);
        }
      } else if (method === 'bluetooth' && connectedDevice) {
        await printThermal(reportBillData, true);
        onOpenChange(false);
      } else {
        // Browser fallback
        const cgstPct = currentRestaurant.cgst_percentage ?? 0;
        const sgstPct = currentRestaurant.sgst_percentage ?? 0;
        const reportLines = [
          '', '========================================',
          '         SALES REPORT SUMMARY           ',
          '========================================', '',
          `Restaurant: ${currentRestaurant.name}`,
          `Period: ${dateRangeLabel}`,
          `Date: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, '',
          '--- REVENUE SUMMARY ---', '',
          `Subtotal (excl. GST): ₹${stats.totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
          `Completed Orders:  ${stats.completedOrders}`,
          `Avg Order Value:   ₹${Math.round(stats.avgOrderValue).toLocaleString()}`,
          ...(stats.cgstTotal > 0 ? [`CGST (${cgstPct}%):        ₹${stats.cgstTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`] : []),
          ...(stats.sgstTotal > 0 ? [`SGST (${sgstPct}%):        ₹${stats.sgstTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`] : []),
          ...(stats.cgstTotal > 0 || stats.sgstTotal > 0 ? [
            '----------------------------------------',
            `Grand Total (incl. GST): ₹${stats.grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
          ] : []),
          '',
          '--- PAYMENT BREAKDOWN ---', '',
          `Cash:    ₹${stats.cashRevenue.toLocaleString()}`,
          `Online:  ₹${stats.onlineRevenue.toLocaleString()}`, '',
          '--- ITEM SALES ---', '',
          ...allSoldItems.map((item, idx) => `${idx + 1}. ${item.name} x${item.quantity}  Rs.${item.revenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`),
          '', '========================================', '', '', '',
        ];
        const printWindow = window.open('', '_blank', 'width=300,height=600');
        if (printWindow) {
          printWindow.document.write(`<!DOCTYPE html><html><head><title>Sales Report</title>
            <style>* { margin:0;padding:0;box-sizing:border-box; } body { font-family:'Courier New',monospace;font-size:12px;width:80mm;padding:5mm; } pre { white-space:pre-wrap;word-wrap:break-word; }</style>
            </head><body><pre>${reportLines.join('\n')}</pre></body></html>`);
          printWindow.document.close();
          printWindow.focus();
          setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
          onOpenChange(false);
        }
      }
    } catch (error: any) {
      console.error('[ReportPrintDialog] Print error:', error);
    }
  };

  const dateRangeLabel = dateRange === 'today' ? 'Today' :
    dateRange === 'yesterday' ? 'Yesterday' :
    dateRange === 'week' ? 'This Week' :
    dateRange === 'month' ? 'This Month' : 'Custom Range';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="w-5 h-5" />
            Print Report Summary
          </DialogTitle>
          <DialogDescription>
            Print the current report summary to your thermal printer
          </DialogDescription>
        </DialogHeader>

        {/* Report Preview */}
        <div className="bg-muted rounded-md p-4 font-mono text-xs space-y-1 max-h-48 overflow-y-auto">
          <p className="text-center font-bold">{currentRestaurant?.name}</p>
          <p className="text-center text-muted-foreground">SALES REPORT</p>
          <Separator className="my-2" />
          <p className="text-muted-foreground">Period: {dateRangeLabel}</p>
          <p className="text-muted-foreground">Date: {format(new Date(), 'dd/MM/yyyy HH:mm')}</p>
          <Separator className="my-2" />
          <p className="font-semibold">REVENUE SUMMARY</p>
          <div className="flex justify-between"><span>Subtotal (excl. GST)</span><span>₹{stats.totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span></div>
          <div className="flex justify-between"><span>Completed Orders</span><span>{stats.completedOrders}</span></div>
          <div className="flex justify-between"><span>Avg Order Value</span><span>₹{Math.round(stats.avgOrderValue).toLocaleString()}</span></div>
          {stats.cgstTotal > 0 && (
            <div className="flex justify-between text-muted-foreground"><span>CGST ({currentRestaurant?.cgst_percentage}%)</span><span>₹{stats.cgstTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span></div>
          )}
          {stats.sgstTotal > 0 && (
            <div className="flex justify-between text-muted-foreground"><span>SGST ({currentRestaurant?.sgst_percentage}%)</span><span>₹{stats.sgstTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span></div>
          )}
          {(stats.cgstTotal > 0 || stats.sgstTotal > 0) && (
            <div className="flex justify-between font-semibold border-t pt-1 mt-1"><span>Grand Total (incl. GST)</span><span>₹{stats.grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span></div>
          )}
          <Separator className="my-2" />
          <p className="font-semibold">PAYMENT BREAKDOWN</p>
          <div className="flex justify-between"><span>Cash</span><span>₹{stats.cashRevenue.toLocaleString()}</span></div>
          <div className="flex justify-between"><span>Online</span><span>₹{stats.onlineRevenue.toLocaleString()}</span></div>
          {allSoldItems.length > 0 && (
            <>
              <Separator className="my-2" />
              <p className="font-semibold">ITEM SALES ({allSoldItems.length})</p>
              {allSoldItems.map((item, idx) => (
                <div key={item.name} className="flex justify-between">
                  <span>{idx + 1}. {item.name} ×{item.quantity}</span>
                  <span>₹{item.revenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                </div>
              ))}
            </>
          )}
        </div>

        <Separator />

        {/* Print Buttons — identical layout to BillingDialog */}
        <div className="space-y-2">
          <div className="flex gap-2">
            {/* USB Thermal Print */}
            {(isUSBAvailable || isElectronApp) && (
              <div className="flex flex-1 gap-1">
                <Button
                  variant={usbPrinter ? 'default' : 'outline'}
                  className={`flex-1 ${usbPrinter ? 'bg-primary' : ''}`}
                  onClick={() => {
                    if (usbPrinter) {
                      handlePrint('usb');
                    } else if (isElectronApp) {
                      setShowDeviceList(!showDeviceList);
                    } else {
                      handleConnectUSB();
                    }
                  }}
                  disabled={usbPrinting}
                >
                  <Usb className="w-4 h-4 mr-2" />
                  {usbPrinter ? `Print (${usbPrinter.name.substring(0, 12)})` : 'Connect USB Printer'}
                </Button>
                {/* Change printer button — only visible when a printer is already connected */}
                {usbPrinter && isElectronApp && (
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
            {/* Browser fallback */}
            <Button
              variant="outline"
              className={(isUSBAvailable || isElectronApp) ? '' : 'flex-1'}
              onClick={() => handlePrint('browser')}
              disabled={thermalPrinting}
            >
              <Printer className="w-4 h-4 mr-2" />
              Browser
            </Button>
            {/* Bluetooth */}
            {isBluetoothAvailable && (
              <Button
                variant="outline"
                className={connectedDevice ? 'border-green-500 text-green-600' : ''}
                onClick={() => connectedDevice ? handlePrint('bluetooth') : undefined}
                disabled={thermalPrinting}
              >
                <Bluetooth className="w-4 h-4 mr-2" />
                BT
              </Button>
            )}
          </div>

          {/* Electron USB Device List — shown when no printer OR when changing printer */}
          {isElectronApp && showDeviceList && (
            <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {usbPrinter ? 'Switch Printer' : 'Available USB Devices'}
                </span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={handleRefreshDevices} disabled={loadingDevices}>
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingDevices ? 'animate-spin' : ''}`} />
                  </Button>
                  {usbPrinter && (
                    <Button variant="ghost" size="sm" onClick={() => setShowDeviceList(false)}>
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
              {usbPrinter && (
                <p className="text-xs text-muted-foreground">
                  Currently: <span className="font-medium text-foreground">{usbPrinter.name}</span> — select a different printer below
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
                        usbPrinter?.vendorId === device.vendorId && usbPrinter?.productId === device.productId
                          ? 'bg-accent/60 font-medium'
                          : ''
                      }`}
                      onClick={() => handleConnectUSB(device.vendorId, device.productId)}
                    >
                      <span className="truncate flex items-center gap-2">
                        {usbPrinter?.vendorId === device.vendorId && usbPrinter?.productId === device.productId && (
                          <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                        )}
                        {device.name}
                      </span>
                      <span className="text-xs opacity-60 ml-2 shrink-0">
                        {device.vendorId.toString(16).padStart(4, '0')}:{device.productId.toString(16).padStart(4, '0')}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Windows Printer Selector - show all available printers */}
          {isElectronApp && usbPrinter && windowsPrinters.length > 0 && (
            <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Windows Printer</Label>
                <span className="text-xs text-muted-foreground">
                  {windowsPrinters.length} printer{windowsPrinters.length > 1 ? 's' : ''} available
                </span>
              </div>
              <select
                className="w-full px-3 py-2 rounded-md border text-sm bg-background"
                value={selectedWindowsPrinter}
                onChange={async (e) => {
                  const newPrinter = e.target.value;
                  setSelectedWindowsPrinter(newPrinter);
                  try {
                    const api = (window as any).electronAPI?.printer;
                    if (api?.switchWindowsPrinter) {
                      const result = await api.switchWindowsPrinter(newPrinter);
                      if (result.success) {
                        console.log('[ReportPrintDialog] Switched to:', newPrinter);
                      }
                    }
                  } catch (err: any) {
                    console.error('[ReportPrintDialog] Switch printer error:', err);
                  }
                }}
              >
                {windowsPrinters.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Select any Windows printer for printing.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Reports() {
  const { currentRestaurant } = useRestaurant();
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [customDateFrom, setCustomDateFrom] = useState<Date | undefined>(undefined);
  const [customDateTo, setCustomDateTo] = useState<Date | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [paymentFilter, setPaymentFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [orderToEdit, setOrderToEdit] = useState<Order | null>(null);
  const [editPaymentMethod, setEditPaymentMethod] = useState<string>('');
  const [editStatus, setEditStatus] = useState<string>('');
  const [billingDialogOpen, setBillingDialogOpen] = useState(false);
  const [billingOrder, setBillingOrder] = useState<Order | null>(null);
  const [billEditDialogOpen, setBillEditDialogOpen] = useState(false);
  const ordersPerPage = 10;

  // Thermal printer hooks
  const { printBill: printThermal, connectedDevice, isBluetoothAvailable, printing: thermalPrinting } = useThermalPrinter();
  const { connectedPrinter: usbPrinter, printing: usbPrinting, isAvailable: isUSBAvailable, connectPrinter: connectUSB, printBill: printUSB } = useUSBPrinter();

  // Delete order handler - offline-first
  const handleDeleteOrder = async () => {
    if (!orderToDelete) return;
    
    try {
      // Delete order items first (local SQLite)
      const db = getDataClient();
      if (db) {
        const itemsRes = await db.query('order_items', { order_id: orderToDelete.id });
        for (const item of (itemsRes.data || [])) {
          await offlineDelete('order_items', item.id, async () => {
            return await supabase.from('order_items').delete().eq('id', item.id);
          });
        }
      }
      
      // Then delete the order
      const { error } = await offlineDelete('orders', orderToDelete.id, async () => {
        return await supabase.from('orders').delete().eq('id', orderToDelete.id);
      });
      
      if (error) throw error;
      
      setOrders(prev => prev.filter(o => o.id !== orderToDelete.id));
      toast({ title: 'Order deleted successfully' });
    } catch (error: any) {
      toast({ title: 'Failed to delete order', description: error.message, variant: 'destructive' });
    } finally {
      setDeleteDialogOpen(false);
      setOrderToDelete(null);
    }
  };

  // Edit order handler - offline-first
  const handleEditOrder = async () => {
    if (!orderToEdit) return;
    
    try {
      const { error } = await offlineMutate('orders', {
        id: orderToEdit.id,
        payment_method: editPaymentMethod || null,
        status: editStatus as OrderStatus,
        restaurant_id: orderToEdit.table_id ? undefined : currentRestaurant?.id
      }, async () => {
        const res = await supabase
          .from('orders')
          .update({
            payment_method: editPaymentMethod || null,
            status: editStatus as OrderStatus,
          })
          .eq('id', orderToEdit.id)
          .select()
          .single();
        return res;
      });
      
      if (error) throw error;
      
      setOrders(prev => prev.map(o => 
        o.id === orderToEdit.id 
          ? { ...o, payment_method: editPaymentMethod || null, status: editStatus as OrderStatus }
          : o
      ));
      toast({ title: 'Order updated successfully' });
    } catch (error: any) {
      toast({ title: 'Failed to update order', description: error.message, variant: 'destructive' });
    } finally {
      setEditDialogOpen(false);
      setOrderToEdit(null);
    }
  };

  const openDeleteDialog = (order: Order) => {
    setOrderToDelete(order);
    setDeleteDialogOpen(true);
  };

  const openEditDialog = (order: Order) => {
    setOrderToEdit(order);
    setEditPaymentMethod(order.payment_method || '');
    setEditStatus(order.status);
    setEditDialogOpen(true);
  };

  const openBillingDialog = (order: Order) => {
    setBillingOrder(order);
    setBillingDialogOpen(true);
  };

  // GST-inclusive grand total for an order. Uses the saved final_amount when
  // present (it already includes discount + GST); otherwise computes it from
  // the subtotal, any saved discount, and the current GST rates.
  const orderGrandTotal = (order: any): number => {
    const finalAmt = Number(order.final_amount) || 0;
    if (finalAmt > 0) return finalAmt;
    const sub = Number(order.total_amount) || 0;
    const disc = Number(order.discount_amount) || 0;
    const net = Math.max(sub - disc, 0);
    const cgst = (net * (currentRestaurant?.cgst_percentage || 0)) / 100;
    const sgst = (net * (currentRestaurant?.sgst_percentage || 0)) / 100;
    return net + cgst + sgst;
  };

  // Calculate date range
  const getDateRange = useMemo(() => {
    const now = new Date();
    switch (dateRange) {
      case 'today':
        return { from: startOfDay(now), to: endOfDay(now) };
      case 'yesterday':
        return { from: startOfDay(subDays(now, 1)), to: endOfDay(subDays(now, 1)) };
      case 'week':
        return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
      case 'month':
        return { from: startOfMonth(now), to: endOfMonth(now) };
      case 'custom':
        return { 
          from: customDateFrom ? startOfDay(customDateFrom) : startOfDay(now), 
          to: customDateTo ? endOfDay(customDateTo) : endOfDay(now) 
        };
      default:
        return { from: startOfDay(now), to: endOfDay(now) };
    }
  }, [dateRange, customDateFrom, customDateTo]);

  // Fetch orders from local SQLite (offline-first)
  const fetchOrders = useCallback(async () => {
    if (!currentRestaurant) return;
    setLoading(true);

    try {
      const result = await offlineQuery(
        async () => {
          const { data, error } = await supabase
            .from('orders')
            .select(`
              id,
              status,
              total_amount,
              created_at,
              notes,
              table_id,
              payment_method,
              restaurant_id,
              order_items (
                id,
                quantity,
                unit_price,
                menu_item:menu_items (
                  name,
                  food_type
                )
              )
            `)
            .eq('restaurant_id', currentRestaurant.id)
            .gte('created_at', getDateRange.from.toISOString())
            .lte('created_at', getDateRange.to.toISOString())
            .order('created_at', { ascending: false });
          
          if (error) throw error;
          return { data, error };
        },
        { table: 'orders', filters: { restaurant_id: currentRestaurant.id } }
      );

      if (result.error && !result.fromCache) throw result.error;

      let ordersData: any[] = [];

      if (result.fromCache) {
        // From SQLite cache - need to filter by date and assemble data
        // Use localQuery which is LAN-aware
        const { localQuery } = await import('@/services/localDataService');
        
        // Fetch all orders for this restaurant from local/LAN
        const ordersRes = await localQuery('orders', { restaurant_id: currentRestaurant.id });
        const rawOrders = (ordersRes.data || []) as any[];
          
          // Filter by date range
          const filteredOrders = rawOrders.filter(order => {
            const orderDate = new Date(order.created_at);
            return orderDate >= getDateRange.from && orderDate <= getDateRange.to;
          });

        // Fetch related data using localQuery (LAN-aware)
          const [itemsRes, tablesRes, floorsRes, menuRes] = await Promise.all([
            localQuery('order_items'),
            localQuery('tables'),
            localQuery('floors'),
            localQuery('menu_items')
          ]);

          const allItems = itemsRes.data || [];
          const allTables = tablesRes.data || [];
          const allFloors = floorsRes.data || [];
          const allMenuItems = menuRes.data || [];

          // Assemble orders with related data
          ordersData = filteredOrders.map(order => {
            const orderItems = allItems
              .filter((item: any) => item.order_id === order.id)
              .map((item: any) => {
                const menuItem = allMenuItems.find((m: any) => m.id === item.menu_item_id);
                return {
                  ...item,
                  menu_item: menuItem ? {
                    name: menuItem.name,
                    food_type: menuItem.food_type
                  } : null
                };
              });

            const table = order.table_id 
              ? allTables.find((t: any) => t.id === order.table_id)
              : null;
            
            const floor = table 
              ? allFloors.find((f: any) => f.id === table.floor_id)
              : null;

            return {
              ...order,
              order_items: orderItems,
              table: table ? { 
                table_number: table.table_number,
                floor: floor ? { name: floor.name } : { name: 'Unknown' }
              } : null
            };
          });
      } else {
        // From Supabase (cloud)
        ordersData = result.data || [];
        
        // Fetch table and floor info separately for cloud data
        const tableIds = ordersData.filter((o: any) => o.table_id).map((o: any) => o.table_id);
        let tablesMap: Record<string, { table_number: string; floor_id: string }> = {};
        let floorsMap: Record<string, { name: string }> = {};
        
        if (tableIds.length > 0) {
          const { data: tables } = await supabase
            .from('tables')
            .select('id, table_number, floor_id')
            .in('id', tableIds);
          
          if (tables) {
            tablesMap = tables.reduce((acc, t) => ({ ...acc, [t.id]: t }), {});
            
            // Fetch floors for these tables
            const floorIds = tables.filter(t => t.floor_id).map(t => t.floor_id);
            if (floorIds.length > 0) {
              const { data: floors } = await supabase
                .from('floors')
                .select('id, name')
                .in('id', floorIds);
              
              if (floors) {
                floorsMap = floors.reduce((acc, f) => ({ ...acc, [f.id]: f }), {});
              }
            }
          }
        }

        ordersData = ordersData.map((order: any) => {
          const table = order.table_id ? tablesMap[order.table_id] : null;
          const floor = table?.floor_id ? floorsMap[table.floor_id] : null;
          return {
            ...order,
            table: table ? { 
              table_number: table.table_number,
              floor: floor ? { name: floor.name } : { name: 'Unknown' }
            } : null
          };
        });
      }

      // Sort newest-first explicitly. The DB returns rows in different orders
      // depending on source (local = updated_at DESC, LAN = insertion order), so
      // without this the history list would differ between the server and a
      // client even though it's the same set of orders.
      ordersData.sort((a: any, b: any) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setOrders(ordersData.map(order => ({
        ...order,
        status: order.status as OrderStatus,
        order_items: order.order_items?.map((item: any) => ({
          ...item,
          menu_item: item.menu_item as { name: string; food_type: string } | null
        })) || []
      })));
    } catch (error: any) {
      console.error('Error fetching orders:', error);
      toast({ title: 'Failed to fetch orders', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [currentRestaurant, getDateRange, toast]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Refresh data when page becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[Reports] Page visible, refreshing data...');
        fetchOrders();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [fetchOrders]);

  // Keep the order history in sync across stations: refresh instantly when the
  // LAN server pushes an order/item change, plus a slower poll as a safety net.
  // Without this a client's history is just a one-time snapshot.
  useEffect(() => {
    const interval = setInterval(() => { fetchOrders(); }, 15000);

    let debounce: any;
    const lan = (window as any).electronAPI?.lan;
    const unsub = lan?.onRecordChanged?.((_e: any, payload: any) => {
      if (payload?.table && !['orders', 'order_items'].includes(payload.table)) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => fetchOrders(), 800);
    });

    return () => {
      clearInterval(interval);
      clearTimeout(debounce);
      unsub?.();
    };
  }, [fetchOrders]);

  // Calculate stats
  const stats = useMemo(() => {
    const completed = orders.filter(o => o.status === 'served');
    const cancelled = orders.filter(o => o.status === 'cancelled');
    const pending = orders.filter(o => ['pending', 'cooking', 'ready'].includes(o.status));
    
    const totalRevenue = completed.reduce((sum, o) => sum + Number(o.total_amount), 0);
    const avgOrderValue = completed.length > 0 ? totalRevenue / completed.length : 0;

    // GST totals derived from restaurant settings
    const cgstPct = currentRestaurant?.cgst_percentage ?? 0;
    const sgstPct = currentRestaurant?.sgst_percentage ?? 0;
    const cgstTotal = (totalRevenue * cgstPct) / 100;
    const sgstTotal = (totalRevenue * sgstPct) / 100;
    const grandTotal = totalRevenue + cgstTotal + sgstTotal;
    
    // Payment method breakdown
    const cashRevenue = completed
      .filter(o => o.payment_method === 'cash')
      .reduce((sum, o) => sum + Number(o.total_amount), 0);
    const onlineRevenue = completed
      .filter(o => o.payment_method === 'card' || o.payment_method === 'upi')
      .reduce((sum, o) => sum + Number(o.total_amount), 0);
    const unpaidRevenue = completed
      .filter(o => !o.payment_method)
      .reduce((sum, o) => sum + Number(o.total_amount), 0);
    
    return {
      totalOrders: orders.length,
      completedOrders: completed.length,
      cancelledOrders: cancelled.length,
      pendingOrders: pending.length,
      totalRevenue,
      avgOrderValue,
      cashRevenue,
      onlineRevenue,
      unpaidRevenue,
      cgstTotal,
      sgstTotal,
      grandTotal,
    };
  }, [orders, currentRestaurant]);

  // Popular items
  const popularItems = useMemo(() => {
    const itemMap = new Map<string, MenuItem>();
    
    orders
      .filter(o => o.status === 'served')
      .forEach(order => {
        order.order_items.forEach(item => {
          const name = item.menu_item?.name || 'Unknown';
          const existing = itemMap.get(name) || { name, quantity: 0, revenue: 0 };
          itemMap.set(name, {
            name,
            quantity: existing.quantity + item.quantity,
            revenue: existing.revenue + (item.quantity * Number(item.unit_price))
          });
        });
      });

    return Array.from(itemMap.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);
  }, [orders]);

  // Every item sold in the period (full list, highest quantity first) — used for
  // the printed report's item-sales summary. popularItems keeps only the top 5
  // for the on-screen widgets; the printout needs the complete list.
  const allSoldItems = useMemo(() => {
    const itemMap = new Map<string, MenuItem>();
    orders
      .filter(o => o.status === 'served')
      .forEach(order => {
        order.order_items.forEach(item => {
          const name = item.menu_item?.name || 'Unknown';
          const existing = itemMap.get(name) || { name, quantity: 0, revenue: 0 };
          itemMap.set(name, {
            name,
            quantity: existing.quantity + item.quantity,
            revenue: existing.revenue + (item.quantity * Number(item.unit_price)),
          });
        });
      });
    return Array.from(itemMap.values()).sort((a, b) => b.quantity - a.quantity);
  }, [orders]);

  // Hourly data for today
  const hourlyData = useMemo(() => {
    if (dateRange !== 'today' && dateRange !== 'yesterday') return [];
    
    const baseDate = dateRange === 'yesterday' ? subDays(new Date(), 1) : new Date();
    const hours = eachHourOfInterval({
      start: startOfDay(baseDate),
      end: addHours(startOfDay(baseDate), 23)
    });

    return hours.map(hour => {
      const hourOrders = orders.filter(o => {
        const orderDate = parseISO(o.created_at);
        return orderDate.getHours() === hour.getHours() && o.status === 'served';
      });

      return {
        hour: format(hour, 'ha'),
        orders: hourOrders.length,
        revenue: hourOrders.reduce((sum, o) => sum + Number(o.total_amount), 0)
      };
    });
  }, [orders, dateRange]);

  // Daily data for week/month
  const dailyData = useMemo(() => {
    if (dateRange === 'today' || dateRange === 'yesterday') return [];

    const days = eachDayOfInterval({ start: getDateRange.from, end: getDateRange.to });

    return days.map(day => {
      const dayOrders = orders.filter(o => {
        const orderDate = parseISO(o.created_at);
        return isWithinInterval(orderDate, { start: startOfDay(day), end: endOfDay(day) }) && 
               o.status === 'served';
      });

      return {
        date: format(day, 'MMM d'),
        orders: dayOrders.length,
        revenue: dayOrders.reduce((sum, o) => sum + Number(o.total_amount), 0)
      };
    });
  }, [orders, dateRange, getDateRange]);

  // Order status distribution
  const statusDistribution = useMemo(() => {
    const distribution = {
      pending: 0,
      cooking: 0,
      ready: 0,
      served: 0,
      cancelled: 0,
    };

    orders.forEach(o => {
      distribution[o.status]++;
    });

    return Object.entries(distribution)
      .filter(([, value]) => value > 0)
      .map(([status, count]) => ({
        name: STATUS_CONFIG[status as OrderStatus].label,
        value: count,
      }));
  }, [orders]);

  // Filtered orders for history
  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
      const matchesPayment = paymentFilter === 'all' || 
        (paymentFilter === 'unpaid' && !order.payment_method) ||
        (paymentFilter === 'online' && (order.payment_method === 'card' || order.payment_method === 'upi')) ||
        order.payment_method === paymentFilter;
      const q = searchTerm.trim().toLowerCase();
      // Bill-number match: a purely-numeric query (also tolerates "#003") matches
      // the order's bill number numerically, so "3", "03", "003" and "#3" all find
      // Bill #003. Scoped to the orders already loaded for the selected day, so
      // this shows that day's bill (bill numbers reset daily).
      const qDigits = q.replace(/[^0-9]/g, '');
      const billNo = (order as any).bill_number;
      const matchesBill = qDigits !== '' && billNo != null &&
        parseInt(qDigits, 10) === Number(billNo);
      const matchesSearch = !searchTerm ||
        matchesBill ||
        order.order_items.some(item =>
          item.menu_item?.name.toLowerCase().includes(q)
        ) ||
        order.table?.table_number.toLowerCase().includes(q);
      return matchesStatus && matchesPayment && matchesSearch;
    });
  }, [orders, statusFilter, paymentFilter, searchTerm]);

  // Pagination
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * ordersPerPage;
    return filteredOrders.slice(start, start + ordersPerPage);
  }, [filteredOrders, currentPage]);

  const totalPages = Math.ceil(filteredOrders.length / ordersPerPage);

  // Export to CSV
  const exportToCSV = useCallback(() => {
    if (filteredOrders.length === 0) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }

    setExporting(true);

    try {
      const headers = ['Order ID', 'Date & Time', 'Table', 'Items', 'Status', 'Total (₹)'];
      const rows = filteredOrders.map(order => [
        order.id.slice(0, 8).toUpperCase(),
        format(parseISO(order.created_at), 'yyyy-MM-dd HH:mm'),
        order.table?.table_number || 'N/A',
        order.order_items.map(i => `${i.menu_item?.name || 'Unknown'} x${i.quantity}`).join('; '),
        STATUS_CONFIG[order.status].label,
        String(Math.round(Number(order.total_amount)))
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `orders_${format(getDateRange.from, 'yyyy-MM-dd')}_to_${format(getDateRange.to, 'yyyy-MM-dd')}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({ title: "CSV exported successfully" });
    } catch (error) {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }, [filteredOrders, getDateRange, toast]);

  // Export to PDF
  const exportToPDF = useCallback(() => {
    if (!currentRestaurant) return;
    if (orders.length === 0) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }

    setExporting(true);

    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();

      // Header
      doc.setFontSize(20);
      doc.setTextColor(40, 40, 40);
      doc.text(currentRestaurant.name, pageWidth / 2, 20, { align: 'center' });

      doc.setFontSize(14);
      doc.setTextColor(100, 100, 100);
      doc.text('Sales Report', pageWidth / 2, 28, { align: 'center' });

      doc.setFontSize(10);
      doc.text(
        `Period: ${format(getDateRange.from, 'PP')} - ${format(getDateRange.to, 'PP')}`,
        pageWidth / 2,
        35,
        { align: 'center' }
      );

      // Summary Section
      doc.setFontSize(12);
      doc.setTextColor(40, 40, 40);
      doc.text('Summary', 14, 48);

      const summaryData = [
        ['Total Orders', String(stats.totalOrders)],
        ['Completed Orders', String(stats.completedOrders)],
        ['Cancelled Orders', String(stats.cancelledOrders)],
        ['Total Revenue', `₹${stats.totalRevenue.toLocaleString()}`],
        ['Average Order Value', `₹${stats.avgOrderValue.toFixed(0)}`],
      ];

      autoTable(doc, {
        startY: 52,
        head: [['Metric', 'Value']],
        body: summaryData,
        theme: 'striped',
        headStyles: { fillColor: [200, 80, 50] },
        margin: { left: 14, right: 14 },
      });

      // Top Items Section
      const finalY1 = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
      doc.text('Top Selling Items', 14, finalY1 + 12);

      if (popularItems.length > 0) {
        autoTable(doc, {
          startY: finalY1 + 16,
          head: [['Item Name', 'Quantity Sold', 'Revenue (₹)']],
          body: popularItems.map(item => [
            item.name,
            String(item.quantity),
            item.revenue.toLocaleString()
          ]),
          theme: 'striped',
          headStyles: { fillColor: [200, 80, 50] },
          margin: { left: 14, right: 14 },
        });
      }

      // Orders Table
      const finalY2 = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
      doc.addPage();
      doc.text('Order Details', 14, 20);

      const ordersTableData = filteredOrders.slice(0, 50).map(order => [
        order.id.slice(0, 8).toUpperCase(),
        format(parseISO(order.created_at), 'MM/dd HH:mm'),
        order.table?.table_number || '-',
        STATUS_CONFIG[order.status].label,
        `₹${Number(order.total_amount).toLocaleString()}`
      ]);

      autoTable(doc, {
        startY: 24,
        head: [['Order ID', 'Date', 'Table', 'Status', 'Total']],
        body: ordersTableData,
        theme: 'striped',
        headStyles: { fillColor: [200, 80, 50] },
        margin: { left: 14, right: 14 },
        styles: { fontSize: 8 },
      });

      // Footer
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(
          `Generated on ${format(new Date(), 'PPp')} | Page ${i} of ${pageCount}`,
          pageWidth / 2,
          doc.internal.pageSize.getHeight() - 10,
          { align: 'center' }
        );
      }

      doc.save(`report_${format(getDateRange.from, 'yyyy-MM-dd')}_to_${format(getDateRange.to, 'yyyy-MM-dd')}.pdf`);
      toast({ title: "PDF exported successfully" });
    } catch (error) {
      console.error('PDF export error:', error);
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }, [currentRestaurant, orders, filteredOrders, stats, popularItems, getDateRange, toast]);

  // Open report print dialog
  const [reportPrintDialogOpen, setReportPrintDialogOpen] = useState(false);

  const openReportPrintDialog = useCallback(() => {
    if (!currentRestaurant) {
      toast({ title: "No restaurant selected", variant: "destructive" });
      return;
    }
    setReportPrintDialogOpen(true);
  }, [currentRestaurant, toast]);

  // Print report summary to thermal printer
  const printReportSummary = useCallback(async (printerType: 'usb' | 'bluetooth' | 'browser' = 'browser') => {
    if (!currentRestaurant) return;

    const dateRangeLabel = dateRange === 'today' ? 'Today' : 
                          dateRange === 'yesterday' ? 'Yesterday' :
                          dateRange === 'week' ? 'This Week' :
                          dateRange === 'month' ? 'This Month' : 'Custom Range';

    // Create report items for BillData format
    const reportItems = [
      { name: `Period: ${dateRangeLabel}`, quantity: 1, price: 0 },
      { name: '--- REVENUE SUMMARY ---', quantity: 1, price: 0 },
      { name: 'Total Revenue', quantity: 1, price: stats.totalRevenue },
      { name: 'Completed Orders', quantity: stats.completedOrders, price: 0 },
      { name: `Average Order Value`, quantity: 1, price: Math.round(stats.avgOrderValue) },
      { name: '--- PAYMENT BREAKDOWN ---', quantity: 1, price: 0 },
      { name: 'Cash Payments', quantity: 1, price: stats.cashRevenue },
      { name: 'Online Payments', quantity: 1, price: stats.onlineRevenue },
      { name: '--- TOP SELLING ITEMS ---', quantity: 1, price: 0 },
      ...popularItems.slice(0, 5).map(item => ({
        name: item.name,
        quantity: item.quantity,
        price: item.revenue
      })),
    ];

    const reportBillData = {
      restaurantName: currentRestaurant.name,
      restaurantAddress: currentRestaurant.address,
      restaurantPhone: currentRestaurant.phone,
      tableNumber: 'REPORT',
      items: reportItems,
      subtotal: stats.totalRevenue,
      total: stats.grandTotal,
      cgstPercentage: currentRestaurant.cgst_percentage ?? 0,
      sgstPercentage: currentRestaurant.sgst_percentage ?? 0,
      cgstAmount: stats.cgstTotal,
      sgstAmount: stats.sgstTotal,
    };

    try {
      if (printerType === 'usb' && isUSBAvailable) {
        // Auto-connect if not yet connected
        if (!usbPrinter) {
          await connectUSB();
        }
        await printUSB(reportBillData);
        toast({ title: "Report printed via USB" });
        setReportPrintDialogOpen(false);
        return;
      }

      if (printerType === 'bluetooth' && isBluetoothAvailable && connectedDevice) {
        await printThermal(reportBillData);
        toast({ title: "Report printed via Bluetooth" });
        setReportPrintDialogOpen(false);
        return;
      }

      if (printerType === 'browser') {
        // Fallback to browser print with formatted text
        const cgstPct = currentRestaurant.cgst_percentage ?? 0;
        const sgstPct = currentRestaurant.sgst_percentage ?? 0;
        const reportLines = [
          '',
          '========================================',
          '         SALES REPORT SUMMARY           ',
          '========================================',
          '',
          `Restaurant: ${currentRestaurant.name}`,
          `Period: ${dateRangeLabel}`,
          `Date: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`,
          '',
          '----------------------------------------',
          '           REVENUE SUMMARY              ',
          '----------------------------------------',
          '',
          `Subtotal (excl. GST): ₹${stats.totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
          `Completed Orders:  ${stats.completedOrders}`,
          `Average Order:     ₹${Math.round(stats.avgOrderValue).toLocaleString()}`,
          ...(stats.cgstTotal > 0 ? [`CGST (${cgstPct}%):   ₹${stats.cgstTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`] : []),
          ...(stats.sgstTotal > 0 ? [`SGST (${sgstPct}%):   ₹${stats.sgstTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`] : []),
          ...(stats.cgstTotal > 0 || stats.sgstTotal > 0 ? [
            '----------------------------------------',
            `Grand Total (incl. GST): ₹${stats.grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
          ] : []),
          '',
          '----------------------------------------',
          '         PAYMENT BREAKDOWN              ',
          '----------------------------------------',
          '',
          `Cash Payments:     ₹${stats.cashRevenue.toLocaleString()}`,
          `Online Payments:   ₹${stats.onlineRevenue.toLocaleString()}`,
          '',
          '----------------------------------------',
          '         TOP SELLING ITEMS              ',
          '----------------------------------------',
          '',
          ...popularItems.slice(0, 5).map((item, idx) => 
            `${idx + 1}. ${item.name}`
          ),
          '',
          '========================================',
          '         End of Report                  ',
          '========================================',
          '',
          '',
          '',
        ];
        const reportText = reportLines.join('\n');
        
        const printWindow = window.open('', '_blank', 'width=300,height=600');
        if (printWindow) {
          printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Sales Report</title>
              <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Courier New', monospace; font-size: 12px; width: 80mm; padding: 5mm; }
                pre { white-space: pre-wrap; word-wrap: break-word; }
              </style>
            </head>
            <body>
              <pre>${reportText}</pre>
            </body>
            </html>
          `);
          printWindow.document.close();
          printWindow.focus();
          setTimeout(() => {
            printWindow.print();
            printWindow.close();
          }, 250);
          toast({ title: "Report sent to browser print" });
          setReportPrintDialogOpen(false);
        }
      }
    } catch (error: any) {
      console.error('Print error:', error);
      toast({ title: "Print failed", description: error.message, variant: "destructive" });
    }
  }, [currentRestaurant, dateRange, stats, popularItems, usbPrinter, isUSBAvailable, connectUSB, connectedDevice, isBluetoothAvailable, printUSB, printThermal, toast]);

  if (!currentRestaurant) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Please select a restaurant first.</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-foreground">Reports & Analytics</h1>
            <p className="text-muted-foreground mt-1">Track your restaurant performance</p>
          </div>
          
          {/* Date Range, Export & Print */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={openReportPrintDialog}
              disabled={thermalPrinting || usbPrinting || loading}
              title="Print report summary to thermal printer"
            >
              <Printer className="w-4 h-4 mr-2" />
              Print Report
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" disabled={exporting || loading}>
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-40 p-2" align="end">
                <div className="space-y-1">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full justify-start" 
                    onClick={exportToPDF}
                    disabled={exporting}
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    PDF Report
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full justify-start" 
                    onClick={exportToCSV}
                    disabled={exporting}
                  >
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    CSV Data
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            <Select value={dateRange} onValueChange={(value: DateRange) => setDateRange(value)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Select range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="yesterday">Yesterday</SelectItem>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>

            {dateRange === 'custom' && (
              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[130px] justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {customDateFrom ? format(customDateFrom, 'PP') : 'From'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={customDateFrom}
                      onSelect={setCustomDateFrom}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[130px] justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {customDateTo ? format(customDateTo, 'PP') : 'To'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={customDateTo}
                      onSelect={setCustomDateTo}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            )}
          </div>
        </div>

        <Tabs defaultValue="summary" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 lg:w-auto lg:inline-grid">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          {/* Summary Tab */}
          <TabsContent value="summary" className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="glass-card">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                      <IndianRupee className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {stats.cgstTotal > 0 || stats.sgstTotal > 0 ? 'Subtotal (excl. GST)' : 'Total Revenue'}
                      </p>
                      <p className="text-2xl font-bold text-foreground">₹{stats.totalRevenue.toLocaleString()}</p>
                      {(stats.cgstTotal > 0 || stats.sgstTotal > 0) && (
                        <p className="text-xs text-primary font-semibold mt-0.5">
                          Grand Total: ₹{stats.grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-card">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center">
                      <ShoppingBag className="w-6 h-6 text-success" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Completed Orders</p>
                      <p className="text-2xl font-bold text-foreground">{stats.completedOrders}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-card">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center">
                      <TrendingUp className="w-6 h-6 text-accent" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Avg. Order Value</p>
                      <p className="text-2xl font-bold text-foreground">₹{stats.avgOrderValue.toFixed(0)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-card">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-warning/10 flex items-center justify-center">
                      <Clock className="w-6 h-6 text-warning" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Pending Orders</p>
                      <p className="text-2xl font-bold text-foreground">{stats.pendingOrders}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* GST Breakdown — only shown when GST is configured */}
            {(stats.cgstTotal > 0 || stats.sgstTotal > 0) && (
              <Card className="glass-card">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <IndianRupee className="w-4 h-4 text-primary" />
                    GST Breakdown
                  </CardTitle>
                  <CardDescription>Tax collected on revenue for the selected period</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="p-3 rounded-lg bg-muted/50 border border-border">
                      <p className="text-xs text-muted-foreground mb-1">Subtotal (excl. GST)</p>
                      <p className="text-lg font-bold text-foreground">₹{stats.totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                    </div>
                    {stats.cgstTotal > 0 && (
                      <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
                        <p className="text-xs text-muted-foreground mb-1">CGST ({currentRestaurant?.cgst_percentage}%)</p>
                        <p className="text-lg font-bold text-foreground">₹{stats.cgstTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                      </div>
                    )}
                    {stats.sgstTotal > 0 && (
                      <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
                        <p className="text-xs text-muted-foreground mb-1">SGST ({currentRestaurant?.sgst_percentage}%)</p>
                        <p className="text-lg font-bold text-foreground">₹{stats.sgstTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                      </div>
                    )}
                    <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                      <p className="text-xs text-muted-foreground mb-1">Grand Total (incl. GST)</p>
                      <p className="text-lg font-bold text-primary">₹{stats.grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Payment Method Breakdown */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <IndianRupee className="w-5 h-5 text-primary" />
                  Revenue by Payment Type
                </CardTitle>
                <CardDescription>Breakdown of payments by method</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="flex items-center gap-3 p-4 rounded-xl bg-success/10 border border-success/20">
                    <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center">
                      <Banknote className="w-5 h-5 text-success" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Cash</p>
                      <p className="text-xl font-bold text-foreground">₹{stats.cashRevenue.toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-4 rounded-xl bg-primary/10 border border-primary/20">
                    <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                      <Smartphone className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Online (Card/UPI)</p>
                      <p className="text-xl font-bold text-foreground">₹{stats.onlineRevenue.toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-4 rounded-xl bg-muted border border-border">
                    <div className="w-10 h-10 rounded-lg bg-muted-foreground/20 flex items-center justify-center">
                      <CreditCard className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Not Recorded</p>
                      <p className="text-xl font-bold text-foreground">₹{stats.unpaidRevenue.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Popular Items */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Flame className="w-5 h-5 text-primary" />
                  Top Selling Items
                </CardTitle>
                <CardDescription>Most popular dishes by quantity sold</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />
                    ))}
                  </div>
                ) : popularItems.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No items sold in this period</p>
                ) : (
                  <div className="space-y-3">
                    {popularItems.map((item, index) => (
                      <div key={item.name} className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
                        <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold",
                          index === 0 ? "bg-primary text-primary-foreground" :
                          index === 1 ? "bg-accent text-accent-foreground" :
                          "bg-muted-foreground/20 text-muted-foreground"
                        )}>
                          {index + 1}
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-foreground">{item.name}</p>
                          <p className="text-sm text-muted-foreground">{item.quantity} sold</p>
                        </div>
                        <p className="font-semibold text-foreground">₹{item.revenue.toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics" className="space-y-6">
            <div className="grid lg:grid-cols-2 gap-6">
              {/* Orders & Revenue Chart */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>Orders & Revenue</CardTitle>
                  <CardDescription>
                    {dateRange === 'today' || dateRange === 'yesterday' ? 'Hourly breakdown' : 'Daily breakdown'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <div className="h-[300px] bg-muted animate-pulse rounded-lg" />
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={dateRange === 'today' || dateRange === 'yesterday' ? hourlyData : dailyData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis 
                          dataKey={dateRange === 'today' || dateRange === 'yesterday' ? 'hour' : 'date'} 
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={12}
                        />
                        <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                        <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: 'hsl(var(--card))', 
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px'
                          }}
                        />
                        <Legend />
                        <Line 
                          yAxisId="left"
                          type="monotone" 
                          dataKey="orders" 
                          name="Orders"
                          stroke="hsl(18, 76%, 52%)" 
                          strokeWidth={2}
                          dot={{ fill: 'hsl(18, 76%, 52%)' }}
                        />
                        <Line 
                          yAxisId="right"
                          type="monotone" 
                          dataKey="revenue" 
                          name="Revenue (₹)"
                          stroke="hsl(142, 76%, 36%)" 
                          strokeWidth={2}
                          dot={{ fill: 'hsl(142, 76%, 36%)' }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              {/* Status Distribution */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>Order Status Distribution</CardTitle>
                  <CardDescription>Breakdown by order status</CardDescription>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <div className="h-[300px] bg-muted animate-pulse rounded-lg" />
                  ) : statusDistribution.length === 0 ? (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                      No orders in this period
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={statusDistribution}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {statusDistribution.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: 'hsl(var(--card))', 
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px'
                          }}
                        />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              {/* Top Items Bar Chart */}
              <Card className="glass-card lg:col-span-2">
                <CardHeader>
                  <CardTitle>Top Items Performance</CardTitle>
                  <CardDescription>Revenue and quantity comparison</CardDescription>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <div className="h-[300px] bg-muted animate-pulse rounded-lg" />
                  ) : popularItems.length === 0 ? (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                      No items sold in this period
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={popularItems} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                        <YAxis 
                          type="category" 
                          dataKey="name" 
                          stroke="hsl(var(--muted-foreground))" 
                          fontSize={12}
                          width={120}
                        />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: 'hsl(var(--card))', 
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px'
                          }}
                        />
                        <Legend />
                        <Bar dataKey="quantity" name="Quantity" fill="hsl(18, 76%, 52%)" radius={[0, 4, 4, 0]} />
                        <Bar dataKey="revenue" name="Revenue (₹)" fill="hsl(38, 92%, 50%)" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-6">
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Input
                  placeholder="Search by bill #, item, or table..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="pl-10"
                />
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              </div>
              <Select value={statusFilter} onValueChange={(value) => {
                setStatusFilter(value);
                setCurrentPage(1);
              }}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="cooking">Cooking</SelectItem>
                  <SelectItem value="ready">Ready</SelectItem>
                  <SelectItem value="served">Served</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Select value={paymentFilter} onValueChange={(value) => {
                setPaymentFilter(value);
                setCurrentPage(1);
              }}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="All Payments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Payments</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="online">Online (Card/UPI)</SelectItem>
                  <SelectItem value="card">Card Only</SelectItem>
                  <SelectItem value="upi">UPI Only</SelectItem>
                  <SelectItem value="unpaid">Not Recorded</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Orders List */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Order History
                </CardTitle>
                <CardDescription>
                  {filteredOrders.length} orders found
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
                    ))}
                  </div>
                ) : paginatedOrders.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <ShoppingBag className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No orders found</p>
                  </div>
                ) : (
                  <ScrollArea className="h-[500px] pr-4">
                    <div className="space-y-4">
                      {paginatedOrders.map((order) => (
                        <div
                          key={order.id}
                          className="p-4 rounded-xl border border-border bg-card hover:shadow-md transition-shadow"
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-foreground">
                                  Order #{order.id.slice(0, 8).toUpperCase()}
                                </span>
                                {(order as any).bill_number != null && (
                                  <Badge variant="secondary" className="font-mono">
                                    Bill #{String((order as any).bill_number).padStart(3, '0')}
                                  </Badge>
                                )}
                                <Badge className={cn('status-badge', STATUS_CONFIG[order.status].className)}>
                                  {STATUS_CONFIG[order.status].label}
                                </Badge>
                                {order.payment_method && (
                                  <Badge variant="outline" className="text-xs">
                                    {order.payment_method === 'cash' ? <Banknote className="w-3 h-3 mr-1" /> : <Smartphone className="w-3 h-3 mr-1" />}
                                    {order.payment_method.toUpperCase()}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {format(parseISO(order.created_at), 'PPp')}
                                {order.table && ` • Table ${order.table.table_number}`}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <p className="text-lg font-bold text-primary">
                                ₹{orderGrandTotal(order).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                              </p>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title="View Bill / Print"
                                onClick={() => openBillingDialog(order)}
                              >
                                <Printer className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title="Edit Order"
                                onClick={() => openEditDialog(order)}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                title="Delete Order"
                                onClick={() => openDeleteDialog(order)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                          
                          <div className="flex flex-wrap gap-2">
                            {order.order_items.slice(0, 3).map((item) => (
                              <Badge key={item.id} variant="secondary" className="text-xs">
                                <Utensils className="w-3 h-3 mr-1" />
                                {item.menu_item?.name || 'Unknown'} × {item.quantity}
                              </Badge>
                            ))}
                            {order.order_items.length > 3 && (
                              <Badge variant="outline" className="text-xs">
                                +{order.order_items.length - 3} more
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                    <p className="text-sm text-muted-foreground">
                      Page {currentPage} of {totalPages}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Order?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete Order #{orderToDelete?.id.slice(0, 8).toUpperCase()}?
                This will permanently remove the order and all its items. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteOrder}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete Order
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Edit Order Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Order</DialogTitle>
              <DialogDescription>
                Update Order #{orderToEdit?.id.slice(0, 8).toUpperCase()}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Select value={editPaymentMethod} onValueChange={setEditPaymentMethod}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select payment method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="upi">UPI</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Order Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="cooking">Cooking</SelectItem>
                    <SelectItem value="ready">Ready</SelectItem>
                    <SelectItem value="served">Served</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleEditOrder}>
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Billing Dialog */}
        <BillingDialog
          open={billingDialogOpen}
          onOpenChange={setBillingDialogOpen}
          order={billingOrder}
          restaurantName={currentRestaurant?.name}
          restaurantAddress={currentRestaurant?.address}
          restaurantPhone={currentRestaurant?.phone}
          restaurantGstin={currentRestaurant?.gstin}
          restaurantCgstPercentage={currentRestaurant?.cgst_percentage || 0}
          restaurantSgstPercentage={currentRestaurant?.sgst_percentage || 0}
          showQrCode={currentRestaurant?.print_qr_on_bill !== false}
          paymentQrContent={(currentRestaurant as any)?.payment_qr_content}
          onPaymentComplete={async (paymentMethod, billing) => {
            if (!billingOrder) return;

            // Persist the discount/GST breakdown so the bill stays consistent.
            const billingFields = billing
              ? {
                  discount_amount: billing.discountAmount,
                  cgst_amount: billing.cgstAmount,
                  sgst_amount: billing.sgstAmount,
                  final_amount: billing.finalAmount,
                }
              : {};

            // Update the order in local state
            setOrders(prev => prev.map(o =>
              o.id === billingOrder.id
                ? { ...o, status: 'served' as OrderStatus, payment_method: paymentMethod, ...billingFields }
                : o
            ));

            // Update in SQLite/Supabase
            try {
              await offlineMutate('orders', {
                id: billingOrder.id,
                status: 'served',
                payment_method: paymentMethod,
                payment_status: 'paid',
                ...billingFields,
                restaurant_id: (billingOrder as any).restaurant_id || currentRestaurant?.id
              }, async () => {
                const res = await supabase
                  .from('orders')
                  .update({ status: 'served', payment_method: paymentMethod })
                  .eq('id', billingOrder.id)
                  .select()
                  .single();
                return res;
              });
              
              // Free up the table
              if (billingOrder.table_id) {
                await offlineMutate('tables', { id: billingOrder.table_id, is_occupied: false }, async () => {
                  const res = await supabase.from('tables').update({ is_occupied: false }).eq('id', billingOrder.table_id).select().single();
                  return res;
                });
              }
              
              toast({ title: `Payment recorded: ${paymentMethod.toUpperCase()}` });
            } catch (error: any) {
              toast({ title: 'Failed to record payment', description: error.message, variant: 'destructive' });
            }
            
            setBillingDialogOpen(false);
            setBillingOrder(null);
          }}
        />

        {/* Report Print Dialog */}
        <ReportPrintDialogInner
          open={reportPrintDialogOpen}
          onOpenChange={setReportPrintDialogOpen}
          currentRestaurant={currentRestaurant}
          dateRange={dateRange}
          stats={stats}
          popularItems={popularItems}
          allSoldItems={allSoldItems}
        />
      </div>
    </DashboardLayout>
  );
}
