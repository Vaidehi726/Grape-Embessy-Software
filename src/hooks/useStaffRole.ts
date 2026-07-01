import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Database } from '@/integrations/supabase/types';

type StaffRole = Database['public']['Enums']['staff_role'];

interface StaffMemberInfo {
  id: string;
  restaurant_id: string;
  role: StaffRole;
  full_name: string;
  email: string;
  is_active: boolean;
}

interface UseStaffRoleResult {
  staffInfo: StaffMemberInfo | null;
  staffRestaurants: { id: string; name: string; slug: string; role: StaffRole }[];
  loading: boolean;
  isOwner: boolean;
  isManager: boolean;
  isWaiter: boolean;
  isChef: boolean;
  hasManagementAccess: boolean;
  refreshStaffInfo: () => Promise<void>;
}

export function useStaffRole(): UseStaffRoleResult {
  const { user } = useAuth();
  const [staffInfo, setStaffInfo] = useState<StaffMemberInfo | null>(null);
  const [staffRestaurants, setStaffRestaurants] = useState<{ id: string; name: string; slug: string; role: StaffRole }[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStaffInfo = async () => {
    if (!user) {
      setStaffInfo(null);
      setStaffRestaurants([]);
      setLoading(false);
      return;
    }

    try {
      // First, try to link account if email matches an unlinked staff member
      const { data: unlinkedStaff } = await supabase
        .from('staff_members')
        .select('id')
        .eq('email', user.email || '')
        .is('user_id', null)
        .limit(1);

      if (unlinkedStaff && unlinkedStaff.length > 0) {
        // Link all staff records with this email to the user
        await supabase
          .from('staff_members')
          .update({ user_id: user.id, joined_at: new Date().toISOString() })
          .eq('email', user.email || '')
          .is('user_id', null);
      }

      // Fetch all staff memberships for this user
      const { data: staffData, error } = await supabase
        .from('staff_members')
        .select(`
          id,
          restaurant_id,
          role,
          full_name,
          email,
          is_active,
          restaurants (
            id,
            name,
            slug
          )
        `)
        .eq('user_id', user.id)
        .eq('is_active', true);

      if (error) throw error;

      if (staffData && staffData.length > 0) {
        // Set the first staff info
        const firstStaff = staffData[0];
        setStaffInfo({
          id: firstStaff.id,
          restaurant_id: firstStaff.restaurant_id,
          role: firstStaff.role,
          full_name: firstStaff.full_name,
          email: firstStaff.email,
          is_active: firstStaff.is_active,
        });

        // Build list of restaurants with roles
        const restaurants = staffData
          .filter(s => s.restaurants)
          .map(s => ({
            id: (s.restaurants as any).id,
            name: (s.restaurants as any).name,
            slug: (s.restaurants as any).slug,
            role: s.role,
          }));
        setStaffRestaurants(restaurants);
      } else {
        setStaffInfo(null);
        setStaffRestaurants([]);
      }
    } catch (error) {
      console.error('Error fetching staff info:', error);
      setStaffInfo(null);
      setStaffRestaurants([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStaffInfo();
  }, [user]);

  const role = staffInfo?.role;

  return {
    staffInfo,
    staffRestaurants,
    loading,
    isOwner: role === 'owner',
    isManager: role === 'manager',
    isWaiter: role === 'waiter',
    isChef: role === 'chef',
    hasManagementAccess: role === 'owner' || role === 'manager',
    refreshStaffInfo: fetchStaffInfo,
  };
}

// Hook to get staff role for a specific restaurant
export function useStaffRoleForRestaurant(restaurantId: string | undefined): {
  role: StaffRole | null;
  loading: boolean;
  isOwner: boolean;
  isManager: boolean;
  isWaiter: boolean;
  isChef: boolean;
  hasManagementAccess: boolean;
} {
  const { user } = useAuth();
  const [role, setRole] = useState<StaffRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRole = async () => {
      if (!user || !restaurantId) {
        setRole(null);
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('staff_members')
          .select('role')
          .eq('user_id', user.id)
          .eq('restaurant_id', restaurantId)
          .eq('is_active', true)
          .maybeSingle();

        if (error) throw error;
        setRole(data?.role || null);
      } catch (error) {
        console.error('Error fetching staff role:', error);
        setRole(null);
      } finally {
        setLoading(false);
      }
    };

    fetchRole();
  }, [user, restaurantId]);

  return {
    role,
    loading,
    isOwner: role === 'owner',
    isManager: role === 'manager',
    isWaiter: role === 'waiter',
    isChef: role === 'chef',
    hasManagementAccess: role === 'owner' || role === 'manager',
  };
}
