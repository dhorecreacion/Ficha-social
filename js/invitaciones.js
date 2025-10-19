    // js/invitaciones.js — Gestión de invitaciones (ADMIN)
    //
    // Funcionalidad:
    // - Cargar fichas recientes en un <select> con filtro por búsqueda.
    // - Generar link seguro: crea doc en /invitaciones con tokenHash (SHA-256).
    // - Mostrar y copiar el link (portapapeles).
    // - Listar invitaciones recientes (máx 100) y permitir "Revocar".
    //
    // Requisitos:
    // - Reglas Firestore: admin por UID y /invitaciones solo admin create/update/delete.
    // - Authentication: Email/Password para admin; Anonymous habilitado (para el invitado al abrir el link).
    //
    // Notas de seguridad:
    // - Nunca guardamos el token en claro en Firestore (solo el hash).
    // - Los links pasados no pueden “recrearse” (no se puede volver a copiar si no guardaste el token en memoria).
    //   Para re-compartir, genera una nueva invitación.

    import {
    auth, db,
    collection, doc, addDoc, getDoc, getDocs, updateDoc,
    query, orderBy, limit, serverTimestamp
    } from "./firebase.js";
    import { doLogout } from "./guard.js";

    // ===============
    // CONFIG: Admin UIDs (debe coincidir con Firestore Rules)
    // ===============
    const ADMIN_UIDS = new Set([
    "FWqjOlSz4HOyR7ZDjPCVL6t6iUp2", // Chris
    ]);

    // ===============
    // DOM y estado
    // ===============
    const $ = (s)=>document.querySelector(s);

    const adminWarn = $("#adminWarn");
    const genCard   = $("#genCard");

    const selFicha  = $("#selFicha");
    const daysEl    = $("#days");
    const btnGen    = $("#btnGen");
    const outWrap   = $("#outWrap");
    const linkOut   = $("#linkOut");
    const btnCopy   = $("#btnCopy");
    const msgGen    = $("#msgGen");

    const search    = $("#search");

    const tbodyInv  = $("#tbodyInv");
    const msgInv    = $("#msgInv");

    $("#btnLogout")?.addEventListener("click",(e)=>{ e.preventDefault(); doLogout(); });

    // Estado en memoria
    let isAdmin = false;
    let fichas = [];         // [{id, ...data}]
    let filtered = [];       // para el <select>
    const tokenById = new Map(); // invId -> token (solo para las invitaciones creadas en esta sesión)

    // ===============
    // Helpers
    // ===============
    function setMsg(el, t){ if(el) el.textContent = t || ""; }
    function esc(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

    function fmtDate(d){
    try{
        const pad = (n)=>String(n).padStart(2,"0");
        return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }catch{ return "–"; }
    }

    function token32(){
    return [...crypto.getRandomValues(new Uint8Array(16))]
        .map(b=>b.toString(16).padStart(2,"0")).join("");
    }
    async function sha256Hex(str){
    const enc = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
    }

    function baseFichaUrl(invId, token){
    // Construye URL absoluta hacia ficha.html en la misma carpeta
    const u = new URL("ficha.html", location.href);
    u.searchParams.set("i", invId);
    u.searchParams.set("t", token);
    return u.toString();
    }

    // ===============
    // Carga inicial
    // ===============
    auth.onAuthStateChanged(async (user)=>{
    if (!user) return location.href = "index.html";
    isAdmin = ADMIN_UIDS.has(user.uid);

    // Mostrar/ocultar secciones según admin
    adminWarn?.classList.toggle("hidden", isAdmin);
    genCard?.classList.toggle("hidden", !isAdmin);

    await Promise.all([
        loadFichas(),
        loadInvitaciones()
    ]);
    });

    // ===============
    // Fichas: cargar + filtrar + pintar <select>
    // ===============
    async function loadFichas(){
    try{
        selFicha.innerHTML = `<option value="">— Cargando fichas… —</option>`;
        const qy = query(collection(db,"fichas"), orderBy("createdAt","desc"), limit(10000));
        const snap = await getDocs(qy);
        fichas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        filtered = fichas.slice(0);
        paintSelect(filtered);
    }catch(e){
        console.error(e);
        selFicha.innerHTML = `<option value="">— Error cargando fichas —</option>`;
    }
    }

    function paintSelect(list){
    if (!list.length){
        selFicha.innerHTML = `<option value="">— No hay fichas —</option>`;
        return;
    }
    const opts = [`<option value="">Selecciona una ficha…</option>`].concat(
        list.map(r => {
        const dni = r.personal?.doc || r.doc || "";
        const nom = `${r.personal?.apellidos||r.apellidos||""} ${r.personal?.nombres||r.nombres||""}`.trim();
        const sede = r.laboral?.sede || r.sede || "";
        const label = `${dni ? dni+" · " : ""}${nom || "(Sin nombre)"}${sede ? " · "+sede : ""}`;
        return `<option value="${esc(r.id)}">${esc(label)}</option>`;
        })
    );
    selFicha.innerHTML = opts.join("");
    }

    search?.addEventListener("input", ()=>{
    const term = (search.value || "").trim().toLowerCase();
    filtered = term
        ? fichas.filter(r => {
            const dni = (r.personal?.doc || r.doc || "").toString().toLowerCase();
            const full = `${r.personal?.apellidos||r.apellidos||""} ${r.personal?.nombres||r.nombres||""}`.toLowerCase();
            return dni.includes(term) || full.includes(term);
        })
        : fichas.slice(0);
    paintSelect(filtered);
    });

    // ===============
    // Generar invitación
    // ===============
    btnGen?.addEventListener("click", async ()=>{
    try{
        if (!isAdmin) return alert("Solo un administrador puede generar invitaciones.");
        const fichaId = selFicha.value;
        if (!fichaId) return setMsg(msgGen, "Selecciona una ficha.");
        const days = Math.max(1, Math.min(60, parseInt(daysEl.value || "7", 10)));
        setMsg(msgGen, "Generando…");
        btnGen.disabled = true;

        // token + hash
        const token = token32();
        const tokenHash = await sha256Hex(token);

        // crear invitación
        const invRef = await addDoc(collection(db,"invitaciones"), {
        fichaId,
        tokenHash,
        status: "enviado",
        expiresAt: Date.now() + days*24*60*60*1000,
        createdAt: serverTimestamp()
        });

        // construir link absoluto
        const link = baseFichaUrl(invRef.id, token);

        // mostrar y copiar
        outWrap.classList.remove("hidden");
        linkOut.value = link;
        try{
        await navigator.clipboard.writeText(link);
        setMsg(msgGen, "Link generado y copiado ✓");
        }catch{
        setMsg(msgGen, "Link generado. Copia manualmente si no se copió.");
        }

        // guardar token en memoria para poder copiar desde la tabla (solo recién creadas)
        tokenById.set(invRef.id, token);

        // refrescar tabla de invitaciones
        await loadInvitaciones();
    }catch(e){
        console.error(e);
        setMsg(msgGen, e?.message || "No se pudo generar la invitación.");
    }finally{
        btnGen.disabled = false;
    }
    });

    btnCopy?.addEventListener("click", async ()=>{
    if (!linkOut.value) return;
    try{
        await navigator.clipboard.writeText(linkOut.value);
        setMsg(msgGen, "Copiado ✓");
    }catch{
        setMsg(msgGen, "No se pudo copiar automáticamente.");
    }
    });

    // ===============
    // Invitaciones recientes: cargar + render + acciones
    // ===============
    async function loadInvitaciones(){
    try{
        tbodyInv.innerHTML = `<tr><td colspan="5">Cargando…</td></tr>`;
        const qy = query(collection(db,"invitaciones"), orderBy("createdAt","desc"), limit(10000));
        const snap = await getDocs(qy);

        if (snap.empty){
        tbodyInv.innerHTML = `<tr><td colspan="5">No hay invitaciones.</td></tr>`;
        return;
        }

        const rows = await Promise.all(snap.docs.map(async d => {
        const inv = d.data();
        const id  = d.id;
        // Fechas
        const created = inv.createdAt?.toDate ? inv.createdAt.toDate() : (inv.createdAt ? new Date(inv.createdAt) : null);
        const expires = inv.expiresAt ? new Date(inv.expiresAt) : null;

        // Texto ficha
        let fichaTxt = inv.fichaId;
        try{
            const fsnap = await getDoc(doc(db,"fichas", inv.fichaId));
            if (fsnap.exists()){
            const r = fsnap.data();
            const dni = r.personal?.doc || r.doc || "";
            const nom = `${r.personal?.apellidos||r.apellidos||""} ${r.personal?.nombres||r.nombres||""}`.trim();
            const sede = r.laboral?.sede || r.sede || "";
            fichaTxt = `${dni ? dni+" · " : ""}${nom || "(Sin nombre)"}${sede ? " · "+sede : ""}`;
            }
        }catch{}

        return { id, inv, created, expires, fichaTxt };
        }));

        tbodyInv.innerHTML = rows.map(({id,inv,created,expires,fichaTxt})=>{
        const status = inv.status || "enviado";
        const cls = status === "completado" ? "ok" : (status === "revocado" ? "warn" : "muted");
        // Solo podemos copiar si el token existe en memoria (recién creado en esta sesión)
        const canCopy = tokenById.has(id) && status !== "revocado";
        const copyBtn = `<button class="btn" data-copy="${id}" ${canCopy ? "" : "disabled"}>Copiar</button>`;
        const revokeBtn = `<button class="btn danger" data-revoke="${id}">Revocar</button>`;
        const openFicha = `<a class="btn" href="ficha.html?id=${inv.fichaId}">Abrir ficha</a>`;

        return `
            <tr>
            <td>${created ? esc(fmtDate(created)) : "–"}</td>
            <td>${expires ? esc(fmtDate(expires)) : "–"}</td>
            <td>${esc(fichaTxt)}</td>
            <td><span class="badge ${cls}">${esc(status)}</span></td>
            <td style="text-align:right;white-space:nowrap;display:flex;gap:8px;justify-content:flex-end">
                ${openFicha}
                ${copyBtn}
                ${revokeBtn}
            </td>
            </tr>
        `;
        }).join("");

        // Wire acciones
        tbodyInv.querySelectorAll("[data-copy]").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
            const id = btn.getAttribute("data-copy");
            const token = tokenById.get(id);
            if (!token) return alert("No se puede recuperar el token de invitaciones antiguas. Genera una nueva invitación.");
            const link = baseFichaUrl(id, token);
            try{
            await navigator.clipboard.writeText(link);
            setMsg(msgInv, "Link copiado ✓");
            setTimeout(()=>setMsg(msgInv,""), 1200);
            }catch{
            setMsg(msgInv, "No se pudo copiar automáticamente.");
            }
        });
        });

        tbodyInv.querySelectorAll("[data-revoke]").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
            const id = btn.getAttribute("data-revoke");
            if (!confirm("¿Revocar esta invitación? Nadie podrá usar el enlace.")) return;
            try{
            await updateDoc(doc(db,"invitaciones", id), {
                status: "revocado",
                expiresAt: Date.now() - 1000 // ya expirada
            });
            await loadInvitaciones();
            setMsg(msgInv, "Invitación revocada ✓");
            setTimeout(()=>setMsg(msgInv,""), 1200);
            }catch(e){
            console.error(e);
            alert(e?.message || "No se pudo revocar.");
            }
        });
        });

    }catch(e){
        console.error(e);
        tbodyInv.innerHTML = `<tr><td colspan="5">Error al cargar invitaciones.</td></tr>`;
    }
    }
