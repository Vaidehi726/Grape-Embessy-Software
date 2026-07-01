// Unified Printer Bridge - works in both Web (WebUSB) and Electron (native USB)
// Detects environment automatically and routes to the correct implementation

import { usbPrinter, USBPrinterDevice } from './usbPrinter';
import type { BillData, SummaryPrintData } from './thermalPrinter';

// Type for the Electron API exposed via preload
interface ElectronPrinterAPI {
  listDevices: () => Promise<{ success: boolean; devices?: any[]; error?: string }>;
  connect: (vendorId: number, productId: number) => Promise<{ success: boolean; device?: any; error?: string }>;
  print: (receiptData: number[]) => Promise<{ success: boolean; error?: string }>;
  disconnect: () => Promise<{ success: boolean; error?: string }>;
  listWindowsPrinters?: () => Promise<{ success: boolean; printers?: string[]; error?: string }>;
  connectWindowsPrinter?: (printerName: string) => Promise<{ success: boolean; error?: string }>;
  printWindowsPrinter?: (receiptData: number[], printerName: string) => Promise<{ success: boolean; error?: string }>;
}

function getElectronPrinter(): ElectronPrinterAPI | null {
  const api = (window as any).electronAPI;
  return api?.printer ?? null;
}

export function isElectron(): boolean {
  return !!(window as any).electronAPI?.isElectron;
}

// Lazy getter - evaluates on first use, not at module load time
let _bridge: PrinterBridge | null = null;
export function getPrinterBridge(): PrinterBridge {
  if (!_bridge) {
    _bridge = isElectron() ? new ElectronPrinterBridge() : new WebPrinterBridge();
  }
  return _bridge;
}

// Convenience object that delegates all calls to the lazy bridge
export const printerBridge: PrinterBridge = {
  isAvailable: () => getPrinterBridge().isAvailable(),
  listDevices: () => getPrinterBridge().listDevices(),
  connect: (v, p) => getPrinterBridge().connect(v, p),
  disconnect: () => getPrinterBridge().disconnect(),
  printBill: (b) => getPrinterBridge().printBill(b),
  printSummary: (s) => getPrinterBridge().printSummary(s),
  getConnectedPrinter: () => getPrinterBridge().getConnectedPrinter(),
  // Windows printer support
  listWindowsPrinters: () => getPrinterBridge().listWindowsPrinters?.() ?? Promise.resolve([]),
  connectWindowsPrinter: (name) => getPrinterBridge().connectWindowsPrinter?.(name) ?? Promise.resolve(),
  printWindows: (bill, printerName) => getPrinterBridge().printWindows?.(bill, printerName) ?? Promise.resolve({ success: false, error: 'Not available' }),
  printWindowsSummary: (summary, printerName) => getPrinterBridge().printWindowsSummary?.(summary, printerName) ?? Promise.resolve({ success: false, error: 'Not available' }),
};

// ── ESC/POS QR Code builder (GS ( k commands) ──────────────────
// Builds ESC/POS QR code bytes for the given text content
function buildQRCodeBytes(content: string): number[] {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const dataLen = data.length + 3; // pL + pH + cn + fn + n + data
  const pL = dataLen & 0xFF;
  const pH = (dataLen >> 8) & 0xFF;

  // GS ( k – Store QR data
  const storeCmd = [
    0x1D, 0x28, 0x6B,
    pL, pH,
    0x31, // cn = 49 (QR Code model 2)
    0x50, // fn = 80 (store data)
    0x30, // QR version auto
    ...Array.from(data),
  ];

  // GS ( k – Set QR module size (6 = ~7.5mm per cell, larger than default 4)
  const sizeCmd = [0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x06];

  // GS ( k – Set error correction level (M = 50)
  const ecCmd = [0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31];

  // GS ( k – Print QR code
  const printCmd = [0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30];

  return [...sizeCmd, ...ecCmd, ...storeCmd, ...printCmd];
}

// ── ESC/POS receipt builder (shared, same as usbPrinter.ts) ──────
const ESC = 0x1B;
const GS = 0x1D;
const LF = 0x0A;

const CMD = {
  INIT: [ESC, 0x40],
  ALIGN_LEFT: [ESC, 0x61, 0x00],
  ALIGN_CENTER: [ESC, 0x61, 0x01],
  ALIGN_RIGHT: [ESC, 0x61, 0x02],
  BOLD_ON: [ESC, 0x45, 0x01],
  BOLD_OFF: [ESC, 0x45, 0x00],
  DOUBLE_WIDTH_ON: [GS, 0x21, 0x10],
  DOUBLE_WIDTH_OFF: [GS, 0x21, 0x00],
  DOUBLE_SIZE_ON: [GS, 0x21, 0x11],
  DOUBLE_SIZE_OFF: [GS, 0x21, 0x00],
  PARTIAL_CUT: [GS, 0x56, 0x01],
  FEED_LINES: (n: number) => [ESC, 0x64, n],
};

function buildReceipt(bill: BillData): Uint8Array {
  const encoder = new TextEncoder();
  const parts: (number[] | Uint8Array)[] = [];
  const add = (data: number[] | Uint8Array) => parts.push(data);
  const text = (str: string) => add(encoder.encode(str));
  const nl = () => add([LF]);

  console.log('[printerBridge.buildReceipt] bill object received:', bill);
  console.log('[printerBridge.buildReceipt] billNumber:', bill.billNumber);

  add(CMD.INIT);
  add(CMD.ALIGN_CENTER);

  // ── QR at the TOP of the receipt ──
  if (bill.paymentQrContent) {
    add(buildQRCodeBytes(bill.paymentQrContent)); nl();
    text('Scan to Pay'); nl();
    text('--------------------------------'); nl();
  } else if (bill.showQrCode && bill.orderId) {
    add(buildQRCodeBytes(bill.orderId)); nl();
    text(`Order: ${bill.orderId.slice(-12).toUpperCase()}`); nl();
    text('--------------------------------'); nl();
  }

  add(CMD.BOLD_ON);
  add(CMD.DOUBLE_WIDTH_ON);
  text(bill.restaurantName);
  nl();
  add(CMD.DOUBLE_WIDTH_OFF);
  add(CMD.BOLD_OFF);

  if (bill.restaurantAddress) { text(bill.restaurantAddress); nl(); }
  if (bill.restaurantPhone) { text(`Ph: ${bill.restaurantPhone}`); nl(); }
  if (bill.restaurantGstin) { text(`GSTIN: ${bill.restaurantGstin}`); nl(); }

  text('--------------------------------'); nl();

  // Center the whole body: every item row is a fixed 32-char string, so
  // centering keeps the columns aligned while giving symmetric margins — the
  // receipt stays readable even if the printer's horizontal alignment drifts.
  add(CMD.ALIGN_CENTER);
  const billDate = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  text(`Table: ${bill.tableNumber || 'Takeaway'}`); nl();
  text(`Date: ${billDate}`); nl();
  
  // Add bill number
  if (bill.billNumber) {
    text(`Bill #: ${String(bill.billNumber).padStart(3, '0')}`); nl();
  }

  if (bill.customerName) { text(`Customer: ${bill.customerName}`); nl(); }
  if (bill.customerPhone) { text(`Phone: ${bill.customerPhone}`); nl(); }
  if (bill.customerGstin) { text(`GSTIN: ${bill.customerGstin}`); nl(); }

  text('--------------------------------'); nl();
  // 4 columns across 32 chars: name(13) qty(3) price(7) amount(9)
  const row4 = (a: string, b: string, c: string, d: string) =>
    a.substring(0, 13).padEnd(13) + b.padStart(3) + c.padStart(7) + d.padStart(9);
  add(CMD.BOLD_ON);
  text(row4('Item', 'Qty', 'Price', 'Amount')); nl();
  add(CMD.BOLD_OFF);
  text('--------------------------------'); nl();

  // Bills carry no paise — every amount is rounded to whole rupees.
  const r0 = (n: number) => String(Math.round(n));
  let totalQty = 0;
  for (const item of bill.items) {
    totalQty += item.quantity;
    text(row4(item.name, String(item.quantity), r0(item.price), r0(item.price * item.quantity))); nl();
  }

  text('--------------------------------'); nl();
  add(CMD.ALIGN_CENTER);
  text(`Total Qty: ${totalQty}`); nl();
  const subtotal = bill.subtotal || bill.total;
  text(`Sub Total: Rs.${r0(subtotal)}`); nl();

  if (bill.discountAmount && bill.discountAmount > 0) {
    text(`Discount: -Rs.${r0(bill.discountAmount)}`); nl();
  }

  if (bill.cgstPercentage && bill.cgstAmount) {
    text(`CGST (${bill.cgstPercentage}%): Rs.${r0(bill.cgstAmount)}`); nl();
  }
  if (bill.sgstPercentage && bill.sgstAmount) {
    text(`SGST (${bill.sgstPercentage}%): Rs.${r0(bill.sgstAmount)}`); nl();
  }

  text('--------------------------------'); nl();
  add(CMD.BOLD_ON);
  add(CMD.DOUBLE_SIZE_ON);
  text(`TOTAL: Rs.${r0(bill.total)}`); nl();
  add(CMD.DOUBLE_SIZE_OFF);
  add(CMD.BOLD_OFF);

  add(CMD.ALIGN_CENTER);
  text('--------------------------------'); nl();
  text('Thank you for dining with us!'); nl();
  text('Please visit again'); nl();

  add(CMD.FEED_LINES(4));
  add(CMD.PARTIAL_CUT);

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part instanceof Uint8Array ? part : new Uint8Array(part), offset);
    offset += part.length;
  }
  return result;
}

// ── Dedicated Sales-Report receipt ──────────────────────────────────────────
// The report has its OWN layout (full-width label→value rows + an item table)
// instead of reusing the bill's 4-column item format, where large money values
// overflow the narrow price column. Everything is centred and padded to the
// 32-char width so it stays readable regardless of printer alignment.
export interface ReportReceiptData {
  restaurantName: string;
  restaurantAddress?: string | null;
  restaurantPhone?: string | null;
  restaurantGstin?: string | null;
  periodLabel: string;
  totalRevenue: number;
  completedOrders: number;
  avgOrderValue: number;
  cashRevenue: number;
  onlineRevenue: number;
  cgstPercentage: number;
  sgstPercentage: number;
  cgstAmount: number;
  sgstAmount: number;
  grandTotal: number;
  items: { name: string; quantity: number; revenue: number }[];
}

export function buildReportReceipt(r: ReportReceiptData): Uint8Array {
  const encoder = new TextEncoder();
  const parts: (number[] | Uint8Array)[] = [];
  const add = (data: number[] | Uint8Array) => parts.push(data);
  const text = (str: string) => add(encoder.encode(str));
  const nl = () => add([LF]);
  const WIDTH = 32;
  const sep = () => { text('-'.repeat(WIDTH)); nl(); };
  const money = (n: number) => 'Rs.' + Math.round(n).toLocaleString('en-IN');
  // Full-width label→value row: label left, value right, never overflowing.
  const lv = (label: string, value: string) => {
    const room = Math.max(0, WIDTH - value.length - 1);
    text(label.substring(0, room).padEnd(room) + ' ' + value); nl();
  };
  // Item row: name(16) qty(5) amount(11) = 32.
  const item = (name: string, qty: string, amt: string) => {
    text(name.substring(0, 16).padEnd(16) + qty.padStart(5) + amt.padStart(11)); nl();
  };

  add(CMD.INIT);
  add(CMD.ALIGN_CENTER);

  add(CMD.BOLD_ON); add(CMD.DOUBLE_WIDTH_ON);
  text(r.restaurantName); nl();
  add(CMD.DOUBLE_WIDTH_OFF); add(CMD.BOLD_OFF);
  if (r.restaurantAddress) { text(r.restaurantAddress); nl(); }
  if (r.restaurantPhone) { text(`Ph: ${r.restaurantPhone}`); nl(); }
  if (r.restaurantGstin) { text(`GSTIN: ${r.restaurantGstin}`); nl(); }
  sep();
  add(CMD.BOLD_ON); text('SALES REPORT'); nl(); add(CMD.BOLD_OFF);
  text(`Period: ${r.periodLabel}`); nl();
  text(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })); nl();
  sep();

  add(CMD.BOLD_ON); text('REVENUE SUMMARY'); nl(); add(CMD.BOLD_OFF);
  lv('Subtotal (excl GST)', money(r.totalRevenue));
  lv('Completed Orders', String(r.completedOrders));
  lv('Avg Order Value', money(r.avgOrderValue));
  if (r.cgstAmount > 0) lv(`CGST (${r.cgstPercentage}%)`, money(r.cgstAmount));
  if (r.sgstAmount > 0) lv(`SGST (${r.sgstPercentage}%)`, money(r.sgstAmount));
  sep();

  add(CMD.BOLD_ON); text('PAYMENT BREAKDOWN'); nl(); add(CMD.BOLD_OFF);
  lv('Cash', money(r.cashRevenue));
  lv('Online', money(r.onlineRevenue));
  sep();

  if (r.items.length > 0) {
    add(CMD.BOLD_ON); text(`ITEM SALES (${r.items.length})`); nl();
    item('Item', 'Qty', 'Amount'); add(CMD.BOLD_OFF);
    let totalQty = 0;
    for (const it of r.items) {
      totalQty += it.quantity;
      item(it.name, String(it.quantity), it.revenue.toFixed(0));
    }
    sep();
    lv('Total Qty', String(totalQty));
    sep();
  }

  add(CMD.BOLD_ON); add(CMD.DOUBLE_SIZE_ON);
  text(`TOTAL: ${money(r.grandTotal)}`); nl();
  add(CMD.DOUBLE_SIZE_OFF); add(CMD.BOLD_OFF);
  sep();
  text('*** END OF REPORT ***'); nl();

  add(CMD.FEED_LINES(4));
  add(CMD.PARTIAL_CUT);

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    out.set(part instanceof Uint8Array ? part : new Uint8Array(part), offset);
    offset += part.length;
  }
  return out;
}

function buildSummaryReceipt(summary: SummaryPrintData): Uint8Array {
  const encoder = new TextEncoder();
  const parts: (number[] | Uint8Array)[] = [];
  const add = (data: number[] | Uint8Array) => parts.push(data);
  const text = (str: string) => add(encoder.encode(str));
  const nl = () => add([LF]);

  add(CMD.INIT);
  add(CMD.ALIGN_CENTER);
  add(CMD.BOLD_ON);
  add(CMD.DOUBLE_WIDTH_ON);
  text(summary.restaurantName);
  nl();
  add(CMD.DOUBLE_WIDTH_OFF);
  add(CMD.BOLD_OFF);

  if (summary.restaurantAddress) { text(summary.restaurantAddress); nl(); }
  if (summary.restaurantPhone) { text(`Ph: ${summary.restaurantPhone}`); nl(); }

  text('--------------------------------'); nl();

  add(CMD.ALIGN_CENTER);
  add(CMD.BOLD_ON);
  text('ORDER SUMMARY'); nl();
  add(CMD.BOLD_OFF);
  text('--------------------------------'); nl();

  add(CMD.ALIGN_LEFT);
  const summaryDate = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  if (summary.floorName && summary.tableNumber) {
    text(`Floor: ${summary.floorName}`); nl();
  }
  text(`Table: ${summary.tableNumber || 'Takeaway'}`); nl();
  text(`Date: ${summaryDate}`); nl();
  
  if (summary.billNumber) {
    text(`Bill #: ${String(summary.billNumber).padStart(3, '0')}`); nl();
  }

  text('--------------------------------'); nl();
  add(CMD.BOLD_ON);
  text('Item                  Qty'); nl();
  add(CMD.BOLD_OFF);
  text('--------------------------------'); nl();

  for (const item of summary.items) {
    const itemName = item.name.substring(0, 20).padEnd(20);
    const qty = String(item.quantity).padStart(3);
    text(`${itemName}${qty}`); nl();
  }

  text('--------------------------------'); nl();
  add(CMD.ALIGN_CENTER);
  text('Please verify order contents'); nl();
  text('Thank you!'); nl();

  add(CMD.FEED_LINES(4));
  add(CMD.PARTIAL_CUT);

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part instanceof Uint8Array ? part : new Uint8Array(part), offset);
    offset += part.length;
  }
  return result;
}

// ── Unified Printer Bridge ───────────────────────────────────────

export interface PrinterBridge {
  isAvailable(): boolean;
  listDevices(): Promise<USBPrinterDevice[]>;
  connect(vendorId?: number, productId?: number): Promise<USBPrinterDevice>;
  disconnect(): Promise<void>;
  printBill(bill: BillData): Promise<void>;
  printSummary(summary: SummaryPrintData): Promise<void>;
  getConnectedPrinter(): USBPrinterDevice | null;
  // Windows printer support
  listWindowsPrinters?(): Promise<string[]>;
  connectWindowsPrinter?(printerName: string): Promise<void>;
  printWindows?(bill: BillData, printerName: string): Promise<{ success: boolean; error?: string }>;
  printWindowsSummary?(summary: SummaryPrintData, printerName: string): Promise<{ success: boolean; error?: string }>;
}

// Electron implementation
class ElectronPrinterBridge implements PrinterBridge {
  private connectedDevice: USBPrinterDevice | null = null;

  isAvailable(): boolean {
    return !!getElectronPrinter();
  }

  async listDevices(): Promise<USBPrinterDevice[]> {
    const api = getElectronPrinter()!;
    const result = await api.listDevices();
    if (!result.success) throw new Error(result.error || 'Failed to list devices');
    return (result.devices || []).map((d: any) => ({
      name: d.name,
      vendorId: d.vendorId,
      productId: d.productId,
    }));
  }

  async connect(vendorId?: number, productId?: number): Promise<USBPrinterDevice> {
    const api = getElectronPrinter()!;

    // Require explicit device selection - don't auto-pick first device
    if (!vendorId || !productId) {
      throw new Error('Please select a specific printer from the list.');
    }

    const result = await api.connect(vendorId, productId);
    console.log('[ElectronPrinterBridge] connect result:', JSON.stringify(result));
    if (!result.success) throw new Error(result.error || 'Failed to connect');

    this.connectedDevice = {
      name: result.device?.name || (result as any).name || `USB Printer (${vendorId.toString(16)}:${productId.toString(16)})`,
      vendorId,
      productId,
    };
    return this.connectedDevice;
  }

  async disconnect(): Promise<void> {
    const api = getElectronPrinter()!;
    await api.disconnect();
    this.connectedDevice = null;
  }

  async printBill(bill: BillData): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('No printer connected.');
    }
    const api = getElectronPrinter()!;
    const receiptData = buildReceipt(bill);
    const result = await api.print(Array.from(receiptData));
    if (!result.success) {
      this.connectedDevice = null;
      throw new Error(result.error || 'Print failed.');
    }
  }

  async printSummary(summary: SummaryPrintData): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error('No printer connected.');
    }
    const api = getElectronPrinter()!;
    const receiptData = buildSummaryReceipt(summary);
    const result = await api.print(Array.from(receiptData));
    if (!result.success) {
      this.connectedDevice = null;
      throw new Error(result.error || 'Summary print failed.');
    }
  }

  getConnectedPrinter(): USBPrinterDevice | null {
    return this.connectedDevice;
  }

  async listWindowsPrinters(): Promise<string[]> {
    const api = getElectronPrinter()!;
    if (!api.listWindowsPrinters) return [];
    const result = await api.listWindowsPrinters();
    if (!result.success) throw new Error(result.error || 'Failed to list Windows printers');
    return result.printers || [];
  }

  async connectWindowsPrinter(printerName: string): Promise<void> {
    const api = getElectronPrinter()!;
    if (!api.connectWindowsPrinter) throw new Error('Windows printer connection not supported');
    const result = await api.connectWindowsPrinter(printerName);
    if (!result.success) throw new Error(result.error || 'Failed to connect to Windows printer');
    
    this.connectedDevice = {
      name: printerName,
      vendorId: 0,
      productId: 0,
    };
  }

  async printWindows(bill: BillData, printerName: string): Promise<{ success: boolean; error?: string }> {
    const api = getElectronPrinter()!;
    if (!api.printWindowsPrinter) {
      return { success: false, error: 'Windows printer printing not supported' };
    }
    
    const receiptData = buildReceipt(bill);
    const result = await api.printWindowsPrinter(Array.from(receiptData), printerName);
    return result;
  }

  async printWindowsSummary(summary: SummaryPrintData, printerName: string): Promise<{ success: boolean; error?: string }> {
    const api = getElectronPrinter()!;
    if (!api.printWindowsPrinter) {
      return { success: false, error: 'Windows printer printing not supported' };
    }
    
    const receiptData = buildSummaryReceipt(summary);
    const result = await api.printWindowsPrinter(Array.from(receiptData), printerName);
    return result;
  }
}

// Web implementation (wraps existing WebUSB service)
class WebPrinterBridge implements PrinterBridge {
  isAvailable(): boolean {
    return usbPrinter.isWebUSBAvailable();
  }

  async listDevices(): Promise<USBPrinterDevice[]> {
    // WebUSB doesn't support listing without user gesture; return empty
    return [];
  }

  async connect(): Promise<USBPrinterDevice> {
    return usbPrinter.requestDevice();
  }

  async disconnect(): Promise<void> {
    return usbPrinter.disconnect();
  }

  async printBill(bill: BillData): Promise<void> {
    return usbPrinter.printBill(bill);
  }

  async printSummary(summary: SummaryPrintData): Promise<void> {
    return usbPrinter.printSummary(summary);
  }

  getConnectedPrinter(): USBPrinterDevice | null {
    return usbPrinter.getConnectedPrinter();
  }
}

// Bridge singleton is now lazy-initialized via Proxy at the top of the file
