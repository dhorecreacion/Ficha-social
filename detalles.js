    import { auth, db, ADMIN_UIDS } from "./firebase-config.js";
    import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
    import {
    doc,
    getDoc,
    updateDoc,
    serverTimestamp
    } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

    let orgEstructura = [];

    async function fetchOrgEstructura() {
    try {
        const res = await fetch("./org-estructura.json");
        orgEstructura = await res.json();
    } catch (e) {
        console.error("No se pudo cargar org-estructura.json:", e);
    }
    }

    const SEGURO_OPTIONS = [
    "ESSALUD",
    "EPS",
    "Red salud",
    "FOLA",
    "Seguro particular"
    ];

    const $ = (s) => document.querySelector(s);

    const msg = $("#msg");
    const estadoEl = $("#estado");
    const correoEl = $("#correo");
    const observacionAdminEl = $("#observacionAdmin");
    const btnGuardar = $("#btnGuardar");
    const btnObservar = $("#btnObservar");
    const btnAprobar = $("#btnAprobar");
    const btnToggleActivo = $("#btnToggleActivo");
    const btnAgregarSeguro = $("#btnAgregarSeguro");
    const segurosEditor = $("#segurosEditor");
    const segurosAdminCard = $("#segurosAdminCard");
    const tallaCasacaEl = $("#tallaCasaca");
    const tallaPantalonEl = $("#tallaPantalon");
    const chkDeclaracionHerederos = $("#chkDeclaracionHerederos");

    const editCategoriaEl  = $("#editCategoria");
    const editSedeEl       = $("#editSede");
    const editCargoEl      = $("#editCargo");
    const editFechaIngresoEl = $("#editFechaIngreso");
    const editDireccionEl  = $("#editDireccion");
    const editAreaEl       = $("#editArea");
    const editSeccionEl    = $("#editSeccion");

    const params = new URLSearchParams(window.location.search);
    const fichaId = params.get("id");

    let fichaRef = null;
    let fichaData = null;
    let session = { user: null, isAdmin: false };

    onAuthStateChanged(auth, async (user) => {
    if (!user) {
        location.href = "index.html";
        return;
    }

    session.user = user;
    session.isAdmin = ADMIN_UIDS.has(user.uid);

    if (!fichaId) {
        setMsg("No se encontró el ID de la ficha.");
        return;
    }

    bindEvents();
    await fetchOrgEstructura();
    await cargarFicha();
    });

    /* ---- Cascada Dirección → Área → Sección ---- */
    function orgDirecciones() {
    return [...new Set(orgEstructura.map((r) => r.Direccion))].sort();
    }

    function orgAreas(dir) {
    return [...new Set(
        orgEstructura.filter((r) => r.Direccion === dir).map((r) => r.Area)
    )].sort();
    }

    function orgSecciones(dir, area) {
    return [...new Set(
        orgEstructura.filter((r) => r.Direccion === dir && r.Area === area).map((r) => r.Seccion)
    )].sort();
    }

    function fillSelect(el, options, placeholder, current) {
    if (!el) return;
    const currentLower = (current || "").trim().toLowerCase();
    el.innerHTML = `<option value="">— ${placeholder} —</option>` +
        options.map((o) => `<option value="${o}"${o.toLowerCase() === currentLower ? " selected" : ""}>${o}</option>`).join("");
    }

    // Devuelve el valor canónico del JSON que coincide (ignora mayúsculas/minúsculas)
    function canonicalize(stored, options) {
    const lower = (stored || "").trim().toLowerCase();
    return options.find((o) => o.toLowerCase() === lower) || "";
    }

    function initDireccionSelect(currentDir) {
    fillSelect(editDireccionEl, orgDirecciones(), "Seleccionar", currentDir);
    }

    function refreshAreaSelect(dir, currentArea) {
    if (!dir) {
        fillSelect(editAreaEl, [], "Seleccionar dirección primero", "");
        fillSelect(editSeccionEl, [], "Seleccionar área primero", "");
        return;
    }
    fillSelect(editAreaEl, orgAreas(dir), "Seleccionar", currentArea);
    }

    function refreshSeccionSelect(dir, area, currentSeccion) {
    if (!dir || !area) {
        fillSelect(editSeccionEl, [], "Seleccionar área primero", "");
        return;
    }
    fillSelect(editSeccionEl, orgSecciones(dir, area), "Seleccionar", currentSeccion);
    }

    function loadLaboralEditors(r) {
    if (editCategoriaEl)    editCategoriaEl.value    = r.laboral?.categoria    || "";
    if (editSedeEl)         editSedeEl.value         = r.laboral?.sede         || "";
    if (editCargoEl)        editCargoEl.value        = r.laboral?.cargo        || "";
    if (editFechaIngresoEl) editFechaIngresoEl.value = r.laboral?.fechaIngreso || "";

    // Normaliza contra los valores canónicos del JSON (ignora diferencias de capitalización)
    const rawDir  = r.laboral?.direccionCorporativa || "";
    const rawArea = r.laboral?.area    || "";
    const rawSec  = r.laboral?.seccion || "";

    const dir  = canonicalize(rawDir,  orgDirecciones());
    const area = canonicalize(rawArea, orgAreas(dir));
    const sec  = canonicalize(rawSec,  orgSecciones(dir, area));

    initDireccionSelect(dir);
    refreshAreaSelect(dir, area);
    refreshSeccionSelect(dir, area, sec);
    }

    function bindEvents() {
    btnGuardar?.addEventListener("click", guardarCambios);

    editDireccionEl?.addEventListener("change", () => {
        refreshAreaSelect(editDireccionEl.value, "");
    });

    editAreaEl?.addEventListener("change", () => {
        refreshSeccionSelect(editDireccionEl?.value || "", editAreaEl.value, "");
    });

    btnObservar?.addEventListener("click", async () => {
        estadoEl.value = "observado";
        await guardarEstadoRapido("Ficha marcada como observada.");
    });

    btnAprobar?.addEventListener("click", async () => {
        estadoEl.value = "aprobado";
        await guardarEstadoRapido("Ficha aprobada correctamente.");
    });

    btnToggleActivo?.addEventListener("click", async () => {
        if (!fichaRef || !fichaData || !session.isAdmin) return;

        const activoActual = fichaData?.meta?.activo !== false;
        const nuevoEstado = !activoActual;

        try {
        btnToggleActivo.disabled = true;

        await updateDoc(fichaRef, {
            meta: {
            ...(fichaData?.meta || {}),
            activo: nuevoEstado
            },
            updatedAt: serverTimestamp()
        });

        await cargarFicha();
        setMsg(nuevoEstado ? "Ficha activada." : "Ficha inactivada.");
        } catch (error) {
        console.error(error);
        setMsg("No se pudo cambiar el estado activo/inactivo.");
        } finally {
        btnToggleActivo.disabled = false;
        }
    });

    btnAgregarSeguro?.addEventListener("click", () => {
        if (!session.isAdmin) return;
        addSeguroRow();
    });
    }

    async function cargarFicha() {
    try {
        setMsg("Cargando ficha...");

        fichaRef = doc(db, "fichas", fichaId);
        const snap = await getDoc(fichaRef);

        if (!snap.exists()) {
        setMsg("La ficha no existe.");
        return;
        }

        fichaData = { id: snap.id, ...snap.data() };
        renderFicha(fichaData);
        setMsg("");
    } catch (error) {
        console.error(error);
        setMsg("No se pudo cargar la ficha.");
    }
    }

    function renderFicha(r) {
    const nombreCompleto = `${r.personal?.apellidos || ""} ${r.personal?.nombres || ""}`.trim();
    const direccionCompleta = [
        r.ubicacion?.direccion,
        r.ubicacion?.distrito,
        r.ubicacion?.provincia,
        r.ubicacion?.departamento
    ].filter(Boolean).join(", ");

    $("#dni").value = r.personal?.doc || "";
    $("#nombreCompleto").value = nombreCompleto;
    $("#sede").value = r.laboral?.sede || "";
    $("#correo").value = r.contacto?.correo || "";
    $("#estado").value = normalizeEstadoValue(r.estado || "borrador");
    $("#ultimaActualizacion").value = formatFechaHora(r.updatedAt || r.createdAt);
    $("#observacionAdmin").value = r.admin?.observacion || "";

    if (tallaCasacaEl) tallaCasacaEl.value = r.personal?.tallaCasaca || "";
    const TALLA_PANTALON_LEGACY = { XS:"26", S:"28", M:"30", L:"32", XL:"34", XXL:"36", XXXL:"38" };
    if (tallaPantalonEl) tallaPantalonEl.value = TALLA_PANTALON_LEGACY[r.personal?.tallaPantalon] || r.personal?.tallaPantalon || "";
    if (chkDeclaracionHerederos) chkDeclaracionHerederos.checked = r.meta?.declaracionHerederos === true;

    $("#estadoCivil").textContent = r.personal?.estadoCivil || "-";
    $("#telefono").textContent = r.contacto?.telefono || "-";
    $("#direccion").textContent = direccionCompleta || "-";

    $("#genero").textContent = r.personal?.genero || "-";
    $("#fechaNacimiento").textContent = formatFecha(r.personal?.nacimiento);
    $("#nacionalidad").textContent = r.personal?.nacionalidadOtra || r.personal?.nacionalidad || "-";

    $("#categoria").textContent = r.laboral?.categoria || "-";
    $("#cargo").textContent = r.laboral?.cargo || "-";
    $("#fechaIngreso").textContent = formatFecha(r.laboral?.fechaIngreso);
    $("#area").textContent = r.laboral?.area || "-";
    $("#direccionCorporativa").textContent = r.laboral?.direccionCorporativa || "-";
    $("#seccion").textContent = r.laboral?.seccion || "-";

    $("#nivelAcademico").textContent = r.academica?.nivel || "-";
    $("#profesion").textContent = r.academica?.profesion || "-";

    const conyugeData = r.familia?.conyuge || r.conyuge || null;
    const conyugeNombreCompleto = [conyugeData?.nombres, conyugeData?.apellidos].filter(Boolean).join(" ") || conyugeData?.nombre || "-";
    $("#conyugeNombre").textContent = conyugeNombreCompleto;
    $("#conyugeNacimiento").textContent = formatFecha(conyugeData?.fechaNacimiento || conyugeData?.nacimiento);

    const hijosData = Array.isArray(r.familia?.hijos) ? r.familia.hijos : Array.isArray(r.hijos) ? r.hijos : [];
    $("#dependientes").textContent = hijosData.length;
    $("#hijos").innerHTML = hijosData.length ? formatHijosHTML(hijosData) : "-";

    const emergenciaData = r.familia?.emergencia || r.emergencia || {};
    $("#contactoEmergencia").textContent = emergenciaData.nombre || "-";
    $("#parentescoEmergencia").textContent = emergenciaData.parentesco || "-";
    $("#telefonoEmergencia").textContent = emergenciaData.telefono || "-";

    const enfermedades = r.salud?.enfermedades || r.salud?.enfermedadesCronicas;
    $("#tipoSangre").textContent = r.salud?.tipoSangre || "-";
    $("#alergias").textContent = Array.isArray(r.salud?.alergias) && r.salud.alergias.length
        ? r.salud.alergias.join(", ")
        : "-";
    $("#enfermedades").textContent = Array.isArray(enfermedades) && enfermedades.length
        ? enfermedades.join(", ")
        : "-";
    $("#seguros").textContent = formatSeguros(r.salud?.seguros, r.salud?.segurosFechas);

    $("#registradoPor").textContent = "Colaborador";
    $("#fechaRegistro").textContent = formatFechaHora(r.createdAt);
    $("#fechaRevision").textContent = formatFechaHora(r.updatedAt || r.createdAt);

    renderEstadoBadge(r.estado || "borrador");
    renderActivoBadge(r.meta?.activo !== false);
    renderSegurosEditor(r.salud?.seguros, r.salud?.segurosFechas);
    loadLaboralEditors(r);
    applyAdminPermissions();
    }

    function applyAdminPermissions() {
    const isAdmin = session.isAdmin;

    if (!isAdmin && segurosAdminCard) {
        segurosAdminCard.hidden = true;
    }

    if (correoEl) correoEl.readOnly = !isAdmin;
    if (estadoEl) estadoEl.disabled = !isAdmin;
    if (observacionAdminEl) observacionAdminEl.readOnly = !isAdmin;
    if (tallaCasacaEl) tallaCasacaEl.disabled = !isAdmin;
    if (tallaPantalonEl) tallaPantalonEl.disabled = !isAdmin;
    if (chkDeclaracionHerederos) chkDeclaracionHerederos.disabled = !isAdmin;

    if (editCategoriaEl)    editCategoriaEl.disabled    = !isAdmin;
    if (editSedeEl)         editSedeEl.disabled         = !isAdmin;
    if (editCargoEl)        editCargoEl.disabled        = !isAdmin;
    if (editFechaIngresoEl) editFechaIngresoEl.disabled = !isAdmin;
    if (editDireccionEl)    editDireccionEl.disabled    = !isAdmin;
    if (editAreaEl)         editAreaEl.disabled         = !isAdmin;
    if (editSeccionEl)      editSeccionEl.disabled      = !isAdmin;

    if (btnGuardar) btnGuardar.disabled = !isAdmin;
    if (btnObservar) btnObservar.disabled = !isAdmin;
    if (btnAprobar) btnAprobar.disabled = !isAdmin;
    if (btnToggleActivo) btnToggleActivo.disabled = !isAdmin;
    if (btnAgregarSeguro) btnAgregarSeguro.disabled = !isAdmin;
    }

    async function guardarCambios() {
    if (!fichaRef || !session.isAdmin) return;

    try {
        const correo = (correoEl?.value || "").trim().toLowerCase();

        if (correo && !isValidEmail(correo)) {
        setMsg("Ingresa un correo válido.");
        correoEl?.focus();
        return;
        }

        const segurosPayload = collectSegurosEditor();
        if (!segurosPayload.ok) {
        setMsg(segurosPayload.message);
        return;
        }

        btnGuardar.disabled = true;
        btnGuardar.innerHTML = `Guardando...`;

        await updateDoc(fichaRef, {
        estado: estadoEl.value,
        personal: {
            ...(fichaData?.personal || {}),
            tallaCasaca: tallaCasacaEl?.value || "",
            tallaPantalon: tallaPantalonEl?.value || ""
        },
        contacto: {
            ...(fichaData?.contacto || {}),
            correo
        },
        laboral: {
            ...(fichaData?.laboral || {}),
            categoria:            (editCategoriaEl?.value    || ""),
            sede:                 (editSedeEl?.value         || ""),
            cargo:                (editCargoEl?.value        || "").trim(),
            fechaIngreso:         (editFechaIngresoEl?.value || ""),
            direccionCorporativa: (editDireccionEl?.value    || ""),
            area:                 (editAreaEl?.value         || ""),
            seccion:              (editSeccionEl?.value      || "")
        },
        salud: {
            ...(fichaData?.salud || {}),
            seguros: segurosPayload.seguros,
            segurosFechas: segurosPayload.segurosFechas
        },
        admin: {
            ...(fichaData?.admin || {}),
            observacion: observacionAdminEl.value.trim()
        },
        meta: {
            ...(fichaData?.meta || {}),
            declaracionHerederos: chkDeclaracionHerederos?.checked === true
        },
        updatedAt: serverTimestamp()
        });

        await cargarFicha();
        setMsg("Cambios guardados correctamente.");
    } catch (error) {
        console.error(error);
        setMsg("No se pudieron guardar los cambios.");
    } finally {
        btnGuardar.disabled = false;
        btnGuardar.innerHTML = `<i class="bi bi-check2-circle" style="margin-right: 6px;"></i>Guardar cambios`;
    }
    }

    async function guardarEstadoRapido(successMsg) {
    if (!fichaRef || !session.isAdmin) return;

    try {
        const correo = (correoEl?.value || "").trim().toLowerCase();

        if (correo && !isValidEmail(correo)) {
        setMsg("Ingresa un correo válido.");
        correoEl?.focus();
        return;
        }

        const segurosPayload = collectSegurosEditor();
        if (!segurosPayload.ok) {
        setMsg(segurosPayload.message);
        return;
        }

        await updateDoc(fichaRef, {
        estado: estadoEl.value,
        personal: {
            ...(fichaData?.personal || {}),
            tallaCasaca: tallaCasacaEl?.value || "",
            tallaPantalon: tallaPantalonEl?.value || ""
        },
        contacto: {
            ...(fichaData?.contacto || {}),
            correo
        },
        laboral: {
            ...(fichaData?.laboral || {}),
            categoria:            (editCategoriaEl?.value    || ""),
            sede:                 (editSedeEl?.value         || ""),
            cargo:                (editCargoEl?.value        || "").trim(),
            fechaIngreso:         (editFechaIngresoEl?.value || ""),
            direccionCorporativa: (editDireccionEl?.value    || ""),
            area:                 (editAreaEl?.value         || ""),
            seccion:              (editSeccionEl?.value      || "")
        },
        salud: {
            ...(fichaData?.salud || {}),
            seguros: segurosPayload.seguros,
            segurosFechas: segurosPayload.segurosFechas
        },
        admin: {
            ...(fichaData?.admin || {}),
            observacion: observacionAdminEl.value.trim()
        },
        meta: {
            ...(fichaData?.meta || {}),
            declaracionHerederos: chkDeclaracionHerederos?.checked === true
        },
        updatedAt: serverTimestamp()
        });

        await cargarFicha();
        setMsg(successMsg);
    } catch (error) {
        console.error(error);
        setMsg("No se pudo actualizar el estado.");
    }
    }

    function renderSegurosEditor(seguros = [], fechas = {}) {
    if (!segurosEditor) return;

    if (!session.isAdmin) {
        segurosEditor.innerHTML = "";
        return;
    }

    const segurosList = Array.isArray(seguros) ? seguros : [];

    if (!segurosList.length) {
        segurosEditor.innerHTML = `<div class="seguro-empty">No hay seguros registrados todavía.</div>`;
        return;
    }

    segurosEditor.innerHTML = segurosList.map((tipo) => `
        <div class="seguro-row" data-seguro-row>
        <div class="field-group" style="margin-bottom:0;">
            <label>Tipo de seguro</label>
            <select class="field-control js-seguro-tipo">
            ${buildSeguroOptions(tipo)}
            </select>
        </div>

        <div class="field-group" style="margin-bottom:0;">
            <label>Fecha de activación</label>
            <input
            class="field-control js-seguro-fecha"
            type="date"
            value="${escAttr(toInputDate(fechas?.[tipo] || ""))}"
            >
        </div>

        <div>
            <button class="btn-icon-soft js-remove-seguro" type="button" title="Eliminar seguro">
            <i class="bi bi-trash3"></i>
            </button>
        </div>
        </div>
    `).join("");

    bindSegurosRowEvents();
    }

    function addSeguroRow(tipo = "", fecha = "") {
    if (!segurosEditor) return;

    const empty = segurosEditor.querySelector(".seguro-empty");
    if (empty) empty.remove();

    const row = document.createElement("div");
    row.className = "seguro-row";
    row.setAttribute("data-seguro-row", "");

    row.innerHTML = `
        <div class="field-group" style="margin-bottom:0;">
        <label>Tipo de seguro</label>
        <select class="field-control js-seguro-tipo">
            ${buildSeguroOptions(tipo)}
        </select>
        </div>

        <div class="field-group" style="margin-bottom:0;">
        <label>Fecha de activación</label>
        <input
            class="field-control js-seguro-fecha"
            type="date"
            value="${escAttr(toInputDate(fecha))}"
        >
        </div>

        <div>
        <button class="btn-icon-soft js-remove-seguro" type="button" title="Eliminar seguro">
            <i class="bi bi-trash3"></i>
        </button>
        </div>
    `;

    segurosEditor.appendChild(row);
    bindSegurosRowEvents();
    }

    function buildSeguroOptions(selectedValue = "") {
    const current = String(selectedValue || "").trim();

    const baseOptions = [
        `<option value="">Seleccionar...</option>`,
        ...SEGURO_OPTIONS.map(opt => `
        <option value="${escAttr(opt)}" ${opt === current ? "selected" : ""}>
            ${opt}
        </option>
        `)
    ];

    const existsInCatalog = SEGURO_OPTIONS.some(opt => opt === current);

    if (current && !existsInCatalog) {
        baseOptions.push(`
        <option value="${escAttr(current)}" selected>${current}</option>
        `);
    }

    return baseOptions.join("");
    }

    function bindSegurosRowEvents() {
    segurosEditor?.querySelectorAll(".js-remove-seguro").forEach((btn) => {
        btn.onclick = () => {
        btn.closest("[data-seguro-row]")?.remove();

        const rows = segurosEditor.querySelectorAll("[data-seguro-row]");
        if (!rows.length) {
            segurosEditor.innerHTML = `<div class="seguro-empty">No hay seguros registrados todavía.</div>`;
        }
        };
    });
    }

    function collectSegurosEditor() {
    if (!session.isAdmin) {
        return {
        ok: true,
        seguros: fichaData?.salud?.seguros || [],
        segurosFechas: fichaData?.salud?.segurosFechas || {}
        };
    }

    const rows = [...(segurosEditor?.querySelectorAll("[data-seguro-row]") || [])];
    const seguros = [];
    const segurosFechas = {};

    for (const row of rows) {
        const tipo = row.querySelector(".js-seguro-tipo")?.value?.trim() || "";
        const fecha = row.querySelector(".js-seguro-fecha")?.value?.trim() || "";

        if (!tipo && !fecha) continue;

        if (!tipo) {
        return {
            ok: false,
            message: "Selecciona el tipo de seguro en todas las filas registradas."
        };
        }

        if (!fecha) {
        return {
            ok: false,
            message: `Completa la fecha de activación para el seguro "${tipo}".`
        };
        }

        if (seguros.some((s) => s.toLowerCase() === tipo.toLowerCase())) {
        return {
            ok: false,
            message: `El seguro "${tipo}" está repetido.`
        };
        }

        seguros.push(tipo);
        segurosFechas[tipo] = fecha;
    }

    return {
        ok: true,
        seguros,
        segurosFechas
    };
    }

    function normalizeEstadoValue(value) {
    const v = String(value || "borrador").trim().toLowerCase();
    return v === "en revision" ? "en revisión" : v;
    }

    function renderEstadoBadge(estado) {
    const el = $("#badgeEstadoActual");
    if (!el) return;

    const v = normalizeEstadoValue(estado);
    el.className = "badge-soft";
    el.style.background = "";
    el.style.color = "";

    if (v === "en revisión") {
        el.classList.add("badge-review");
        el.textContent = "En revisión";
        return;
    }

    if (v === "observado") {
        el.classList.add("badge-observed");
        el.textContent = "Observado";
        return;
    }

    if (v === "aprobado") {
        el.classList.add("badge-approved");
        el.textContent = "Aprobado";
        return;
    }

    if (v === "subsanado") {
        el.style.background = "#f3e8ff";
        el.style.color = "#6b21a8";
        el.textContent = "Subsanado";
        return;
    }

    if (v === "enviado") {
        el.style.background = "#eef2ff";
        el.style.color = "#3730a3";
        el.textContent = "Enviado";
        return;
    }

    el.style.background = "#eef2f6";
    el.style.color = "#5c6873";
    el.textContent = "Borrador";
    }

    function renderActivoBadge(activo) {
    const el = $("#badgeActivo");
    const btn = $("#btnToggleActivo");
    if (!el) return;

    if (activo) {
        el.textContent = "Activa";
        el.style.background = "#eaf7ef";
        el.style.color = "#1f7a45";
        if (btn) {
        btn.innerHTML = `<i class="bi bi-arrow-repeat" style="margin-right: 6px;"></i>Inactivar ficha`;
        }
    } else {
        el.textContent = "Inactiva";
        el.style.background = "#fff4f4";
        el.style.color = "#c62828";
        if (btn) {
        btn.innerHTML = `<i class="bi bi-arrow-repeat" style="margin-right: 6px;"></i>Activar ficha`;
        }
    }
    }

    function formatFecha(value) {
    if (!value) return "-";

    try {
        if (typeof value?.toDate === "function") {
        return value.toDate().toLocaleDateString("es-PE");
        }

        const d = new Date(value);
        if (isNaN(d.getTime())) return "-";

        return d.toLocaleDateString("es-PE");
    } catch {
        return "-";
    }
    }

    function formatFechaHora(value) {
    if (!value) return "-";

    try {
        const d = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
        if (isNaN(d.getTime())) return "-";

        return d.toLocaleString("es-PE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
        });
    } catch {
        return "-";
    }
    }

    function formatHijosHTML(hijos) {
    if (!Array.isArray(hijos) || !hijos.length) return "-";
    return hijos.map(h => {
        const nombre = [h?.nombres, h?.apellidos].filter(Boolean).join(" ") || h?.nombre || "-";
        const fechaRaw = h?.fechaNacimiento || h?.nacimiento;
        const fechaStr = fechaRaw ? formatFecha(fechaRaw) : "";
        const tipo = h?.tipoHijo || "";
        const meta = [fechaStr, tipo].filter(Boolean).join(" · ");
        const metaPart = meta
        ? ` <span style="color:var(--text-soft);font-weight:400;">(${escAttr(meta)})</span>`
        : "";
        return `<div style="margin-bottom:2px;">${escAttr(nombre)}${metaPart}</div>`;
    }).join("");
    }

    function formatSeguros(seguros, fechas) {
    if (!Array.isArray(seguros) || !seguros.length) return "-";

    return seguros.map(s => {
        const fecha = fechas?.[s] ? ` (${formatFecha(fechas[s])})` : "";
        return `${s}${fecha}`;
    }).join(", ");
    }

    function toInputDate(value) {
    if (!value) return "";

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

    const d = new Date(value);
    if (isNaN(d.getTime())) return "";

    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
    }

    function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function escAttr(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function setMsg(text) {
    if (msg) msg.textContent = text || "";
    }