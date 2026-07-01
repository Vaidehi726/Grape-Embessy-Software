import { useState, useCallback, useEffect } from 'react';
import { printerBridge, isElectron } from '@/services/printerBridge';
import { USBPrinterDevice } from '@/services/usbPrinter';
import type { BillData, SummaryPrintData } from '@/services/thermalPrinter';

const SAVED_PRINTER_KEY = 'restroflow_last_usb_printer';

function saveLastPrinter(device: USBPrinterDevice) {
  try { localStorage.setItem(SAVED_PRINTER_KEY, JSON.stringify(device)); } catch {}
}

function loadLastPrinter(): USBPrinterDevice | null {
  try {
    const raw = localStorage.getItem(SAVED_PRINTER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function useUSBPrinter() {
  const [connectedPrinter, setConnectedPrinter] = useState<USBPrinterDevice | null>(null);
  const [printing, setPrinting] = useState(false);
  const [isAvailable] = useState(() => printerBridge.isAvailable());
  const [availableDevices, setAvailableDevices] = useState<USBPrinterDevice[]>([]);

  // On mount: restore already-connected device from bridge singleton, or auto-reconnect last saved device
  useEffect(() => {
    if (!isAvailable || !isElectron()) return;

    const init = async () => {
      try {
        // 1. If the bridge singleton already has a connected device (same session), use it
        const alreadyConnected = printerBridge.getConnectedPrinter();
        if (alreadyConnected) {
          setConnectedPrinter(alreadyConnected);
          return;
        }

        // 2. Try to auto-reconnect the last saved printer
        const saved = loadLastPrinter();
        const devices = await printerBridge.listDevices();
        setAvailableDevices(devices);

        if (saved) {
          const match = devices.find(
            d => d.vendorId === saved.vendorId && d.productId === saved.productId
          );
          if (match) {
            try {
              const device = await printerBridge.connect(match.vendorId, match.productId);
              setConnectedPrinter({ ...device });
              console.log('[useUSBPrinter] Auto-reconnected saved printer:', device.name);
            } catch (e) {
              console.warn('[useUSBPrinter] Auto-reconnect failed:', e);
            }
          }
        }
      } catch {}
    };

    init();
  }, [isAvailable]);

  const refreshDevices = useCallback(async () => {
    if (isElectron()) {
      const devices = await printerBridge.listDevices();
      setAvailableDevices(devices);
      return devices;
    }
    return [];
  }, []);

  const connectPrinter = useCallback(async (vendorId?: number, productId?: number) => {
    console.log('[useUSBPrinter] Connecting...', { vendorId, productId });
    const device = await printerBridge.connect(vendorId, productId);
    console.log('[useUSBPrinter] Bridge returned device:', device);
    
    // Force state update with a new object to ensure React detects the change
    const deviceCopy = { ...device };
    setConnectedPrinter(deviceCopy);
    saveLastPrinter(deviceCopy); // Persist so it auto-reconnects on next tab change
    console.log('[useUSBPrinter] State updated to:', deviceCopy);
    return deviceCopy;
  }, []);

  const disconnectPrinter = useCallback(async () => {
    await printerBridge.disconnect();
    setConnectedPrinter(null);
    try { localStorage.removeItem(SAVED_PRINTER_KEY); } catch {}
  }, []);

  const printBill = useCallback(async (bill: BillData) => {
    setPrinting(true);
    try {
      await printerBridge.printBill(bill);
    } finally {
      setPrinting(false);
    }
  }, []);

  const printSummary = useCallback(async (summary: SummaryPrintData) => {
    setPrinting(true);
    try {
      await printerBridge.printSummary(summary);
    } finally {
      setPrinting(false);
    }
  }, []);

  return {
    connectedPrinter,
    printing,
    isAvailable,
    availableDevices,
    connectPrinter,
    disconnectPrinter,
    printBill,
    printSummary,
    refreshDevices,
    isElectronApp: isElectron(),
    // Expose printer bridge for Windows printer access
    printerBridge,
  };
}
