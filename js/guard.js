    // js/guard.js — protección de páginas internas + logout
    import { auth } from "./firebase.js";
    import { onAuthStateChanged, signOut } from "./firebase.js";

    /**
     * Requiere que exista sesión (email/contraseña o anónima).
     * Si no hay usuario, redirige a index.html
     */
    export function requireAuth() {
    // si ya hay usuario, listo
    if (auth.currentUser) return;

    onAuthStateChanged(auth, (user) => {
        if (!user) {
        // No hay sesión: volvemos al login
        location.href = "index.html";
        }
        // Si hay sesión, continúa la carga normal de la página
    });
    }

    /**
     * Cerrar sesión y volver al login.
     */
    export async function doLogout() {
    try {
        await signOut(auth);
    } catch (e) {
        console.warn("Error al cerrar sesión:", e);
    } finally {
        location.href = "index.html";
    }
    }
