import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
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

export default function ResetDataCard() {
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    setResetting(true);
    try {
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI?.app) {
        toast.error('Reset feature only available in desktop app');
        return;
      }

      const result = await electronAPI.app.resetAllData();
      
      if (result.success) {
        toast.success('Application data has been reset. Restarting...');
      } else {
        toast.error(`Reset failed: ${result.message}`);
      }
    } catch (err: any) {
      toast.error(`Reset error: ${err.message}`);
    } finally {
      setResetting(false);
    }
  };

  return (
    <Card className="border-red-200 bg-red-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-red-700">
          <AlertTriangle className="h-5 w-5" />
          Danger Zone
        </CardTitle>
        <CardDescription className="text-red-600">
          These actions cannot be undone. Be careful!
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-white rounded-lg border border-red-200">
            <div className="flex-1">
              <h4 className="font-semibold text-gray-900">Reset All Application Data</h4>
              <p className="text-sm text-gray-600 mt-1">
                Deletes all restaurants, settings, orders, and configurations. The app will restart with a clean slate.
              </p>
              <ul className="text-xs text-gray-500 mt-2 space-y-1">
                <li>• SQLite databases</li>
                <li>• LAN configuration</li>
                <li>• Login sessions</li>
                <li>• Cached data</li>
                <li>• All local settings</li>
              </ul>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button 
                  variant="destructive" 
                  disabled={resetting}
                  className="ml-4"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  {resetting ? 'Resetting...' : 'Reset Everything'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-red-600">Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action will permanently delete ALL application data including:
                    <ul className="mt-2 space-y-1 text-sm">
                      <li>• All restaurant data</li>
                      <li>• All orders and order history</li>
                      <li>• Menu items and categories</li>
                      <li>• Staff accounts</li>
                      <li>• LAN server/client configuration</li>
                      <li>• All settings and preferences</li>
                    </ul>
                    <p className="mt-3 font-semibold text-red-600">
                      This cannot be undone!
                    </p>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleReset}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    Yes, Reset Everything
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <div className="text-xs text-gray-500 bg-white p-3 rounded border border-gray-200">
            <strong>Tip:</strong> After uninstalling the app, you can also manually delete these folders for a completely clean state:
            <ul className="mt-1 space-y-1 font-mono">
              <li>%APPDATA%/RestroFlow/</li>
              <li>%LOCALAPPDATA%/RestroFlow/</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
