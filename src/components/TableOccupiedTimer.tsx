import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

interface TableOccupiedTimerProps {
  occupiedSince: string | null; // ISO timestamp
  className?: string;
}

export function TableOccupiedTimer({ occupiedSince, className = '' }: TableOccupiedTimerProps) {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    if (!occupiedSince) {
      setElapsed('');
      return;
    }

    const calculateElapsed = () => {
      const start = new Date(occupiedSince).getTime();
      const now = Date.now();
      const diff = Math.max(0, now - start);

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      if (hours > 0) {
        return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
      }
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    setElapsed(calculateElapsed());

    const interval = setInterval(() => {
      setElapsed(calculateElapsed());
    }, 1000);

    return () => clearInterval(interval);
  }, [occupiedSince]);

  if (!occupiedSince || !elapsed) return null;

  return (
    <div className={`flex items-center gap-1 text-xs text-destructive font-medium ${className}`}>
      <Clock className="w-3 h-3" />
      <span>{elapsed}</span>
    </div>
  );
}
