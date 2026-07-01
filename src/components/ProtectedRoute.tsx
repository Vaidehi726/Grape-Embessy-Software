import { useAuth } from '@/contexts/LocalAuthContext';
import { Navigate, useLocation } from 'react-router-dom';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

function isLanClientMode(): boolean {
  try {
    return localStorage.getItem('lan_mode') === 'client';
  } catch {
    return false;
  }
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // LAN client stations ("slave" billing/kitchen PCs) never log in — the
  // owner/manager account lives on the server PC. Decide this synchronously from
  // the saved mode so a page refresh can't briefly fall through to the login
  // screen while the websocket is still reconnecting. The connection itself is
  // gated in App (it shows "Connecting…" / the IP screen until connected), so by
  // the time these routes render the client is already linked to the server.
  if (isLanClientMode()) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Server PC / standalone: require authentication.
  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
