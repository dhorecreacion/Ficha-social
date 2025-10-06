    // js/fichas.js — Listado de fichas para ADMIN
    // - Botón "Nueva ficha": crea y redirige a ficha.html?id=...
    // - Búsqueda por DNI o nombres
    // - KPIs básicos
    // - Exportar CSV
    // - Eliminar (solo admin)
    //
    // Reglas en Firestore: admin por UID y grants por invitación (como configuraste)

    import {
    auth, db,
    collection, doc,
    addDoc, getDoc, getDocs, updateDoc, deleteDoc,
    query, orderBy, limit,
    serverTimestamp,
    onAuthStateChanged
    } from "./firebase.js";
    import { doLogout } from "./guard.js";

    // =======================
    // Config: quién es admin (UIDs)
    // =======================
    // Debe coincidir con lo que pusiste en Firestore Rules (isAdmin())
    const ADMIN_UIDS = new Set([
    "FWqjOlSz4HOyR7ZDjPCVL6t6iUp2", // Chris
    ]);

    // =======================
    // DOM
    // =======================
    const $  = (s)=>document.querySelector(s);
    const tbody   = $("#tbody");
    const btnNew  = $("#btnNew");
    const btnCSV  = $("#btnExport");
    const search  = $("#search");
    const msg     = $("#msg");

    $("#btnLogout")?.addEventListener("click",(e)=>{ e.preventDefault(); doLogout(); });

    // Estado en memoria
    let session = { user:null, isAdmin:false };
    let rows = []; // fichas cargadas (máx 300)

    // =======================
    // Bootstrap sesión + datos
    // =======================
    onAuthStateChanged(auth, async (user) => {
    if (!user) {
        // guard.js ya redirige en esta página, pero por si acaso:
        location.href = "index.html";
        return;
    }
    session.user = user;
    session.isAdmin = ADMIN_UIDS.has(user.uid);

    // Ocultar/mostrar acciones según admin
    if (!session.isAdmin) {
        btnNew?.classList.add("hidden");
        btnCSV?.classList.add("hidden");
        // También podría ocultar columna Acciones si quieres
    }

    await loadFichas();
    });

    // =======================
    // Cargar y renderizar lista
    // =======================
    async function loadFichas(){
    try{
        tbody.innerHTML = "<tr><td colspan='7'>Cargando…</td></tr>";

        // Admin: ve todo (reglas lo permiten). Invitado: esta página no es para él,
        // igual capturamos permission-denied si ocurre.
        let qy = query(
        collection(db,"fichas"),
        orderBy("createdAt","desc"),
        limit(300)
        );

        const snap = await getDocs(qy);
        rows = snap.docs.map(d => ({ id:d.id, ...d.data() }));

        render();
        kpis(rows);
        setMsg("");
    }catch(e){
        console.error(e);
        if (e?.code === "permission-denied") {
        setMsg("No tienes permisos para ver el listado de fichas (se requiere administrador).");
        tbody.innerHTML = "<tr><td colspan='7'>Sin permisos</td></tr>";
        return;
        }
        setMsg(human(e));
    }
    }

    function render(){
    const term = (search?.value || "").trim().toLowerCase();

    const filtered = term
        ? rows.filter(r => {
            const doc = (r.personal?.doc || r.doc || "").toString().toLowerCase();
            const full = `${r.personal?.apellidos||r.apellidos||""} ${r.personal?.nombres||r.nombres||""}`.toLowerCase();
            return doc.includes(term) || full.includes(term);
        })
        : rows;

    if (!filtered.length) {
        tbody.innerHTML = "<tr><td colspan='7'>Sin resultados</td></tr>";
        return;
    }

    tbody.innerHTML = filtered.map(r => `
        <tr>
        <td>${esc(r.personal?.doc || r.doc || "")}</td>
        <td>${esc(`${r.personal?.apellidos||r.apellidos||""} ${r.personal?.nombres||r.nombres||""}`)}</td>
        <td>${esc(r.laboral?.sede || r.sede || "")}</td>
        <td>${esc(r.personal?.genero || r.genero || "")}</td>
        <td><span class="badge ${pct(r)>=80?'ok':(pct(r)>=40?'muted':'warn')}">${pct(r)}%</span></td>
        <td>${esc(r.estado || "borrador")}</td>
        <td style="text-align:right;white-space:nowrap">
            <a class="btn" href="ficha.html?id=${r.id}">Abrir</a>
            ${session.isAdmin ? `<button class="btn danger" data-del="${r.id}">Eliminar</button>` : ""}
        </td>
        </tr>
    `).join("");

    // wire eliminar (solo admin)
    if (session.isAdmin) {
        tbody.querySelectorAll("[data-del]").forEach(b =>
        b.addEventListener("click", () => del(b.dataset.del))
        );
    }
    }

    search?.addEventListener("input", render);

    // =======================
    // Crear y redirigir
    // =======================
    btnNew?.addEventListener("click", createAndGo);

    async function createAndGo(){
    try{
        if (!session.isAdmin) {
        return alert("Solo un administrador puede crear fichas.");
        }
        btnNew.disabled = true;
        const old = btnNew.textContent;
        btnNew.textContent = "Creando…";

        const ref = await addDoc(collection(db,"fichas"), {
        grants: {}, // nadie invitado aún
        estado: "borrador",
        hijos: [],
        salud: { alergias: [], enfermedadesCronicas: [] },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
        });

        location.href = `ficha.html?id=${ref.id}`;
    }catch(e){
        console.error(e);
        alert(human(e));
    }finally{
        btnNew.disabled = false;
        btnNew.textContent = "Nueva ficha";
    }
    }

    // =======================
    // KPIs
    // =======================
    function kpis(data){
    $("#kpiTotal").textContent = data.length;

    const H = data.filter(x => (x.personal?.genero||x.genero) === "Masculino").length;
    const M = data.filter(x => (x.personal?.genero||x.genero) === "Femenino").length;

    $("#kpiH").textContent = H;
    $("#kpiM").textContent = M;

    const prom = Math.round(
        data.reduce((a,x)=>a+pct(x),0) / (data.length || 1)
    );
    $("#kpiC").textContent = prom + "%";
    }

    // % de completitud (mismos campos críticos que en ficha.js)
    function pct(r){
    const must = [
        "personal.doc","personal.nombres","personal.apellidos","personal.genero","personal.nacimiento","personal.nacionalidad","personal.estadoCivil",
        "contacto.telefono","contacto.correo",
        "ubicacion.direccion","ubicacion.departamento","ubicacion.provincia","ubicacion.distrito",
        "laboral.categoria","laboral.sede"
    ];
    const get = (p)=> p.split(".").reduce((o,k)=>o?.[k], r);
    const filled = must.filter(k => String(get(k)||"").trim().length>0).length;
    return Math.round((filled / must.length) * 100);
    }

    // =======================
    // Exportar CSV
    // =======================
    btnCSV?.addEventListener("click", exportCSV);

    function exportCSV(){
    if (!rows.length) return alert("No hay datos para exportar.");
    const headers = [
        "personal.doc","personal.apellidos","personal.nombres","laboral.sede","personal.genero",
        "contacto.correo","contacto.telefono","ubicacion.direccion","laboral.categoria","estado"
    ];
    const label = ["doc","apellidos","nombres","sede","genero","correo","telefono","direccion","categoria","estado"];

    const lines = [label.join(",")].concat(
        rows.map(r => headers.map(h => {
        const v = h.split(".").reduce((o,k)=>o?.[k], r) ?? "";
        // CSV-safe
        return JSON.stringify(String(v));
        }).join(","))
    );

    const blob = new Blob(["\uFEFF"+lines.join("\n")], {type:"text/csv;charset=utf-8;"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "fichas.csv";
    a.click();
    }

    // =======================
    // Eliminar (solo admin)
    // =======================
    async function del(id){
    if (!session.isAdmin) return alert("Solo un administrador puede eliminar.");
    if (!confirm("¿Eliminar esta ficha? Esta acción no se puede deshacer.")) return;

    try{
        await deleteDoc(doc(db,"fichas", id));
        // refrescar lista
        rows = rows.filter(r => r.id !== id);
        render();
        kpis(rows);
        setMsg("Ficha eliminada ✓");
    }catch(e){
        console.error(e);
        alert(human(e));
    }
    }

    // =======================
    // Utilidades UI
    // =======================
    function setMsg(t){ if(msg) msg.textContent = t || ""; }
    function esc(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    function human(err){
    const map = {
        "permission-denied": "Permisos insuficientes (se requiere administrador).",
        "unauthenticated": "Inicia sesión e inténtalo nuevamente."
    };
    return map[err?.code] || err?.message || "Ocurrió un error.";
    }
