import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getDatabase } from "firebase/database";

// The static site's own Firebase project
const firebaseConfig = {
  apiKey: "AIzaSyBDXIXxE6dlTzJ70SAID_pGKoKuuvq-f38",
  authDomain: "lucky-number-th.firebaseapp.com",
  projectId: "lucky-number-th",
  storageBucket: "lucky-number-th.firebasestorage.app",
  messagingSenderId: "395880648208",
  appId: "1:395880648208:web:538e536e1700f42a190495"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// Live inventory data lives in the RTDB (created in the original project).
const db = getDatabase(app, "https://lucky-number-df6fa-default-rtdb.asia-southeast1.firebasedatabase.app");

export { app, analytics, db };
