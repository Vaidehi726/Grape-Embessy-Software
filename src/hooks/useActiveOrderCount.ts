import { useState, useEffect } from 'react';
import { offlineQuery } from '@/services/offlineDataService';

export function useActiveOrderCount(restaurantId: string | undefined) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!restaurantId) {
      setCount(0);
      return;
    }

    const fetchCount = async () => {
      const result = await offlineQuery(
        async () => ({ data: null, error: null }), // No Supabase fallback
        { table: 'orders', filters: { restaurant_id: restaurantId } }
      );

      // Count from local data
      const orders = (result.data || []) as any[];
      const activeCount = orders.filter(o => 
        o.status === 'pending' || 
        o.status === 'cooking' ||
        o.status === 'confirmed' ||
        o.status === 'preparing' ||
        o.status === 'ready'
      ).length;
      setCount(activeCount);
    };

    fetchCount();

    // Poll for updates every 5 seconds (no realtime in local mode)
    const interval = setInterval(fetchCount, 5000);
    return () => clearInterval(interval);
  }, [restaurantId]);

  return count;
}
