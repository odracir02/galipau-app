// Legacy catalogue source: Firestore "productos" collection (read-only).
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";

export const getProductosFirebase = async () => {
  const productosRef = collection(db, "productos");
  const snapshot = await getDocs(productosRef);

  const productos = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  }));

  return productos;
};
