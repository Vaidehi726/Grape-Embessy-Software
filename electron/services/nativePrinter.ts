// Native USB Printer Service for Electron main process
// Uses the 'usb' package for direct device access, with Windows raw port fallback

import { usb, getDeviceList, findByIds, Interface, InEndpoint, OutEndpoint } from 'usb';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface PrinterDeviceInfo {
  name: string;
  vendorId: number;
  productId: number;
  manufacturer?: string;
  serial?: string;
  isKnown?: boolean;
}

// Known thermal printer vendor IDs
const KNOWN_PRINTER_VENDORS = new Set([
  0x04B8, // Epson
  0x0DD4, // TVS Electronics
  0x0FE6, // POS Printer / ICS / Kontron
  0x0483, // STMicroelectronics
  0x1FC9, // NXP
  0x20D1, // POS Printer
  0x0416, // WinChipHead
  0x1A86, // QinHeng (CH340)
  0x067B, // Prolific (PL2303)
  0x0403, // FTDI
  0x0525, // Netchip
  0x154F, // SNBC
  0x0AA7, // Beiyang
  0x4B43, // Custom POS
  0x2730, // Citizen
  0x0B00, // HP POS
  0x0493, // CN (CN811-UB)
  0x1504, // Face POS
  0x0456, // Analog Devices POS
  0x0471, // Philips POS
  0x28E9, // GD32 Chinese POS
  0x1D90, // Generic POS
]);

export class NativePrinterService {
  private device: any = null;
  private outEndpoint: any = null;
  private iface: any = null;
  private rawPortName: string | null = null; // Windows raw port fallback
  private rawPrinterName: string | null = null; // Windows printer name for spooler API

  /**
   * List all USB devices that could be thermal printers.
   * Lists ALL USB devices so users can pick their printer regardless of vendor ID.
   */
  async listDevices(): Promise<PrinterDeviceInfo[]> {
    const devices = getDeviceList();
    const printers: PrinterDeviceInfo[] = [];

    for (const dev of devices) {
      const desc = dev.deviceDescriptor;
      const vid = desc.idVendor;
      const pid = desc.idProduct;

      // Skip hubs (class 9) and HID devices (class 3) like keyboards/mice
      if (desc.bDeviceClass === 9 || desc.bDeviceClass === 3) continue;
      // Skip devices with vid 0 (invalid)
      if (vid === 0) continue;

      let name = `USB Device (${vid.toString(16).padStart(4, '0').toUpperCase()}:${pid.toString(16).padStart(4, '0').toUpperCase()})`;
      let manufacturer: string | undefined;
      const isKnown = KNOWN_PRINTER_VENDORS.has(vid);

      try {
        dev.open();
        const prodStr = await getStringDescriptor(dev, desc.iProduct);
        if (prodStr) name = prodStr;
        const mfgStr = await getStringDescriptor(dev, desc.iManufacturer);
        if (mfgStr) manufacturer = mfgStr;
        dev.close();
      } catch {
        try { dev.close(); } catch { /* ignore */ }
      }

      printers.push({ name, vendorId: vid, productId: pid, manufacturer, isKnown });
    }

    // Sort: known printer vendors first, then alphabetically
    printers.sort((a, b) => {
      if (a.isKnown && !b.isKnown) return -1;
      if (!a.isKnown && b.isKnown) return 1;
      return a.name.localeCompare(b.name);
    });

    return printers;
  }

  /**
   * Connect to a specific USB device by vendorId and productId
   */
  async connect(vendorId: number, productId: number): Promise<PrinterDeviceInfo> {
    // Disconnect existing device first
    await this.disconnect();

    const dev = findByIds(vendorId, productId);
    if (!dev) {
      throw new Error(`Printer not found (VID: ${vendorId.toString(16)}, PID: ${productId.toString(16)}). Make sure it is connected.`);
    }

    // Try libusb first
    try {
      dev.open();
    } catch (err: any) {
      // On Windows, LIBUSB_ERROR_NOT_SUPPORTED means no WinUSB driver
      // Fall back to Windows raw port printing
      if (err.message && (err.message.includes('NOT_SUPPORTED') || err.message.includes('LIBUSB_ERROR'))) {
        console.log('[NativePrinter] libusb not supported for this device, trying Windows raw port...');
        return this.connectViaWindowsPort(vendorId, productId);
      }
      throw new Error(`Cannot open printer: ${err.message}. Try unplugging and reconnecting.`);
    }

    // Find a bulk OUT endpoint for printing
    const config = dev.configDescriptor;
    if (!config) {
      dev.close();
      throw new Error('No USB configuration available on this device.');
    }

    let foundEndpoint = false;
    for (const ifaceDesc of config.interfaces) {
      for (const alt of ifaceDesc) {
        const outEp = alt.endpoints.find(
          (ep: any) => {
            const isOut = (ep.bEndpointAddress & 0x80) === 0;
            const isBulk = (ep.bmAttributes & 0x03) === 2;
            return isOut && isBulk;
          }
        );
        if (outEp) {
          const iface = dev.interface(alt.bInterfaceNumber);
          
          if (iface.isKernelDriverActive()) {
            try { iface.detachKernelDriver(); } catch { /* ignore */ }
          }

          try {
            iface.claim();
          } catch (err: any) {
            dev.close();
            // Also try Windows raw port as fallback
            console.log('[NativePrinter] Cannot claim interface, trying Windows raw port...');
            return this.connectViaWindowsPort(vendorId, productId);
          }

          this.iface = iface;
          this.outEndpoint = iface.endpoint(outEp.bEndpointAddress) as OutEndpoint;
          foundEndpoint = true;
          break;
        }
      }
      if (foundEndpoint) break;
    }

    if (!foundEndpoint) {
      dev.close();
      // Try Windows raw port as last resort
      console.log('[NativePrinter] No bulk endpoint found, trying Windows raw port...');
      return this.connectViaWindowsPort(vendorId, productId);
    }

    this.device = dev;

    // Try to get Windows printer name first (more user-friendly)
    let name = `USB Printer (${vendorId.toString(16)}:${productId.toString(16)})`;
    let windowsPrinterName: string | null = null;
    try {
      const printerInfo = this.findWindowsPrinterByVidPid(vendorId, productId);
      if (printerInfo) {
        name = printerInfo.name; // Use Windows printer name like "Champ RP Series"
        windowsPrinterName = printerInfo.name;
      } else {
        // Fallback to USB device name
        const prodStr = await getStringDescriptor(dev, dev.deviceDescriptor.iProduct);
        if (prodStr) name = prodStr;
      }
    } catch { 
      // Fallback to USB device name
      try {
        const prodStr = await getStringDescriptor(dev, dev.deviceDescriptor.iProduct);
        if (prodStr) name = prodStr;
      } catch { /* ignore */ }
    }
    
    // Also update the rawPrinterName if we found a Windows printer
    if (windowsPrinterName) {
      this.rawPrinterName = windowsPrinterName;
    }

    return { name, vendorId, productId };
  }

  /**
   * Windows fallback: connect via the printer's Windows spooler name
   * Matches the selected USB device VID/PID to the correct Windows printer
   */
  private connectViaWindowsPort(vendorId: number, productId: number): PrinterDeviceInfo {
    if (process.platform !== 'win32') {
      throw new Error('This printer requires a WinUSB driver. Install it using Zadig (https://zadig.akeo.ie).');
    }

    const printerInfo = this.findWindowsPrinterByVidPid(vendorId, productId);
    if (!printerInfo) {
      throw new Error(
        `Could not find a Windows printer matching USB device ${vendorId.toString(16)}:${productId.toString(16)}. ` +
        `The printer driver may not be installed. Please install the TVS RP 3210 GOLD driver or a "Generic / Text Only" printer driver in Windows Settings > Printers.`
      );
    }

    this.rawPortName = printerInfo.port;
    this.rawPrinterName = printerInfo.name;
    console.log(`[NativePrinter] Connected via Windows spooler: "${printerInfo.name}" on port ${printerInfo.port}`);

    return {
      name: printerInfo.name,
      vendorId,
      productId,
    };
  }

  /**
   * Find a Windows printer that matches the given USB VID/PID
   */
  private findWindowsPrinterByVidPid(vendorId: number, productId: number): { name: string; port: string } | null {
    const vid = vendorId.toString(16).toUpperCase().padStart(4, '0');
    const pid = productId.toString(16).toUpperCase().padStart(4, '0');
    const targetHwId = `VID_${vid}&PID_${pid}`.toUpperCase();

    console.log(`[NativePrinter] Looking for Windows printer with hardware ID: ${targetHwId}`);

    try {
      // Method 1: Match PnP devices to printer names via InstanceId
      const pnpOutput = execSync(
        `powershell -NoProfile -Command "Get-PnpDevice -Class Printer -ErrorAction SilentlyContinue | Select-Object FriendlyName,InstanceId | ConvertTo-Json"`,
        { encoding: 'utf-8', timeout: 15000 }
      );

      const pnpDevices = JSON.parse(pnpOutput.trim());
      const devices = Array.isArray(pnpDevices) ? pnpDevices : [pnpDevices];

      for (const dev of devices) {
        if (dev?.InstanceId && dev.InstanceId.toUpperCase().includes(targetHwId)) {
          const printerName = dev.FriendlyName;
          console.log(`[NativePrinter] Found PnP match: "${printerName}" (${dev.InstanceId})`);

          // Get the port for this printer
          const portInfo = this.getPrinterPort(printerName);
          if (portInfo) {
            return { name: printerName, port: portInfo };
          }
          // Even without a port, try using the printer name directly
          return { name: printerName, port: 'USB' };
        }
      }
    } catch (err) {
      console.error('[NativePrinter] PnP device lookup failed:', err);
    }

    try {
      // Method 2: Check all printers and their ports, try USB ports
      const output = execSync(
        'powershell -NoProfile -Command "Get-Printer | Select-Object Name,PortName,DriverName | ConvertTo-Json"',
        { encoding: 'utf-8', timeout: 10000 }
      );

      const printers = JSON.parse(output.trim());
      const printerList = Array.isArray(printers) ? printers : [printers];

      console.log(`[NativePrinter] Available Windows printers:`);
      for (const p of printerList) {
        console.log(`  - "${p.Name}" on port ${p.PortName} (driver: ${p.DriverName})`);
      }

      // Look for printers with thermal/receipt/POS-related names or generic text driver
      // PRIORITY 1: COM port printers (most reliable for POS58)
      const comPrinters = printerList.filter(p => p.PortName && p.PortName.match(/^COM\d+$/i));
      if (comPrinters.length > 0) {
        // Prefer COM port printers - they're almost always thermal/POS printers
        const comPrinter = comPrinters[0];
        console.log(`[NativePrinter] Matched COM port printer: "${comPrinter.Name}" on ${comPrinter.PortName}`);
        return { name: comPrinter.Name, port: comPrinter.PortName };
      }
      
      // PRIORITY 2: Look for printers with thermal/receipt/POS-related names
      const thermalKeywords = ['thermal', 'receipt', 'pos', 'tvs', 'rp 3210', 'rp3210', 'gold', 'generic', 'text only', 'cn811'];
      const genericNames = ['usb printer']; // Removed pos58/pos80 from generic exclusion
      
      // First pass: find thermal printer
      for (const p of printerList) {
        const nameAndDriver = `${p.Name} ${p.DriverName}`.toLowerCase();
        const isThermal = thermalKeywords.some(kw => nameAndDriver.includes(kw));
        if (isThermal && p.PortName) {
          console.log(`[NativePrinter] Matched thermal printer: "${p.Name}" on ${p.PortName}`);
          return { name: p.Name, port: p.PortName };
        }
      }

      // Fallback: pick first USB-port printer that ISN'T clearly an inkjet/laser
      const inkjetKeywords = ['brother', 'canon', 'epson', 'hp ', 'hp_', 'laserjet', 'inkjet', 'deskjet', 'officejet'];
      for (const p of printerList) {
        if (p.PortName && p.PortName.match(/USB\d+/i)) {
          const nameLC = p.Name.toLowerCase();
          if (!inkjetKeywords.some(kw => nameLC.includes(kw))) {
            console.log(`[NativePrinter] Using non-inkjet USB printer: "${p.Name}" on ${p.PortName}`);
            return { name: p.Name, port: p.PortName };
          }
        }
      }
    } catch (err) {
      console.error('[NativePrinter] Printer list lookup failed:', err);
    }

    return null;
  }

  /**
   * Get the port name for a specific Windows printer
   */
  private getPrinterPort(printerName: string): string | null {
    try {
      const output = execSync(
        `powershell -NoProfile -Command "Get-Printer -Name '${printerName.replace(/'/g, "''")}' | Select-Object -ExpandProperty PortName"`,
        { encoding: 'utf-8', timeout: 5000 }
      );
      return output.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Switch to a different Windows printer (same USB device, different driver)
   */
  switchWindowsPrinter(printerName: string): void {
    if (!this.rawPortName) {
      throw new Error('Cannot switch printer: not connected via Windows spooler.');
    }
    
    // Get the port for the new printer
    const portInfo = this.getPrinterPort(printerName);
    if (!portInfo) {
      throw new Error(`Could not find port for printer "${printerName}".`);
    }
    
    this.rawPrinterName = printerName;
    this.rawPortName = portInfo;
    console.log(`[NativePrinter] Switched to Windows printer: "${printerName}" on port ${portInfo}`);
  }

  /**
   * Find ALL Windows printers that match the given USB VID/PID
   * Returns an array of printer names (multiple printers can share same VID/PID)
   */
  findAllWindowsPrintersByVidPid(vendorId: number, productId: number): string[] {
    const vid = vendorId.toString(16).toUpperCase().padStart(4, '0');
    const pid = productId.toString(16).toUpperCase().padStart(4, '0');
    const targetHwId = `VID_${vid}&PID_${pid}`.toUpperCase();

    console.log(`[NativePrinter] Finding all Windows printers with hardware ID: ${targetHwId}`);
    const matchingPrinters: string[] = [];

    try {
      // Get all PnP devices that are printers and match the VID/PID
      const pnpOutput = execSync(
        `powershell -NoProfile -Command "Get-PnpDevice -Class Printer -ErrorAction SilentlyContinue | Select-Object FriendlyName,InstanceId | ConvertTo-Json"`,
        { encoding: 'utf-8', timeout: 15000 }
      );

      const pnpDevices = JSON.parse(pnpOutput.trim());
      const devices = Array.isArray(pnpDevices) ? pnpDevices : [pnpDevices];

      for (const dev of devices) {
        if (dev?.InstanceId && dev.InstanceId.toUpperCase().includes(targetHwId)) {
          const printerName = dev.FriendlyName;
          console.log(`[NativePrinter] Found matching printer: "${printerName}" (${dev.InstanceId})`);
          matchingPrinters.push(printerName);
        }
      }
    } catch (err) {
      console.error('[NativePrinter] PnP device lookup failed:', err);
    }

    // If no PnP match, also try checking all USB port printers
    if (matchingPrinters.length === 0) {
      try {
        const output = execSync(
          'powershell -NoProfile -Command "Get-Printer | Where-Object { $_.PortName -match \'USB\' } | Select-Object -ExpandProperty Name | ConvertTo-Json"',
          { encoding: 'utf-8', timeout: 10000 }
        );
        const printers = JSON.parse(output.trim());
        const printerList = Array.isArray(printers) ? printers : [printers];
        
        // Return all USB printers as fallback
        for (const p of printerList) {
          if (p && p.trim()) {
            matchingPrinters.push(p);
          }
        }
      } catch (err) {
        console.error('[NativePrinter] USB printer list fallback failed:', err);
      }
    }

    console.log(`[NativePrinter] Found ${matchingPrinters.length} matching printers for ${targetHwId}`);
    return matchingPrinters;
  }

  /**
   * Get the currently selected Windows printer name
   */
  getWindowsPrinterName(): string | null {
    return this.rawPrinterName;
  }

  /**
   * Send raw ESC/POS data to the connected printer
   */
  async printRaw(data: Uint8Array): Promise<void> {
    // Windows raw port fallback
    if (this.rawPortName) {
      return this.printViaRawPort(Buffer.from(data));
    }

    if (!this.device || !this.outEndpoint) {
      throw new Error('No printer connected.');
    }

    const CHUNK_SIZE = 1024;
    
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = Buffer.from(data.slice(i, i + CHUNK_SIZE));
      await new Promise<void>((resolve, reject) => {
        this.outEndpoint.transfer(chunk, (err: Error | null) => {
          if (err) reject(new Error(`Print failed: ${err.message}`));
          else resolve();
        });
      });
    }
  }

  /**
   * Print via Windows Print Spooler API (uses PowerShell + winspool.drv)
   */
  private async printViaRawPort(data: Buffer): Promise<void> {
    if (!this.rawPrinterName) {
      throw new Error('No Windows printer configured.');
    }

    const tmpFile = path.join(os.tmpdir(), `receipt_${Date.now()}.bin`);
    try {
      fs.writeFileSync(tmpFile, data);

      // Use PowerShell with winspool.drv P/Invoke to send raw ESC/POS data
      const escapedFile = tmpFile.replace(/\\/g, '\\\\');
      const escapedPrinter = this.rawPrinterName.replace(/'/g, "''");

      const psScript = `
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public class RP{
[StructLayout(LayoutKind.Sequential)]public struct DI{[MarshalAs(UnmanagedType.LPStr)]public string n;[MarshalAs(UnmanagedType.LPStr)]public string o;[MarshalAs(UnmanagedType.LPStr)]public string d;}
[DllImport("winspool.drv",EntryPoint="OpenPrinterA",SetLastError=true)]public static extern bool OpenPrinter(string s,out IntPtr h,IntPtr p);
[DllImport("winspool.drv",EntryPoint="StartDocPrinterA",SetLastError=true)]public static extern bool StartDocPrinter(IntPtr h,int l,ref DI d);
[DllImport("winspool.drv",EntryPoint="StartPagePrinter",SetLastError=true)]public static extern bool StartPagePrinter(IntPtr h);
[DllImport("winspool.drv",EntryPoint="WritePrinter",SetLastError=true)]public static extern bool WritePrinter(IntPtr h,IntPtr b,int c,out int w);
[DllImport("winspool.drv",EntryPoint="EndPagePrinter",SetLastError=true)]public static extern bool EndPagePrinter(IntPtr h);
[DllImport("winspool.drv",EntryPoint="EndDocPrinter",SetLastError=true)]public static extern bool EndDocPrinter(IntPtr h);
[DllImport("winspool.drv",EntryPoint="ClosePrinter",SetLastError=true)]public static extern bool ClosePrinter(IntPtr h);
[DllImport("kernel32.dll")]public static extern int GetLastError();
public static bool Send(string pn,byte[] bs,out string err){err="";IntPtr hp;DI di=new DI();di.n="Receipt";di.d="RAW";
if(!OpenPrinter(pn,out hp,IntPtr.Zero)){err="OpenPrinter failed, error="+GetLastError();return false;}
if(!StartDocPrinter(hp,1,ref di)){err="StartDocPrinter failed";ClosePrinter(hp);return false;}
if(!StartPagePrinter(hp)){err="StartPagePrinter failed";EndDocPrinter(hp);ClosePrinter(hp);return false;}
IntPtr pb=Marshal.AllocCoTaskMem(bs.Length);Marshal.Copy(bs,0,pb,bs.Length);int w;bool ok=WritePrinter(hp,pb,bs.Length,out w);
if(!ok)err="WritePrinter failed";Marshal.FreeCoTaskMem(pb);EndPagePrinter(hp);EndDocPrinter(hp);ClosePrinter(hp);return ok;}}
'@
$b=[IO.File]::ReadAllBytes('${escapedFile}')
[string]$err=""
if([RP]::Send('${escapedPrinter}',$b,[ref]$err)){Write-Output 'OK'}else{Write-Error "Print failed: $err";exit 1}
`.trim();

      // Write PS script to temp file to avoid command line escaping issues
      const psFile = tmpFile + '.ps1';
      fs.writeFileSync(psFile, psScript);

      execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`, {
        timeout: 20000,
        windowsHide: true,
      });
      console.log(`[NativePrinter] Printed ${data.length} bytes via Windows spooler to "${this.rawPrinterName}"`);

      try { fs.unlinkSync(psFile); } catch { /* ignore */ }
    } catch (err: any) {
      throw new Error(`Failed to print to "${this.rawPrinterName}": ${err.message}`);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  /**
   * Disconnect from the current printer
   */
  async disconnect(): Promise<void> {
    if (this.iface) {
      try { this.iface.release(true, () => {}); } catch { /* ignore */ }
      this.iface = null;
    }
    if (this.device) {
      try { this.device.close(); } catch { /* ignore */ }
      this.device = null;
    }
    this.outEndpoint = null;
    this.rawPortName = null;
    this.rawPrinterName = null;
  }

  isConnected(): boolean {
    return (this.device !== null && this.outEndpoint !== null) || this.rawPortName !== null;
  }
}

// Helper to get USB string descriptor
function getStringDescriptor(device: any, index: number): Promise<string | undefined> {
  if (!index) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    device.getStringDescriptor(index, (err: Error | null, value?: string) => {
      resolve(err ? undefined : value);
    });
  });
}
