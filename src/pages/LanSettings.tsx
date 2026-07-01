import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Server, Wifi, WifiOff, Computer, ChefHat, Receipt, Copy, CheckCircle2, AlertCircle, Settings as SettingsIcon } from 'lucide-react';
import { toast } from 'sonner';
import DashboardLayout from '@/components/layout/DashboardLayout';

interface LanStatus {
  mode: 'server' | 'client' | 'none';
  connected: boolean;
  serverRunning: boolean;
  serverIp?: string;
  port?: number;
  clientsConnected?: number;
  dbStatus?: 'stopped' | 'starting' | 'ready' | 'error';
}

// Debug info interface
interface DebugInfo {
  hasElectronAPI: boolean;
  hasLanAPI: boolean;
  electronKeys: string[];
  lanKeys: string[];
  error?: string;
}

export default function LanSettings() {
  const [status, setStatus] = useState<LanStatus>({ mode: 'none', connected: false, serverRunning: false });
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [startServerError, setStartServerError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<string>('');
  
  // Client config - only need server IP
  const [serverIp, setServerIp] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [deviceType, setDeviceType] = useState<'billing' | 'kitchen' | 'manager'>('billing');

  useEffect(() => {
    // Debug: Check what APIs are available
    const checkAPI = () => {
      try {
        const info: DebugInfo = {
          hasElectronAPI: !!window.electronAPI,
          hasLanAPI: !!window.electronAPI?.lan,
          electronKeys: window.electronAPI ? Object.keys(window.electronAPI) : [],
          lanKeys: window.electronAPI?.lan ? Object.keys(window.electronAPI.lan) : []
        };
        setDebugInfo(info);
        console.log('[LanSettings] Debug Info:', info);
      } catch (err: any) {
        setDebugInfo({
          hasElectronAPI: false,
          hasLanAPI: false,
          electronKeys: [],
          lanKeys: [],
          error: err.message
        });
      }
    };
    
    checkAPI();
    
    // Generate device name if not set
    if (!deviceName) {
      setDeviceName(`Station ${Math.floor(Math.random() * 100)}`);
    }
    
    checkStatus();
    
    // Set up event listeners
    if (window.electronAPI?.lan) {
      const unsubConnected = window.electronAPI.lan.onConnected(() => {
        toast.success('Connected to LAN server');
        checkStatus();
      });
      
      const unsubDisconnected = window.electronAPI.lan.onDisconnected(() => {
        toast.error('Disconnected from LAN server');
        checkStatus();
      });
      
      return () => {
        unsubConnected();
        unsubDisconnected();
      };
    }
  }, []);

  // Get current mode from localStorage
  const currentMode = localStorage.getItem('lan_mode') as 'server' | 'client' | null;

  const checkStatus = async () => {
    if (!window.electronAPI?.lan) return;
    try {
      const result = await window.electronAPI.lan.status();
      setStatus(result);
      // Auto-fill server IP if available
      if (result.serverIp) {
        setServerIp(result.serverIp);
      }
    } catch (err) {
      console.error('Failed to get LAN status:', err);
    }
  };

  const copyIpToClipboard = () => {
    if (status.serverIp) {
      navigator.clipboard.writeText(status.serverIp);
      setCopied(true);
      toast.success('IP address copied!');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const startServer = async () => {
    setStartServerError(null);
    
    console.log('[LanSettings] Starting server...');
    console.log('[LanSettings] window.electronAPI:', window.electronAPI);
    console.log('[LanSettings] window.electronAPI?.lan:', window.electronAPI?.lan);
    
    if (!window.electronAPI?.lan) {
      const errorMsg = `LAN API not available. Debug: hasElectronAPI=${debugInfo?.hasElectronAPI}, hasLanAPI=${debugInfo?.hasLanAPI}, electronKeys=[${debugInfo?.electronKeys.join(', ')}]`;
      console.error('[LanSettings]', errorMsg);
      setStartServerError(errorMsg);
      toast.error('LAN support not available - check debug info below');
      return;
    }
    
    setLoading(true);
    try {
      console.log('[LanSettings] Calling lan.startServer()...');
      const result = await window.electronAPI.lan.startServer();
      console.log('[LanSettings] startServer result:', result);
      
      if (result.success) {
        toast.success(`Server started! IP: ${result.ip}`);
        checkStatus();
      } else {
        const errorMsg = result.error || 'Unknown error';
        setStartServerError(errorMsg);
        toast.error(`Failed to start: ${errorMsg}`);
      }
    } catch (err: any) {
      const errorMsg = err.message || String(err);
      console.error('[LanSettings] startServer exception:', err);
      setStartServerError(errorMsg);
      toast.error(`Error: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  const stopServer = async () => {
    if (!window.electronAPI?.lan) return;
    
    setLoading(true);
    try {
      await window.electronAPI.lan.stopServer();
      toast.success('Server stopped');
      checkStatus();
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const connectClient = async () => {
    if (!window.electronAPI?.lan) {
      toast.error('LAN support not available');
      return;
    }
    
    if (!serverIp) {
      toast.error('Please enter the server IP address');
      return;
    }
    
    console.log('[LanSettings] Attempting to connect to:', serverIp);
    setLoading(true);
    try {
      const config = {
        serverHost: serverIp,
        serverPort: 3333, // Fixed port
        deviceId: `device-${Math.random().toString(36).substr(2, 9)}`,
        deviceType,
        deviceName: deviceName || `Station ${Math.floor(Math.random() * 100)}`
      };
      
      console.log('[LanSettings] Connect config:', config);
      const result = await window.electronAPI.lan.connect(config);
      console.log('[LanSettings] Connect result:', result);
      
      if (result.success) {
        toast.success('Connected! All data will sync automatically.');
        checkStatus();
      } else {
        const errorMsg = result.error || 'Unknown error - check console for details';
        console.error('[LanSettings] Connection failed:', errorMsg);
        toast.error(`Failed to connect: ${errorMsg}`);
      }
    } catch (err: any) {
      console.error('[LanSettings] Connect exception:', err);
      toast.error(`Error: ${err.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const disconnectClient = async () => {
    if (!window.electronAPI?.lan) return;
    
    setLoading(true);
    try {
      await window.electronAPI.lan.disconnect();
      toast.success('Disconnected');
      checkStatus();
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const syncAllDataFromServer = async () => {
    if (!window.electronAPI?.lan) return;
    if (!status.connected) {
      toast.error('Not connected to LAN server');
      return;
    }

    setSyncing(true);
    setSyncProgress('Starting sync...');
    
    try {
      console.log('[LanSettings] ========== Syncing all data from server ==========');
      setSyncProgress('Fetching restaurants...');
      
      // Phase 1 & 2: Auto-fetch restaurants first, then restaurant-specific data
      const result = await window.electronAPI.lan.syncAllFromServer();
      
      if (result.success && result.data) {
        const restaurantCount = result.data.restaurants?.length || 0;
        
        if (restaurantCount === 0) {
          toast.warning('⚠️ No restaurants found on server\n\nPlease create a restaurant on the Main PC first.');
          setSyncing(false);
          setSyncProgress('');
          return;
        }
        
        // Auto-select first restaurant
        const firstRestaurant = result.data.restaurants[0];
        const restaurantId = firstRestaurant.id;
        
        // Save to localStorage
        localStorage.setItem('restaurant_id', restaurantId);
        localStorage.setItem('restaurant_name', firstRestaurant.name || 'Restaurant');
        
        console.log('[LanSettings] ✓ Sync complete!');
        console.log('[LanSettings] Auto-selected restaurant:', firstRestaurant.name);
        console.log('[LanSettings] Data fetched:', {
          restaurants: restaurantCount,
          menu_categories: result.data.menu_categories?.length || 0,
          menu_items: result.data.menu_items?.length || 0,
          floors: result.data.floors?.length || 0,
          tables: result.data.tables?.length || 0,
          kitchens: result.data.kitchens?.length || 0,
          staff_members: result.data.staff_members?.length || 0,
          orders: result.data.orders?.length || 0,
          order_items: result.data.order_items?.length || 0,
        });
        
        const totalRecords = Object.values(result.data).reduce((sum, arr) => sum + (arr?.length || 0), 0);
        
        toast.success(
          `✅ Synced ${totalRecords} records from server!\n\n` +
          `Restaurant: ${firstRestaurant.name}\n` +
          `The app will now reload with fresh data.`
        );
        
        // Reload the app to refresh all data
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        toast.error(`Sync failed: ${result.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      console.error('[LanSettings] Sync failed:', err);
      toast.error(`Sync error: ${err.message || String(err)}`);
    } finally {
      setSyncing(false);
      setSyncProgress('');
    }
  };

  const switchMode = () => {
    // Clear LAN mode and config to show startup screen again
    localStorage.removeItem('lan_mode');
    localStorage.removeItem('lan_config');
    toast.info('Restart app to change mode');
    
    // Optional: Auto-reload the app
    if (confirm('Restart app to change mode?')) {
      window.location.reload();
    }
  };

  // Check if running in Electron - use multiple detection methods
  const isElectron = !!(window.electronAPI?.isElectron || window.electronAPI?.db || window.electronAPI?.printer);
  
  console.log('[LanSettings] isElectron check:', { 
    isElectron, 
    hasElectronAPI: !!window.electronAPI,
    isElectronFlag: window.electronAPI?.isElectron,
    hasDb: !!window.electronAPI?.db,
    hasPrinter: !!window.electronAPI?.printer
  });

  if (!isElectron) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>LAN Network</CardTitle>
            <CardDescription>LAN mode is only available in the desktop application</CardDescription>
          </CardHeader>
          <CardContent className="text-xs">
            <p>Debug: window.electronAPI = {typeof window.electronAPI}</p>
            <p>Keys: {window.electronAPI ? Object.keys(window.electronAPI).join(', ') : 'N/A'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <DashboardLayout>
    <div className="container mx-auto p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">LAN Network Setup</h1>
        <p className="text-muted-foreground">Connect multiple counters to share data in real-time</p>
      </div>

      {/* Debug Info Card - Shows what's available */}
      {debugInfo && (
        <Card className="mb-6 border-yellow-400">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertCircle className="h-4 w-4" />
              Debug Information
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-2">
            <div><strong>hasElectronAPI:</strong> {debugInfo.hasElectronAPI ? 'Yes' : 'No'}</div>
            <div><strong>hasLanAPI:</strong> {debugInfo.hasLanAPI ? 'Yes' : 'No'}</div>
            <div><strong>electronAPI keys:</strong> {debugInfo.electronKeys.join(', ') || 'None'}</div>
            <div><strong>lan keys:</strong> {debugInfo.lanKeys.join(', ') || 'None'}</div>
            {debugInfo.error && <div className="text-red-500"><strong>Error:</strong> {debugInfo.error}</div>}
          </CardContent>
        </Card>
      )}

      {/* Error Display */}
      {startServerError && (
        <Card className="mb-6 border-red-400 bg-red-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4" />
              Start Server Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-red-700">{startServerError}</p>
          </CardContent>
        </Card>
      )}

      {/* Current Mode Indicator */}
      {currentMode && (
        <Card className="mb-6 border-blue-400 bg-blue-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm text-blue-700">
              <SettingsIcon className="h-4 w-4" />
              Current Mode: {currentMode === 'server' ? 'Main Server PC' : 'Client PC'}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="text-sm text-blue-700">
              {currentMode === 'server' 
                ? 'This computer is hosting the database for other computers' 
                : 'This computer is connected to a server on the network'}
            </p>
            <Button variant="outline" size="sm" onClick={switchMode}>
              Switch Mode
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Status Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              {status.connected || status.serverRunning ? (
                <Wifi className="h-5 w-5 text-green-500" />
              ) : (
                <WifiOff className="h-5 w-5 text-gray-400" />
              )}
              <span className="font-medium">
                {status.serverRunning ? 'Server Running' : status.connected ? 'Connected' : 'Not Connected'}
              </span>
            </div>
            
            {status.serverRunning && status.serverIp && (
              <>
                <Badge variant="default" className="bg-green-600">
                  Server Active
                </Badge>
                <div className="flex items-center gap-2 bg-muted px-3 py-1.5 rounded-lg">
                  <span className="font-mono text-sm">{status.serverIp}</span>
                  <button 
                    onClick={copyIpToClipboard}
                    className="text-muted-foreground hover:text-foreground"
                    title="Copy IP"
                  >
                    {copied ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </>
            )}
            
            {status.connected && (
              <Badge variant="secondary">Client Mode</Badge>
            )}
            
            {status.clientsConnected !== undefined && status.clientsConnected > 0 && (
              <Badge variant="outline">{status.clientsConnected} device(s) connected</Badge>
            )}
          </div>
          
          {status.serverRunning && status.serverIp && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Other computers should connect to:</strong> {status.serverIp}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="server" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="server" className="flex items-center gap-2">
            <Server className="h-4 w-4" />
            This is the Main PC
          </TabsTrigger>
          <TabsTrigger value="client" className="flex items-center gap-2">
            <Computer className="h-4 w-4" />
            This is a Second PC
          </TabsTrigger>
        </TabsList>

        {/* Server Mode - Simplified */}
        <TabsContent value="server">
          <Card>
            <CardHeader>
              <CardTitle>Start Server (Main PC)</CardTitle>
              <CardDescription>
                Click the button below to start the server. Everything is configured automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <h4 className="font-medium mb-2">What happens when you start the server:</h4>
                <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Database starts automatically (built-in)</li>
                  <li>Server IP address is shown for other computers</li>
                  <li>Other computers can connect using this IP</li>
                  <li>All data is stored on this computer</li>
                </ul>
              </div>

              <div className="flex gap-2 pt-2">
                {status.serverRunning ? (
                  <Button 
                    variant="destructive" 
                    onClick={stopServer}
                    disabled={loading}
                    className="flex-1"
                  >
                    Stop Server
                  </Button>
                ) : (
                  <Button 
                    onClick={startServer}
                    disabled={loading}
                    className="flex-1"
                    size="lg"
                  >
                    <Server className="h-5 w-5 mr-2" />
                    Start Server
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Client Mode - Simplified */}
        <TabsContent value="client">
          <Card>
            <CardHeader>
              <CardTitle>Connect to Main PC</CardTitle>
              <CardDescription>
                Enter the IP address shown on the main computer
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Server IP Address (from main PC)</Label>
                <Input
                  value={serverIp}
                  onChange={(e) => setServerIp(e.target.value)}
                  placeholder="192.168.1.100"
                />
              </div>

              <div className="space-y-2">
                <Label>This Computer's Name</Label>
                <Input
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder="Counter 2"
                />
              </div>

              <div className="space-y-2">
                <Label>This Computer's Role</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={deviceType === 'billing' ? 'default' : 'outline'}
                    className="flex-1"
                    onClick={() => setDeviceType('billing')}
                  >
                    <Receipt className="h-4 w-4 mr-2" />
                    Billing
                  </Button>
                  <Button
                    type="button"
                    variant={deviceType === 'kitchen' ? 'default' : 'outline'}
                    className="flex-1"
                    onClick={() => setDeviceType('kitchen')}
                  >
                    <ChefHat className="h-4 w-4 mr-2" />
                    Kitchen
                  </Button>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                {status.connected ? (
                  <Button 
                    variant="destructive" 
                    onClick={disconnectClient}
                    disabled={loading}
                    className="flex-1"
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button 
                    onClick={connectClient}
                    disabled={loading || !serverIp}
                    className="flex-1"
                    size="lg"
                  >
                    <Wifi className="h-5 w-5 mr-2" />
                    Connect
                  </Button>
                )}
              </div>

              {status.connected && (
                <div className="space-y-3 pt-4 border-t">
                  <div className="p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                    <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-1">🔄 Fresh Data Sync</h4>
                    <p className="text-sm text-blue-700 dark:text-blue-300">
                      Load all data (menus, tables, floors) from the main PC. This ensures you have the latest data.
                    </p>
                  </div>
                  
                  <Button 
                    onClick={syncAllDataFromServer}
                    disabled={syncing}
                    className="w-full"
                    size="lg"
                    variant="outline"
                  >
                    {syncing ? (
                      <>
                        <span className="animate-spin mr-2">⏳</span>
                        {syncProgress || 'Syncing...'}
                      </>
                    ) : (
                      <>
                        <Server className="h-5 w-5 mr-2" />
                        Load All Data from Server
                      </>
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
    </DashboardLayout>
  );
}
