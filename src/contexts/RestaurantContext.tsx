import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth, LocalUser } from './LocalAuthContext';
import { toast } from 'sonner';
import { offlineQuery, offlineMutate, isElectron } from '@/services/offlineDataService';

const CACHED_RESTAURANT_KEY = 'restroflow_current_restaurant';
const CACHED_ROLE_KEY = 'restroflow_current_role';

type StaffRole = 'owner' | 'manager' | 'waiter' | 'cashier' | 'chef' | 'host' | 'runner';

interface Restaurant {
  id: string;
  name: string;
  print_qr_on_bill?: boolean | null;
  payment_qr_content?: string | null;
  lock_saved_items?: boolean | null;
  slug: string;
  address: string | null;
  phone: string | null;
  gstin: string | null;
  cgst_percentage: number | null;
  sgst_percentage: number | null;
  created_at: string;
}

interface StaffRestaurant extends Restaurant {
  role: StaffRole;
  isOwner: boolean;
}

interface RestaurantContextType {
  restaurants: Restaurant[];
  staffRestaurants: StaffRestaurant[];
  currentRestaurant: Restaurant | null;
  currentRole: StaffRole | null;
  setCurrentRestaurant: (restaurant: Restaurant | null) => void;
  loading: boolean;
  createRestaurant: (name: string, address?: string, phone?: string, gstin?: string) => Promise<Restaurant | null>;
  refreshRestaurants: () => Promise<void>;
  isOwner: boolean;
  isManager: boolean;
  hasManagementAccess: boolean;
}

const RestaurantContext = createContext<RestaurantContextType | undefined>(undefined);

export function RestaurantProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [staffRestaurants, setStaffRestaurants] = useState<StaffRestaurant[]>([]);
  const [currentRestaurant, setCurrentRestaurantState] = useState<Restaurant | null>(null);
  const [currentRole, setCurrentRoleState] = useState<StaffRole | null>(null);
  const [loading, setLoading] = useState(true);

  // Wrapper to persist currentRestaurant to localStorage
  const setCurrentRestaurant = (restaurant: Restaurant | null) => {
    setCurrentRestaurantState(restaurant);
    try {
      if (restaurant) {
        localStorage.setItem(CACHED_RESTAURANT_KEY, JSON.stringify(restaurant));
      } else {
        localStorage.removeItem(CACHED_RESTAURANT_KEY);
      }
    } catch {}
  };

  const setCurrentRole = (role: StaffRole | null) => {
    setCurrentRoleState(role);
    try {
      if (role) {
        localStorage.setItem(CACHED_ROLE_KEY, role);
      } else {
        localStorage.removeItem(CACHED_ROLE_KEY);
      }
    } catch {}
  };

  const fetchRestaurants = async () => {
    // Check if we're in LAN client mode
    const lan = (window as any).electronAPI?.lan;
    const isLanClient = lan && (await lan.clientStatus()).connected;

    if (!user && !isLanClient) {
      // No user and not LAN client - try to restore from localStorage
      try {
        const cachedRest = localStorage.getItem(CACHED_RESTAURANT_KEY);
        const cachedRole = localStorage.getItem(CACHED_ROLE_KEY) as StaffRole | null;
        if (cachedRest) {
          const rest = JSON.parse(cachedRest) as Restaurant;
          setRestaurants([rest]);
          const staffRest: StaffRestaurant = { ...rest, role: cachedRole || 'owner', isOwner: true };
          setStaffRestaurants([staffRest]);
          setCurrentRestaurantState(rest);
          setCurrentRoleState(cachedRole || 'owner');
          console.log('[RestaurantContext] Restored restaurant from localStorage (no user)');
        }
      } catch {}
      setLoading(false);
      return;
    }

    // LAN client mode - fetch restaurant data from LAN server
    if (isLanClient) {
      console.log('[RestaurantContext] ====== LAN CLIENT MODE ======');
      try {
        const result = await lan.query('restaurants', {});
        
        if (result.success && result.data && result.data.length > 0) {
          const restaurants = result.data as Restaurant[];
          setRestaurants(restaurants);
          
          const staffRests: StaffRestaurant[] = restaurants.map(r => ({
            ...r,
            role: 'manager' as StaffRole,
            isOwner: false,
          }));
          setStaffRestaurants(staffRests);
          
          if (restaurants.length > 0) {
            setCurrentRestaurant(restaurants[0]);
            setCurrentRole('manager');
            console.log('[RestaurantContext] ✓ Successfully loaded', restaurants.length, 'restaurants from LAN server');
          }
        } else {
          console.error('[RestaurantContext] ✗ No restaurants found on LAN server');
        }
      } catch (err) {
        console.error('[RestaurantContext] ✗ Failed to fetch restaurants from LAN:', err);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Local mode - fetch from local SQLite
    console.log('[RestaurantContext] ====== LOCAL MODE ======');
    console.log('[RestaurantContext] User:', user?.id);

    try {
      // Load restaurants from local SQLite
      const ownedResult = await offlineQuery(
        async () => ({ data: null, error: null }), // No Supabase fallback
        { table: 'restaurants', filters: {} }
      );

      const ownedData = ownedResult.data || [];
      console.log('[RestaurantContext] Loaded', ownedData.length, 'restaurants from local database');
      if (ownedData.length > 0) {
        console.log('[RestaurantContext] First restaurant payment_qr_content:', (ownedData[0] as any).payment_qr_content);
      }

      // Build staff restaurants from owned restaurants
      const staffRests: StaffRestaurant[] = ownedData.map(r => ({
        ...r,
        role: 'owner' as StaffRole,
        isOwner: true,
        cgst_percentage: r.cgst_percentage ?? null,
        sgst_percentage: r.sgst_percentage ?? null,
      }));

      setRestaurants(ownedData as Restaurant[]);
      setStaffRestaurants(staffRests);

      // Try to restore cached restaurant
      try {
        const cachedRest = localStorage.getItem(CACHED_RESTAURANT_KEY);
        const cachedRole = localStorage.getItem(CACHED_ROLE_KEY) as StaffRole | null;
        if (cachedRest) {
          const rest = JSON.parse(cachedRest) as Restaurant;
          const exists = ownedData.some((r: Restaurant) => r.id === rest.id);
          if (exists) {
            // Merge cached restaurant with fresh database data to ensure we have latest payment_qr_content
            const freshData = ownedData.find((r: Restaurant) => r.id === rest.id);
            const mergedRest = freshData ? { ...rest, ...freshData } : rest;
            console.log('[RestaurantContext] Restoring from cache - payment_qr_content:', (mergedRest as any).payment_qr_content);
            setCurrentRestaurantState(mergedRest);
            setCurrentRoleState(cachedRole || 'owner');
            // Update cache with merged data
            localStorage.setItem(CACHED_RESTAURANT_KEY, JSON.stringify(mergedRest));
          }
        }
      } catch {}

      // Auto-select first restaurant if none selected
      if (!currentRestaurant && ownedData.length > 0) {
        const first = ownedData[0] as Restaurant;
        console.log('[RestaurantContext] Auto-selecting first restaurant - payment_qr_content:', (first as any).payment_qr_content);
        setCurrentRestaurant(first);
        setCurrentRole('owner');
        // Cache the auto-selected restaurant
        localStorage.setItem(CACHED_RESTAURANT_KEY, JSON.stringify(first));
      }

      console.log('[RestaurantContext] ✓ Loaded', ownedData.length, 'restaurants');
    } catch (err: any) {
      console.error('[RestaurantContext] Failed to fetch restaurants:', err);
    } finally {
      setLoading(false);
    }
  };

  // Update role when current restaurant changes
  useEffect(() => {
    if (currentRestaurant) {
      const staffRest = staffRestaurants.find(r => r.id === currentRestaurant.id);
      if (staffRest) {
        setCurrentRole(staffRest.role);
      } else if (restaurants.find(r => r.id === currentRestaurant.id)) {
        setCurrentRole('owner');
      }
    }
  }, [currentRestaurant, staffRestaurants, restaurants]);

  useEffect(() => {
    fetchRestaurants();
  }, [user]);

  // Re-fetch when LAN connection status changes
  useEffect(() => {
    const lan = (window as any).electronAPI?.lan;
    if (!lan) return;

    const handleConnected = () => {
      console.log('[RestaurantContext] LAN connected - fetching restaurants');
      fetchRestaurants();
    };

    const unsubConnected = lan.onConnected(handleConnected);
    
    return () => {
      unsubConnected();
    };
  }, []);

  const createRestaurant = async (
    name: string,
    address?: string,
    phone?: string,
    gstin?: string,
  ) => {
    try {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      
      const newRestaurant = {
        id: crypto.randomUUID(),
        name,
        slug,
        address: address || null,
        phone: phone || null,
        gstin: gstin || null,
        cgst_percentage: 9,
        sgst_percentage: 9,
        owner_id: user?.id || 'local-user',
        created_at: new Date().toISOString(),
      };

      const result = await offlineMutate('restaurants', newRestaurant);
      
      if (result.error) {
        toast.error('Failed to create restaurant: ' + result.error.message);
        return null;
      }

      const restaurant = result.data as Restaurant;
      
      // Add to state
      setRestaurants(prev => [...prev, restaurant]);
      const staffRest: StaffRestaurant = { ...restaurant, role: 'owner', isOwner: true };
      setStaffRestaurants(prev => [...prev, staffRest]);
      setCurrentRestaurant(restaurant);
      setCurrentRole('owner');

      toast.success('Restaurant created successfully!');
      return restaurant;
    } catch (error: any) {
      console.error('[RestaurantContext] Create restaurant error:', error);
      toast.error('Failed to create restaurant');
      return null;
    }
  };

  const refreshRestaurants = async () => {
    await fetchRestaurants();
  };

  const isOwner = currentRole === 'owner';
  const isManager = currentRole === 'manager';
  const hasManagementAccess = isOwner || isManager;

  return (
    <RestaurantContext.Provider
      value={{
        restaurants,
        staffRestaurants,
        currentRestaurant,
        currentRole,
        setCurrentRestaurant,
        loading,
        createRestaurant,
        refreshRestaurants,
        isOwner,
        isManager,
        hasManagementAccess,
      }}
    >
      {children}
    </RestaurantContext.Provider>
  );
}

export function useRestaurant() {
  const context = useContext(RestaurantContext);
  if (context === undefined) {
    throw new Error('useRestaurant must be used within a RestaurantProvider');
  }
  return context;
}
