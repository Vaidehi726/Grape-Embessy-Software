import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { offlineQuery } from '@/services/offlineDataService';
import { useToast } from '@/hooks/use-toast';

export type StaffRole = 'owner' | 'manager' | 'waiter' | 'chef';

export interface StaffMember {
  id: string;
  restaurant_id: string;
  user_id: string | null;
  email: string;
  full_name: string;
  phone: string | null;
  role: StaffRole;
  is_active: boolean;
  invited_at: string | null;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Shift {
  id: string;
  restaurant_id: string;
  staff_member_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  staff_member?: StaffMember;
}

export function useStaffMembers(restaurantId: string | undefined) {
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchStaffMembers = useCallback(async () => {
    if (!restaurantId) {
      setStaffMembers([]);
      setLoading(false);
      return;
    }

    try {
      const result = await offlineQuery(
        async () => {
          const res = await supabase
            .from('staff_members')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .order('role', { ascending: true })
            .order('full_name', { ascending: true });
          return res;
        },
        { table: 'staff_members', filters: { restaurant_id: restaurantId } }
      );

      if (result.error && !result.fromCache) throw result.error;
      setStaffMembers(((result.data || []) as StaffMember[]));
    } catch (error: any) {
      console.error('Error fetching staff members:', error);
      toast({
        title: 'Error',
        description: 'Failed to load staff members',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [restaurantId, toast]);

  useEffect(() => {
    fetchStaffMembers();
  }, [fetchStaffMembers]);

  const addStaffMember = async (data: {
    email: string;
    full_name: string;
    phone?: string;
    role: StaffRole;
  }) => {
    if (!restaurantId) return { error: new Error('No restaurant selected') };

    try {
      const { error } = await supabase.from('staff_members').insert({
        restaurant_id: restaurantId,
        email: data.email,
        full_name: data.full_name,
        phone: data.phone || null,
        role: data.role,
      });

      if (error) throw error;
      await fetchStaffMembers();
      return { error: null };
    } catch (error: any) {
      return { error };
    }
  };

  const updateStaffMember = async (id: string, data: Partial<StaffMember>) => {
    try {
      const { error } = await supabase
        .from('staff_members')
        .update(data)
        .eq('id', id);

      if (error) throw error;
      await fetchStaffMembers();
      return { error: null };
    } catch (error: any) {
      return { error };
    }
  };

  const deleteStaffMember = async (id: string) => {
    try {
      const { error } = await supabase
        .from('staff_members')
        .delete()
        .eq('id', id);

      if (error) throw error;
      await fetchStaffMembers();
      return { error: null };
    } catch (error: any) {
      return { error };
    }
  };

  return {
    staffMembers,
    loading,
    fetchStaffMembers,
    addStaffMember,
    updateStaffMember,
    deleteStaffMember,
  };
}

export function useShifts(restaurantId: string | undefined) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchShifts = useCallback(async (startDate?: string, endDate?: string) => {
    if (!restaurantId) {
      setShifts([]);
      setLoading(false);
      return;
    }

    try {
      let query = supabase
        .from('shifts')
        .select('*, staff_member:staff_members(*)')
        .eq('restaurant_id', restaurantId)
        .order('shift_date', { ascending: true })
        .order('start_time', { ascending: true });

      if (startDate) {
        query = query.gte('shift_date', startDate);
      }
      if (endDate) {
        query = query.lte('shift_date', endDate);
      }

      const { data, error } = await query;

      if (error) throw error;
      setShifts((data || []) as Shift[]);
    } catch (error: any) {
      console.error('Error fetching shifts:', error);
      toast({
        title: 'Error',
        description: 'Failed to load shifts',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [restaurantId, toast]);

  useEffect(() => {
    fetchShifts();
  }, [fetchShifts]);

  const addShift = async (data: {
    staff_member_id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    notes?: string;
  }) => {
    if (!restaurantId) return { error: new Error('No restaurant selected') };

    try {
      const { error } = await supabase.from('shifts').insert({
        restaurant_id: restaurantId,
        staff_member_id: data.staff_member_id,
        shift_date: data.shift_date,
        start_time: data.start_time,
        end_time: data.end_time,
        notes: data.notes || null,
      });

      if (error) throw error;
      await fetchShifts();
      return { error: null };
    } catch (error: any) {
      return { error };
    }
  };

  const updateShift = async (id: string, data: Partial<Shift>) => {
    try {
      const { error } = await supabase
        .from('shifts')
        .update(data)
        .eq('id', id);

      if (error) throw error;
      await fetchShifts();
      return { error: null };
    } catch (error: any) {
      return { error };
    }
  };

  const deleteShift = async (id: string) => {
    try {
      const { error } = await supabase.from('shifts').delete().eq('id', id);

      if (error) throw error;
      await fetchShifts();
      return { error: null };
    } catch (error: any) {
      return { error };
    }
  };

  return {
    shifts,
    loading,
    fetchShifts,
    addShift,
    updateShift,
    deleteShift,
  };
}
