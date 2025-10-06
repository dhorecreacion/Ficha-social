    // js/dashboard.js — Dashboard de Fichas (ADMIN)
    // Charts: se crean solo si existe el <canvas> con ese id.
    // Requiere: Chart.js (cdn), guard.js (autenticado), y reglas que permitan leer a admin.

    import {
    auth, db,
    collection, query, orderBy, limit, getDocs, startAfter
    } from "./firebase.js";
    import { doLogout } from "./guard.js";

    const $ = (s)=>document.querySelector(s);
    $("#btnLogout")?.addEventListener("click",(e)=>{ e.preventDefault(); doLogout(); });

    const el = {
    kpiTotal: $("#kpiTotal"),
    kpiComplete: $("#kpiComplete"),
    kpiDraft: $("#kpiDraft"),
    kpiAvg: $("#kpiAvg"),
    msg: $("#msg"),
    fltSede: $("#fltSede"),
    fltRango: $("#fltRango"),
    btnRefrescar: $("#btnRefrescar"),
    };

    let ALL = [];          // todas las fichas (hasta 2,000)
    let FILTERED = [];     // fichas luego de filtros UI
    const charts = {};     // id -> Chart instance

    // ========= Utilidades =========
    function setMsg(t){ if (el.msg) el.msg.textContent = t || ""; }
    function esc(s){ return String(s ?? "").trim(); }
    function notEmpty(s){ return String(s||"").trim().length>0; }

    function getTS(v){
    // Firestore Timestamp -> Date | number(ms) -> Date | string yyyy-mm-dd -> Date
    try{
        if (!v) return null;
        if (typeof v?.toDate === "function") return v.toDate();
        if (typeof v === "number") return new Date(v);
        if (typeof v === "string") return new Date(v);
        return null;
    }catch{ return null; }
    }

    function yearsBetween(date, now=new Date()){
    if (!date) return null;
    const d = new Date(date);
    if (isNaN(d)) return null;
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m===0 && now.getDate() < d.getDate())) age--;
    return age;
    }

    // Adultos
    function ageGroupAdult(age){
    if (age==null) return "Sin fecha";
    if (age < 25)  return "<25";
    if (age < 35)  return "25–34";
    if (age < 45)  return "35–44";
    if (age < 55)  return "45–54";
    return "55+";
    }
    // Hijos
    function ageGroupChild(age){
    if (age==null) return "Sin fecha";
    if (age <= 5)   return "0–5";
    if (age <= 12)  return "6–12";
    if (age <= 17)  return "13–17";
    return "18+";
    }

    function countBy(arr, keyFn){
    const m = new Map();
    for (const x of arr){
        const k = keyFn(x);
        if (!k) continue;
        m.set(k, (m.get(k)||0)+1);
    }
    return m;
    }
    function sumBy(arr, keyFn){
    const m = new Map();
    for (const x of arr){
        const [k, n] = keyFn(x); // return [key, number]
        if (!k) continue;
        m.set(k, (m.get(k)||0)+(n||0));
    }
    return m;
    }
    function topN(map, n=12, otrosLabel="Otros"){
    const entries = [...map.entries()].sort((a,b)=>b[1]-a[1]);
    const head = entries.slice(0, n);
    const tail = entries.slice(n);
    const extra = tail.reduce((acc,[,v])=>acc+v, 0);
    return extra>0 ? head.concat([[otrosLabel, extra]]) : head;
    }

    // Completitud como en fichas/ficha
    const MUST = [
    "personal.doc","personal.nombres","personal.apellidos","personal.genero","personal.nacimiento","personal.nacionalidad","personal.estadoCivil",
    "contacto.telefono","contacto.correo",
    "ubicacion.direccion","ubicacion.departamento","ubicacion.provincia","ubicacion.distrito",
    "laboral.categoria","laboral.sede"
    ];
    function getDeep(o, path){ return path.split(".").reduce((a,k)=>a?.[k], o); }
    function completeness(r){
    const filled = MUST.filter(k => String(getDeep(r,k) ?? "").trim().length>0).length;
    return Math.round((filled / MUST.length) * 100);
    }

    // ========= Data: carga con paginación =========
    async function fetchAllFichas(max=2000, page=500){
    const out = [];
    let last = null;
    while (out.length < max){
        const qy = last
        ? query(collection(db,"fichas"), orderBy("createdAt","desc"), startAfter(last), limit(page))
        : query(collection(db,"fichas"), orderBy("createdAt","desc"), limit(page));
        const snap = await getDocs(qy);
        if (snap.empty) break;
        out.push(...snap.docs.map(d => ({ id:d.id, ...d.data() })));
        last = snap.docs[snap.docs.length-1];
        if (snap.size < page) break;
    }
    return out;
    }

    // ========= Filtros UI =========
    function applyFilters(){
    const sede = el.fltSede?.value || "";
    const rango = el.fltRango?.value || "30";
    const now = new Date();

    let fromDate = null;
    if (rango !== "all"){
        const days = parseInt(rango,10);
        fromDate = new Date(now.getTime() - days*24*60*60*1000);
    }

    FILTERED = ALL.filter(r=>{
        if (sede && (r.laboral?.sede !== sede)) return false;
        if (fromDate){
        const d = getTS(r.createdAt);
        if (!d || d < fromDate) return false;
        }
        return true;
    });
    }

    // ========= KPIs =========
    function paintKPIs(rows){
    const total = rows.length;
    const comp  = rows.map(completeness);
    const avg   = Math.round(comp.reduce((a,x)=>a+x,0) / (comp.length||1));
    const complete80 = comp.filter(x=>x>=80).length;
    const draft = rows.filter(r => (r.estado||"").toLowerCase()==="borrador").length;

    if (el.kpiTotal)    el.kpiTotal.textContent = total;
    if (el.kpiAvg)      el.kpiAvg.textContent   = `${avg}%`;
    if (el.kpiComplete) el.kpiComplete.textContent = complete80;
    if (el.kpiDraft)    el.kpiDraft.textContent = draft;
    }

    // ========= Charts helpers =========
    function ensureChart(id, type, data, options={}){
    const canvas = document.getElementById(id);
    if (!canvas) return; // si no existe el canvas, no hacemos nada
    const ctx = canvas.getContext("2d");
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, { type, data, options });
    }

    function barOpts(title, stacked=false){
    return {
        responsive: true,
        plugins: { legend:{display:false}, title:{display: !!title, text:title} },
        scales: {
        x: { stacked },
        y: { stacked, beginAtZero:true, ticks:{ precision:0 } }
        }
    };
    }

    function pieOpts(title){
    return {
        responsive: true,
        plugins: { legend:{ position:"bottom" }, title:{ display: !!title, text:title } }
    };
    }

    // ========= Charts: calcular datasets y pintar =========
    function paintCharts(rows){
    // ---------- Datos base ----------
    const genero = countBy(rows, r => esc(r.personal?.genero));
    const sede   = countBy(rows, r => esc(r.laboral?.sede));
    const categoria = countBy(rows, r => esc(r.laboral?.categoria));
    const estadoCivil = countBy(rows, r => esc(r.personal?.estadoCivil));
    const area   = countBy(rows, r => esc(r.laboral?.area));
    const prov   = countBy(rows, r => esc(r.ubicacion?.provincia));

    const edades = countBy(rows, r => {
        const age = yearsBetween(esc(r.personal?.nacimiento) ? new Date(r.personal.nacimiento) : null);
        return ageGroupAdult(age);
    });

    // Completitud -> histograma 10 en 10
    const bins = new Map([["0–20",0],["21–40",0],["41–60",0],["61–80",0],["81–100",0]]);
    for (const r of rows){
        const p = completeness(r);
        if (p<=20) bins.set("0–20", bins.get("0–20")+1);
        else if (p<=40) bins.set("21–40", bins.get("21–40")+1);
        else if (p<=60) bins.set("41–60", bins.get("41–60")+1);
        else if (p<=80) bins.set("61–80", bins.get("61–80")+1);
        else bins.set("81–100", bins.get("81–100")+1);
    }

    // Fichas por semana (últimas 12)
    const byWeek = new Map(); // YYYY-WW -> count
    const fmtWeek = (d)=>{
        const date = getTS(d?.toDate ? d : d);
        if (!date) return null;
        const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = tmp.getUTCDay() || 7;
        tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(),0,1));
        const weekNo = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
        return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2,"0")}`;
    };
    rows.forEach(r=>{
        const key = fmtWeek(r.createdAt);
        if (!key) return;
        byWeek.set(key, (byWeek.get(key)||0)+1);
    });
    const weeksSorted = [...byWeek.entries()].sort((a,b)=>a[0].localeCompare(b[0])).slice(-12);

    // Alergias (top 15)
    const alergias = new Map();
    rows.forEach(r=>{
        const arr = r?.salud?.alergias || [];
        arr.forEach(x=>{
        const k = esc(x).toUpperCase();
        if (!k) return;
        alergias.set(k, (alergias.get(k)||0)+1);
        });
    });
    const topAlergias = topN(alergias, 15);

    // Hijos
    const hijosCount = rows.reduce((a,r)=> a + ((r.hijos||[]).length||0), 0);
    const hijosPorSede = sumBy(rows, r=>[esc(r.laboral?.sede), (r.hijos||[]).length||0]);
    // Hijos por edad (consolidado)
    const hijosAges = new Map([["0–5",0],["6–12",0],["13–17",0],["18+",0],["Sin fecha",0]]);
    rows.forEach(r=>{
        (r.hijos||[]).forEach(h=>{
        const age = yearsBetween(esc(h?.nacimiento) ? new Date(h.nacimiento) : null);
        const g = ageGroupChild(age);
        hijosAges.set(g, (hijosAges.get(g)||0)+1);
        });
    });
    // Distribución de # hijos por ficha
    const hijosDist = new Map([["0",0],["1",0],["2",0],["3",0],["4+",0]]);
    rows.forEach(r=>{
        const n = (r.hijos||[]).length||0;
        if (n===0) hijosDist.set("0", hijosDist.get("0")+1);
        else if (n===1) hijosDist.set("1", hijosDist.get("1")+1);
        else if (n===2) hijosDist.set("2", hijosDist.get("2")+1);
        else if (n===3) hijosDist.set("3", hijosDist.get("3")+1);
        else hijosDist.set("4+", hijosDist.get("4+")+1);
    });

    // ---------- Pintar (solo si existe el canvas) ----------
    ensureChart("chGenero","pie",{
        labels:[...genero.keys()],
        datasets:[{ data:[...genero.values()] }]
    }, pieOpts("Distribución por género"));

    ensureChart("chSede","bar",{
        labels:[...sede.keys()],
        datasets:[{ data:[...sede.values()] }]
    }, barOpts("Fichas por sede"));

    ensureChart("chEdad","bar",{
        labels:[...edades.keys()],
        datasets:[{ data:[...edades.values()] }]
    }, barOpts("Por grupo de edad (adultos)"));

    ensureChart("chCategoria","bar",{
        labels:[...categoria.keys()],
        datasets:[{ data:[...categoria.values()] }]
    }, barOpts("Por categoría"));

    ensureChart("chEstadoCivil","bar",{
        labels:[...estadoCivil.keys()],
        datasets:[{ data:[...estadoCivil.values()] }]
    }, barOpts("Por estado civil"));

    ensureChart("chArea","bar",{
        labels:[...area.keys()],
        datasets:[{ data:[...area.values()] }]
    }, barOpts("Por área"));

    // Provincias (top 15 + Otros)
    {
        const provTop = topN(prov, 15, "Otros");
        ensureChart("chProvincia","bar",{
        labels: provTop.map(([k])=>k),
        datasets:[{ data: provTop.map(([,v])=>v) }]
        }, barOpts("Provincia de residencia (top 15)"));
    }

    ensureChart("chAlergias","bar",{
        labels: topAlergias.map(([k])=>k),
        datasets:[{ data: topAlergias.map(([,v])=>v) }]
    }, barOpts("Alergias (top 15)"));

    ensureChart("chHijosTotal","bar",{
        labels:["Total hijos"],
        datasets:[{ data:[hijosCount] }]
    }, barOpts("Total de hijos (suma)"));

    ensureChart("chHijosPorSede","bar",{
        labels:[...hijosPorSede.keys()],
        datasets:[{ data:[...hijosPorSede.values()] }]
    }, barOpts("Hijos por sede"));

    ensureChart("chHijosEdad","bar",{
        labels:[...hijosAges.keys()],
        datasets:[{ data:[...hijosAges.values()] }]
    }, barOpts("Hijos por rango de edad"));

    ensureChart("chHijosDist","bar",{
        labels:[...hijosDist.keys()],
        datasets:[{ data:[...hijosDist.values()] }]
    }, barOpts("Distribución de # de hijos por ficha"));

    ensureChart("chCompleto","bar",{
        labels:[...bins.keys()],
        datasets:[{ data:[...bins.values()] }]
    }, barOpts("Completitud (0–100%)"));

    ensureChart("chTiempo","line",{
        labels: weeksSorted.map(([k])=>k),
        datasets:[{ label:"Fichas/semana", data: weeksSorted.map(([,v])=>v), tension:.2 }]
    }, { responsive:true, plugins:{ legend:{display:false}, title:{display:true,text:"Fichas por semana (12)" } }, scales:{ y:{ beginAtZero:true, ticks:{ precision:0 } } }});
    }

    // ========= Main =========
    async function main(){
    try{
        setMsg("Cargando…");
        ALL = await fetchAllFichas();
        applyFilters();
        paintKPIs(FILTERED);
        paintCharts(FILTERED);
        setMsg("");
    }catch(e){
        console.error(e);
        if (e?.code === "permission-denied"){
        setMsg("No tienes permisos para ver el dashboard (se requiere administrador).");
        }else{
        setMsg(e?.message || "Error al cargar el dashboard.");
        }
    }
    }

    // Interacciones
    el.btnRefrescar?.addEventListener("click", ()=>{
    applyFilters();
    paintKPIs(FILTERED);
    paintCharts(FILTERED);
    });
    el.fltSede?.addEventListener("change", ()=>{
    applyFilters();
    paintKPIs(FILTERED);
    paintCharts(FILTERED);
    });
    el.fltRango?.addEventListener("change", ()=>{
    applyFilters();
    paintKPIs(FILTERED);
    paintCharts(FILTERED);
    });

    // Arranque cuando hay sesión
    auth.onAuthStateChanged((u)=>{
    if (!u) return; // guard.js ya redirige si no hay sesión
    main();
    });
