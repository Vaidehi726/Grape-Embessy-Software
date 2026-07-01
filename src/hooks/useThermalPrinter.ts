import { useState, useCallback, useEffect } from 'react';
import { thermalPrinter, PrinterDevice, BillData, SummaryPrintData } from '@/services/thermalPrinter';

export function useThermalPrinter() {
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<PrinterDevice[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<PrinterDevice | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [isBluetoothAvailable, setIsBluetoothAvailable] = useState(false);

  useEffect(() => {
    thermalPrinter.isBluetoothAvailable().then(setIsBluetoothAvailable);
    setConnectedDevice(thermalPrinter.getConnectedDevice());
  }, []);

  const scanDevices = useCallback(async () => {
    setScanning(true);
    try {
      const foundDevices = await thermalPrinter.scanDevices();
      setDevices(foundDevices);
      return foundDevices;
    } finally {
      setScanning(false);
    }
  }, []);

  const connect = useCallback(async (device: PrinterDevice) => {
    setConnecting(true);
    try {
      await thermalPrinter.connect(device);
      setConnectedDevice(device);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await thermalPrinter.disconnect();
    setConnectedDevice(null);
  }, []);

  const printBill = useCallback(async (bill: BillData, useBluetooth: boolean = false) => {
    setPrinting(true);
    try {
      if (useBluetooth && isBluetoothAvailable) {
        await thermalPrinter.printViaBluetooth(bill);
      } else {
        thermalPrinter.printViaBrowser(bill);
      }
    } finally {
      setPrinting(false);
    }
  }, [isBluetoothAvailable]);

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

  return {
    scanning,
    devices,
    connectedDevice,
    connecting,
    printing,
    isBluetoothAvailable,
    scanDevices,
    connect,
    disconnect,
    printBill,
    printSummary,
  };
}
