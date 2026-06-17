/**
 * Firebase initialization (Web SDK v10, modular).
 * Config values come from Vite env vars — see .env.example.
 */
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
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
