import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { isElectron } from '@/services/printerBridge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
import {
  Loader2,
  AlertTriangle,
  Trash2,
  Monitor,
  MonitorCog,
  Wifi,
  WifiOff,
  Database,
  ArrowLeft,
} from 'lucide-react';
import { isOffline, onConnectivityChange } from '@/services/offlineDataService';

export default function GlobalSettings() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [factoryResetting, setFactoryResetting] = useState(false);
  const [browserOffline, setBrowserOffline] = useState(isOffline());

  // Track browser connectivity
  useEffect(() => {
    const unsub = onConnectivityChange((online) => {
      setBrowserOffline(!online);
    });
    return unsub;
  }, []);

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

  // Change LAN Mode
  const handleChangeLanMode = () => {
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
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card px-6 py-4">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Application settings and data management
            </p>
          </div>
        </div>
      </header>

      {/* Offline Banner */}
      {browserOffline && (
        <div className="bg-yellow-500/90 text-yellow-950 px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2">
          <WifiOff className="w-4 h-4" />
          Offline Mode
        </div>
      )}

      <div className="container max-w-4xl mx-auto p-6 space-y-6">
        {/* Connection Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {browserOffline ? (
                <WifiOff className="w-5 h-5 text-red-500" />
              ) : (
                <Wifi className="w-5 h-5 text-green-500" />
              )}
              Connection Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {browserOffline ? 'Offline' : 'Online'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {browserOffline 
                    ? 'You are currently offline. Some features may be limited.'
                    : 'Connected to the internet.'}
                </p>
              </div>
              <Badge variant={browserOffline ? 'destructive' : 'default'}>
                {browserOffline ? 'Offline' : 'Online'}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* LAN Mode Configuration - Electron Only */}
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
                onClick={handleChangeLanMode}
              >
                <Monitor className="w-4 h-4 mr-2" />
                Change LAN Mode
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Factory Reset - Complete Wipe - Electron Only */}
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

        {/* Web Mode Info */}
        {!isElectron() && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="w-5 h-5" />
                Web Mode
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                You are using the web version. Factory reset and LAN mode features are only available in the desktop (Electron) application.
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => window.open('https://github.com/your-org/tableflow-pro/releases', '_blank')}
              >
                Download Desktop App
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
