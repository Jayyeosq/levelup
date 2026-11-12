// Accounts: sign up with email + username + password; log in with email OR username.
// Other users only ever see usernames. Username login runs on the server
// (supabase/functions/auth-login) so the email behind a username is never revealed.
import type { Session } from '@supabase/supabase-js';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, SUPABASE_KEY, SUPABASE_URL, supabaseReady } from './supabase';

export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

type AuthCtx = {
  loading: boolean;
  session: Session | null;
  userId: string | null;
  email: string | null; // your own email — only ever shown to you
  signUp: (email: string, username: string, password: string) => Promise<'signed_in' | 'confirm_email'>;
  signIn: (emailOrUsername: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Emails a reset code. */
  sendReset: (email: string) => Promise<void>;
  /** Checks the emailed code, sets the new password and logs you in. */
  resetPassword: (email: string, code: string, password: string) => Promise<void>;
};
const Ctx = createContext<AuthCtx | null>(null);

const friendly = (m?: string) => {
  if (!m) return 'Something went wrong. Please try again.';
  if (/invalid login credentials/i.test(m)) return 'Wrong email/username or password.';
  if (/already registered|already exists/i.test(m)) return 'That email already has an account. Try logging in.';
  if (/password should be at least/i.test(m)) return 'Password must be at least 8 characters.';
  if (/email not confirmed/i.test(m)) return 'Please confirm your email first (check your inbox).';
  if (/database error saving new user/i.test(m)) return 'That username was just taken. Pick another.';
  return m;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabaseReady) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthCtx>(() => ({
    loading, session, userId: session?.user.id ?? null, email: session?.user.email ?? null,

    async signUp(email, username, password) {
      if (!supabaseReady) throw new Error('The app is not connected to the server yet.');
      if (!USERNAME_RE.test(username)) throw new Error('Username: 3–20 letters, numbers or _ only.');
      if (password.length < 8) throw new Error('Password must be at least 8 characters.');
      const { data: free, error: e1 } = await supabase.rpc('username_available', { u: username });
      if (e1) throw new Error(friendly(e1.message));
      if (!free) throw new Error('That username is taken. Pick another.');
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { username } } });
      if (error) throw new Error(friendly(error.message));
      return data.session ? 'signed_in' : 'confirm_email';
    },

    async signIn(id, password) {
      if (!supabaseReady) throw new Error('The app is not connected to the server yet.');
      const ident = id.trim();
      if (ident.includes('@')) {
        const { error } = await supabase.auth.signInWithPassword({ email: ident, password });
        if (error) throw new Error(friendly(error.message));
        return;
      }
      const res = await fetch(`${SUPABASE_URL}/functions/v1/auth-login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
        body: JSON.stringify({ username: ident, password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.access_token) throw new Error(j.error ?? 'Wrong email/username or password.');
      const { error } = await supabase.auth.setSession({ access_token: j.access_token, refresh_token: j.refresh_token });
      if (error) throw new Error(friendly(error.message));
    },

    async signOut() { await supabase.auth.signOut(); },

    async sendReset(email) {
      if (!supabaseReady) throw new Error('The app is not connected to the server yet.');
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) throw new Error('Enter the email you signed up with.');
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (error) throw new Error(/rate limit|security purposes/i.test(error.message) ? 'Please wait a minute before asking for another code.' : friendly(error.message));
    },

    async resetPassword(email, code, password) {
      if (!supabaseReady) throw new Error('The app is not connected to the server yet.');
      if (!/^\d{6,10}$/.test(code.trim())) throw new Error('Enter the code from the email (numbers only).');
      if (password.length < 8) throw new Error('Password must be at least 8 characters.');
      // A correct code logs you in; then the new password is saved.
      const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'recovery' });
      if (error) throw new Error(/expired|invalid/i.test(error.message) ? 'That code is wrong or has expired. Ask for a new one.' : friendly(error.message));
      const { error: e2 } = await supabase.auth.updateUser({ password });
      if (e2 && !/different from the old/i.test(e2.message)) throw new Error(friendly(e2.message));
    },
  }), [loading, session]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be inside AuthProvider');
  return c;
}
