    // js/ficha.js — Editor de Ficha Social (invitación + autosave + revocar tras guardar)

    import { auth, db } from "./firebase.js";
    import {
    collection, doc, getDoc, setDoc, addDoc, updateDoc,
    serverTimestamp, signInAnonymously, query, where, getDocs
    } from "./firebase.js";
    import { doLogout } from "./guard.js";

    const $ = (s)=>document.querySelector(s);
    $("#btnLogout")?.addEventListener("click",(e)=>{ e.preventDefault(); doLogout(); });

    // --- DOM ---
    const form = $("#form");
    const msg  = $("#msg");
    const bar  = $("#progressBar");
    const pct  = $("#progressPct");
    // Botón guardar (barra inferior)
    const btnSave = document.querySelector(".savebar .primary") 
                || document.querySelector('button[type="submit"]');

    // --- Parámetros de URL ---
    const p = new URLSearchParams(location.search);
    const fichaIdParam  = p.get("id");
    const inviteIdParam = p.get("i");
    const tokenParam    = p.get("t");

    // --- Flags ---
    const AUTO_CREATE_WHEN_EMPTY = true; // Admin sin id → crea ficha
    const isInvite = !!(inviteIdParam && tokenParam);
    if (isInvite) document.body.classList.add("invite-only"); // oculta menú

    // --- Admin (mismo UID de tus rules) ---
    const ADMIN_UID = "FWqjOlSz4HOyR7ZDjPCVL6t6iUp2";
    function isAdminClient(){ return auth.currentUser?.uid === ADMIN_UID; }

    /** Deshabilita elementos marcados como data-admin-only si NO eres admin (incluye lock duro de seguros) */
    function applyAdminLock(){
    const isAdmin = isAdminClient();

    // Deshabilita todo lo marcado data-admin-only si NO eres admin
    document
        .querySelectorAll('[data-admin-only] input, [data-admin-only] select, [data-admin-only] textarea, [data-admin-only] button')
        .forEach(el => {
        el.disabled = !isAdmin;
        if (!isAdmin) el.dataset.forceDisabled = "true"; // evita re-enable accidental
        });

    // Bloque editable y solo-lectura de Seguros
    const segEdit = document.getElementById('segSalud');
    const segRO   = document.getElementById('segSaludReadOnly');

    if (!isAdmin){
        if (segEdit){
        segEdit.setAttribute('inert','');                 // evita foco/clicks
        segEdit.classList.add('pointer-events-none');     // si usas Tailwind
        segEdit.querySelectorAll('input,select,textarea,button').forEach(el=>{
            el.disabled = true; el.dataset.forceDisabled = "true";
        });
        }
        if (segRO) segRO.style.display = "grid";
    } else {
        if (segEdit){
        segEdit.removeAttribute('inert');
        segEdit.classList.remove('pointer-events-none');
        segEdit.querySelectorAll('input,select,textarea,button').forEach(el=>{
            if (el.dataset.forceDisabled === "true") delete el.dataset.forceDisabled;
            el.disabled = false;
        });
        }
        if (segRO) segRO.style.display = "none";
    }
    }

    /** Lock específico de seguros para invitados/no-admin (doble seguro) */
    function lockSegurosUIForNonAdminOrInvite(){
    const segEdit = document.getElementById('segSalud');          // bloque editable
    const segRO   = document.getElementById('segSaludReadOnly');  // bloque solo lectura
    const mustLock = isInvite || !isAdminClient();
    if (!segEdit) return;

    if (mustLock){
        segEdit.setAttribute('inert',''); // sin foco
        segEdit.style.pointerEvents = 'none';
        segEdit.querySelectorAll('input,select,textarea,button').forEach(el=>{
        el.disabled = true;
        el.dataset.forceDisabled = "true";
        // Mata interacción por si falla CSS/atributos
        el.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); }, true);
        el.addEventListener('input', ev => { ev.preventDefault(); ev.stopPropagation(); }, true);
        el.addEventListener('change', ev => { ev.preventDefault(); ev.stopPropagation(); }, true);
        el.addEventListener('keydown', ev => { ev.preventDefault(); ev.stopPropagation(); }, true);
        });
        if (segRO) segRO.style.display = 'grid';
    } else {
        segEdit.removeAttribute('inert');
        segEdit.style.pointerEvents = '';
        segEdit.querySelectorAll('input,select,textarea,button').forEach(el=>{
        if (el.dataset.forceDisabled === "true") delete el.dataset.forceDisabled;
        el.disabled = false;
        });
        if (segRO) segRO.style.display = 'none';
    }
    }

    // Aplica lock cuando cambie la sesión
    document.addEventListener("DOMContentLoaded", () => {
    auth.onAuthStateChanged(() => {
        applyAdminLock();
        lockSegurosUIForNonAdminOrInvite();
    });
    });

    // ---------------- Inactivo = solo lectura para no-admin ----------------
    let fichaActiva = true;

    function enableFormRespectingAdminLock(){
    // Habilita todo y luego vuelve a aplicar el lock de admin-only
    form?.querySelectorAll("input,select,textarea,button").forEach(el=>{
        if (el.dataset.forceDisabled === "true") return;
        el.disabled = false;
    });
    applyAdminLock();
    }

    function applyInactiveLockUI(){
    // Si está inactiva y NO eres admin → modo solo lectura
    if (!fichaActiva && !isAdminClient()){
        disableForm();
    } else {
        enableFormRespectingAdminLock();
    }
    }

    // --- Fechas por seguro: enable/require cuando el check esté marcado
    function initSeguroFechas(){
    const wrap = document.getElementById('segSalud');
    if (!wrap) return;

    const pairs = [...wrap.querySelectorAll('input[type="checkbox"][name="salud.seguros[]"]')]
        .map(chk => {
        const key  = chk.getAttribute('data-key') || chk.value;
        const date = wrap.querySelector(`input.check-date[name="salud.segurosFechas.${CSS.escape(key)}"]`);
        return { chk, date, key };
        });

    const sync = ({chk, date})=>{
        if (!date) return;
        if (chk.checked){
        date.disabled = false;
        date.required = true;
        if (!date.value){
            const d = new Date();
            const mm = String(d.getMonth()+1).padStart(2,'0');
            const dd = String(d.getDate()).padStart(2,'0');
            date.value = `${d.getFullYear()}-${mm}-${dd}`;
        }
        } else {
        date.required = false;
        date.disabled = true;
        date.value = "";
        }
    };

    pairs.forEach(p=>{
        sync(p); // estado inicial
        // cambios → progreso + autosave
        p.chk.addEventListener('change', ()=>{ sync(p); updateProgress(); scheduleAutosave(); });
        p.date?.addEventListener('change', ()=>{ updateProgress(); scheduleAutosave(); });
    });
    }

    /** Validación extra: si eres admin, todo seguro marcado DEBE tener fecha */
    function validateSegurosFechas(){
    const wrap = document.getElementById('segSalud');
    if (!wrap) return true;
    if (!isAdminClient()) return true;

    const pairs = [...wrap.querySelectorAll('input[type="checkbox"][name="salud.seguros[]"]')]
        .map(chk => {
        const key  = chk.getAttribute('data-key') || chk.value;
        const date = wrap.querySelector(`input.check-date[name="salud.segurosFechas.${CSS.escape(key)}"]`);
        return { chk, date, key };
        });

    for (const {chk, date, key} of pairs){
        if (chk.checked){
        if (!date || !date.value){
            if (date) date.focus();
            setErr(`Falta la fecha de activación para: ${key}`);
            return false;
        }
        }
    }
    return true;
    }

    // --- Loader pantalla completa ---
    const screenLoader = document.getElementById("screenLoader");
    function loading(on){ screenLoader?.classList.toggle("hidden", !on); }

    // --- Estado ---
    let currentId   = null;
    let inviteMeta  = null;  // { inviteId, tokenHash } cuando vienes por invitación
    let saveTimer   = null;
    const AUTOSAVE_DELAY = 1200;

    /* =========================================================
    DNI DUPLICADO — mínima integración
    ========================================================= */
    // normaliza DNI: quita espacios y no-dígitos
    function normDNI(v){ return String(v||"").replace(/\D+/g,"").trim(); }

    let hasDniDuplicate = false;
    let lastDniChecked = "";

    async function findDuplicateByDNI(dni){
    const clean = normDNI(dni);
    if (!clean) return null;
    try{
        const q = query(collection(db,"fichas"), where("personal.doc","==", clean));
        const snap = await getDocs(q);
        let dup = null;
        snap.forEach(docSnap=>{
        // si es distinto a la ficha abierta → duplicado
        if (docSnap.id !== currentId) dup = { id: docSnap.id, data: docSnap.data() };
        });
        return dup;
    }catch(e){
        console.warn("No se pudo verificar DNI duplicado:", e);
        return null;
    }
    }

    function applyDniDuplicateState(dup){
    hasDniDuplicate = !!dup;
    if (dup){
        setErr(`DNI ya registrado en otra ficha (ID: ${dup.id}).`);
    }else{
        // solo borro el error si era por duplicado
        if (msg && /DNI ya registrado/.test(msg.textContent||"")) msg.textContent = "";
    }
    updateSaveState();
    }

    // helper: determina si debemos bloquear guardados (autosave/submit)
    function shouldBlockSave(){
    return hasDniDuplicate === true;
    }

    // hook al input de DNI
    const dniInput = form?.querySelector('[name="personal.doc"]');
    if (dniInput){
    dniInput.addEventListener("input", ()=>{
        // si cambió, reseteo estado hasta volver a chequear
        applyDniDuplicateState(null);
    });
    dniInput.addEventListener("blur", async ()=>{
        const val = normDNI(dniInput.value);
        if (!val || val === lastDniChecked) return;
        const dup = await findDuplicateByDNI(val);
        lastDniChecked = val;
        applyDniDuplicateState(dup);
    });
    }

    /* =========================================================
    Botón Activar/Desactivar (meta.activo) — SOLO ADMIN
    ========================================================= */
    function updateActivoUI(isActive){
    const badge = document.getElementById("statusActivo");
    const btn   = document.getElementById("btnToggleActivo");
    if (!badge || !btn) return;

    badge.classList.toggle("active",   isActive);
    badge.classList.toggle("inactive", !isActive);
    badge.textContent = isActive ? "ACTIVA" : "INACTIVA";
    btn.textContent   = isActive ? "Desactivar ficha" : "Activar ficha";
    }

    async function toggleActivo(){
    if (!isAdminClient()){
        setErr("Solo el administrador puede cambiar el estado de la ficha.");
        return;
    }
    if (!currentId){
        setErr("No hay ficha cargada.");
        return;
    }

    const isActiveNow = (document.getElementById("statusActivo")?.textContent === "ACTIVA");
    const next = !isActiveNow;

    try{
        loading(true);
        const patch = {
        meta: {
            activo: next,
            changedAt: Date.now(),
            changedBy: auth.currentUser?.uid || null
        },
        updatedAt: Date.now()
        };
        await setDoc(doc(db, "fichas", currentId), patch, { merge:true });
        fichaActiva = next;
        updateActivoUI(next);
        applyInactiveLockUI();
        setOk(next ? "Ficha activada ✓" : "Ficha desactivada ✓");
    }catch(e){
        const m = e?.code === "permission-denied"
        ? "No tienes permisos para cambiar el estado."
        : (e?.message || "No se pudo cambiar el estado.");
        setErr(m);
        console.error(e);
    }finally{
        loading(false);
    }
    }
    // Vincula el botón
    document.getElementById("btnToggleActivo")?.addEventListener("click", toggleActivo);

    /* =========================================================
    UBIGEO: Dpto → Prov → Dist (JSON estático + selects cascada)
    ========================================================= */
    const UBIGEO_URL = new URL("../data/peru-ubigeo.json", import.meta.url).href;

    let UBIGEO = [];               // filas crudas
    let MAP_D = new Map();         // Departamento -> Set(Provincia)
    let MAP_P = new Map();         // "Dep|Prov"  -> Set(Distrito)

    function opt(value, text=value){
    const o=document.createElement("option");
    o.value=value; o.textContent=text;
    return o;
    }
    function clearAndDisable(sel, disabled=true){
    sel.innerHTML=""; sel.disabled=disabled;
    }
    async function loadUbigeo(){
    if (UBIGEO.length) return; // cache
    try{
        const res = await fetch(UBIGEO_URL, { cache:"force-cache" });
        UBIGEO = await res.json();
    }catch(e){
        console.warn("No se pudo cargar UBIGEO:", e);
        UBIGEO = [];
    }
    MAP_D.clear(); MAP_P.clear();
    for (const row of UBIGEO){
        const dep  = String(row.Departamento||"").trim();
        const prov = String(row.Provincia||"").trim();
        const dist = String(row.Distrito||"").trim();
        if (!dep || !prov || !dist) continue;

        if (!MAP_D.has(dep)) MAP_D.set(dep, new Set());
        MAP_D.get(dep).add(prov);

        const kp = dep+"|"+prov;
        if (!MAP_P.has(kp)) MAP_P.set(kp, new Set());
        MAP_P.get(kp).add(dist);
    }
    }
    function fillDepartamentos(selDep, selected=""){
    clearAndDisable(selDep, false);
    selDep.appendChild(opt("", "Selecciona…"));
    [...MAP_D.keys()].sort().forEach(d=> selDep.appendChild(opt(d)));
    if (selected) selDep.value = selected;
    }
    function fillProvincias(selDep, selProv, selected=""){
    const dep = selDep.value;
    clearAndDisable(selProv, true);
    if (!dep || !MAP_D.has(dep)) return;
    selProv.disabled = false;
    selProv.appendChild(opt("", "Selecciona…"));
    [...MAP_D.get(dep)].sort().forEach(p=> selProv.appendChild(opt(p)));
    if (selected) selProv.value = selected;
    }
    function fillDistritos(selDep, selProv, selDist, selected=""){
    const dep = selDep.value, prov = selProv.value;
    clearAndDisable(selDist, true);
    const kp = dep+"|"+prov;
    if (!dep || !prov || !MAP_P.has(kp)) return;
    selDist.disabled = false;
    selDist.appendChild(opt("", "Selecciona…"));
    [...MAP_P.get(kp)].sort().forEach(d=> selDist.appendChild(opt(d)));
    if (selected) selDist.value = selected;
    }
    /** Llamar DESPUÉS de populateForm(...) */
    async function setupUbigeoCascada(datosActuales={}){
    const selDep  = document.getElementById("selDep");
    const selProv = document.getElementById("selProv");
    const selDist = document.getElementById("selDist");
    if (!selDep || !selProv || !selDist) return;

    await loadUbigeo();

    // hidrata según lo guardado
    const depSaved  = datosActuales?.ubicacion?.departamento || "";
    const provSaved = datosActuales?.ubicacion?.provincia   || "";
    const distSaved = datosActuales?.ubicacion?.distrito     || "";

    fillDepartamentos(selDep, depSaved);
    fillProvincias(selDep, selProv, provSaved);
    fillDistritos(selDep, selProv, selDist, distSaved);

    // cascada
    selDep.addEventListener("change", ()=>{
        fillProvincias(selDep, selProv, "");
        clearAndDisable(selDist, true);
        updateProgress();
        scheduleAutosave();
    });
    selProv.addEventListener("change", ()=>{
        fillDistritos(selDep, selProv, selDist, "");
        updateProgress();
        scheduleAutosave();
    });
    selDist.addEventListener("change", ()=>{
        updateProgress();
        scheduleAutosave();
    });
    }

    /* =========================================================
    ORG: Dirección → Área → Sección (JSON estático + cascada)
    ========================================================= */
    const ORG_URL = new URL("../data/org-estructura.json", import.meta.url).href;

    function toTitleCase(str){
    const KEEP_LOW = new Set(["y","e","de","del","la","las","el","los","a","en","con","para","por","o","u","al"]);
    return String(str||"")
        .toLowerCase()
        .replace(/\s+/g," ")
        .trim()
        .split(/(\s|-|\/)/)
        .map((tok,i)=>{
        if (/^(\s|-|\/)$/.test(tok)) return tok;
        if (i>0 && KEEP_LOW.has(tok)) return tok;
        if (tok.length<=3 && tok === tok.toUpperCase()) return tok;
        return tok.charAt(0).toUpperCase() + tok.slice(1);
        })
        .join("");
    }

    function buildOrgTree(rows){
    const pick = (row, keys) => {
        for (const k of keys) if (k in row && row[k]!=null && String(row[k]).trim()!=="") return row[k];
        return "";
    };

    const tree = {};
    rows.forEach(r=>{
        const d = toTitleCase(pick(r, ["Dirección","Direccion","DIRECCIÓN","DIRECCION","direccion"]));
        const a = toTitleCase(pick(r, ["Área","Area","ÁREA","AREA","área","area"]));
        const s = toTitleCase(pick(r, ["Sección","Seccion","SECCIÓN","SECCION","sección","seccion"]));
        if(!d || !a || !s) return;
        tree[d] ??= {};
        tree[d][a] ??= new Set();
        tree[d][a].add(s);
    });

    for (const d of Object.keys(tree)){
        for (const a of Object.keys(tree[d])){
        tree[d][a] = Array.from(tree[d][a]).sort((x,y)=>x.localeCompare(y,'es'));
        }
    }
    return tree;
    }

    function fillSelect(sel, items, placeholder="Selecciona…"){
    sel.innerHTML = "";
    const o0 = document.createElement("option");
    o0.value = ""; o0.textContent = placeholder;
    sel.appendChild(o0);

    items.forEach(v=>{
        const o=document.createElement("option");
        o.value=v; o.textContent=v;
        sel.appendChild(o);
    });

    sel.disabled = items.length === 0;
    }

    async function setupOrgCascader(savedData = {}){
    const selDir  = document.getElementById("selDirCorp");
    const selArea = document.getElementById("selAreaCorp");
    const selSec  = document.getElementById("selSeccionCorp");
    if(!selDir || !selArea || !selSec) return;

    let rows = [];
    try{
        const res = await fetch(ORG_URL, { cache:"force-cache" });
        rows = await res.json();
    }catch(e){
        console.warn("No se pudo cargar", ORG_URL, e);
        fillSelect(selDir, [], "Dirección…");
        fillSelect(selArea, [], "Área…");
        fillSelect(selSec,  [],  "Sección…");
        return;
    }
    const tree = buildOrgTree(rows);

    const dirs = Object.keys(tree).sort((a,b)=>a.localeCompare(b,'es'));
    fillSelect(selDir, dirs, "Dirección…");
    fillSelect(selArea, [],  "Área…");
    fillSelect(selSec,  [],  "Sección…");

    selDir.addEventListener("change", ()=>{
        const d = selDir.value;
        const areas = d ? Object.keys(tree[d]).sort((a,b)=>a.localeCompare(b,'es')) : [];
        fillSelect(selArea, areas, "Área…");
        fillSelect(selSec,  [],    "Sección…");
        updateProgress();
        scheduleAutosave();
    });

    selArea.addEventListener("change", ()=>{
        const d = selDir.value, a = selArea.value;
        const secs = (d && a) ? (tree[d][a] || []) : [];
        fillSelect(selSec, secs, "Sección…");
        updateProgress();
        scheduleAutosave();
    });

    selSec.addEventListener("change", ()=> { updateProgress(); scheduleAutosave(); });

    // hidratar guardados (normalizados a Title Case)
    const savedDir  = toTitleCase(savedData?.laboral?.direccionCorporativa || "");
    const savedArea = toTitleCase(savedData?.laboral?.area || "");
    const savedSec  = toTitleCase(savedData?.laboral?.seccion || "");

    if (savedDir && tree[savedDir]){
        selDir.value = savedDir;
        selDir.dispatchEvent(new Event("change"));
        if (savedArea && tree[savedDir][savedArea]){
        selArea.value = savedArea;
        selArea.dispatchEvent(new Event("change"));
        if (savedSec) selSec.value = savedSec;
        }
    }

    console.info(`[ORG] direcciones: ${dirs.length}`);
    }

    /* =========================
    Utils: deep set/get
    ========================= */
    function pathToParts(path) {
    const out = [];
    path.split(".").forEach(seg=>{
        const re = /([^[\]]+)|\[(\d+)\]/g; let m;
        while((m = re.exec(seg))){ out.push(m[1] ?? Number(m[2])); }
    });
    return out;
    }
    function setDeep(obj, path, value){
    const parts = pathToParts(path);
    let cur = obj;
    parts.forEach((k,i)=>{
        if(i === parts.length-1){ cur[k] = value; }
        else{
        const nextK = parts[i+1];
        if(cur[k] == null){ cur[k] = typeof nextK === "number" ? [] : {}; }
        cur = cur[k];
        }
    });
    }
    function getDeep(obj, path){
    try { return pathToParts(path).reduce((o,k)=>o?.[k], obj); }
    catch { return undefined; }
    }

    /* =========================
    Serializar / Poblar
    ========================= */
    function serializeForm(f){
    const out = {};
    try { new FormData(f); } catch { return out; }

    // 1) Campos simples
    f.querySelectorAll("input[name]:not([type=checkbox]), select[name], textarea[name]")
        .forEach(el => setDeep(out, el.name, (el.value ?? "").trim()));

    // 2) Checkboxes booleanos (los que NO terminan en [])
    f.querySelectorAll('input[type="checkbox"][name]:not([name$="[]"])')
        .forEach(el => setDeep(out, el.name, !!el.checked));

    // === SEGUROS (100% DOM, sin arrastres) ======================
    const segurosChecked = Array
        .from(f.querySelectorAll('input[type="checkbox"][name="salud.seguros[]"]:checked'))
        .map(el => el.getAttribute('data-key') || el.value);

    const fechas = {};
    for (const key of segurosChecked){
        const el = f.querySelector(`input.check-date[name="salud.segurosFechas.${CSS.escape(key)}"]`);
        const v  = el?.value?.trim();
        if (v) fechas[key] = v; // yyyy-mm-dd
    }

    out.salud = out.salud || {};
    out.salud.seguros = segurosChecked;          // siempre array (posible [])
    if (Object.keys(fechas).length) out.salud.segurosFechas = fechas;
    else delete out.salud.segurosFechas;
    // ============================================================

    // 3) Repetidores
    out.hijos = Array.isArray(out.hijos) ? out.hijos.map(x=>x||{}) : [];
    out.salud.alergias = (out.salud.alergias||[]).map(x=>String(x||"").trim()).filter(Boolean);
    out.salud.enfermedadesCronicas = (out.salud.enfermedadesCronicas||[]).map(x=>String(x||"").trim()).filter(Boolean);

    // 4) DNI: normalizo antes de guardar
    if (out?.personal?.doc) {
        out.personal.doc = normDNI(out.personal.doc);
    }

    // 5) Nacionalidad
    if (document.getElementById('selNacionalidad')) {
        const nval = leerNacionalidadParaGuardar();
        if (nval) {
        out.personal = out.personal || {};
        out.personal.nacionalidad = nval;
        const sel = document.getElementById('selNacionalidad');
        if (sel && sel.value !== 'OTRA' && out.personal.nacionalidadOtra !== undefined){
            delete out.personal.nacionalidadOtra;
        }
        }
    }

    // 6) Invitado: NO enviar nada de salud (blindaje extra)
    if (isInvite){
        if (out.salud){
        delete out.salud.seguros;
        delete out.salud.segurosFechas;
        delete out.salud.segurosOtro;
        if (!Object.keys(out.salud).some(k => k !== 'seguros' && k !== 'segurosFechas' && k !== 'segurosOtro')) {
            delete out.salud;
        }
        }
    }

    return out;
    }

    function populateForm(f, data){
    f.querySelectorAll("input[name],select[name],textarea[name]").forEach(el=>{
        const val = getDeep(data, el.name);
        if(val != null) el.value = val;
    });
    renderRepeaterHijos(data?.hijos || []);
    renderRepeaterText("#listAlergias", "tpl-texto", "salud.alergias", data?.salud?.alergias || []);
    renderRepeaterText("#listEnf",      "tpl-texto", "salud.enfermedadesCronicas", data?.salud?.enfermedadesCronicas || []);
    updateProgress();

    // >>> Seguros (checks + fechas) y lock
    hydrateSeguros(data);
    renderSegurosReadOnly(data);
    lockSegurosUIForNonAdminOrInvite();

    // >>> Estado ACTIVO/INACTIVO + lock para no-admin
    fichaActiva = getDeep(data, "meta.activo") !== false; // default true
    updateActivoUI(fichaActiva);
    applyInactiveLockUI();
    }

    /** Hidratar checks y fechas de seguros (limpia → aplica, SOLO si el check está marcado) */
    function hydrateSeguros(data){
    const norm = s => String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().trim();

    const arrRaw = data?.salud?.seguros;
    const marcados = Array.isArray(arrRaw) ? arrRaw.map(norm) : [];

    // 0) limpiar todo
    document.querySelectorAll('input[type="checkbox"][name="salud.seguros[]"]').forEach(chk=>{
        chk.checked = false;
    });
    document.querySelectorAll('input.check-date[name^="salud.segurosFechas."]').forEach(el=>{
        el.value = "";
        el.disabled = true;
        el.required = false;
    });

    // 1) checks (comparando en mayúsculas)
    document.querySelectorAll('input[type="checkbox"][name="salud.seguros[]"]').forEach(chk=>{
        const key = norm(chk.getAttribute('data-key') || chk.value);
        chk.checked = marcados.includes(key);
    });

    // 2) fechas (solo para los que están marcados)
    const fechas = (data?.salud?.segurosFechas && typeof data.salud.segurosFechas === "object") ? data.salud.segurosFechas : {};
    Object.entries(fechas).forEach(([k,v])=>{
        const K = norm(k);
        // aplica fecha solo si el seguro está marcado
        const chk = document.querySelector(`input[type="checkbox"][name="salud.seguros[]"][data-key="${K}"], input[type="checkbox"][name="salud.seguros[]"][value="${K}"]`);
        if (chk && chk.checked){
        const el = document.querySelector(`input.check-date[name="salud.segurosFechas.${CSS.escape(K)}"]`);
        if (el) el.value = v;
        }
    });

    // 3) habilitar/deshabilitar fechas según checks
    initSeguroFechas();

    // 4) bloquear según rol
    applyAdminLock();
    }

    /** Pinta un resumen de Seguros en el bloque read-only (#segSaludReadOnly) */
    function renderSegurosReadOnly(data){
    const ro = document.getElementById('segSaludReadOnly');
    if (!ro) return;

    const items = (Array.isArray(data?.salud?.seguros) ? data.salud.seguros : []).slice();
    const fechas = (data?.salud?.segurosFechas && typeof data.salud.segurosFechas === "object") ? data.salud.segurosFechas : {};

    // Rellenar UL sin perder el <strong>
    let ul = ro.querySelector('ul');
    if (!ul){
        ul = document.createElement('ul');
        ro.appendChild(ul);
    }
    ul.innerHTML = "";

    if (!items.length){
        ul.innerHTML = `<li style="color:#64748b">Sin seguros seleccionados.</li>`;
        return;
    }

    items.forEach(k => {
        const li = document.createElement('li');
        const f  = fechas?.[k] ? ` — desde ${fechas[k]}` : "";
        li.textContent = `${k}${f}`;
        ul.appendChild(li);
    });
    }

    /* =========================
    Repetidores
    ========================= */
    function renderRepeaterHijos(items){
    const c = $("#listHijos"); if(!c) return;
    c.innerHTML = "";
    const tpl = $("#tpl-hijo");
    items.forEach((item, i)=>{
        const node = tpl.content.cloneNode(true);
        node.querySelectorAll("[data-name]").forEach(el=>{
        const base = el.getAttribute("data-name"); // hijos[].campo
        el.name = base.replace("[]", `[${i}]`);
        });
        const delBtn = node.querySelector("[data-del]");
        if (delBtn) delBtn.dataset.del = "hijos";
        c.appendChild(node);
    });
    items.forEach((it, i)=>{
        Object.entries(it||{}).forEach(([k,v])=>{
        const el = form.querySelector(`[name="hijos[${i}].${k}"]`);
        if(el) el.value = v ?? "";
        });
    });
    }
    function renderRepeaterText(containerSel, tplId, base, items){
    const c = $(containerSel); if(!c) return;
    c.innerHTML = "";
    const tpl = document.getElementById(tplId);
    items.forEach((v, i)=>{
        const node = tpl.content.cloneNode(true);
        const input = node.querySelector("[input]");
        input.name = `${base}[${i}]`;
        const delBtn = node.querySelector("[data-del]");
        if (delBtn) delBtn.dataset.del = base;
        c.appendChild(node);
        const el = form.querySelector(`[name="${base}[${i}]"]`);
        if(el) el.value = v ?? "";
    });
    }

    /* =========================
    Progreso / completitud
    ========================= */
    const MUST = [
    "personal.doc","personal.estadoCivil","personal.nombres","personal.apellidos","personal.genero",
    "personal.nacimiento","personal.tallaCasaca","personal.nacionalidad", "contacto.telefono","contacto.correo",
    "ubicacion.direccion", "ubicacion.referencia", "ubicacion.departamento", "ubicacion.provincia", "ubicacion.distrito",
    "academica.nivel", "academica.profesion", "laboral.fechaIngreso", "laboral.categoria", "laboral.sede", "laboral.cargo",
    "laboral.direccionCorporativa", "laboral.area", "laboral.seccion","salud.tipoSangre", "emergencia.nombre",
    "emergencia.telefono","emergencia.parentesco"
    ];
    function completeness(obj){
    const filled = MUST.filter(k => String(getDeep(obj,k)||"").trim().length>0).length;
    return Math.round((filled / MUST.length) * 100);
    }
    function updateProgress(){
    const current = serializeForm(form);
    const c = completeness(current);
    if (bar) bar.style.width = `${c}%`;
    if (pct) pct.textContent = `${c}%`;
    }

    // --- Validación para modo invitación (cónyuge e hijos opcionales)
    function isFormCompleteInvite() {
    const data = serializeForm(form);

    // Asegura nacionalidad aunque el select no tenga name
    if (document.getElementById('selNacionalidad')) {
        const nval = leerNacionalidadParaGuardar();
        data.personal = data.personal || {};
        data.personal.nacionalidad = nval || data.personal.nacionalidad;
    }

    for (const k of MUST) {
        const v = getDeep(data, k);
        if (!v || String(v).trim().length === 0) return false;
    }
    return true;
    }

    function updateSaveState() {
    if (!btnSave) return;
    const okBase = isInvite ? isFormCompleteInvite() : true;
    const ok = okBase && !hasDniDuplicate;        // <- incluye estado de DNI duplicado
    btnSave.disabled = !ok;
    btnSave.setAttribute("aria-disabled", String(!ok));
    }

    /* =========================
    Autosave (debounce) — con chequeo JIT de DNI
    ========================= */
    function scheduleAutosave(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async ()=>{
        if(!currentId) return;

        try {
        // --- Chequeo JIT de DNI duplicado justo antes de escribir ---
        const dniVal = normDNI(form?.querySelector('[name="personal.doc"]')?.value || "");
        if (dniVal) {
            const dup = await findDuplicateByDNI(dniVal);
            applyDniDuplicateState(dup);   // actualiza UI/flag
            if (dup) {
            hint("No se guardó (autosave): DNI duplicado.");
            return; // cancelar escritura
            }
        }

        const delta = serializeForm(form);
        delta.updatedAt = Date.now();
        await setDoc(doc(db,"fichas", currentId), delta, { merge:true });
        hint("Guardado automático ✓");
        } catch(e){
        hint("No se pudo guardar automáticamente");
        console.warn(e);
        }
    }, AUTOSAVE_DELAY);
    }
    function hint(text){
    if(!msg) return;
    msg.style.color = "#0f172a";
    msg.textContent = text;
    setTimeout(()=>{ if(msg.textContent===text) msg.textContent=""; }, 1200);
    }

    /* =========================
    Crypto util para token
    ========================= */
    async function sha256Hex(str){
    const enc = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
    }

    /* =========================
    Crear ficha vacía
    ========================= */
    async function createEmptyFicha(){
    const ref = await addDoc(collection(db,"fichas"), {
        grants: {},
        estado: "borrador",
        hijos: [],
        salud: { alergias: [], enfermedadesCronicas: [] },
        meta: { activo: true }, // por defecto ACTIVA
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
    return ref.id;
    }

    /* =========================
    Modo invitación: preparar requeridos/escuchas
    ========================= */
    function setupInviteMode() {
    if (!isInvite) return;

    // Cónyuge opcional
    form.querySelectorAll('[name^="conyuge."]').forEach(el => {
        el.removeAttribute("required");
    });

    updateSaveState();

    form.querySelectorAll("input, select, textarea").forEach(el => {
        el.addEventListener("input", () => { updateSaveState(); updateProgress(); });
        el.addEventListener("change", () => { updateSaveState(); updateProgress(); });
    });

    const targets = ["#listHijos", "#listAlergias", "#listEnf"]
        .map(s => form.querySelector(s))
        .filter(Boolean);

    const mo = new MutationObserver(() => { updateSaveState(); updateProgress(); });
    targets.forEach(t => mo.observe(t, { childList: true, subtree: true }));

    updateSaveState();
    }

    /* =========================
    Bootstrap
    ========================= */
    (async function bootstrap(){
    loading(true);
    try{
        // A) Admin: abrir por id
        if (fichaIdParam){
        const snap = await getDoc(doc(db,"fichas", fichaIdParam));
        if(!snap.exists()){ setErr("Ficha no encontrada."); return; }
        currentId = snap.id;
        populateForm(form, snap.data());
        lockSegurosUIForNonAdminOrInvite();
        await setupUbigeoCascada(snap.data());   // UBIGEO
        await setupOrgCascader(snap.data());     // Dirección/Área/Sección
        updateSaveState(); 
        setupNacionalidad();
        hydrateNacionalidadDesdeDatos(snap.data());
        setupInviteMode();
        updateProgress();
        updateSaveState();
        return;
        }

        // B) Invitación (?i & ?t)
        if (isInvite){
        if (!auth.currentUser) await signInAnonymously(auth);

        const invRef  = doc(db,"invitaciones", inviteIdParam);
        const invSnap = await getDoc(invRef);
        if (!invSnap.exists()){ setErr("Invitación inválida."); return; }
        const inv = invSnap.data();

        if (inv.status === "revocado"){ setErr("Invitación revocada."); return; }
        if (inv.expiresAt && Date.now() > inv.expiresAt){ setErr("Invitación expirada."); return; }

        const tokenHash = await sha256Hex(tokenParam);
        if (tokenHash !== inv.tokenHash){ setErr("Token inválido."); return; }

        // Meta para reglas (validInviteWrite en Rules)
        inviteMeta = { inviteId: inviteIdParam, tokenHash };

        // Primera escritura: añade grant al UID anónimo
        await setDoc(doc(db,"fichas", inv.fichaId), {
            _inv: inviteMeta,
            grants: { [auth.currentUser.uid]: true },
            updatedAt: serverTimestamp()
        }, { merge:true });

        // Cargar ficha
        currentId = inv.fichaId;
        const fsnap = await getDoc(doc(db,"fichas", currentId));
        if(!fsnap.exists()){ setErr("Ficha no encontrada."); return; }
        populateForm(form, fsnap.data());
        lockSegurosUIForNonAdminOrInvite();
        await setupUbigeoCascada(fsnap.data());  // UBIGEO
        await setupOrgCascader(fsnap.data());    // ORG
        updateSaveState(); 
        setupNacionalidad();
        hydrateNacionalidadDesdeDatos(fsnap.data());
        setupInviteMode();
        updateProgress();
        updateSaveState();
        return;
        }

        // C) Admin sin id → crear
        if (AUTO_CREATE_WHEN_EMPTY){
        setOk("Creando ficha…");
        currentId = await createEmptyFicha();
        const baseData = { hijos:[], salud:{ alergias:[], enfermedadesCronicas: [] }, meta: { activo: true } };
        populateForm(form, baseData);
        lockSegurosUIForNonAdminOrInvite();
        await setupUbigeoCascada(baseData);  // UBIGEO
        await setupOrgCascader(baseData);    // ORG
        updateSaveState(); 
        setupNacionalidad();
        hydrateNacionalidadDesdeDatos(baseData);
        setupInviteMode();
        hint("Ficha creada ✓");
        updateProgress();
        updateSaveState();
        return;
        }

        setErr("No hay ficha activa.");
    }catch(e){
        const m = e?.code === "permission-denied"
        ? "No tienes permisos para ver/editar esta ficha."
        : (e?.message || "Error al cargar.");
        setErr(m);
        console.error(e);
    }finally{
        loading(false);
    }
    })();

    /* =========================
    Submit (guardar + revocar si invitado)
    ========================= */
    form?.addEventListener("submit", async (e)=>{
    e.preventDefault();

    // Si está INACTIVA y no eres admin → no se puede guardar
    if (!fichaActiva && !isAdminClient()){
        setErr("Esta ficha está inactiva. No puedes editar ni guardar.");
        return;
    }

    // En modo invitación: no permitir guardar si faltan obligatorios
    if (isInvite && !isFormCompleteInvite()) {
        setErr("Completa los campos obligatorios para guardar.");
        updateSaveState();
        return;
    }

    // Revalidar DNI duplicado antes de guardar
    const dniVal = normDNI(form?.querySelector('[name="personal.doc"]')?.value || "");
    if (dniVal){
        const dup = await findDuplicateByDNI(dniVal);
        applyDniDuplicateState(dup);
        if (dup || shouldBlockSave()){
        setErr("No puedes guardar: el DNI ya está registrado en otra ficha.");
        return;
        }
    }

    // Validación extra: si eres admin y hay seguros marcados sin fecha → bloquear
    if (!validateSegurosFechas()){
        updateSaveState();
        return;
    }

    try{
        loading(true);

        if(!currentId){
        setOk("Creando ficha…");
        currentId = await createEmptyFicha();
        }

        const payload = serializeForm(form);
        payload.updatedAt = Date.now();

        // Normaliza nacionalidad si usas el select con "OTRA"
        try {
        const nval = leerNacionalidadParaGuardar();
        if (nval) {
            payload.personal = payload.personal || {};
            payload.personal.nacionalidad = nval;
            const sel = document.getElementById('selNacionalidad');
            if (sel && sel.value !== 'OTRA' && payload.personal.nacionalidadOtra !== undefined){
            delete payload.personal.nacionalidadOtra;
            }
        }
        } catch {}

        // Estado según completitud
        const pctFilled = completeness(payload);
        payload.estado = pctFilled >= 80 ? "completo" : "borrador";

        // Meta de invitación para pasar reglas (solo si aplica)
        if (inviteMeta) payload._inv = inviteMeta;

        // Limpia el map completo de fechas para evitar “fantasmas”
        await updateDoc(doc(db,"fichas", currentId), { "salud.segurosFechas": {} });

        await setDoc(doc(db,"fichas", currentId), payload, { merge:true });

        if (inviteMeta){
        if (inviteMeta.inviteId){
            await updateDoc(doc(db,"invitaciones", inviteMeta.inviteId), {
            status: "completado",
            closedAt: serverTimestamp()
            });
        }
        await setDoc(doc(db,"fichas", currentId), {
            [`grants.${auth.currentUser.uid}`]: false,
            _inv: null,
            updatedAt: serverTimestamp()
        }, { merge:true });

        disableForm();
        setOk("Guardado ✓ Enlace cerrado. ¡Gracias!");
        try { window.close(); } catch(_) {}
        setTimeout(()=>{ doLogout(); }, 400);
        return;
        }

        setOk("Guardado ✓");
    }catch(e){
        const m = e?.code === "permission-denied"
        ? "No tienes permisos para guardar esta ficha."
        : (e?.message || "No se pudo guardar.");
        setErr(m);
        console.error(e);
    }finally{
        loading(false);
    }
    });

    /* =========================
    Cambios → progreso + autosave (+ validar botón)
    ========================= */
    form?.addEventListener("input", ()=>{
    updateProgress();
    updateSaveState();
    scheduleAutosave();
    });

    /* =========================
    Añadir / Eliminar filas
    ========================= */
    document.querySelectorAll("[data-add]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
        const target = btn.dataset.add;
        if(target === "hijos") addHijo();
        if(target === "alergias") addTexto("#listAlergias", "tpl-texto", "salud.alergias");
        if(target === "enf") addTexto("#listEnf", "tpl-texto", "salud.enfermedadesCronicas");
        scheduleAutosave();
        updateSaveState();
        updateProgress();
    });
    });

    document.addEventListener("click", (e)=>{
    const btn = e.target.closest("[data-del]");
    if(!btn) return;
    const row = btn.closest("[data-row]"); if(!row) return;

    const kind = btn.dataset.del;
    const label =
        kind === "hijos" ? "este hijo(a)" :
        kind === "salud.alergias" ? "esta alergia" :
        kind === "salud.enfermedadesCronicas" ? "esta enfermedad crónica" :
        "esta fila";

    if (!confirm(`¿Eliminar ${label}? Esta acción no se puede deshacer.`)) return;

    row.remove();
    if (kind === "hijos") reindexHijos();
    else if (kind === "salud.alergias") reindexText("#listAlergias", "salud.alergias");
    else if (kind === "salud.enfermedadesCronicas") reindexText("#listEnf", "salud.enfermedadesCronicas");

    scheduleAutosave();
    updateSaveState();
    updateProgress();
    hint("Elemento eliminado ✓");
    });

    /* =========================
    Helpers de reindexado
    ========================= */
    function addHijo(){
    const c = $("#listHijos"); const t = $("#tpl-hijo");
    const idx = c.querySelectorAll("[data-row='hijo']").length;
    const node = t.content.cloneNode(true);
    node.querySelectorAll("[data-name]").forEach(el=>{
        const base = el.getAttribute("data-name"); // hijos[].campo
        el.name = base.replace("[]", `[${idx}]`);
    });
    const delBtn = node.querySelector("[data-del]");
    if (delBtn) delBtn.dataset.del = "hijos";
    c.appendChild(node);
    updateSaveState();
    updateProgress();
    }
    function reindexHijos(){
    const c = $("#listHijos");
    c.querySelectorAll("[data-row='hijo']").forEach((row, i)=>{
        row.querySelectorAll("[name]").forEach(el=>{
        el.name = el.name.replace(/hijos\[\d+\]/, `hijos[${i}]`);
        });
    });
    }
    function addTexto(containerSel, tplId, base){
    const c = $(containerSel); const t = document.getElementById(tplId);
    const idx = c.querySelectorAll("[data-row='texto']").length;
    const node = t.content.cloneNode(true);
    const input = node.querySelector("[input]");
    input.name = `${base}[${idx}]`;
    const delBtn = node.querySelector("[data-del]");
    if (delBtn) delBtn.dataset.del = base;
    c.appendChild(node);
    }
    function reindexText(containerSel, base){
    const c = $(containerSel);
    c.querySelectorAll("[data-row='texto']").forEach((row, i)=>{
        const input = row.querySelector("[input]");
        if(input){ input.name = `${base}[${i}]`; }
    });
    }

    /* =========================
    Mensajería UI
    ========================= */
    function setOk(text){ if(msg){ msg.style.color = "#166534"; msg.textContent = text; setTimeout(()=>msg.textContent="", 1600); } }
    function setErr(text){ if(msg){ msg.style.color = "#b91c1c"; msg.textContent = text; } }
    function disableForm(){ form?.querySelectorAll("input,select,textarea,button").forEach(el=> el.disabled = true); }

    /* =========================
    Nacionalidad: select + "OTRA"
    ========================= */
    function _norm(s){
    return String(s || "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().trim();
    }
    function _findOptionInsensitive(sel, saved){
    const target = _norm(saved);
    for (const opt of Array.from(sel.options)){
        if (_norm(opt.value) === target) return opt.value;
        if (_norm(opt.text)  === target) return opt.value;
    }
    return null;
    }

    function setupNacionalidad() {
    const sel = document.getElementById('selNacionalidad');
    const wrapOtra = document.getElementById('wrapNacOtra');
    const inputOtra = document.querySelector('[name="personal.nacionalidadOtra"]');

    if (!sel || !wrapOtra || !inputOtra) return;

    const toggle = () => {
        const isOtra = sel.value === 'OTRA';
        wrapOtra.classList.toggle('hidden', !isOtra);
        inputOtra.required = isOtra;
        if (!isOtra) inputOtra.value = '';
    };

    sel.addEventListener('change', toggle);
    toggle();
    }

    function hydrateNacionalidadDesdeDatos(datos) {
    const sel = document.getElementById('selNacionalidad');
    const wrapOtra = document.getElementById('wrapNacOtra');
    const inputOtra = document.querySelector('[name="personal.nacionalidadOtra"]');
    if (!sel) return;

    const guardada = (datos?.personal?.nacionalidad || '').toString().trim();
    if (!guardada) return;

    const matchVal = _findOptionInsensitive(sel, guardada);

    if (matchVal) {
        sel.value = matchVal;
        wrapOtra?.classList.add('hidden');
        if (inputOtra) inputOtra.value = '';
    } else {
        sel.value = 'OTRA';
        wrapOtra?.classList.remove('hidden');
        if (inputOtra) inputOtra.value = guardada;
    }
    }

    function leerNacionalidadParaGuardar() {
    const sel = document.getElementById('selNacionalidad');
    const inputOtra = document.querySelector('[name="personal.nacionalidadOtra"]');
    if (!sel) return '';
    return sel.value === 'OTRA' ? (inputOtra?.value?.trim() || 'OTRA') : sel.value;
    }
