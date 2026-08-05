/**
 * Firebase initialization (Web SDK v10, modular).
 * Config values come from Vite env vars — see .env.example.
 */
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, OAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

// TODO(setup): fill these in via .env (local) / GitHub secrets (CI). See README.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
// Region must match setGlobalOptions() in functions/src/index.ts — the SDK
// defaults to us-central1, which silently 404s every callable otherwise.
export const functions = getFunctions(app, 'us-east1');
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
// Sign in with Apple — same popup flow as Google. Requires the Apple provider
// to be enabled in Firebase Console → Authentication (needs an Apple Developer
// Services ID + key). Apple only shares name/email on the FIRST sign-in.
export const appleProvider = new OAuthProvider('apple.com');
appleProvider.addScope('email');
appleProvider.addScope('name');
// Sign in with Microsoft — colleges/agencies live on Microsoft 365, so this is
// the institutional sign-in. Requires the Microsoft provider enabled in
// Firebase Console (Azure app registration: any org directory + personal).
export const microsoftProvider = new OAuthProvider('microsoft.com');
microsoftProvider.setCustomParameters({ prompt: 'select_account' });
