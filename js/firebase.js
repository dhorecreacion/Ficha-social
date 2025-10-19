    // js/firebase.js
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";

    // Auth
    import {
    getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
    signInAnonymously, setPersistence, browserLocalPersistence
    } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";

    // Firestore
    import {
    getFirestore, collection, doc, addDoc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
    query, where, orderBy, limit, startAfter, serverTimestamp, enableIndexedDbPersistence
    } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

    // TU CONFIG (de la consola)
    const firebaseConfig = {
    apiKey: "AIzaSyD7I29Q12YILYAEyfc2JPnIGn1mr97YDH0",
    authDomain: "ficha-social-427a1.firebaseapp.com",
    projectId: "ficha-social-427a1",
    storageBucket: "ficha-social-427a1.firebasestorage.app",
    messagingSenderId: "793852990137",
    appId: "1:793852990137:web:a084b1e1bad17409dfc168"
    };

    const app  = initializeApp(firebaseConfig);

    // Persistencia
    const auth = getAuth(app);
    setPersistence(auth, browserLocalPersistence);

    // Firestore
    const db = getFirestore(app);
    try { await enableIndexedDbPersistence(db); } catch(e){ /* ok si falla por multi-pestaña */ }

    // Exports
    export {
    app, auth, db,
    onAuthStateChanged, signInWithEmailAndPassword, signOut, signInAnonymously,
    collection, doc, addDoc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
    query, where, orderBy, limit, startAfter, serverTimestamp
    };
