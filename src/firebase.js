import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDrhdY_8S0ZD4GZt6Ta9ALYWQWhrJOZBKI",
  authDomain: "galipau-presupuestos.firebaseapp.com",
  projectId: "galipau-presupuestos",
  storageBucket: "galipau-presupuestos.firebasestorage.app",
  messagingSenderId: "286193808224",
  appId: "1:286193808224:web:742484fcd70653dbdea405"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db };