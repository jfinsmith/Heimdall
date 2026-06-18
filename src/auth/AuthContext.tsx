/**
 * AuthContext — wraps Firebase Auth and the user's Firestore profile.
 *
 * On first sign-in we create the `users/{uid}` doc with role:'instructor',
 * status:'pending' (per RBAC policy). The custom claim is set later by an
 * admin via the `setUserRole` callable; we force-refresh the ID token when
 * the profile's role changes so rules pick it up promptly.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  reauthenticateWithCredential,
  updatePassword,
  EmailAuthProvider,
  signOut as fbSignOut,
  User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from '../lib/firebase';
import type { Role, UserDoc } from '../types';

interface AuthState {
  firebaseUser: FirebaseUser | null;
  /** Firestore profile (null until loaded / while signed out). */
  profile: (UserDoc & { id: string }) | null;
  role: Role | null;
  /** Tenant the signed-in user belongs to (null until backfilled/provisioned). */
  orgId: string | null;
  /** Product owner — cross-org platform access. */
  platformOwner: boolean;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  /** Reauthenticate with the current password, then set a new one. Clears any
   * forced-change flag. Throws Firebase auth errors (wrong-password, weak, etc.). */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

async function ensureUserDoc(user: FirebaseUser, displayName?: string): Promise<void> {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  const profile: Omit<UserDoc, 'createdAt' | 'updatedAt'> & { createdAt: unknown; updatedAt: unknown } = {
    email: user.email ?? '',
    displayName: displayName || user.displayName || user.email?.split('@')[0] || 'New User',
    photoURL: user.photoURL ?? '',
    phone: '',
    rank: '',
    agency: '',
    role: 'instructor',   // self-registered users start at the bottom of the chain
    status: 'pending',    // requires admin approval before active
    qualifications: [],
    verifiedQualKeys: [],
    notificationPrefs: { email: true, reminderLeadHours: 48, digest: true },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, profile);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<(UserDoc & { id: string }) | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setProfile(null);
        setLoading(false);
      }
    });
  }, []);

  // Live-subscribe to the profile doc once signed in.
  useEffect(() => {
    if (!firebaseUser) return;
    const unsub = onSnapshot(doc(db, 'users', firebaseUser.uid), async (snap) => {
      if (snap.exists()) {
        const data = snap.data() as UserDoc;
        setProfile({ id: snap.id, ...data });
        // Refresh the token when any claim that rules depend on (role, orgId,
        // platformOwner) is stale vs the profile — e.g. right after the org
        // backfill mints an orgId claim, so the session isn't locked out for up
        // to an hour waiting for the claim to propagate.
        const token = await firebaseUser.getIdTokenResult();
        const claimMismatch =
          token.claims.role !== data.role ||
          (token.claims.orgId ?? null) !== (data.orgId ?? null) ||
          !!token.claims.platformOwner !== (data.platformOwner === true);
        if (claimMismatch) {
          await firebaseUser.getIdToken(true);
        }
      } else {
        await ensureUserDoc(firebaseUser);
      }
      setLoading(false);
    });
    return unsub;
  }, [firebaseUser]);

  const value: AuthState = {
    firebaseUser,
    profile,
    role: profile?.role ?? null,
    orgId: profile?.orgId ?? null,
    platformOwner: profile?.platformOwner === true,
    loading,
    signInWithGoogle: async () => {
      const cred = await signInWithPopup(auth, googleProvider);
      await ensureUserDoc(cred.user);
    },
    signInWithEmail: async (email, password) => {
      await signInWithEmailAndPassword(auth, email, password);
    },
    registerWithEmail: async (email, password, displayName) => {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await ensureUserDoc(cred.user, displayName);
    },
    resetPassword: (email) => sendPasswordResetEmail(auth, email),
    changePassword: async (currentPassword, newPassword) => {
      const user = auth.currentUser;
      if (!user || !user.email) throw new Error('You must be signed in to change your password.');
      // Reauthenticate first — updatePassword requires a recent login.
      const cred = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, newPassword);
      // Clear the forced-change flag (merge: no-op for users who never had it).
      await setDoc(
        doc(db, 'users', user.uid),
        { mustChangePassword: false, updatedAt: serverTimestamp() },
        { merge: true }
      );
    },
    signOut: () => fbSignOut(auth),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
