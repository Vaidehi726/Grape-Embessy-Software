import { useState, useEffect } from 'react';
import { useRestaurant } from '@/contexts/RestaurantContext';
import { supabase } from '@/integrations/supabase/client';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save, Download, Upload, Cloud, Database, Monitor, MonitorCog, AlertTriangle, Trash2 } from 'lucide-react';
import { 
  downloadAllDataFromCloud, 
  manualSyncToCloud, 
  getPendingSyncCount,
  isElectron,
  debugDumpSQLiteData,
  clearAllLocalData,
  offlineMutate,
} from '@/services/offlineDataService';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import ResetDataCard from '@/components/ResetDataCard';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export default function Settings() {
  const { currentRestaurant, refreshRestaurants } = useRestaurant();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [factoryResetting, setFactoryResetting] = useState(false);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    address: '',
    gstin: '',
    cgst_percentage: '',
    sgst_percentage: '',
    print_qr_on_bill: true,
    payment_qr_content: '',
    lock_saved_items: false,
  });

  // Poll pending count
  useEffect(() => {
    if (!isElectron()) return;
    const checkPending = async () => {
      const count = await getPendingSyncCount();
      setPendingCount(count);
    };
    checkPending();
    const interval = setInterval(checkPending, 5_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (currentRestaurant) {
      setForm({
        name: currentRestaurant.name || '',
        phone: currentRestaurant.phone || '',
        address: currentRestaurant.address || '',
        gstin: currentRestaurant.gstin || '',
        cgst_percentage: currentRestaurant.cgst_percentage?.toString() || '',
        sgst_percentage: currentRestaurant.sgst_percentage?.toString() || '',
        print_qr_on_bill: currentRestaurant.print_qr_on_bill !== false,
        payment_qr_content: (currentRestaurant as any).payment_qr_content || '',
        lock_saved_items: Boolean((currentRestaurant as any).lock_saved_items),
      });
    }
  }, [currentRestaurant]);

  const handleDownload = async () => {
    if (!currentRestaurant) {
      toast({ title: 'Error', description: 'No restaurant selected', variant: 'destructive' });
      return;
    }
    setDownloading(true);
    const result = await downloadAllDataFromCloud(currentRestaurant.id);
    setDownloading(false);

    if (result.success) {
      toast({
        title: 'Download Complete',
        description: `Downloaded ${result.downloaded} records from cloud to local database`,
      });
    } else {
      toast({
        title: 'Download Failed',
        description: result.errors.join(', '),
        variant: 'destructive',
      });
    }
  };

  const handleUpload = async () => {
    setUploading(true);
    const result = await manualSyncToCloud();
    setUploading(false);

    if (result.success) {
      setPendingCount(0);
      toast({
        title: 'Upload Complete',
        description: `Uploaded ${result.uploaded} records, deleted ${result.deleted} records`,
      });
    } else {
      toast({
        title: 'Upload Failed',
        description: result.errors.join(', '),
        variant: 'destructive',
      });
    }
  };

  // Factory Reset - Complete wipe for fresh install
  const handleFactoryReset = async () => {
    setFactoryResetting(true);
    
    try {
      const electronAPI = (window as any).electronAPI;
      
      if (!electronAPI?.app) {
        toast({
          title: 'Error',
          description: 'Factory reset only available in desktop app',
          variant: 'destructive',
        });
        setFactoryResetting(false);
        return;
      }

      console.log('[Factory Reset] Starting complete data wipe...');

      // Step 1: Clear all localStorage
      console.log('[Factory Reset] Clearing localStorage...');
      localStorage.clear();
      sessionStorage.clear();

      // Step 2: Clear all IndexedDB databases
      console.log('[Factory Reset] Clearing IndexedDB...');
      if (window.indexedDB && window.indexedDB.databases) {
        const databases = await window.indexedDB.databases();
        for (const db of databases) {
          if (db.name) {
            window.indexedDB.deleteDatabase(db.name);
            console.log(`[Factory Reset] Deleted IndexedDB: ${db.name}`);
          }
        }
      }

      // Step 3: Clear SQLite databases via Electron IPC
      console.log('[Factory Reset] Clearing SQLite databases...');
      const resetResult = await electronAPI.app.resetAllData();
      
      if (!resetResult.success) {
        throw new Error(resetResult.message || 'Failed to reset SQLite databases');
      }

      console.log('[Factory Reset] All data cleared successfully');

      toast({
        title: '✅ Factory Reset Complete',
        description: 'All data has been wiped. Restarting app for fresh install...',
      });

      // Step 4: Force reload app (will show LAN mode selection)
      setTimeout(() => {
        console.log('[Factory Reset] Reloading app...');
        window.location.href = '/';
      }, 1500);

    } catch (error: any) {
      console.error('[Factory Reset] Error:', error);
      toast({
        title: '❌ Factory Reset Failed',
        description: error.message || 'An error occurred during reset',
        variant: 'destructive',
      });
    } finally {
      setFactoryResetting(false);
    }
  };

  const handleSave = async () => {
    if (!currentRestaurant) return;

    setSaving(true);

    const updatedData = {
      id: currentRestaurant.id,
      name: form.name,
      phone: form.phone,
      address: form.address,
      gstin: form.gstin || null,
      cgst_percentage: form.cgst_percentage ? parseFloat(form.cgst_percentage) : 0,
      sgst_percentage: form.sgst_percentage ? parseFloat(form.sgst_percentage) : 0,
      print_qr_on_bill: form.print_qr_on_bill,
      payment_qr_content: form.payment_qr_content || null,
      lock_saved_items: form.lock_saved_items,
    };

    try {
      // Use offlineMutate so local SQLite cache is updated first
      await offlineMutate(
        'restaurants',
        updatedData,
        async () => {
          const res = await supabase
            .from('restaurants')
            .update({
              name: updatedData.name,
              phone: updatedData.phone,
              address: updatedData.address,
              gstin: updatedData.gstin,
              cgst_percentage: updatedData.cgst_percentage,
              sgst_percentage: updatedData.sgst_percentage,
              print_qr_on_bill: updatedData.print_qr_on_bill,
              payment_qr_content: updatedData.payment_qr_content,
              lock_saved_items: updatedData.lock_saved_items,
            } as any)
            .eq('id', currentRestaurant.id)
            .select()
            .single();
          return res;
        }
      );

      toast({
        title: 'Saved',
        description: 'Restaurant settings updated successfully',
      });
      
      // Update the current restaurant in context with the new data
      if (currentRestaurant) {
        const updatedRestaurant = {
          ...currentRestaurant,
          name: updatedData.name,
          phone: updatedData.phone,
          address: updatedData.address,
          gstin: updatedData.gstin,
          cgst_percentage: updatedData.cgst_percentage,
          sgst_percentage: updatedData.sgst_percentage,
          print_qr_on_bill: updatedData.print_qr_on_bill,
          payment_qr_content: updatedData.payment_qr_content,
          lock_saved_items: updatedData.lock_saved_items,
        };
        // Update localStorage cache
        localStorage.setItem('restroflow_current_restaurant', JSON.stringify(updatedRestaurant));
        // Trigger re-render by updating form with fresh data
        setForm({
          name: updatedData.name,
          phone: updatedData.phone,
          address: updatedData.address,
          gstin: updatedData.gstin || '',
          cgst_percentage: updatedData.cgst_percentage?.toString() || '',
          sgst_percentage: updatedData.sgst_percentage?.toString() || '',
          print_qr_on_bill: updatedData.print_qr_on_bill,
          payment_qr_content: updatedData.payment_qr_content || '',
          lock_saved_items: updatedData.lock_saved_items,
        });
      }
      
      refreshRestaurants();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save settings',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">Manage your restaurant settings</p>
        </div>

        {/* LAN Mode Change Card */}
        {isElectron() && (
          <Card className="border-blue-200 bg-blue-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MonitorCog className="w-5 h-5 text-blue-600" />
                LAN Mode Configuration
              </CardTitle>
              <CardDescription>
                Current mode: <strong>{localStorage.getItem('lan_mode') === 'server' ? '🖥️ Main Server' : '💻 Client PC'}</strong>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600 mb-4">
                {localStorage.getItem('lan_mode') === 'server' 
                  ? 'This computer is running as the main server. Other devices can connect to it on the local network.'
                  : 'This computer is connected to a LAN server. Change mode to switch to server mode.'}
              </p>
              <Button
                variant="outline"
                className="border-blue-300 text-blue-700 hover:bg-blue-100"
                onClick={() => {
                  // Clear LAN mode and reload
                  localStorage.removeItem('lan_mode');
                  localStorage.removeItem('lan_config');
                  
                  // Disconnect from LAN server if connected
                  const electronAPI = (window as any).electronAPI;
                  if (electronAPI?.lan) {
                    electronAPI.lan.disconnect?.();
                  }
                  
                  toast({
                    title: 'LAN Mode Cleared',
                    description: 'Restarting to show mode selection...',
                  });
                  
                  // Reload app to show LAN startup screen
                  setTimeout(() => {
                    window.location.reload();
                  }, 1000);
                }}
              >
                <Monitor className="w-4 h-4 mr-2" />
                Change LAN Mode
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Restaurant Details</CardTitle>
            <CardDescription>Update your restaurant information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Restaurant Name</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Enter restaurant name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="Enter phone number"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Textarea
                id="address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Enter full address"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="gstin">GSTIN</Label>
              <Input
                id="gstin"
                value={form.gstin}
                onChange={(e) => setForm({ ...form, gstin: e.target.value })}
                placeholder="Enter GSTIN number"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cgst">CGST (%)</Label>
                <Input
                  id="cgst"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={form.cgst_percentage}
                  onChange={(e) => setForm({ ...form, cgst_percentage: e.target.value })}
                  placeholder="e.g., 9"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sgst">SGST (%)</Label>
                <Input
                  id="sgst"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={form.sgst_percentage}
                  onChange={(e) => setForm({ ...form, sgst_percentage: e.target.value })}
                  placeholder="e.g., 9"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="print-qr" className="text-base">Print QR Code on Bill</Label>
                <p className="text-sm text-muted-foreground">
                  Print an Order ID QR code at the bottom of each receipt. Disable to save paper.
                </p>
              </div>
              <Switch
                id="print-qr"
                checked={form.print_qr_on_bill}
                onCheckedChange={(checked) => setForm({ ...form, print_qr_on_bill: checked })}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="lock-saved-items" className="text-base">Lock Saved Items</Label>
                <p className="text-sm text-muted-foreground">
                  Once an item is saved to an order, its quantity can only be increased — not reduced or removed. Prevents lowering an order after it's taken.
                </p>
              </div>
              <Switch
                id="lock-saved-items"
                checked={form.lock_saved_items}
                onCheckedChange={(checked) => setForm({ ...form, lock_saved_items: checked })}
              />
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="payment-qr-content">Payment QR Code Content</Label>
              <p className="text-sm text-muted-foreground">
                Enter the payment QR string provided by your bank (e.g., UPI payment link). This QR code will be printed on receipts for customer payments.
              </p>
              <Input
                id="payment-qr-content"
                value={form.payment_qr_content}
                onChange={(e) => setForm({ ...form, payment_qr_content: e.target.value })}
                placeholder="e.g., upi://pay?pa=restaurant@bank&pn=Restaurant+Name&mc=1234"
              />
            </div>

            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save Changes
            </Button>
          </CardContent>
        </Card>

        {/* Data Sync Section - Electron Only */}
        {isElectron() && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="w-5 h-5" />
                Data Synchronization
              </CardTitle>
              <CardDescription>
                Manage local database sync with cloud. Download data to work offline, upload when ready to sync.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Download Section */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Cloud className="w-4 h-4 text-blue-500" />
                  <h3 className="font-medium">Download from Cloud</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  Fetch all data from Supabase cloud and store locally. This allows you to work offline.
                </p>
                <Button 
                  onClick={handleDownload} 
                  disabled={downloading}
                  variant="outline"
                  className="w-full sm:w-auto"
                >
                  {downloading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 mr-2" />
                  )}
                  Download All Data
                </Button>
              </div>

              <Separator />

              {/* Upload Section */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-green-500" />
                  <h3 className="font-medium">Upload to Cloud</h3>
                  {pendingCount > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {pendingCount} pending
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Upload all local changes to Supabase cloud. Preserves original timestamps.
                </p>
                <Button 
                  onClick={handleUpload} 
                  disabled={uploading || pendingCount === 0}
                  variant="outline"
                  className="w-full sm:w-auto"
                >
                  {uploading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4 mr-2" />
                  )}
                  Upload Pending Changes
                </Button>
              </div>

              <Separator className="my-4" />

              {/* Debug Section */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground">Debug Tools</h4>
                <div className="flex gap-2">
                  <Button 
                    onClick={debugDumpSQLiteData} 
                    variant="ghost"
                    size="sm"
                  >
                    <Database className="w-4 h-4 mr-2" />
                    Dump SQLite Data
                  </Button>
                  <Button 
                    onClick={async () => {
                      const result = await clearAllLocalData();
                      toast({
                        title: result.success ? 'Data Cleared' : 'Error',
                        description: result.message,
                        variant: result.success ? 'default' : 'destructive',
                      });
                    }} 
                    variant="ghost"
                    size="sm"
                  >
                    <Database className="w-4 h-4 mr-2" />
                    Clear All Local Data
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Reset All Data - Only in Electron */}
        {isElectron() && (
          <ResetDataCard />
        )}

        {/* Factory Reset - Complete Wipe - Only in Electron */}
        {isElectron() && (
          <Card className="border-red-300 bg-red-50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-red-700">
                <AlertTriangle className="w-6 h-6" />
                ⚠️ Factory Reset - Fresh Install
              </CardTitle>
              <CardDescription className="text-red-600">
                This will completely wipe ALL data and restore the app to a fresh install state
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="bg-white border border-red-200 rounded-lg p-4">
                  <h4 className="font-semibold text-red-700 mb-2">This will delete:</h4>
                  <ul className="space-y-1 text-sm text-gray-700">
                    <li className="flex items-start gap-2">
                      <Trash2 className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                      <span><strong>All SQLite databases</strong> (local & LAN server data)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Trash2 className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                      <span><strong>All localStorage data</strong> (settings, LAN mode, preferences)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Trash2 className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                      <span><strong>All IndexedDB databases</strong> (cached data)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Trash2 className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                      <span><strong>All session data</strong> (login state, tokens)</span>
                    </li>
                  </ul>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <p className="text-sm text-yellow-800">
                    <strong>⚠️ Warning:</strong> This action cannot be undone! All local data will be permanently deleted.
                    Data in Supabase cloud will NOT be affected.
                  </p>
                </div>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-6 text-lg"
                      disabled={factoryResetting}
                    >
                      {factoryResetting ? (
                        <>
                          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                          Resetting...
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="w-5 h-5 mr-2" />
                          🗑️ FACTORY RESET - DELETE ALL DATA
                        </>
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle className="flex items-center gap-2 text-red-700">
                        <AlertTriangle className="w-6 h-6" />
                        Are you absolutely sure?
                      </AlertDialogTitle>
                      <AlertDialogDescription className="space-y-2">
                        <p className="font-semibold text-gray-800">
                          This will permanently delete ALL local data and cannot be undone!
                        </p>
                        <p>
                          After reset, the app will restart and show the initial setup screen
                          where you can choose LAN Server or Client mode.
                        </p>
                        <p className="text-sm text-gray-600">
                          <strong>Note:</strong> Data in Supabase cloud will remain intact.
                        </p>
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleFactoryReset}
                        className="bg-red-600 hover:bg-red-700 text-white"
                      >
                        Yes, Delete Everything
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
