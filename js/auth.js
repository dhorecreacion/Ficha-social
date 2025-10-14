    // js/auth.js — Login (email/contraseña) + Reset + Redirect
    // Funciona con index.html (sin Google ni Registro)

    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
    import {
    getAuth, signInWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail
    } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
    import {
    getFirestore, doc, getDoc, setDoc
    } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

    // ⚙️ Tu configuración (copiada de la consola de Firebase)
    const firebaseConfig = {
    apiKey: "AIzaSyD7I29Q12YILYAEyfc2JPnIGn1mr97YDH0",
    authDomain: "ficha-social-427a1.firebaseapp.com",
    projectId: "ficha-social-427a1",
    storageBucket: "ficha-social-427a1.firebasestorage.app",
    messagingSenderId: "793852990137",
    appId: "1:793852990137:web:a084b1e1bad17409dfc168"
    };

    // 🧩 Inicializar
    const app  = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db   = getFirestore(app);

    // 🔗 Helpers DOM
    const $   = (s) => document.querySelector(s);
    const msg = $("#msg");
    const form = $("#loginForm");
    const emailEl = $("#email");
    const passEl  = $("#password");
    const btnLogin = $("#btnLogin");
    const btnReset = $("#btnReset");

    // 🧭 Redirige si ya hay sesión
    onAuthStateChanged(auth, (user) => {
    if (user) {
        // Ya logueado: vete a fichas
        location.href = "fichas.html";
    }
    });

    // 🚪 Login
    form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg();
    if (!emailEl.checkValidity() || !passEl.checkValidity()) {
        setMsg("Completa correo y contraseña.");
        return;
    }

    // UI loading state
    setLoading(true);

    try {
        const email = emailEl.value.trim();
        const pass  = passEl.value;
        const cred  = await signInWithEmailAndPassword(auth, email, pass);

        // crea /users/{uid} si no existe (no bloquea el redirect)
        try { await ensureUserDoc(cred.user); } catch (err) { console.warn("ensureUserDoc:", err?.code || err?.message); }

        location.href = "fichas.html";
    } catch (err) {
        setMsg(human(err));
    } finally {
        setLoading(false);
    }
    });

    // ✉️ Reset de contraseña
    btnReset?.addEventListener("click", async () => {
    clearMsg();
    const email = emailEl.value.trim();
    if (!email) {
        setMsg("Ingresa tu correo para enviarte el enlace.");
        emailEl.focus();
        return;
    }
    setLoading(true);
    try {
        await sendPasswordResetEmail(auth, email);
        setMsg("Te enviamos un enlace para restablecer la contraseña.");
    } catch (err) {
        setMsg(human(err));
    } finally {
        setLoading(false);
    }
    });

    // 🗂️ Crea doc de usuario si no existe
    async function ensureUserDoc(user) {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
        await setDoc(ref, {
        email: user.email || "",
        displayName: user.displayName || "",
        role: "invitado",
        createdAt: Date.now()
        });
    }
    }

    // 🧠 Mapeo de errores
    function human(err) {
    const map = {
        "auth/invalid-credential": "Correo o contraseña incorrectos.",
        "auth/user-not-found": "Usuario no registrado.",
        "auth/wrong-password": "Contraseña incorrecta.",
        "auth/too-many-requests": "Demasiados intentos. Intenta luego.",
        "auth/operation-not-allowed": "Habilita Email/Password en Authentication.",
        "auth/unauthorized-domain": "Agrega localhost/127.0.0.1 en Authorized domains."
    };
    return map[err?.code] || err?.message || "Ocurrió un error al iniciar sesión.";
    }

    // 🎛️ UI helpers
    function setLoading(on) {
    if (!btnLogin) return;
    btnLogin.disabled = on;
    emailEl.disabled = on;
    passEl.disabled = on;
    btnLogin.textContent = on ? "Ingresando…" : "Ingresar";
    }
    function setMsg(text) { if (msg) msg.textContent = text; }
    function clearMsg() { setMsg(""); }

    // ⚠️ Aviso útil si abren con file:// (no debería, pero por si acaso)
    if (location.protocol === "file:") {
    setMsg("Abre con Live Server (http://localhost:xxxx). Con file:// Firebase Auth no funciona.");
    }
