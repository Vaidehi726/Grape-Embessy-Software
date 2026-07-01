import React, { createContext, useContext, useEffect, useState } from 'react';
import { localMutate, localQuery } from '@/services/localDataService';

export interface LocalUser {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'manager' | 'waiter' | 'cashier' | 'chef';
  created_at: string;
}

interface AuthContextType {
  user: LocalUser | null;
  loading: boolean;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const CURRENT_USER_KEY = 'restroflow_current_user';
const USERS_TABLE = 'users';

function hashPassword(password: string): string {
  // Simple hash for local auth - not cryptographically secure but sufficient for local use
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString();
}

function cacheUser(user: LocalUser | null) {
  try {
    if (user) {
      localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(CURRENT_USER_KEY);
    }
  } catch { /* localStorage might be unavailable */ }
}

function getCachedUser(): LocalUser | null {
  try {
    const raw = localStorage.getItem(CURRENT_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<LocalUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load cached user on startup
    const cached = getCachedUser();
    if (cached) {
      setUser(cached);
    }
    setLoading(false);
  }, []);

  const signUp = async (email: string, password: string, fullName: string) => {
    try {
      // Check if user already exists
      const existingResult = await localQuery(USERS_TABLE, { email });
      if (existingResult.data && existingResult.data.length > 0) {
        return { error: 'User with this email already exists' };
      }

      // Create new user
      const hashedPassword = hashPassword(password);
      const newUser = {
        id: crypto.randomUUID(),
        email,
        password_hash: hashedPassword,
        full_name: fullName,
        role: 'admin' as const,
        created_at: new Date().toISOString()
      };

      const result = await localMutate(USERS_TABLE, newUser);
      if (result.error) {
        return { error: result.error.message };
      }

      // Auto sign in after signup
      const { password_hash, ...userWithoutPassword } = newUser;
      setUser(userWithoutPassword as LocalUser);
      cacheUser(userWithoutPassword as LocalUser);

      return { error: null };
    } catch (error: any) {
      return { error: error.message || 'Failed to create user' };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const hashedPassword = hashPassword(password);
      
      // Query user by email
      const result = await localQuery(USERS_TABLE, { email });
      if (!result.data || result.data.length === 0) {
        return { error: 'Invalid email or password' };
      }

      const userRecord = result.data[0];
      if (userRecord.password_hash !== hashedPassword) {
        return { error: 'Invalid email or password' };
      }

      // Remove password from user object before caching
      const { password_hash, ...userWithoutPassword } = userRecord;
      setUser(userWithoutPassword as LocalUser);
      cacheUser(userWithoutPassword as LocalUser);

      return { error: null };
    } catch (error: any) {
      return { error: error.message || 'Failed to sign in' };
    }
  };

  const signOut = () => {
    setUser(null);
    cacheUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signUp, signIn, signOut }}>
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
