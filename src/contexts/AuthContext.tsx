import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { initializeSync, stopSync, isOffline } from '@/services/offlineDataService';

const CACHED_USER_KEY = 'restroflow_cached_user';

function cacheUser(user: User | null) {
  try {
    if (user) {
      localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    }
    // Don't remove on null - keep cached for offline use
  } catch { /* localStorage might be unavailable */ }
}

function getCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function clearCachedUser() {
  try { localStorage.removeItem(CACHED_USER_KEY); } catch {}
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // When offline and session expires, Supabase may fire TOKEN_REFRESHED with null session
        // or SIGNED_OUT. Don't clear user if we're offline - use cached user instead.
        if (!session && isOffline()) {
          const cached = getCachedUser();
          if (cached && event !== 'SIGNED_OUT') {
            console.log('[Auth] Ignoring null session while offline, using cached user');
            setUser(cached);
            setLoading(false);
            return;
          }
        }

        setSession(session);
        const u = session?.user ?? null;
        setUser(u);
        if (u) cacheUser(u);
        setLoading(false);

        // Start/stop sync engine based on auth state
        if (session?.access_token) {
          initializeSync(session.access_token).catch(console.error);
        } else {
          stopSync().catch(console.error);
        }

        // Explicit sign out → clear cached user
        if (event === 'SIGNED_OUT') {
          clearCachedUser();
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      const u = session?.user ?? null;
      if (u) {
        setUser(u);
        cacheUser(u);
      } else if (isOffline()) {
        // Offline with expired/missing session: use cached user
        const cached = getCachedUser();
        if (cached) {
          console.log('[Auth] Using cached user for offline mode');
          setUser(cached);
        }
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, fullName: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
        },
      },
    });
    return { error: error as Error | null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
