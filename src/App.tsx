import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState, useEffect } from 'react';
import { AuthProvider } from "@/contexts/LocalAuthContext";
import { RestaurantProvider } from "@/contexts/RestaurantContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import LanStartup, { LanMode } from "@/components/LanStartup";
import { initializeBillCounter } from "@/services/dailyBillNumber";
import Auth from "./pages/Auth";
import Onboarding from "./pages/Onboarding";
import GlobalSettings from "./pages/GlobalSettings";
import DashboardHome from "./pages/dashboard/DashboardHome";
import Kitchens from "./pages/dashboard/Kitchens";
import Floors from "./pages/dashboard/Floors";
import Menu from "./pages/dashboard/Menu";
import Orders from "./pages/dashboard/Orders";
import KitchenView from "./pages/dashboard/KitchenView";
import OrderKioskUnified from "./pages/dashboard/OrderKioskUnified";
import Settings from "./pages/dashboard/Settings";
import Reports from "./pages/dashboard/Reports";
import Staff from "./pages/dashboard/Staff";
import DataManager from "./pages/dashboard/DataManager";
import Expenses from "./pages/dashboard/Expenses";
import LanSettings from "./pages/LanSettings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

// Use HashRouter for Electron (file:// protocol), BrowserRouter for web
const isElectron = !!(window as any).electronAPI;
const Router = isElectron ? HashRouter : BrowserRouter;

const App = () => {
  const [lanMode, setLanMode] = useState<LanMode>(null);
  const [lanConfig, setLanConfig] = useState<any>(null);
  const [initialized, setInitialized] = useState(false);
  // Client-only connection gate: lanReady = linked to the server at least once
  // this session; lanProbing = a connection attempt is currently in flight.
  const [lanReady, setLanReady] = useState(false);
  const [lanProbing, setLanProbing] = useState(false);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Debug: Log all Ctrl/Cmd key combinations
      if (e.ctrlKey || e.metaKey) {
        console.log('[App Shortcut] Detected:', {
          key: e.key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          target: e.target,
          tagName: (e.target as HTMLElement)?.tagName,
        });
      }
      
      // Ctrl+K or Cmd+K: Navigate to Order Kiosk
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        console.log('[App Shortcut] Ctrl+K triggered!');
        e.preventDefault();
        e.stopPropagation();
        // Navigate using window.location for hash router
        const currentHash = window.location.hash;
        const restaurantSlug = currentHash.match(/\/dashboard\/([^/]+)/);
        if (restaurantSlug) {
          console.log('[App Shortcut] Navigating to order-kiosk');
          window.location.hash = `#/dashboard/${restaurantSlug[1]}/order-kiosk`;
        } else {
          console.warn('[App Shortcut] No restaurant slug found in hash:', currentHash);
        }
      }
    };

    // Use capture phase (true) to intercept before other handlers
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  // Check for saved LAN mode on startup
  useEffect(() => {
    const savedMode = localStorage.getItem('lan_mode') as LanMode;
    const savedConfig = localStorage.getItem('lan_config');
    
    if (savedMode) {
      setLanMode(savedMode);
      if (savedConfig) {
        setLanConfig(JSON.parse(savedConfig));
      }

      // Auto-start networking on boot so a customer never has to click anything:
      // - Server PC: bring the SQLite LAN server up immediately.
      // - Client PC: reconnect to the saved server IP and gate the UI on it.
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.lan) {
        if (savedMode === 'server') {
          electronAPI.lan.startServer()
            .then((r: any) => console.log('[App] LAN server auto-start:', r?.success ? `running on ${r.ip}:${r.port}` : r?.error))
            .catch((err: any) => console.error('[App] LAN server auto-start failed:', err));
        } else if (savedMode === 'client' && savedConfig) {
          // A live connection (onConnected) is the single source of truth for the
          // gate; the auto-reconnect loop in lanClient keeps retrying the saved IP.
          setLanProbing(true);
          electronAPI.lan.connect(JSON.parse(savedConfig))
            .then((r: any) => {
              console.log('[App] LAN client auto-connect:', r?.success ? 'connected' : r?.error);
              if (r?.success) setLanReady(true);
            })
            .catch((err: any) => console.error('[App] LAN client auto-connect failed:', err))
            .finally(() => setLanProbing(false));
        }
      }
    }

    // Initialize daily bill counter by scanning today's orders
    initializeBillCounter().then(() => {
      console.log('[App] Bill counter initialized');
    }).catch(err => {
      console.error('[App] Failed to initialize bill counter:', err);
    });
    
    setInitialized(true);
  }, []);

  // Keep the client connection gate in sync with live websocket events. Once we
  // are connected we mark the session ready and keep the app mounted; a later
  // transient drop does NOT yank the user back to the gate (lanClient auto-
  // reconnects in the background and writes are already blocked while offline),
  // which avoids kicking a cashier out of an in-progress cart on a brief blip.
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.lan?.onConnected) return;
    const offConnected = electronAPI.lan.onConnected(() => {
      setLanReady(true);
      setLanProbing(false);
    });
    return () => { offConnected?.(); };
  }, []);

  // Handle LAN mode selection
  const handleModeSelect = async (mode: LanMode, config?: any) => {
    if (!mode) return;

    // Save mode to localStorage
    localStorage.setItem('lan_mode', mode);
    
    if (mode === 'client' && config) {
      localStorage.setItem('lan_config', JSON.stringify(config));
      setLanConfig(config);

      // Try to connect to LAN server
      try {
        const electronAPI = (window as any).electronAPI;
        if (electronAPI?.lan) {
          console.log('[App] Connecting to LAN server:', config.serverHost);
          setLanProbing(true);
          const result = await electronAPI.lan.connect(config);

          if (result.success) {
            console.log('[App] Successfully connected to LAN server');
            setLanReady(true);
          } else {
            console.error('[App] Failed to connect to LAN server:', result.error);
            setLanReady(false);
          }
          setLanProbing(false);
        }
      } catch (err) {
        console.error('[App] LAN connection error:', err);
        setLanProbing(false);
      }
    } else if (mode === 'server') {
      // Clear client config if switching to server mode
      localStorage.removeItem('lan_config');
      setLanConfig(null);

      // Start the SQLite LAN server right away so other PCs can connect.
      try {
        const electronAPI = (window as any).electronAPI;
        if (electronAPI?.lan) {
          const result = await electronAPI.lan.startServer();
          console.log('[App] LAN server start:', result?.success ? `running on ${result.ip}:${result.port}` : result?.error);
        }
      } catch (err) {
        console.error('[App] LAN server start error:', err);
      }
    }

    setLanMode(mode);
  };

  // Show LAN startup screen if not initialized
  if (!initialized) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Show LAN mode selection if not set
  if (!lanMode && isElectron) {
    return <LanStartup onModeSelect={handleModeSelect} />;
  }

  // Client station: don't render the app (or the login route) until we're linked
  // to the server. If the saved IP is reachable this is a brief "Connecting…"
  // flash; if it's unreachable/changed, show the IP screen (pre-filled) so the
  // user can update + save a new IP — never the login screen.
  if (isElectron && lanMode === 'client' && !lanReady) {
    if (lanProbing) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-100 p-4">
          <div className="text-center space-y-4 max-w-sm">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600 mx-auto"></div>
            <h1 className="text-xl font-semibold text-gray-900">Connecting to server…</h1>
            <p className="text-gray-600">
              {lanConfig?.serverHost ? `Reaching ${lanConfig.serverHost}` : 'Linking to the main PC'}
            </p>
            <button onClick={() => setLanProbing(false)} className="text-sm text-green-700 underline">
              Change server IP
            </button>
          </div>
        </div>
      );
    }
    return (
      <LanStartup
        onModeSelect={handleModeSelect}
        initialMode="client"
        initialServerIp={lanConfig?.serverHost || ''}
        notice={`Couldn't reach the server${lanConfig?.serverHost ? ` at ${lanConfig.serverHost}` : ''}. Check the IP address and reconnect.`}
      />
    );
  }

  return (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <RestaurantProvider>
          <Toaster />
          <Sonner />
          <Router>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
              
              {/* Global Settings - No restaurant required */}
              <Route path="/settings" element={<GlobalSettings />} />
              
              {/* Dashboard routes with restaurant slug */}
              <Route path="/dashboard" element={<ProtectedRoute><DashboardHome /></ProtectedRoute>} />
              <Route path="/dashboard/:slug" element={<ProtectedRoute><DashboardHome /></ProtectedRoute>} />
              <Route path="/dashboard/:slug/kitchens" element={<ProtectedRoute><Kitchens /></ProtectedRoute>} />
              <Route path="/dashboard/:slug/floors" element={<ProtectedRoute><Floors /></ProtectedRoute>} />
              <Route path="/dashboard/:slug/menu" element={<ProtectedRoute><Menu /></ProtectedRoute>} />
              <Route path="/dashboard/:slug/orders" element={<ProtectedRoute><Orders /></ProtectedRoute>} />
              <Route path="/dashboard/:slug/kitchen-view" element={<ProtectedRoute><KitchenView /></ProtectedRoute>} />
              <Route path="/dashboard/:slug/order-kiosk" element={<ProtectedRoute><OrderKioskUnified /></ProtectedRoute>} />
              <Route path="/dashboard/:slug/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
              <Route path="/dashboard/:slug/expenses" element={<ProtectedRoute><Expenses /></ProtectedRoute>} />
              <Route path="/dashboard/:slug/staff" element={<ProtectedRoute><Staff /></ProtectedRoute>} />
              <Route path="/dashboard/:slug/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
              <Route path="/dashboard/:slug/data" element={<ProtectedRoute><DataManager /></ProtectedRoute>} />
              <Route path="/dashboard/:slug/lan-settings" element={<ProtectedRoute><LanSettings /></ProtectedRoute>} />
              
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Router>
        </RestaurantProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
  );
};

export default App;