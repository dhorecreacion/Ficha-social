    // js/fichas.js — Listado de fichas (Admin) con filtro ACT/INACT + buscador

    import {
    auth, db,
    collection, doc,
    addDoc, getDocs, deleteDoc,
    query, orderBy, limit,
    serverTimestamp,
    onAuthStateChanged
    } from "./firebase.js";
    import { doLogout } from "./guard.js";

    const ADMIN_UIDS = new Set([
    "FWqjOlSz4HOyR7ZDjPCVL6t6iUp2",
    ]);

    const $ = (s)=>document.querySelector(s);
    const tbody   = $("#tbody");
    const btnNew  = $("#btnNew");
    const btnCSV  = $("#btnExport");
    const search  = $("#search");
    const filtroEstado = $("#fltEstado");
    const msg     = $("#msg");

    $("#btnLogout")?.addEventListener("click",(e)=>{ e.preventDefault(); doLogout(); });

    let session = { user:null, isAdmin:false };
    let rows = []; // fichas (máx 300)

    // ------- Helpers de estado activo -------
    const hasActivoFlag = (r)=> r?.meta && Object.prototype.hasOwnProperty.call(r.meta, "activo");
    const isActive = (r)=> hasActivoFlag(r) ? r.meta.activo === true : true; // default ACTIVA si no hay flag

    // Normaliza el valor del select a: 'act' | 'inact' | 'all'
    function readEstadoFilter() {
    const el = filtroEstado || document.querySelector('select[name="fltEstado"]');
    let v = (el?.value ?? "").toString().trim().toLowerCase();

    // Fallbacks comunes
    if (v === "" || v === "activas" || v === "activa" || v === "1" || v === "true") v = "act";
    if (v === "inactivas" || v === "inactiva" || v === "0" || v === "false") v = "inact";
    if (v === "todas" || v === "todo" || v === "any" || v === "*") v = "all";

    // Por defecto, “act”
    if (!["act","inact","all"].includes(v)) v = "act";
    return v;
    }

    // ------- Bootstrap -------
    onAuthStateChanged(auth, async (user) => {
    if (!user) { location.href = "index.html"; return; }
    session.user = user;
    session.isAdmin = ADMIN_UIDS.has(user.uid);

    if (!session.isAdmin) {
        btnNew?.classList.add("hidden");
        btnCSV?.classList.add("hidden");
    }

    await loadFichas();

    // Listeners (después de cargar)
    search?.addEventListener("input", render);
    (filtroEstado || document.querySelector('select[name="fltEstado"]'))?.addEventListener("change", render);
    });

    // ------- Carga -------
    async function loadFichas(){
    try{
        tbody.innerHTML = "<tr><td colspan='8'>Cargando…</td></tr>";

        const qy = query(
        collection(db,"fichas"),
        orderBy("createdAt","desc"),
        limit(10000)
        );

        const snap = await getDocs(qy);
        rows = snap.docs.map(d => ({ id:d.id, ...d.data() }));

        render();
        kpis(rows);  // Si los KPIs deben seguir el filtro, cámbialo a kpis(getFiltered())
        setMsg("");
    }catch(e){
        console.error(e);
        if (e?.code === "permission-denied") {
        setMsg("No tienes permisos para ver el listado de fichas (se requiere administrador).");
        tbody.innerHTML = "<tr><td colspan='8'>Sin permisos</td></tr>";
        return;
        }
        setMsg(human(e));
    }
    }

    // ------- Filtro combinado -------
    function getFiltered(){
    const term = (search?.value || "").trim().toLowerCase();
    const est  = readEstadoFilter();   // 'act' | 'inact' | 'all'

    return rows.filter(r => {
        // 1) Estado
        if (est === "act"   && !isActive(r)) return false;
        if (est === "inact" &&  isActive(r)) return false;

        // 2) Texto
        if (term) {
        const doc = (r.personal?.doc || r.doc || "").toString().toLowerCase();
        const full = `${r.personal?.apellidos||r.apellidos||""} ${r.personal?.nombres||r.nombres||""}`.toLowerCase();
        if (!doc.includes(term) && !full.includes(term)) return false;
        }
        return true;
    });
    }

    function render(){
    const data = getFiltered();

    if (!data.length) {
        tbody.innerHTML = "<tr><td colspan='8'>Sin resultados</td></tr>";
        return;
    }

    tbody.innerHTML = data.map(r => `
        <tr>
        <td>${esc(r.personal?.doc || r.doc || "")}</td>
        <td>${esc(`${r.personal?.apellidos||r.apellidos||""} ${r.personal?.nombres||r.nombres||""}`)}</td>
        <td>${esc(r.laboral?.sede || r.sede || "")}</td>
        <td>${esc(r.personal?.genero || r.genero || "")}</td>
        <td><span class="badge ${pct(r)>=80?'ok':(pct(r)>=40?'muted':'warn')}">${pct(r)}%</span></td>
        <td>${esc(r.estado || "borrador")}</td>
        <td>${isActive(r) ? "<span class='badge ok'>A</span>" : "<span class='badge warn'>I</span>"}</td>
        <td style="text-align:right;white-space:nowrap">
            <a class="btn" href="ficha.html?id=${r.id}">Abrir</a>
            ${session.isAdmin ? `<button class="btn danger" data-del="${r.id}">Eliminar</button>` : ""}
        </td>
        </tr>
    `).join("");

    if (session.isAdmin) {
        tbody.querySelectorAll("[data-del]").forEach(b =>
        b.addEventListener("click", () => del(b.dataset.del))
        );
    }
    }

    // ------- Crear -------
    btnNew?.addEventListener("click", createAndGo);

    async function createAndGo(){
    try{
        if (!session.isAdmin) return alert("Solo un administrador puede crear fichas.");
        btnNew.disabled = true;
        const old = btnNew.textContent;
        btnNew.textContent = "Creando…";

        const ref = await addDoc(collection(db,"fichas"), {
        grants: {},
        estado: "borrador",
        hijos: [],
        salud: { alergias: [], enfermedadesCronicas: [] },
        meta: { activo: true }, // default ACTIVA
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

    // ------- KPIs -------
    // Helper seguro para escribir en el DOM
    function setTextSafe(sel, text){
    const el = document.querySelector(sel);
    if (el) el.textContent = text;
    }

    function kpis(data){
    // Si no hay ningún KPI en el DOM, no hacer nada
    const hasAny = document.querySelector('#kpiTotal')
                || document.querySelector('#kpiH')
                || document.querySelector('#kpiM')
                || document.querySelector('#kpiC');
    if (!hasAny) return;

    const total = data.length;

    const H = data.filter(x => (x.personal?.genero||x.genero) === "Masculino").length;
    const M = data.filter(x => (x.personal?.genero||x.genero) === "Femenino").length;

    const prom = Math.round(
        data.reduce((a,x)=>a+pct(x),0) / (data.length || 1)
    );

    setTextSafe('#kpiTotal', String(total));
    setTextSafe('#kpiH', String(H));
    setTextSafe('#kpiM', String(M));
    setTextSafe('#kpiC', prom + '%');
    }

    // % de completitud
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

    // ------- Exportar CSV -------
    btnCSV?.addEventListener("click", exportCSV);

    function exportCSV(){
    const data = getFiltered(); // exporta lo filtrado; si prefieres todo, usa rows
    if (!data.length) return alert("No hay datos para exportar.");
    const headers = [
        "personal.doc","personal.apellidos","personal.nombres","laboral.sede","personal.genero",
        "contacto.correo","contacto.telefono","ubicacion.direccion","laboral.categoria","estado","meta.activo"
    ];
    const label = ["doc","apellidos","nombres","sede","genero","correo","telefono","direccion","categoria","estado","activa"];

    const lines = [label.join(",")].concat(
        data.map(r => headers.map(h => {
        const v = h.split(".").reduce((o,k)=>o?.[k], r);
        return JSON.stringify(String(
            h==="meta.activo" ? (isActive(r) ? "ACTIVA" : "INACTIVA") : (v ?? "")
        ));
        }).join(","))
    );

    const blob = new Blob(["\uFEFF"+lines.join("\n")], {type:"text/csv;charset=utf-8;"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "fichas.csv";
    a.click();
    }

    // ------- Eliminar -------
    async function del(id){
    if (!session.isAdmin) return alert("Solo un administrador puede eliminar.");
    if (!confirm("¿Eliminar esta ficha? Esta acción no se puede deshacer.")) return;

    try{
        await deleteDoc(doc(db,"fichas", id));
        rows = rows.filter(r => r.id !== id);
        render();
        kpis(rows);
        setMsg("Ficha eliminada ✓");
    }catch(e){
        console.error(e);
        alert(human(e));
    }
    }

    // ------- Utilidades -------
    function setMsg(t){ if(msg) msg.textContent = t || ""; }
    function esc(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','&gt;':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    function human(err){
    const map = {
        "permission-denied": "Permisos insuficientes (se requiere administrador).",
        "unauthenticated": "Inicia sesión e inténtalo nuevamente."
    };
    return map[err?.code] || err?.message || "Ocurrió un error.";
    }
