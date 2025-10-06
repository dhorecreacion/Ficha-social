// js/ficha.js — Editor de Ficha Social (invitación + autosave + revocar tras guardar)

import { auth, db } from "./firebase.js";
import {
  collection, doc, getDoc, setDoc, addDoc, updateDoc,
  serverTimestamp, signInAnonymously
} from "./firebase.js";
import { doLogout } from "./guard.js";

const $ = (s)=>document.querySelector(s);
$("#btnLogout")?.addEventListener("click",(e)=>{ e.preventDefault(); doLogout(); });

// --- DOM ---
const form = $("#form");
const msg  = $("#msg");
const bar  = $("#progressBar");
const pct  = $("#progressPct");

// --- Parámetros de URL ---
const p = new URLSearchParams(location.search);
const fichaIdParam  = p.get("id");
const inviteIdParam = p.get("i");
const tokenParam    = p.get("t");

// --- Flags ---
const AUTO_CREATE_WHEN_EMPTY = true;              // Admin sin id → crea ficha
const isInvite = !!(inviteIdParam && tokenParam); // Modo invitación
if (isInvite) document.body.classList.add("invite-only");

// --- Loader pantalla completa ---
const screenLoader = document.getElementById("screenLoader");
function loading(on){ screenLoader?.classList.toggle("hidden", !on); }

// --- Estado runtime ---
let currentId   = null;
let inviteMeta  = null;  // { inviteId, tokenHash } cuando llega por invitación
let saveTimer   = null;
const AUTOSAVE_DELAY = 1200;

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
  const fd = new FormData(f);
  for (const [name, raw] of fd.entries()){
    const val = typeof raw === "string" ? raw.trim() : raw;
    setDeep(out, name, val);
  }
  // Normaliza arrays
  out.hijos = Array.isArray(out.hijos) ? out.hijos.map(x=>x||{}) : [];
  out.salud = out.salud || {};
  out.salud.alergias = (out.salud.alergias||[]).map(x=>String(x||"").trim()).filter(Boolean);
  out.salud.enfermedadesCronicas = (out.salud.enfermedadesCronicas||[]).map(x=>String(x||"").trim()).filter(Boolean);
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
  "personal.doc","personal.nombres","personal.apellidos","personal.genero","personal.nacimiento","personal.nacionalidad","personal.estadoCivil",
  "contacto.telefono","contacto.correo",
  "ubicacion.direccion","ubicacion.departamento","ubicacion.provincia","ubicacion.distrito",
  "laboral.categoria","laboral.sede"
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

/* =========================
   Autosave (debounce)
========================= */
function scheduleAutosave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async ()=>{
    if(!currentId) return;
    try {
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
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ref.id;
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

      // Meta para reglas (validInviteWrite)
      inviteMeta = { inviteId: inviteIdParam, tokenHash };

      // Dar grant al UID anónimo (primera escritura)
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
      return;
    }

    // C) Admin sin id → crear
    if (AUTO_CREATE_WHEN_EMPTY){
      setOk("Creando ficha…");
      currentId = await createEmptyFicha();
      populateForm(form,{ hijos:[], salud:{ alergias:[], enfermedadesCronicas:[] } });
      hint("Ficha creada ✓");
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
  try{
    loading(true);

    if(!currentId){
      setOk("Creando ficha…");
      currentId = await createEmptyFicha();
    }

    const payload = serializeForm(form);
    payload.updatedAt = Date.now();

    // Estado según completitud
    const p = completeness(payload);
    payload.estado = p >= 80 ? "completo" : "borrador";

    // Meta de invitación para pasar reglas (solo si aplica)
    if (inviteMeta) payload._inv = inviteMeta;

    // Guarda (crea/actualiza)
    await setDoc(doc(db,"fichas", currentId), payload, { merge:true });

    // Si venimos por invitación → intentar marcar invitación, revocar y cerrar
    if (inviteMeta){
      // 1) Intentar marcar invitación como completado (si falla, seguimos)
      try {
        if (inviteMeta.inviteId){
          await updateDoc(doc(db,"invitaciones", inviteMeta.inviteId), {
            status: "completado",
            closedAt: serverTimestamp()
          });
        }
      } catch(e) {
        console.warn("No se pudo actualizar invitación (seguimos):", e);
      }

      // 2) Quitar grant al UID anónimo y limpiar meta _inv
      await setDoc(doc(db,"fichas", currentId), {
        [`grants.${auth.currentUser.uid}`]: false,
        _inv: null,
        updatedAt: serverTimestamp()
      }, { merge:true });

      // 3) Deshabilitar y cerrar / logout
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
   Cambios → progreso + autosave
========================= */
form?.addEventListener("input", ()=>{
  updateProgress();
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
