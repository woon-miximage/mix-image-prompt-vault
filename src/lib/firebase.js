import { getAnalytics, isSupported } from 'firebase/analytics'
import { initializeApp, getApps } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

// Public browser configuration supplied for MIX-IMAGE Prompt Library.
// Firestore and Storage Rules remain the real access boundary.
const firebaseConfig = {
  apiKey: 'AIzaSyBIJ7kio6XtUErPIULTjrwp-vn5RRYg3i4',
  authDomain: 'miximage-prompt-library.firebaseapp.com',
  projectId: 'miximage-prompt-library',
  storageBucket: 'miximage-prompt-library.firebasestorage.app',
  messagingSenderId: '938461503077',
  appId: '1:938461503077:web:7991995e4a9e189134708c',
  measurementId: 'G-MFMTD245DB',
}

const app = getApps()[0] ?? initializeApp(firebaseConfig)
const db = getFirestore(app)
const storage = getStorage(app)

if (typeof window !== 'undefined') {
  isSupported()
    .then((supported) => {
      if (supported) getAnalytics(app)
    })
    .catch(() => {})
}

export { app, db, storage, firebaseConfig }
