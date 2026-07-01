import { ReactNode, useState, useEffect } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/LocalAuthContext';
import { useRestaurant } from '@/contexts/RestaurantContext';
import { useActiveOrderCount } from '@/hooks/useActiveOrderCount';
import { isElectron } from '@/services/printerBridge';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  UtensilsCrossed,
  LayoutDashboard,
  ChefHat,
  Layers,
  BookOpen,
  ShoppingBag,
  LogOut,
  ChevronDown,
  Plus,
  Menu,
  X,
  Settings as SettingsIcon,
  Building2,
  Monitor,
  BarChart3,
  Users,
  Database as DatabaseIcon,
  Wallet,
  Wifi,
  WifiOff,
  RefreshCw,
  Network,
  Columns,
  Trash2,
  Eraser,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Database } from '@/integrations/supabase/types';

type StaffRole = Database['public']['Enums']['staff_role'];

interface DashboardLayoutProps {
  children: ReactNode;
}

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles?: StaffRole[]; // If undefined, visible to all
}

const getNavItems = (slug: string): NavItem[] => [
  { href: `/dashboard/${slug}`, label: 'Dashboard', icon: LayoutDashboard },
  { href: `/dashboard/${slug}/order-kiosk`, label: 'Order Kiosk', icon: Monitor, roles: ['owner', 'manager', 'waiter'] },
  { href: `/dashboard/${slug}/kitchens`, label: 'Kitchens', icon: ChefHat, roles: ['owner', 'manager'] },
  { href: `/dashboard/${slug}/floors`, label: 'Floors & Tables', icon: Layers, roles: ['owner', 'manager'] },
  { href: `/dashboard/${slug}/menu`, label: 'Menu', icon: BookOpen, roles: ['owner', 'manager'] },
  { href: `/dashboard/${slug}/orders`, label: 'Orders', icon: ShoppingBag },
  { href: `/dashboard/${slug}/reports`, label: 'Reports', icon: BarChart3, roles: ['owner', 'manager'] },
  { href: `/dashboard/${slug}/expenses`, label: 'Expenses', icon: Wallet, roles: ['owner', 'manager'] },
  { href: `/dashboard/${slug}/staff`, label: 'Staff', icon: Users, roles: ['owner', 'manager'] },
  { href: `/dashboard/${slug}/data`, label: 'Data Manager', icon: DatabaseIcon, roles: ['owner'] },
  { href: `/dashboard/${slug}/settings`, label: 'Settings', icon: SettingsIcon, roles: ['owner'] },
  { href: `/dashboard/${slug}/lan-settings`, label: 'LAN Network', icon: Network, roles: ['owner'] },
  { href: `/dashboard/${slug}/kitchen-view`, label: 'Kitchen View', icon: ChefHat, roles: ['owner', 'manager', 'chef'] },
];

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const { user, signOut } = useAuth();
  const { restaurants, staffRestaurants, currentRestaurant, currentRole, setCurrentRestaurant } = useRestaurant();
  const activeOrderCount = useActiveOrderCount(currentRestaurant?.id);
  const location = useLocation();
  const navigate = useNavigate();
  const { slug } = useParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ isOnline: boolean; pendingCount: number }>({ isOnline: true, pendingCount: 0 });
  const [syncing, setSyncing] = useState(false);
  const [browserOffline, setBrowserOffline] = useState(false);

  // Connectivity tracking (simplified for local mode)
  useEffect(() => {
    // No connectivity tracking needed in local-only mode
    return () => {};
  }, []);

  // Poll pending count (disabled in local mode)
  useEffect(() => {
    // No sync in local mode
  }, []);

  const handleForceSync = async () => {
    // No sync in local mode
    return;
  };

  const handleCleanupOrphaned = async () => {
    // No cleanup needed in local mode
    return;
  };

  const handleClearCache = async () => {
    // Clear cache functionality removed in local-only mode
    return;
  };

  // Sync restaurant from URL slug
  useEffect(() => {
    if (slug && restaurants.length > 0) {
      const restaurant = restaurants.find(r => r.slug === slug);
      if (restaurant && restaurant.id !== currentRestaurant?.id) {
        setCurrentRestaurant(restaurant);
      }
    }
  }, [slug, restaurants, currentRestaurant, setCurrentRestaurant]);

  // Redirect to slug-based URL if on /dashboard without slug
  useEffect(() => {
    if (location.pathname === '/dashboard' && currentRestaurant?.slug) {
      navigate(`/dashboard/${currentRestaurant.slug}`, { replace: true });
    }
  }, [location.pathname, currentRestaurant, navigate]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const handleRestaurantChange = (restaurant: typeof currentRestaurant) => {
    if (restaurant) {
      setCurrentRestaurant(restaurant);
      // Navigate to the same page but with new restaurant slug
      const currentPath = location.pathname;
      const pathParts = currentPath.split('/');
      // Replace old slug with new slug
      if (pathParts.length >= 3 && pathParts[1] === 'dashboard') {
        if (pathParts[2] && restaurants.some(r => r.slug === pathParts[2])) {
          pathParts[2] = restaurant.slug;
          navigate(pathParts.join('/'));
        } else {
          navigate(`/dashboard/${restaurant.slug}`);
        }
      } else {
        navigate(`/dashboard/${restaurant.slug}`);
      }
    }
  };

  // Filter nav items based on role
  const allNavItems = currentRestaurant ? getNavItems(currentRestaurant.slug) : [];
  const navItems = allNavItems.filter(item => {
    if (!item.roles) return true; // Visible to all
    if (!currentRole) return false;
    return item.roles.includes(currentRole);
  });

  // Combine owned restaurants with staff restaurants for selector
  const allRestaurants = [
    ...restaurants.map(r => ({ ...r, role: 'owner' as StaffRole, isOwner: true })),
    ...staffRestaurants.filter(sr => !restaurants.find(r => r.id === sr.id)),
  ];

  return (
    <div className="min-h-screen bg-background flex overflow-x-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-foreground/20 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-50 w-64 bg-gradient-sidebar border-r border-sidebar-border transform transition-transform duration-200 ease-in-out lg:transform-none",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex flex-col gap-2 px-6 py-5 border-b border-sidebar-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-primary flex items-center justify-center shadow-glow">
                <UtensilsCrossed className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg font-bold text-sidebar-foreground">Grape Embassy</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="ml-auto lg:hidden text-sidebar-foreground/70 hover:text-sidebar-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <span className="text-xs text-sidebar-foreground/50 -mt-1">- Dev by NIKOLAINDUSTRY (P) LTD.</span>
          </div>

          {/* Restaurant Selector */}
          <div className="px-4 py-4 border-b border-sidebar-border">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full justify-between text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  <div className="flex items-center gap-2 truncate">
                    <Building2 className="w-4 h-4 shrink-0" />
                    <span className="truncate">
                      {currentRestaurant?.name || 'Select Restaurant'}
                    </span>
                  </div>
                  <ChevronDown className="w-4 h-4 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {allRestaurants.map((restaurant) => (
                  <DropdownMenuItem
                    key={restaurant.id}
                    onClick={() => handleRestaurantChange(restaurant)}
                    className={cn(
                      currentRestaurant?.id === restaurant.id && "bg-accent"
                    )}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span>{restaurant.name}</span>
                      <Badge variant="outline" className="ml-2 text-xs capitalize">
                        {restaurant.role}
                      </Badge>
                    </div>
                  </DropdownMenuItem>
                ))}
                {currentRole === 'owner' && <DropdownMenuSeparator />}
                {currentRole === 'owner' && (
                  <DropdownMenuItem onClick={() => navigate('/onboarding')}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Restaurant
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const isActive = location.pathname === item.href || 
                (item.label === 'Dashboard' && location.pathname === `/dashboard/${currentRestaurant?.slug}`);
              const showBadge = item.label === 'Orders' && activeOrderCount > 0;
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="flex-1">{item.label}</span>
                  {showBadge && (
                    <Badge 
                      variant="destructive" 
                      className="h-5 min-w-5 px-1.5 text-xs font-semibold animate-pulse"
                    >
                      {activeOrderCount}
                    </Badge>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Sync Status (Electron only) */}
          {isElectron() && (
            <div className="px-4 py-2 border-t border-sidebar-border">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2 text-xs text-sidebar-foreground/70">
                  {syncStatus.isOnline ? (
                    <Wifi className="w-3.5 h-3.5 text-green-500" />
                  ) : (
                    <WifiOff className="w-3.5 h-3.5 text-red-500" />
                  )}
                  <span>{syncStatus.isOnline ? 'Online' : 'Offline'}</span>
                  {syncStatus.pendingCount > 0 && (
                    <Badge variant="secondary" className="h-4 text-[10px] px-1">
                      {syncStatus.pendingCount} pending
                    </Badge>
                  )}
                </div>
                <button
                  onClick={handleForceSync}
                  disabled={syncing || !syncStatus.isOnline}
                  className="p-1 rounded hover:bg-sidebar-accent disabled:opacity-50"
                  title="Force sync now"
                >
                  <RefreshCw className={cn("w-3.5 h-3.5 text-sidebar-foreground/70", syncing && "animate-spin")} />
                </button>
                <button
                  onClick={handleCleanupOrphaned}
                  className="p-1 rounded hover:bg-sidebar-accent"
                  title="Clean up orphaned local records"
                >
                  <Trash2 className="w-3.5 h-3.5 text-sidebar-foreground/70 hover:text-red-500" />
                </button>
                <button
                  onClick={handleClearCache}
                  className="p-1 rounded hover:bg-sidebar-accent"
                  title="Clear all cached data (forces re-sync from Supabase)"
                >
                  <Eraser className="w-3.5 h-3.5 text-sidebar-foreground/70 hover:text-orange-500" />
                </button>
              </div>
            </div>
          )}

          {/* User Menu */}
          <div className="p-4 border-t border-sidebar-border">
            <div className="mb-2 px-2">
              <Badge variant="outline" className="text-xs capitalize">
                {currentRole || 'No role'}
              </Badge>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent"
                >
                  <div className="w-8 h-8 rounded-full bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground text-sm font-medium mr-2">
                    {user?.email?.charAt(0).toUpperCase() || 'U'}
                  </div>
                  <span className="truncate text-sm">{user?.email || 'User'}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {/* Global Settings - Always visible */}
                <DropdownMenuItem onClick={() => navigate('/settings')}>
                  <SettingsIcon className="w-4 h-4 mr-2" />
                  Settings
                </DropdownMenuItem>
                
                {currentRole === 'owner' && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate(`/dashboard/${currentRestaurant?.slug}/settings`)}>
                      <SettingsIcon className="w-4 h-4 mr-2" />
                      Restaurant Settings
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate(`/dashboard/${currentRestaurant?.slug}/lan-settings`)}>
                      <Network className="w-4 h-4 mr-2" />
                      LAN Network
                    </DropdownMenuItem>
                  </>
                )}
                
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-screen min-w-0 overflow-hidden">
        {/* Mobile Header */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-card">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg hover:bg-accent"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex flex-col items-center gap-0">
            <div className="flex items-center gap-2">
              <UtensilsCrossed className="w-5 h-5 text-primary" />
              <span className="font-semibold">Grape Embassy</span>
            </div>
            <span className="text-[10px] text-muted-foreground -mt-1">- Dev by NIKOLAINDUSTRY (P) LTD.</span>
          </div>
          <div className="w-9" /> {/* Spacer for centering */}
        </header>

        {/* Offline Banner */}
        {browserOffline && (
          <div className="bg-yellow-500/90 text-yellow-950 px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2">
            <WifiOff className="w-4 h-4" />
            Offline Mode - Using cached data. Changes will sync when connection is restored.
          </div>
        )}

        {/* Page Content */}
        <div className={cn(
          "flex-1 overflow-auto min-w-0",
          location.pathname.includes('/order-kiosk') || location.pathname.includes('/kitchen-view')
            ? "p-0 overflow-hidden"
            : "p-4 lg:p-8"
        )}>
          {children}
        </div>
      </main>
    </div>
  );
}