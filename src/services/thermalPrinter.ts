import { Capacitor } from '@capacitor/core';
import { CapacitorThermalPrinter } from 'capacitor-thermal-printer';

export interface PrinterDevice {
  name: string;
  address: string;
}

export interface BillData {
  restaurantName: string;
  restaurantAddress?: string | null;
  restaurantPhone?: string | null;
  restaurantGstin?: string | null;
  tableNumber?: string;
  floorName?: string;
  orderId?: string;
  billNumber?: number;
  showQrCode?: boolean;
  paymentQrContent?: string | null;
  customerName?: string;
  customerPhone?: string;
  customerGstin?: string;
  items: {
    name: string;
    quantity: number;
    price: number;
  }[];
  subtotal?: number;
  discountAmount?: number;
  cgstPercentage?: number;
  sgstPercentage?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  total: number;
}

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

class ThermalPrinterService {
  private connectedDevice: PrinterDevice | null = null;
  private isNative = Capacitor.isNativePlatform();

  async isBluetoothAvailable(): Promise<boolean> {
    return this.isNative;
  }

  async scanDevices(): Promise<PrinterDevice[]> {
    if (!this.isNative) {
      throw new Error('Bluetooth scanning is only available on mobile devices');
    }

    return new Promise(async (resolve, reject) => {
      const devices: PrinterDevice[] = [];
      let listenerHandle: { remove: () => void } | null = null;
      
      try {
        // Set up listener for discovered devices
        listenerHandle = await CapacitorThermalPrinter.addListener('discoverDevices', (data: any) => {
          if (data.devices) {
            data.devices.forEach((device: any) => {
              if (!devices.find(d => d.address === device.address)) {
                devices.push({
                  name: device.name || 'Unknown Printer',
                  address: device.address,
                });
              }
            });
          }
        });

        // Start scanning
        await CapacitorThermalPrinter.startScan();
        
        // Stop scan after 5 seconds and resolve with found devices
        setTimeout(async () => {
          try {
            await CapacitorThermalPrinter.stopScan();
          } catch (e) {
            // Ignore stop errors
          }
          if (listenerHandle) {
            listenerHandle.remove();
          }
          resolve(devices);
        }, 5000);
      } catch (error) {
        if (listenerHandle) {
          listenerHandle.remove();
        }
        reject(new Error('Failed to scan for Bluetooth printers'));
      }
    });
  }

  async connect(device: PrinterDevice): Promise<void> {
    if (!this.isNative) {
      throw new Error('Bluetooth connection is only available on mobile devices');
    }

    try {
      await CapacitorThermalPrinter.connect({ address: device.address });
      this.connectedDevice = device;
    } catch (error) {
      console.error('Failed to connect to printer:', error);
      throw new Error(`Failed to connect to ${device.name}`);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isNative || !this.connectedDevice) return;

    try {
      await CapacitorThermalPrinter.disconnect();
      this.connectedDevice = null;
    } catch (error) {
      console.error('Failed to disconnect printer:', error);
    }
  }

  getConnectedDevice(): PrinterDevice | null {
    return this.connectedDevice;
  }

  async printViaBluetooth(bill: BillData): Promise<void> {
    if (!this.isNative) {
      throw new Error('Bluetooth printing is only available on mobile devices');
    }

    if (!this.connectedDevice) {
      throw new Error('No printer connected. Please connect a printer first.');
    }

    const billDate = new Date().toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    try {
      // Build the receipt using ESC/POS commands
      const printer = CapacitorThermalPrinter.begin()
        .align('center')
        .bold()
        .doubleWidth()
        .text(`${bill.restaurantName}\n`)
        .clearFormatting()
        .align('center');

      if (bill.restaurantAddress) {
        printer.text(`${bill.restaurantAddress}\n`);
      }
      if (bill.restaurantPhone) {
        printer.text(`Phone: ${bill.restaurantPhone}\n`);
      }
      if (bill.restaurantGstin) {
        printer.text(`GSTIN: ${bill.restaurantGstin}\n`);
      }

      printer
        .text('--------------------------------\n')
        .align('left')
        .text(`Table: ${bill.tableNumber || 'Takeaway'}\n`)
        .text(`Date: ${billDate}\n`);
      
      // Add bill number
      if (bill.billNumber) {
        printer.text(`Bill #: ${String(bill.billNumber).padStart(3, '0')}\n`);
      }

      if (bill.customerName) { printer.text(`Customer: ${bill.customerName}\n`); }
      if (bill.customerPhone) { printer.text(`Phone: ${bill.customerPhone}\n`); }
      if (bill.customerGstin) { printer.text(`GSTIN: ${bill.customerGstin}\n`); }

      printer
        .text('--------------------------------\n')
        .bold()
        .text('Item              Qty    Amount\n')
        .clearFormatting()
        .text('--------------------------------\n');

      for (const item of bill.items) {
        const itemName = item.name.substring(0, 16).padEnd(16);
        const qty = String(item.quantity).padStart(3);
        const amount = `₹${(item.price * item.quantity).toFixed(0)}`.padStart(8);
        printer.text(`${itemName}${qty}${amount}\n`);
      }

      printer
        .text('--------------------------------\n')
        .align('right');

      // Add subtotal
      const subtotal = bill.subtotal || bill.total;
      printer.text(`Subtotal: ₹${Math.round(subtotal)}\n`);

      // Discount (if any)
      if (bill.discountAmount && bill.discountAmount > 0) {
        printer.text(`Discount: -₹${Math.round(bill.discountAmount)}\n`);
      }

      // Add GST details if available
      if (bill.cgstPercentage && bill.cgstAmount) {
        printer.text(`CGST (${bill.cgstPercentage}%): ₹${Math.round(bill.cgstAmount)}\n`);
      }
      if (bill.sgstPercentage && bill.sgstAmount) {
        printer.text(`SGST (${bill.sgstPercentage}%): ₹${Math.round(bill.sgstAmount)}\n`);
      }

      await printer
        .text('--------------------------------\n')
        .bold()
        .text(`Grand Total: ₹${Math.round(bill.total)}\n`)
        .clearFormatting()
        .align('center')
        .text('\n')
        .text('Thank you for dining with us!\n')
        .text('Please visit again\n');

      // QR code section
      // If payment QR content is provided, use it instead of Order ID QR
      if (bill.paymentQrContent) {
        console.log('[ThermalPrinter] Printing payment QR code...');
        printer
          .text('\n')
          .text('Scan to Pay\n')
          .qr(bill.paymentQrContent);
      } else if (bill.showQrCode && bill.orderId) {
        // Fallback to Order ID QR if no payment QR
        const shortId = bill.orderId.slice(-12).toUpperCase();
        printer
          .text('\n')
          .text(`Order: ${shortId}\n`)
          .qr(bill.orderId);
      } else {
        console.log('[ThermalPrinter] No QR code to print');
      }

      await printer
        .text('\n\n\n')
        .cutPaper()
        .write();
    } catch (error) {
      console.error('Bluetooth print failed:', error);
      throw new Error('Failed to print via Bluetooth');
    }
  }

  printViaBrowser(bill: BillData): void {
    const billDate = new Date().toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    const itemsHtml = bill.items
      .map(
        (item) => `
      <tr>
        <td style="padding: 6px 0;">${item.name}</td>
        <td style="text-align: center;">${item.quantity}</td>
        <td style="text-align: right;">₹${Math.round(item.price)}</td>
        <td style="text-align: right;">₹${Math.round(item.price * item.quantity)}</td>
      </tr>
    `
      )
      .join('');

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      throw new Error('Please allow popups to print the bill');
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Bill - ${bill.restaurantName}</title>
          <style>
            body { font-family: 'Courier New', monospace; font-size: 12px; padding: 20px; max-width: 300px; margin: 0 auto; }
            .header { text-align: center; margin-bottom: 20px; }
            .header h1 { font-size: 18px; margin: 0 0 5px 0; }
            .header p { margin: 2px 0; color: #666; font-size: 11px; }
            table { width: 100%; border-collapse: collapse; margin: 15px 0; }
            th { border-bottom: 1px dashed #000; padding: 6px 0; text-align: left; font-size: 11px; }
            th:nth-child(2), th:nth-child(3), th:nth-child(4) { text-align: right; }
            .total-row { border-top: 1px dashed #000; font-weight: bold; }
            .total-row td { padding-top: 10px; }
            .footer { text-align: center; margin-top: 30px; font-size: 11px; }
            .divider { border-bottom: 1px dashed #000; margin: 15px 0; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${bill.restaurantName}</h1>
            ${bill.restaurantAddress ? `<p>${bill.restaurantAddress}</p>` : ''}
            ${bill.restaurantPhone ? `<p>Phone: ${bill.restaurantPhone}</p>` : ''}
            ${bill.restaurantGstin ? `<p>GSTIN: ${bill.restaurantGstin}</p>` : ''}
          </div>
          <div class="divider"></div>
          <p><strong>Table:</strong> ${bill.tableNumber || 'Takeaway'}</p>
          <p><strong>Date:</strong> ${billDate}</p>
          ${bill.billNumber ? `<p><strong>Bill #:</strong> ${String(bill.billNumber).padStart(3, '0')}</p>` : ''}
          ${bill.customerName ? `<p><strong>Customer:</strong> ${bill.customerName}</p>` : ''}
          ${bill.customerPhone ? `<p><strong>Phone:</strong> ${bill.customerPhone}</p>` : ''}
          ${bill.customerGstin ? `<p><strong>GSTIN:</strong> ${bill.customerGstin}</p>` : ''}
          <div class="divider"></div>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
          <div class="divider"></div>
          <table>
            <tr>
              <td colspan="3">Subtotal</td>
              <td style="text-align: right;">₹${Math.round(bill.subtotal || bill.total)}</td>
            </tr>
            ${bill.discountAmount && bill.discountAmount > 0 ? `
            <tr>
              <td colspan="3">Discount</td>
              <td style="text-align: right;">-₹${Math.round(bill.discountAmount)}</td>
            </tr>
            ` : ''}
            ${bill.cgstPercentage && bill.cgstAmount ? `
            <tr>
              <td colspan="3">CGST (${bill.cgstPercentage}%)</td>
              <td style="text-align: right;">₹${Math.round(bill.cgstAmount)}</td>
            </tr>
            ` : ''}
            ${bill.sgstPercentage && bill.sgstAmount ? `
            <tr>
              <td colspan="3">SGST (${bill.sgstPercentage}%)</td>
              <td style="text-align: right;">₹${Math.round(bill.sgstAmount)}</td>
            </tr>
            ` : ''}
            <tr class="total-row">
              <td colspan="3"><strong>Grand Total</strong></td>
              <td style="text-align: right;"><strong>₹${Math.round(bill.total)}</strong></td>
            </tr>
          </table>
          <div class="footer">
            <p>Thank you for dining with us!</p>
            <p>Please visit again</p>
            ${bill.paymentQrContent ? `
            <div class="qr-section">
              <p style="font-size:10px;margin:8px 0 4px;">Scan to Pay</p>
              <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(bill.paymentQrContent)}" 
                   width="180" height="180" style="display:block;margin:0 auto;"
                   onerror="this.style.display='none';" />
            </div>
            ` : bill.showQrCode && bill.orderId ? `
            <div class="qr-section">
              <p style="font-size:10px;margin:8px 0 4px;">Order ID</p>
              <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(bill.orderId)}" 
                   width="180" height="180" style="display:block;margin:0 auto;"
                   onerror="this.style.display='none';document.getElementById('order-id-fallback').style.display='block';" />
              <p id="order-id-fallback" style="display:none;font-size:9px;word-break:break-all;border:1px solid #ccc;padding:4px;">
                ${bill.orderId}
              </p>
            </div>
            ` : ''}
          </div>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.print();
  }

  /**
   * Print summary receipt (items and quantities only, no prices)
   */
  async printSummaryViaBluetooth(summary: SummaryPrintData): Promise<void> {
    if (!this.isNative) {
      throw new Error('Bluetooth printing is only available on mobile devices');
    }

    if (!this.connectedDevice) {
      throw new Error('No printer connected. Please connect a printer first.');
    }

    const printDate = new Date().toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    try {
      // Build the summary receipt using ESC/POS commands
      const printer = CapacitorThermalPrinter.begin()
        .align('center')
        .bold()
        .doubleWidth()
        .text(`${summary.restaurantName}\n`)
        .clearFormatting()
        .align('center');

      if (summary.restaurantAddress) {
        printer.text(`${summary.restaurantAddress}\n`);
      }
      if (summary.restaurantPhone) {
        printer.text(`Phone: ${summary.restaurantPhone}\n`);
      }

      printer
        .text('--------------------------------\n')
        .align('center')
        .bold()
        .text('ORDER SUMMARY\n')
        .clearFormatting()
        .align('left');

      if (summary.floorName && summary.tableNumber) {
        printer.text(`Floor: ${summary.floorName}\n`);
      }
      printer.text(`Table: ${summary.tableNumber || 'Takeaway'}\n`);
      printer.text(`Date: ${printDate}\n`);
      
      if (summary.billNumber) {
        printer.text(`Bill #: ${String(summary.billNumber).padStart(3, '0')}\n`);
      }

      printer
        .text('--------------------------------\n')
        .bold()
        .text('Item                  Qty\n')
        .clearFormatting()
        .text('--------------------------------\n');

      for (const item of summary.items) {
        const itemName = item.name.substring(0, 20).padEnd(20);
        printer.text(`${itemName}${item.quantity}\n`);
      }

      printer
        .text('--------------------------------\n')
        .align('center')
        .text('\n')
        .text('Please verify order contents\n')
        .text('Thank you!\n')
        .text('\n\n\n')
        .cutPaper();

      await printer.write();
    } catch (error) {
      console.error('Summary Bluetooth print failed:', error);
      throw new Error('Failed to print summary via Bluetooth');
    }
  }

  /**
   * Print summary receipt via browser (items and quantities only)
   */
  printSummaryViaBrowser(summary: SummaryPrintData): void {
    const printDate = new Date().toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    const itemsHtml = summary.items
      .map(
        (item) => `
      <tr>
        <td style="padding: 6px 0;">${item.name}</td>
        <td style="text-align: center; font-weight: bold;">${item.quantity}</td>
      </tr>
    `
      )
      .join('');

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      throw new Error('Please allow popups to print the summary');
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Order Summary - ${summary.restaurantName}</title>
          <style>
            body { font-family: 'Courier New', monospace; font-size: 12px; padding: 20px; max-width: 300px; margin: 0 auto; }
            .header { text-align: center; margin-bottom: 20px; }
            .title { font-size: 16px; font-weight: bold; margin: 10px 0; }
            .info { margin: 5px 0; }
            table { width: 100%; border-collapse: collapse; margin: 15px 0; }
            th { text-align: left; border-bottom: 2px solid #000; padding: 6px 0; font-weight: bold; }
            td { padding: 6px 0; border-bottom: 1px solid #ccc; }
            .footer { text-align: center; margin-top: 20px; font-size: 11px; }
            .divider { border-top: 2px dashed #000; margin: 15px 0; }
            @media print {
              body { padding: 0; }
              @page { margin: 10mm; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="title">${summary.restaurantName}</div>
            ${summary.restaurantAddress ? `<div class="info">${summary.restaurantAddress}</div>` : ''}
            ${summary.restaurantPhone ? `<div class="info">Phone: ${summary.restaurantPhone}</div>` : ''}
          </div>
          <div class="divider"></div>
          <div style="text-align: center; font-weight: bold; margin: 10px 0;">ORDER SUMMARY</div>
          <div class="divider"></div>
          <div class="info">
            ${summary.floorName && summary.tableNumber ? `<div>Floor: ${summary.floorName}</div>` : ''}
            <div>Table: ${summary.tableNumber || 'Takeaway'}</div>
            <div>Date: ${printDate}</div>
            ${summary.billNumber ? `<div>Bill #: ${String(summary.billNumber).padStart(3, '0')}</div>` : ''}
          </div>
          <div class="divider"></div>
          <table>
            <thead>
              <tr>
                <th style="width: 70%;">Item</th>
                <th style="width: 30%; text-align: center;">Qty</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
          <div class="divider"></div>
          <div class="footer">
            <p>Please verify order contents</p>
            <p>Thank you!</p>
          </div>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.print();
  }
}

export const thermalPrinter = new ThermalPrinterService();
