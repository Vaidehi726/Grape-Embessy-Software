import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Server, Monitor, Wifi, ArrowRight, Settings } from 'lucide-react';
import { toast } from 'sonner';

export type LanMode = 'server' | 'client' | null;

interface LanStartupProps {
  onModeSelect: (mode: LanMode, config?: LanClientConfig) => void;
  /** Start directly on a given screen (e.g. 'client' for a reconnect prompt). */
  initialMode?: LanMode;
  /** Pre-fill the server IP field (e.g. the last-used IP on a reconnect). */
  initialServerIp?: string;
  /** Optional note shown on the client screen (e.g. "Couldn't reach the server"). */
  notice?: string;
}

interface LanClientConfig {
  serverHost: string;
  serverPort: number;
  deviceId: string;
  deviceType: 'billing' | 'kitchen' | 'manager';
  deviceName: string;
}

export default function LanStartup({ onModeSelect, initialMode = null, initialServerIp = '', notice }: LanStartupProps) {
  const [selectedMode, setSelectedMode] = useState<LanMode>(initialMode);
  const [serverIp, setServerIp] = useState(initialServerIp);
  const [deviceName, setDeviceName] = useState('');
  const [deviceType, setDeviceType] = useState<'billing' | 'kitchen' | 'manager'>('billing');
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    // Generate default device name
    setDeviceName(`Station ${Math.floor(Math.random() * 100)}`);
  }, []);

  const handleServerMode = () => {
    setSelectedMode('server');
    onModeSelect('server');
  };

  const handleClientMode = () => {
    setSelectedMode('client');
  };

  const handleConnect = async () => {
    if (!serverIp.trim()) {
      toast.error('Please enter the server IP address');
      return;
    }

    setConnecting(true);
    try {
      const config: LanClientConfig = {
        serverHost: serverIp.trim(),
        serverPort: 3333,
        deviceId: `device-${Math.random().toString(36).substr(2, 9)}`,
        deviceType,
        deviceName: deviceName.trim() || `Station ${Math.floor(Math.random() * 100)}`
      };

      onModeSelect('client', config);
    } catch (err: any) {
      toast.error(`Connection failed: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleBack = () => {
    setSelectedMode(null);
    setServerIp('');
  };

  // Mode Selection Screen
  if (!selectedMode) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="max-w-4xl w-full space-y-8">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Welcome to Grape Embassy</h1>
            <p className="text-lg text-gray-600">Choose how you want to use this computer</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Server Mode Card */}
            <Card 
              className="cursor-pointer hover:shadow-xl transition-all duration-300 border-2 hover:border-blue-500 group"
              onClick={handleServerMode}
            >
              <CardHeader className="text-center pb-4">
                <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4 group-hover:bg-blue-200 transition-colors">
                  <Server className="w-8 h-8 text-blue-600" />
                </div>
                <CardTitle className="text-2xl">Main Server PC</CardTitle>
                <CardDescription className="text-base">
                  This computer will host the database and serve other computers
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="text-sm text-gray-600 space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold mt-0.5">✓</span>
                    <span>Stores all restaurant data</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold mt-0.5">✓</span>
                    <span>Requires login & setup</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold mt-0.5">✓</span>
                    <span>Other PCs connect to this one</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold mt-0.5">✓</span>
                    <span>Best for manager/owner computers</span>
                  </li>
                </ul>
                <Button className="w-full mt-4" size="lg">
                  Select This PC as Server
                  <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
              </CardContent>
            </Card>

            {/* Client Mode Card */}
            <Card 
              className="cursor-pointer hover:shadow-xl transition-all duration-300 border-2 hover:border-green-500 group"
              onClick={handleClientMode}
            >
              <CardHeader className="text-center pb-4">
                <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4 group-hover:bg-green-200 transition-colors">
                  <Monitor className="w-8 h-8 text-green-600" />
                </div>
                <CardTitle className="text-2xl">Second PC / Client</CardTitle>
                <CardDescription className="text-base">
                  Connect to an existing server on your network
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="text-sm text-gray-600 space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-green-600 font-bold mt-0.5">✓</span>
                    <span>No login required</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-600 font-bold mt-0.5">✓</span>
                    <span>Shares data with server PC</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-600 font-bold mt-0.5">✓</span>
                    <span>Real-time sync automatically</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-600 font-bold mt-0.5">✓</span>
                    <span>Best for billing counters & kitchen</span>
                  </li>
                </ul>
                <Button className="w-full mt-4" variant="outline" size="lg">
                  Connect to Server
                  <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="text-center text-sm text-gray-500">
            <p>Need help? Contact your system administrator for the server IP address</p>
          </div>
        </div>
      </div>
    );
  }

  // Client Connection Screen
  if (selectedMode === 'client') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <Wifi className="w-8 h-8 text-green-600" />
            </div>
            <CardTitle className="text-center">Connect to Server</CardTitle>
            <CardDescription className="text-center">
              Enter the server PC's IP address to connect
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {notice && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {notice}
              </div>
            )}
            <div className="space-y-2">
              <Label>Server IP Address</Label>
              <Input
                value={serverIp}
                onChange={(e) => setServerIp(e.target.value)}
                placeholder="192.168.31.85"
                className="font-mono"
              />
              <p className="text-xs text-gray-500">
                Find this on the server PC under LAN Settings
              </p>
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
              <div className="grid grid-cols-3 gap-2">
                <Button
                  type="button"
                  variant={deviceType === 'billing' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDeviceType('billing')}
                >
                  Billing
                </Button>
                <Button
                  type="button"
                  variant={deviceType === 'kitchen' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDeviceType('kitchen')}
                >
                  Kitchen
                </Button>
                <Button
                  type="button"
                  variant={deviceType === 'manager' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDeviceType('manager')}
                >
                  Manager
                </Button>
              </div>
            </div>

            <div className="flex gap-2 pt-4">
              <Button variant="outline" onClick={handleBack} className="flex-1">
                Back
              </Button>
              <Button 
                onClick={handleConnect} 
                disabled={connecting || !serverIp}
                className="flex-1"
              >
                {connecting ? 'Connecting...' : 'Connect'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
