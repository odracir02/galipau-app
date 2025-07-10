// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDrhdY_8S0ZD4GZt6Ta9ALYWQWhrJOZBKI",
  authDomain: "galipau-presupuestos.firebaseapp.com",
  projectId: "galipau-presupuestos",
  storageBucket: "galipau-presupuestos.firebasestorage.app",
  messagingSenderId: "286193808224",
  appId: "1:286193808224:web:742484fcd70653dbdea405"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db };