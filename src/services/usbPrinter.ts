// WebUSB ESC/POS Thermal Printer Service
// Supports: Epson M325A, TVS RP3210, Epson TM-T82, POS80, and other ESC/POS compatible USB printers

import type { BillData, SummaryPrintData } from './thermalPrinter';

// ESC/POS Command Constants
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

// Known USB Vendor IDs for thermal printers
// Vendor-based filters for known thermal printers
const PRINTER_VENDOR_FILTERS: { vendorId?: number; productId?: number }[] = [
  { vendorId: 0x04B8 },  // Epson (M325A, TM-T82)
  { vendorId: 0x0DD4 },  // TVS Electronics (RP3210)
  { vendorId: 0x0FE6 },  // POS Printer
  { vendorId: 0x0483 },  // STMicroelectronics
  { vendorId: 0x1FC9 },  // NXP
  { vendorId: 0x20D1 },  // POS Printer
  { vendorId: 0x0416 },  // WinChipHead
  { vendorId: 0x1A86 },  // QinHeng (CH340)
  { vendorId: 0x067B },  // Prolific (PL2303)
  { vendorId: 0x0403 },  // FTDI
  { vendorId: 0x0525 },  // Netchip (Linux USB gadget)
  { vendorId: 0x154F },  // SNBC
  { vendorId: 0x0AA7 },  // Beiyang
  { vendorId: 0x4B43 },  // Custom POS
  { vendorId: 0x2730 },  // Citizen
  { vendorId: 0x0B00 },  // Hewlett Packard POS
  { vendorId: 0x0493 },  // CN (CN811-UB and similar)
  { vendorId: 0x0FE6, productId: 0x811 }, // CN811-UB variant
  { vendorId: 0x1504 },  // Face (POS printers)
  { vendorId: 0x0456 },  // Analog Devices / POS
  { vendorId: 0x0471 },  // Philips POS
  { vendorId: 0x28E9 },  // GD32 (Chinese POS printers)
  { vendorId: 0x1D90 },  // Octoprint / Generic POS
];

// Broader class-based filters as fallback for unrecognized printers
const PRINTER_CLASS_FILTERS: { classCode: number }[] = [
  { classCode: 7 },    // USB Printer class
  { classCode: 0xFF },  // Vendor-specific class (many thermal printers use this)
];

export interface USBPrinterDevice {
  name: string;
  vendorId: number;
  productId: number;
}

// Access navigator.usb safely
function getUSB(): any {
  return (navigator as any).usb;
}

class USBPrinterService {
  private device: any = null;
  private interfaceNumber: number = 0;
  private endpointOut: number = 0;

  isWebUSBAvailable(): boolean {
    return !!getUSB();
  }

  getConnectedPrinter(): USBPrinterDevice | null {
    if (!this.device) return null;
    return {
      name: this.device.productName || 'USB Printer',
      vendorId: this.device.vendorId,
      productId: this.device.productId,
    };
  }

  async requestDevice(): Promise<USBPrinterDevice> {
    const usb = getUSB();
    if (!usb) {
      throw new Error('WebUSB is not supported. Use Chrome or Edge browser.');
    }

    try {
      // First try with known vendor filters
      const device = await usb.requestDevice({ filters: PRINTER_VENDOR_FILTERS });
      await this.connectDevice(device);
      return {
        name: device.productName || 'USB Printer',
        vendorId: device.vendorId,
        productId: device.productId,
      };
    } catch (error: any) {
      if (error.name === 'NotFoundError') {
        // No device selected with vendor filters, try broader class-based filters
        try {
          const device = await usb.requestDevice({ filters: PRINTER_CLASS_FILTERS });
          await this.connectDevice(device);
          return {
            name: device.productName || 'USB Printer',
            vendorId: device.vendorId,
            productId: device.productId,
          };
        } catch (retryError: any) {
          if (retryError.name === 'NotFoundError') {
            throw new Error('No printer selected. Please select your thermal printer.');
          }
          throw new Error(`Failed to connect: ${retryError.message}`);
        }
      }
      throw new Error(`Failed to connect: ${error.message}`);
    }
  }

  async reconnectSavedDevice(): Promise<USBPrinterDevice | null> {
    const usb = getUSB();
    if (!usb) return null;

    try {
      const devices = await usb.getDevices();
      if (devices.length > 0) {
        await this.connectDevice(devices[0]);
        return {
          name: devices[0].productName || 'USB Printer',
          vendorId: devices[0].vendorId,
          productId: devices[0].productId,
        };
      }
    } catch {
      // Silent fail
    }
    return null;
  }

  private async connectDevice(device: any): Promise<void> {
    try {
      await device.open();
    } catch (err: any) {
      if (err.message && err.message.includes('Access denied')) {
        throw new Error('Printer not found. Please make sure the USB printer is physically connected to this computer and try again.');
      }
      throw err;
    }

    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    const config = device.configuration;
    if (!config) throw new Error('No USB configuration available');

    let foundInterface = false;
    for (const iface of config.interfaces) {
      for (const alt of iface.alternates) {
        const outEndpoint = alt.endpoints.find(
          (ep: any) => ep.direction === 'out' && ep.type === 'bulk'
        );
        if (outEndpoint) {
          this.interfaceNumber = iface.interfaceNumber;
          this.endpointOut = outEndpoint.endpointNumber;
          foundInterface = true;
          break;
        }
      }
      if (foundInterface) break;
    }

    if (!foundInterface) {
      throw new Error('Could not find printer endpoint. Ensure this is a supported ESC/POS printer.');
    }

    try {
      await device.claimInterface(this.interfaceNumber);
    } catch {
      // Already claimed
    }

    this.device = device;
  }

  async disconnect(): Promise<void> {
    if (this.device) {
      try {
        await this.device.releaseInterface(this.interfaceNumber);
        await this.device.close();
      } catch {
        // Ignore
      }
      this.device = null;
    }
  }

  private textEncoder = new TextEncoder();

  // ESC/POS QR Code builder
  private buildQRCodeBytes(content: string): number[] {
    const data = this.textEncoder.encode(content);
    const dataLen = data.length + 3;
    const pL = dataLen & 0xFF;
    const pH = (dataLen >> 8) & 0xFF;

    // GS ( k – Store QR data
    const storeCmd = [
      0x1D, 0x28, 0x6B,
      pL, pH,
      0x31,
      0x50,
      0x30,
      ...Array.from(data),
    ];

    // GS ( k – Set QR module size (6 = ~7.5mm per cell, larger than default 4)
    const sizeCmd = [0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x06];

    // GS ( k – Set error correction level
    const ecCmd = [0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31];

    // GS ( k – Print QR code
    const printCmd = [0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30];

    return [...sizeCmd, ...ecCmd, ...storeCmd, ...printCmd];
  }

  private buildReceipt(bill: BillData): Uint8Array {
    const parts: (number[] | Uint8Array)[] = [];
    const add = (data: number[] | Uint8Array) => parts.push(data);
    const text = (str: string) => add(this.textEncoder.encode(str));
    const nl = () => add([LF]);

    console.log('[usbPrinter.buildReceipt] bill object received:', bill);
    console.log('[usbPrinter.buildReceipt] billNumber:', bill.billNumber);

    add(CMD.INIT);

    // Header
    add(CMD.ALIGN_CENTER);
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

    // Table & Date
    add(CMD.ALIGN_LEFT);
    const billDate = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    text(`Table: ${bill.tableNumber || 'Takeaway'}`); nl();
    text(`Date: ${billDate}`); nl();
    
    // Add bill number
    if (bill.billNumber) {
      text(`Bill #: ${String(bill.billNumber).padStart(3, '0')}`); nl();
    }

    // Customer details
    if (bill.customerName) { text(`Customer: ${bill.customerName}`); nl(); }
    if (bill.customerPhone) { text(`Phone: ${bill.customerPhone}`); nl(); }
    if (bill.customerGstin) { text(`GSTIN: ${bill.customerGstin}`); nl(); }

    text('--------------------------------'); nl();

    add(CMD.BOLD_ON);
    text('Item              Qty    Amount'); nl();
    add(CMD.BOLD_OFF);
    text('--------------------------------'); nl();

    for (const item of bill.items) {
      const itemName = item.name.substring(0, 16).padEnd(16);
      const qty = String(item.quantity).padStart(3);
      const amount = `${(item.price * item.quantity).toFixed(0)}`.padStart(8);
      text(`${itemName}${qty}${amount}`); nl();
    }

    text('--------------------------------'); nl();
    
    // Add subtotal
    add(CMD.ALIGN_RIGHT);
    // Bills carry no paise — every amount is rounded to whole rupees.
    const r0 = (n: number) => String(Math.round(n));
    const subtotal = bill.subtotal || bill.total;
    text(`Subtotal: Rs.${r0(subtotal)}`); nl();

    // Discount (if any)
    if (bill.discountAmount && bill.discountAmount > 0) {
      text(`Discount: -Rs.${r0(bill.discountAmount)}`); nl();
    }

    // Add GST details if available
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

    // QR code section
    // If payment QR content is provided, use it instead of Order ID QR
    if (bill.paymentQrContent) {
      nl();
      text('Scan to Pay'); nl();
      add(CMD.ALIGN_CENTER);
      const qrBytes = this.buildQRCodeBytes(bill.paymentQrContent);
      add(qrBytes);
      nl();
    } else if (bill.showQrCode && bill.orderId) {
      // Fallback to Order ID QR if no payment QR
      nl();
      const shortId = bill.orderId.slice(-12).toUpperCase();
      text(`Order: ${shortId}`); nl();
      add(CMD.ALIGN_CENTER);
      const qrBytes = this.buildQRCodeBytes(bill.orderId);
      add(qrBytes);
      nl();
    }

    add(CMD.FEED_LINES(4));
    add(CMD.PARTIAL_CUT);

    // Combine
    const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      result.set(part instanceof Uint8Array ? part : new Uint8Array(part), offset);
      offset += part.length;
    }
    return result;
  }

  private buildSummaryReceipt(summary: SummaryPrintData): Uint8Array {
    const parts: (number[] | Uint8Array)[] = [];
    const add = (data: number[] | Uint8Array) => parts.push(data);
    const text = (str: string) => add(this.textEncoder.encode(str));
    const nl = () => add([LF]);

    add(CMD.INIT);

    // Header
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

    // Title
    add(CMD.ALIGN_CENTER);
    add(CMD.BOLD_ON);
    text('ORDER SUMMARY'); nl();
    add(CMD.BOLD_OFF);
    text('--------------------------------'); nl();

    // Table & Date
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

    // Combine
    const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      result.set(part instanceof Uint8Array ? part : new Uint8Array(part), offset);
      offset += part.length;
    }
    return result;
  }

  async printBill(bill: BillData): Promise<void> {
    if (!this.device) {
      throw new Error('No printer connected. Please connect a USB thermal printer first.');
    }

    const receiptData = this.buildReceipt(bill);

    try {
      const chunkSize = 64;
      for (let i = 0; i < receiptData.length; i += chunkSize) {
        const chunk = receiptData.slice(i, i + chunkSize);
        await this.device.transferOut(this.endpointOut, chunk);
      }
    } catch (error: any) {
      console.error('USB print failed:', error);
      this.device = null;
      throw new Error('Print failed. Reconnect the printer and try again.');
    }
  }

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
}

export const usbPrinter = new USBPrinterService();
