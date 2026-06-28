    import { db } from "./firebase-config.js";
    import {
    doc,
    getDoc,
    setDoc,
    serverTimestamp
    } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

    const $ = (selector) => document.querySelector(selector);

    const msg = $("#msg");
    const form = $("#formFicha");
    const btnGuardar = $("#btnGuardar");

    const btnAgregarConyuge = $("#btnAgregarConyuge");
    const conyugeContainer = $("#conyugeContainer");

    const btnAgregarHijo = $("#btnAgregarHijo");
    const childrenList = $("#childrenList");

    const btnAgregarAlergia = $("#btnAgregarAlergia");
    const alergiasList = $("#alergiasList");

    const btnAgregarEnfermedad = $("#btnAgregarEnfermedad");
    const enfermedadesList = $("#enfermedadesList");

    const selNacionalidad = $("#nacionalidad");
    const nacionalidadOtraWrap = $("#nacionalidadOtraWrap");

    const selDep = $("#selDep");
    const selProv = $("#selProv");
    const selDist = $("#selDist");

    const params = new URLSearchParams(window.location.search);
    const fichaIdFromUrl = params.get("id");
    const fichaIdFromSession = sessionStorage.getItem("colaboradorFichaId");
    const fichaId = fichaIdFromUrl || fichaIdFromSession || null;

    let fichaActual = null;
    let ubigeoData = [];

    const sectionState = {
    conyuge: null,
    hijos: null,
    alergias: null,
    enfermedades: null
    };

    function showToast(texto, tipo = "success") {
    const el = document.getElementById("toast-guardado");
    if (!el) return;
    el.textContent = texto;
    el.style.background = tipo === "error" ? "#dc2626" : "#16a34a";
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), tipo === "error" ? 5000 : 3500);
    }

    function setMsg(text, type = "info") {
    if (!msg) return;

    msg.textContent = text || "";
    msg.style.color =
        type === "error" ? "#b42318" :
        type === "success" ? "#027a48" :
        "#5c6873";
    }

    function setValue(selector, value) {
    const el = $(selector);
    if (el) el.value = value ?? "";
    }

    const TALLA_PANTALON_LEGACY = { XS:"26", S:"28", M:"30", L:"32", XL:"34", XXL:"36", XXXL:"38" };
    function normTallaPantalon(v) { return TALLA_PANTALON_LEGACY[v] || v || ""; }

    function setText(selector, value) {
    const el = $(selector);
    if (el) el.textContent = value ?? "-";
    }

    function getNested(obj, paths = [], fallback = null) {
    for (const path of paths) {
        const parts = path.split(".");
        let current = obj;
        let ok = true;

        for (const part of parts) {
        if (current && Object.prototype.hasOwnProperty.call(current, part)) {
            current = current[part];
        } else {
            ok = false;
            break;
        }
        }

        if (ok && current !== undefined && current !== null && current !== "") {
        return current;
        }
    }

    return fallback;
    }

    function initials(name) {
    if (!name) return "FS";

    return (
        name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() || "")
        .join("") || "FS"
    );
    }

    function nombreCompletoDesdeFicha(ficha) {
    const nombres = getNested(ficha, ["personal.nombres"], "");
    const apellidos = getNested(ficha, ["personal.apellidos"], "");
    return `${nombres} ${apellidos}`.trim();
    }

    function formatFecha(value) {
    if (!value) return "";

    try {
        if (typeof value?.toDate === "function") {
        const d = value.toDate();
        return d.toISOString().split("T")[0];
        }

        if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return value;
        }

        const d = new Date(value);
        if (isNaN(d.getTime())) return "";

        return d.toISOString().split("T")[0];
    } catch {
        return "";
    }
    }

    function formatFechaVisible(value) {
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

    function renderEstadoBadge(estado) {
    const el = $("#badgeEstadoActual");
    if (!el) return;

    const v = String(estado || "").toLowerCase().trim();

    el.className = "badge-soft";
    el.style.background = "";
    el.style.color = "";
    el.style.borderColor = "";

    if (v === "en revisión" || v === "revision") {
        el.classList.add("badge-review");
        el.textContent = "En revisión";
        return;
    }

    if (v === "observado") {
        el.classList.add("badge-observed");
        el.textContent = "Observado";
        return;
    }

    if (v === "aprobado" || v === "completo") {
        el.classList.add("badge-approved");
        el.textContent = v === "completo" ? "Completo" : "Aprobado";
        return;
    }

    if (v === "subsanado") {
        el.style.background = "#f3e8ff";
        el.style.color = "#6b21a8";
        el.style.borderColor = "#ddd6fe";
        el.textContent = "Subsanado";
        return;
    }

    if (v === "enviado") {
        el.style.background = "#eef2ff";
        el.style.color = "#3730a3";
        el.style.borderColor = "#c7d2fe";
        el.textContent = "Enviado";
        return;
    }

    el.style.background = "#eef2f6";
    el.style.color = "#5c6873";
    el.style.borderColor = "#d9e2ec";
    el.textContent = "Borrador";
    }

    function renderActivoBadge(activo) {
    const el = $("#badgeActivo");
    if (!el) return;

    el.className = "badge-soft";
    el.style.background = "";
    el.style.color = "";
    el.style.borderColor = "";

    if (activo) {
        el.classList.add("badge-approved");
        el.textContent = "Activa";
        return;
    }

    el.classList.add("badge-observed");
    el.textContent = "Inactiva";
    }

    function renderHererosBadge(entrego) {
    const el = $("#badgeHerederos");
    if (!el) return;

    if (entrego) {
        el.style.background = "#dcfce7";
        el.style.color = "#15803d";
        el.textContent = "Dec. herederos: ✓ Entregó";
    } else {
        el.style.background = "#fee2e2";
        el.style.color = "#b91c1c";
        el.textContent = "Dec. herederos: Pendiente";
    }
    }

    function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    }

    function normalizeArrayLike(value) {
    if (Array.isArray(value)) return value.filter(Boolean);

    if (value && typeof value === "object") {
        return Object.values(value).filter(Boolean);
    }

    if (typeof value === "string" && value.trim() !== "") {
        return [value.trim()];
    }

    return [];
    }

    function clearValidationStyles() {
    document.querySelectorAll(".field-error").forEach((el) => {
        el.classList.remove("field-error");
    });
    }

    function markError(selector) {
    const el = $(selector);
    if (el) el.classList.add("field-error");
    }

    function focusField(selector) {
    const el = $(selector);
    if (el) {
        el.focus();
        el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    }

    async function cargarJsons() {
    try {
        const [ubigeoRes] = await Promise.all([
        fetch("./peru-ubigeo.json", { cache: "no-store" })
        ]);

        if (!ubigeoRes.ok) {
        throw new Error(`No se pudo cargar peru-ubigeo.json (${ubigeoRes.status})`);
        }

        ubigeoData = await ubigeoRes.json();
        prepararUbigeo();
    } catch (error) {
        console.error("Error cargando JSON auxiliares:", error);
        setMsg(`No se pudieron cargar los catálogos auxiliares. ${error.message || ""}`, "error");
    }
    }

    function setSelectOptions(selectEl, values = [], placeholder = "Seleccionar") {
    if (!selectEl) return;

    const uniq = [...new Set(values.filter(Boolean))].sort((a, b) =>
        String(a).localeCompare(String(b), "es")
    );

    selectEl.innerHTML = `<option value="">${placeholder}</option>`;

    uniq.forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        selectEl.appendChild(option);
    });
    }

    function prepararUbigeo() {
    const departamentos = ubigeoData.map((x) => x.Departamento);
    setSelectOptions(selDep, departamentos, "Seleccionar departamento");
    setSelectOptions(selProv, [], "Seleccionar provincia");
    setSelectOptions(selDist, [], "Seleccionar distrito");

    if (selProv) selProv.disabled = true;
    if (selDist) selDist.disabled = true;
    }

    function actualizarProvincias(departamento, provinciaSeleccionada = "", distritoSeleccionado = "") {
    if (!selProv || !selDist) return;

    if (!departamento) {
        setSelectOptions(selProv, [], "Seleccionar provincia");
        setSelectOptions(selDist, [], "Seleccionar distrito");
        selProv.disabled = true;
        selDist.disabled = true;
        return;
    }

    const provincias = ubigeoData
        .filter((x) => x.Departamento === departamento)
        .map((x) => x.Provincia);

    setSelectOptions(selProv, provincias, "Seleccionar provincia");
    selProv.disabled = false;

    if (provinciaSeleccionada && provincias.includes(provinciaSeleccionada)) {
        selProv.value = provinciaSeleccionada;
    } else {
        selProv.value = "";
    }

    actualizarDistritos(departamento, selProv.value, distritoSeleccionado);
    }

    function actualizarDistritos(departamento, provincia, distritoSeleccionado = "") {
    if (!selDist) return;

    if (!departamento || !provincia) {
        setSelectOptions(selDist, [], "Seleccionar distrito");
        selDist.disabled = true;
        return;
    }

    const distritos = ubigeoData
        .filter((x) => x.Departamento === departamento && x.Provincia === provincia)
        .map((x) => x.Distrito);

    setSelectOptions(selDist, distritos, "Seleccionar distrito");
    selDist.disabled = false;

    if (distritoSeleccionado && distritos.includes(distritoSeleccionado)) {
        selDist.value = distritoSeleccionado;
    } else {
        selDist.value = "";
    }
    }

    function toggleNacionalidadOtra() {
    const isOtra = (selNacionalidad?.value || "") === "Otra";
    nacionalidadOtraWrap?.classList.toggle("hidden", !isOtra);

    if (!isOtra) {
        setValue("#nacionalidadOtra", "");
    }
    }

    function setChoiceState(target, value, options = {}) {
    const { autoCreate = false } = options;

    sectionState[target] = value;

    document.querySelectorAll(`.choice-btn[data-target="${target}"]`).forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.value === value);
    });

    const contentMap = {
        conyuge: {
        content: "#conyugeContent",
        note: "#conyugeEmptyNote",
        addBtn: "#btnAgregarConyuge",
        container: "#conyugeContainer"
        },
        hijos: {
        content: "#hijosContent",
        note: "#hijosEmptyNote",
        addBtn: "#btnAgregarHijo",
        container: "#childrenList"
        },
        alergias: {
        content: "#alergiasContent",
        note: "#alergiasEmptyNote",
        addBtn: "#btnAgregarAlergia",
        container: "#alergiasList"
        },
        enfermedades: {
        content: "#enfermedadesContent",
        note: "#enfermedadesEmptyNote",
        addBtn: "#btnAgregarEnfermedad",
        container: "#enfermedadesList"
        }
    };

    const cfg = contentMap[target];
    if (!cfg) return;

    const content = $(cfg.content);
    const note = $(cfg.note);
    const addBtn = $(cfg.addBtn);
    const container = $(cfg.container);

    const isNo = value === "no";
    const isSi = value === "si";

    if (content) content.classList.toggle("hidden", isNo);
    if (note) note.classList.toggle("hidden", !isNo);
    if (addBtn) addBtn.classList.toggle("hidden", isNo);

    if (isNo && container) {
        container.innerHTML = "";
        if (target === "conyuge") eliminarConyuge();
    }

    if (isSi && autoCreate) {
        if (target === "conyuge" && !conyugeContainer.querySelector("#conyugeCard")) {
        agregarConyuge();
        }
        if (target === "hijos" && !childrenList.querySelector(".family-card")) {
        agregarHijo();
        }
        if (target === "alergias" && !alergiasList.querySelector(".family-card")) {
        addSimpleTextItem(alergiasList, "Alergia", "");
        renumerarSimpleList(alergiasList);
        }
        if (target === "enfermedades" && !enfermedadesList.querySelector(".family-card")) {
        addSimpleTextItem(enfermedadesList, "Enfermedad", "");
        renumerarSimpleList(enfermedadesList);
        }
    }
    }

    function crearConyugeCard(conyuge = {}) {
    const wrapper = document.createElement("div");
    wrapper.className = "family-card";
    wrapper.id = "conyugeCard";

    wrapper.innerHTML = `
        <div class="family-card-header">
        <h4 class="family-card-title">Datos del cónyuge / conviviente</h4>
        <button type="button" class="btn-danger-soft" id="btnEliminarConyuge">
            <i class="bi bi-trash" style="margin-right:6px;"></i>
            Eliminar
        </button>
        </div>

        <div class="form-grid">
        <div class="field-group">
            <label for="conyugeNombres">Nombres</label>
            <input id="conyugeNombres" class="field-control" type="text" value="${escapeHtml(conyuge.nombres || "")}">
        </div>

        <div class="field-group">
            <label for="conyugeApellidos">Apellidos</label>
            <input id="conyugeApellidos" class="field-control" type="text" value="${escapeHtml(conyuge.apellidos || "")}">
        </div>

        <div class="field-group">
            <label for="conyugeFechaNacimiento">Fecha de nacimiento</label>
            <input id="conyugeFechaNacimiento" class="field-control" type="date" value="${escapeHtml(formatFecha(conyuge.fechaNacimiento || conyuge.nacimiento || ""))}">
        </div>

        <div class="field-group">
            <label for="conyugeTelefono">Teléfono</label>
            <input id="conyugeTelefono" class="field-control" type="tel" value="${escapeHtml(conyuge.telefono || "")}">
        </div>

        <div class="field-group">
            <label for="conyugeCorreo">Correo</label>
            <input id="conyugeCorreo" class="field-control" type="email" value="${escapeHtml(conyuge.correo || "")}">
        </div>

        <div class="field-group">
            <label for="conyugeOcupacion">Ocupación</label>
            <input id="conyugeOcupacion" class="field-control" type="text" value="${escapeHtml(conyuge.ocupacion || "")}">
        </div>
        </div>
    `;

    wrapper.querySelector("#btnEliminarConyuge")?.addEventListener("click", eliminarConyuge);
    return wrapper;
    }

    function renderConyuge(conyuge = null) {
    if (!conyugeContainer) return;
    conyugeContainer.innerHTML = "";

    const tieneDatos = conyuge && Object.values(conyuge).some((v) => String(v || "").trim() !== "");
    if (tieneDatos) conyugeContainer.appendChild(crearConyugeCard(conyuge));
    }

    function agregarConyuge(conyuge = {}) {
    if (!conyugeContainer) return;
    if (conyugeContainer.querySelector("#conyugeCard")) return;
    conyugeContainer.innerHTML = "";
    conyugeContainer.appendChild(crearConyugeCard(conyuge));
    }

    function eliminarConyuge() {
    if (!conyugeContainer) return;
    conyugeContainer.innerHTML = "";
    }

    function obtenerConyugeDesdeDOM() {
    const card = conyugeContainer?.querySelector("#conyugeCard");
    if (!card) return null;

    const conyuge = {
        nombres: $("#conyugeNombres")?.value.trim() || "",
        apellidos: $("#conyugeApellidos")?.value.trim() || "",
        fechaNacimiento: $("#conyugeFechaNacimiento")?.value || "",
        telefono: $("#conyugeTelefono")?.value.trim() || "",
        correo: $("#conyugeCorreo")?.value.trim() || "",
        ocupacion: $("#conyugeOcupacion")?.value.trim() || ""
    };

    const tieneDatos = Object.values(conyuge).some((v) => String(v || "").trim() !== "");
    return tieneDatos ? conyuge : null;
    }

    function crearHijoCard(hijo = {}, index = 0) {
    const wrapper = document.createElement("div");
    wrapper.className = "family-card";
    wrapper.dataset.index = String(index);

    wrapper.innerHTML = `
        <div class="family-card-header">
        <h4 class="family-card-title">Hijo ${index + 1}</h4>
        <button type="button" class="btn-danger-soft btn-remove-child">
            <i class="bi bi-trash" style="margin-right:6px;"></i>
            Eliminar
        </button>
        </div>

        <div class="form-grid">
        <div class="field-group">
            <label>Nombres</label>
            <input class="field-control hijo-nombres" type="text" value="${escapeHtml(hijo.nombres || "")}">
        </div>

        <div class="field-group">
            <label>Apellidos</label>
            <input class="field-control hijo-apellidos" type="text" value="${escapeHtml(hijo.apellidos || "")}">
        </div>

        <div class="field-group">
            <label>Fecha de nacimiento</label>
            <input class="field-control hijo-fechaNacimiento" type="date" value="${escapeHtml(formatFecha(hijo.fechaNacimiento || hijo.nacimiento || ""))}">
        </div>

        <div class="field-group">
            <label>Género</label>
            <select class="hijo-genero">
            <option value="">Seleccionar</option>
            <option value="Masculino" ${hijo.genero === "Masculino" ? "selected" : ""}>Masculino</option>
            <option value="Femenino" ${hijo.genero === "Femenino" ? "selected" : ""}>Femenino</option>
            <option value="Otro" ${hijo.genero === "Otro" ? "selected" : ""}>Otro</option>
            <option value="Prefiero no indicar" ${hijo.genero === "Prefiero no indicar" ? "selected" : ""}>Prefiero no indicar</option>
            </select>
        </div>

        <div class="field-group">
            <label>Tipo de hijo</label>
            <select class="hijo-tipo">
            <option value="">Seleccionar</option>
            <option value="Biológico(a)" ${hijo.tipoHijo === "Biológico(a)" ? "selected" : ""}>Biológico(a)</option>
            <option value="Hijastro(a)" ${hijo.tipoHijo === "Hijastro(a)" ? "selected" : ""}>Hijastro(a)</option>
            </select>
        </div>
        </div>
    `;

    wrapper.querySelector(".btn-remove-child")?.addEventListener("click", () => {
        wrapper.remove();
        renumerarHijos();
    });

    return wrapper;
    }

    function renumerarHijos() {
    const cards = childrenList.querySelectorAll(".family-card");
    cards.forEach((card, index) => {
        card.dataset.index = String(index);
        const title = card.querySelector(".family-card-title");
        if (title) title.textContent = `Hijo ${index + 1}`;
    });
    }

    function renderHijos(hijos = []) {
    if (!childrenList) return;
    childrenList.innerHTML = "";
    hijos.forEach((hijo, index) => {
        childrenList.appendChild(crearHijoCard(hijo, index));
    });
    }

    function agregarHijo(hijo = {}) {
    if (!childrenList) return;
    const index = childrenList.querySelectorAll(".family-card").length;
    childrenList.appendChild(crearHijoCard(hijo, index));
    renumerarHijos();
    }

    function obtenerHijosDesdeDOM() {
    if (!childrenList) return [];

    return Array.from(childrenList.querySelectorAll(".family-card"))
        .map((card) => ({
        nombres: card.querySelector(".hijo-nombres")?.value.trim() || "",
        apellidos: card.querySelector(".hijo-apellidos")?.value.trim() || "",
        fechaNacimiento: card.querySelector(".hijo-fechaNacimiento")?.value || "",
        genero: card.querySelector(".hijo-genero")?.value || "",
        tipoHijo: card.querySelector(".hijo-tipo")?.value || ""
        }))
        .filter((hijo) => hijo.nombres || hijo.apellidos || hijo.fechaNacimiento || hijo.genero);
    }

    function createSimpleTextCard(value = "", title = "Registro") {
    const wrapper = document.createElement("div");
    wrapper.className = "family-card";

    wrapper.innerHTML = `
        <div class="family-card-header">
        <h4 class="family-card-title">${title}</h4>
        <button type="button" class="btn-danger-soft btn-remove-simple">
            <i class="bi bi-trash" style="margin-right:6px;"></i>
            Eliminar
        </button>
        </div>
        <div class="field-group">
        <label>Detalle</label>
        <input class="field-control simple-text-value" type="text" value="${escapeHtml(value)}">
        </div>
    `;

    wrapper.querySelector(".btn-remove-simple")?.addEventListener("click", () => {
        wrapper.remove();
        renumerarSimpleList(wrapper.parentElement);
    });

    return wrapper;
    }

    function renumerarSimpleList(container) {
    if (!container) return;

    const cards = container.querySelectorAll(".family-card");
    const isAlergia = container.id === "alergiasList";

    cards.forEach((card, index) => {
        const title = card.querySelector(".family-card-title");
        if (title) {
        title.textContent = isAlergia ? `Alergia ${index + 1}` : `Enfermedad ${index + 1}`;
        }
    });
    }

    function renderSimpleTextList(container, values = [], labelPrefix = "Registro") {
    if (!container) return;
    container.innerHTML = "";

    values.forEach((value, index) => {
        container.appendChild(createSimpleTextCard(value, `${labelPrefix} ${index + 1}`));
    });
    }

    function addSimpleTextItem(container, labelPrefix = "Registro", value = "") {
    if (!container) return;
    const nextIndex = container.querySelectorAll(".family-card").length + 1;
    container.appendChild(createSimpleTextCard(value, `${labelPrefix} ${nextIndex}`));
    }

    function getSimpleTextValues(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll(".simple-text-value"))
        .map((input) => input.value.trim())
        .filter(Boolean);
    }

    function cargarUbigeoEnFormulario(ficha) {
    const dep = getNested(ficha, ["contacto.departamento", "ubicacion.departamento", "personal.departamento"], "");
    const prov = getNested(ficha, ["contacto.provincia", "ubicacion.provincia", "personal.provincia"], "");
    const dist = getNested(ficha, ["contacto.distrito", "ubicacion.distrito", "personal.distrito"], "");

    if (selDep) selDep.value = dep || "";
    actualizarProvincias(dep, prov, dist);
    }

    function cargarFormulario(ficha) {
    fichaActual = ficha;

    const nombreCompleto = nombreCompletoDesdeFicha(ficha);
    const estado = getNested(ficha, ["estado", "meta.estado"], "borrador");
    const activo = getNested(ficha, ["meta.activo"], true) !== false;

    const observacion = getNested(
        ficha,
        ["admin.observacion", "observacionAdmin", "observacion", "meta.observacion"],
        ""
    );

    const tieneConyuge = getNested(ficha, ["familia.tieneConyuge"], null);
    const tieneHijos = getNested(ficha, ["familia.tieneHijos"], null);
    const tieneAlergias = getNested(ficha, ["salud.tieneAlergias"], null);
    const tieneEnfermedades = getNested(ficha, ["salud.tieneEnfermedades"], null);

    const conyuge = getNested(ficha, ["familia.conyuge", "conyuge"], null);
    const hijos = normalizeArrayLike(getNested(ficha, ["familia.hijos", "hijos"], []));
    const alergias = normalizeArrayLike(getNested(ficha, ["salud.alergias"], []));
    const enfermedades = normalizeArrayLike(getNested(ficha, ["salud.enfermedades"], []));

    setText("#heroNombre", nombreCompleto || "Sin nombre registrado");
    setText("#heroMeta", `${getNested(ficha, ["laboral.cargo"], "Colaborador")} • ${getNested(ficha, ["laboral.sede"], "Sin sede")}`);

    setText("#userDisplayName", nombreCompleto || "Colaborador");
    setText("#userInitials", initials(nombreCompleto));
    setText("#userInitialsMobile", initials(nombreCompleto));

    setValue("#dni", getNested(ficha, ["personal.doc", "personal.dni"], ""));
    setValue("#nombreCompleto", nombreCompleto);

    setValue("#estadoCivil", getNested(ficha, ["personal.estadoCivil"], ""));
    setValue("#genero", getNested(ficha, ["personal.genero", "personal.sexo"], ""));
    setValue("#fechaNacimiento", formatFecha(getNested(ficha, ["personal.nacimiento", "personal.fechaNacimiento"], "")));

    const nacionalidadOtra = getNested(ficha, ["personal.nacionalidadOtra"], "");
    const nacionalidadBase = nacionalidadOtra ? "Otra" : getNested(ficha, ["personal.nacionalidad"], "");

    setValue("#nacionalidad", nacionalidadBase === "OTRA" ? "Otra" : nacionalidadBase);
    setValue("#nacionalidadOtra", nacionalidadOtra);
    toggleNacionalidadOtra();

    setValue("#tallaCasaca", getNested(ficha, ["personal.tallaCasaca"], ""));
    setValue("#tallaPantalon", normTallaPantalon(getNested(ficha, ["personal.tallaPantalon"], "")));

    setValue("#telefono", getNested(ficha, ["contacto.telefono", "personal.telefono"], ""));
    setValue("#correo", getNested(ficha, ["contacto.correo"], ""));
    setValue("#direccion", getNested(ficha, ["contacto.direccion", "ubicacion.direccion", "contacto.direccionActual", "personal.direccion"], ""));
    setValue("#referencia", getNested(ficha, ["contacto.referencia", "ubicacion.referencia", "personal.referencia"], ""));

    cargarUbigeoEnFormulario(ficha);

    setValue("#nivelAcademico", getNested(ficha, ["salud.nivelAcademico", "formacion.nivelAcademico", "academica.nivel"], ""));
    setValue("#profesion", getNested(ficha, ["salud.profesion", "formacion.profesion", "academica.profesion"], ""));
    setValue("#tipoSangre", getNested(ficha, ["salud.tipoSangre"], ""));

    renderSimpleTextList(alergiasList, alergias, "Alergia");
    renderSimpleTextList(enfermedadesList, enfermedades, "Enfermedad");

    setValue("#fechaIngreso", formatFecha(getNested(ficha, ["laboral.fechaIngreso"], "")));
    setValue("#categoria", getNested(ficha, ["laboral.categoria"], ""));
    setValue("#sede", getNested(ficha, ["laboral.sede"], ""));
    setValue("#cargo", getNested(ficha, ["laboral.cargo"], ""));
    setValue("#selDirCorp", getNested(ficha, ["laboral.direccionCorporativa", "laboral.direccionCorp", "laboral.direccion"], ""));
    setValue("#selAreaCorp", getNested(ficha, ["laboral.area"], ""));
    setValue("#selSeccionCorp", getNested(ficha, ["laboral.seccion"], ""));

    setValue("#emergenciaNombre", getNested(ficha, ["familia.emergencia.nombre", "emergencia.nombre", "contacto.emergencia.nombre"], ""));
    setValue("#emergenciaParentesco", getNested(ficha, ["familia.emergencia.parentesco", "emergencia.parentesco", "contacto.emergencia.parentesco"], ""));
    setValue("#emergenciaTelefono", getNested(ficha, ["familia.emergencia.telefono", "emergencia.telefono", "contacto.emergencia.telefono"], ""));

    renderConyuge(conyuge);
    renderHijos(hijos);

    if (tieneConyuge === false) setChoiceState("conyuge", "no");
    else if (tieneConyuge === true || conyuge) setChoiceState("conyuge", "si");

    if (tieneHijos === false) setChoiceState("hijos", "no");
    else if (tieneHijos === true || hijos.length) setChoiceState("hijos", "si");

    if (tieneAlergias === false) setChoiceState("alergias", "no");
    else if (tieneAlergias === true || alergias.length) setChoiceState("alergias", "si");

    if (tieneEnfermedades === false) setChoiceState("enfermedades", "no");
    else if (tieneEnfermedades === true || enfermedades.length) setChoiceState("enfermedades", "si");

    setValue("#observacionAdmin", observacion || "No hay observaciones registradas por el momento.");
    setValue("#ultimaActualizacion", formatFechaVisible(getNested(ficha, ["updatedAt", "createdAt"], "")));
    setValue("#estadoActual", estado);

    renderEstadoBadge(estado);
    renderActivoBadge(activo);
    renderHererosBadge(getNested(ficha, ["meta.declaracionHerederos"], false) === true);

    // Pre-marcar ambas declaraciones si ya fueron aceptadas o si la ficha ya fue enviada antes
    const yaAcepto = getNested(ficha, ["meta.declaracionDatos"], false) === true
        || (ficha.estado && ficha.estado !== "borrador");
    const chk1 = $("#chkDeclaracion1");
    const chk2 = $("#chkDeclaracion2");
    if (chk1) chk1.checked = yaAcepto;
    if (chk2) chk2.checked = yaAcepto;
    }

    async function loadFicha() {
    if (!fichaId) {
        setMsg("No se encontró el identificador de la ficha.", "error");
        return;
    }

    try {
        setMsg("Cargando información...");
        const ref = doc(db, "fichas", fichaId);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
        setMsg("No se encontró la ficha del colaborador.", "error");
        return;
        }

        const ficha = snap.data();

        sessionStorage.setItem("colaboradorFichaId", fichaId);

        const email = getNested(ficha, ["contacto.correo"], "");
        const nombre = nombreCompletoDesdeFicha(ficha);

        if (email) sessionStorage.setItem("colaboradorEmail", email);
        if (nombre) sessionStorage.setItem("colaboradorNombre", nombre);

        cargarFormulario(ficha);
        setMsg("");
    } catch (error) {
        console.error("Error al cargar ficha:", error);
        setMsg(`No se pudo cargar la ficha. ${error.code || error.message || ""}`, "error");
    }
    }

    function obtenerPayloadDesdeFormulario() {
    const estadoAnterior = String(getNested(fichaActual, ["estado"], "") || "").toLowerCase().trim();

    let nuevoEstado = getNested(fichaActual, ["estado"], "borrador");
    if (estadoAnterior === "observado" || estadoAnterior === "en revisión" || estadoAnterior === "revision") {
        nuevoEstado = "subsanado";
    } else if (!estadoAnterior) {
        nuevoEstado = "enviado";
    }

    const nacionalidadSeleccionada = $("#nacionalidad")?.value || "";
    const nacionalidadOtra = nacionalidadSeleccionada === "Otra"
        ? ($("#nacionalidadOtra")?.value.trim() || "")
        : "";

    const tieneConyuge = sectionState.conyuge === "si";
    const tieneHijos = sectionState.hijos === "si";
    const tieneAlergias = sectionState.alergias === "si";
    const tieneEnfermedades = sectionState.enfermedades === "si";

    const conyugeData = tieneConyuge ? obtenerConyugeDesdeDOM() : null;
    const hijosData = tieneHijos ? obtenerHijosDesdeDOM() : [];
    const alergiasData = tieneAlergias ? getSimpleTextValues(alergiasList) : [];
    const enfermedadesData = tieneEnfermedades ? getSimpleTextValues(enfermedadesList) : [];

    return {
        personal: {
        ...(fichaActual?.personal || {}),
        estadoCivil: $("#estadoCivil")?.value || "",
        genero: $("#genero")?.value || "",
        nacimiento: $("#fechaNacimiento")?.value || "",
        nacionalidad: nacionalidadSeleccionada === "Otra" ? "OTRA" : nacionalidadSeleccionada,
        nacionalidadOtra,
        tallaCasaca: $("#tallaCasaca")?.value || "",
        tallaPantalon: $("#tallaPantalon")?.value || ""
        },
        contacto: {
        ...(fichaActual?.contacto || {}),
        telefono: $("#telefono")?.value.trim() || "",
        correo: $("#correo")?.value.trim() || "",
        direccion: $("#direccion")?.value.trim() || "",
        referencia: $("#referencia")?.value.trim() || "",
        departamento: $("#selDep")?.value || "",
        provincia: $("#selProv")?.value || "",
        distrito: $("#selDist")?.value || ""
        },
        laboral: {
        ...(fichaActual?.laboral || {})
        },
        salud: {
        ...(fichaActual?.salud || {}),
        nivelAcademico: $("#nivelAcademico")?.value || "",
        profesion: $("#profesion")?.value.trim() || "",
        tipoSangre: $("#tipoSangre")?.value || "",
        tieneAlergias,
        tieneEnfermedades,
        alergias: alergiasData,
        enfermedades: enfermedadesData
        },
        familia: {
        ...(fichaActual?.familia || {}),
        tieneConyuge,
        tieneHijos,
        conyuge: conyugeData,
        hijos: hijosData,
        emergencia: {
            ...(fichaActual?.familia?.emergencia || {}),
            nombre: $("#emergenciaNombre")?.value.trim() || "",
            parentesco: $("#emergenciaParentesco")?.value || "",
            telefono: $("#emergenciaTelefono")?.value.trim() || ""
        }
        },
        conyuge: conyugeData,
        hijos: hijosData,
        estado: nuevoEstado,
        meta: {
        ...(fichaActual?.meta || {}),
        declaracionDatos: $("#chkDeclaracion1")?.checked === true && $("#chkDeclaracion2")?.checked === true,
        declaracionDatosAt: ($("#chkDeclaracion1")?.checked && $("#chkDeclaracion2")?.checked) ? Date.now() : (fichaActual?.meta?.declaracionDatosAt || null)
        },
        updatedAt: serverTimestamp()
    };
    }

    function validarCorreo(valor) {
    if (!valor) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor);
    }

    function validarTelefono(valor) {
    if (!valor) return true;
    return /^[0-9+\-\s()]{6,20}$/.test(valor);
    }

    function validarFormulario() {
    clearValidationStyles();

    const checks = [
        ["#estadoCivil", "Debes seleccionar el estado civil."],
        ["#genero", "Debes seleccionar el género."],
        ["#fechaNacimiento", "Debes registrar la fecha de nacimiento."],
        ["#nacionalidad", "Debes seleccionar la nacionalidad."],
        ["#tallaCasaca", "Debes seleccionar la talla de casaca."],
        ["#tallaPantalon", "Debes seleccionar la talla de pantalón."],
        ["#telefono", "Debes registrar el teléfono."],
        ["#correo", "Debes registrar el correo."],
        ["#direccion", "Debes registrar la dirección."],
        ["#referencia", "Debes registrar la referencia."],
        ["#selDep", "Debes seleccionar el departamento."],
        ["#selProv", "Debes seleccionar la provincia."],
        ["#selDist", "Debes seleccionar el distrito."],
        ["#nivelAcademico", "Debes seleccionar el nivel académico."],
        ["#profesion", "Debes registrar la profesión o carrera."],
        ["#tipoSangre", "Debes seleccionar el tipo de sangre."],
        ["#emergenciaNombre", "Debes registrar el nombre del contacto de emergencia."],
        ["#emergenciaParentesco", "Debes seleccionar el parentesco del contacto de emergencia."],
        ["#emergenciaTelefono", "Debes registrar el teléfono de emergencia."]
    ];

    for (const [selector, message] of checks) {
        const el = $(selector);
        const value = el?.value?.trim?.() ?? el?.value ?? "";
        if (!value) {
        markError(selector);
        setMsg(message, "error");
        focusField(selector);
        return false;
        }
    }

    if (($("#nacionalidad")?.value || "") === "Otra" && !($("#nacionalidadOtra")?.value.trim())) {
        markError("#nacionalidadOtra");
        setMsg("Debes especificar la nacionalidad cuando eliges 'Otra'.", "error");
        focusField("#nacionalidadOtra");
        return false;
    }

    const correo = $("#correo")?.value.trim() || "";
    const telefono = $("#telefono")?.value.trim() || "";
    const correoConyuge = $("#conyugeCorreo")?.value.trim() || "";
    const telefonoConyuge = $("#conyugeTelefono")?.value.trim() || "";
    const emergenciaTelefono = $("#emergenciaTelefono")?.value.trim() || "";

    if (!validarCorreo(correo)) {
        markError("#correo");
        setMsg("Ingresa un correo válido para el colaborador.", "error");
        focusField("#correo");
        return false;
    }

    if (!validarTelefono(telefono)) {
        markError("#telefono");
        setMsg("Ingresa un teléfono válido para el colaborador.", "error");
        focusField("#telefono");
        return false;
    }

    if (correoConyuge && !validarCorreo(correoConyuge)) {
        markError("#conyugeCorreo");
        setMsg("Ingresa un correo válido para el cónyuge o conviviente.", "error");
        focusField("#conyugeCorreo");
        return false;
    }

    if (telefonoConyuge && !validarTelefono(telefonoConyuge)) {
        markError("#conyugeTelefono");
        setMsg("Ingresa un teléfono válido para el cónyuge o conviviente.", "error");
        focusField("#conyugeTelefono");
        return false;
    }

    if (!validarTelefono(emergenciaTelefono)) {
        markError("#emergenciaTelefono");
        setMsg("Ingresa un teléfono válido para el contacto de emergencia.", "error");
        focusField("#emergenciaTelefono");
        return false;
    }

    if (!sectionState.alergias) {
        setMsg("Debes indicar si presentas alergias o no.", "error");
        return false;
    }

    if (!sectionState.enfermedades) {
        setMsg("Debes indicar si presentas enfermedades o antecedentes o no.", "error");
        return false;
    }

    if (!sectionState.conyuge) {
        setMsg("Debes indicar si tienes cónyuge o conviviente o no.", "error");
        return false;
    }

    if (!sectionState.hijos) {
        setMsg("Debes indicar si tienes hijos o no.", "error");
        return false;
    }

    if (sectionState.conyuge === "si") {
        const requiredConyuge = [
        ["#conyugeNombres", "Debes registrar los nombres del cónyuge o conviviente."],
        ["#conyugeApellidos", "Debes registrar los apellidos del cónyuge o conviviente."],
        ["#conyugeFechaNacimiento", "Debes registrar la fecha de nacimiento del cónyuge o conviviente."]
        ];

        for (const [selector, message] of requiredConyuge) {
        const value = $(selector)?.value?.trim?.() ?? $(selector)?.value ?? "";
        if (!value) {
            markError(selector);
            setMsg(message, "error");
            focusField(selector);
            return false;
        }
        }
    }

    if (sectionState.hijos === "si") {
        const hijos = Array.from(childrenList.querySelectorAll(".family-card"));
        if (!hijos.length) {
        setMsg("Debes registrar al menos un hijo si marcaste 'Sí tiene'.", "error");
        return false;
        }

        for (const hijoCard of hijos) {
        const nombre = hijoCard.querySelector(".hijo-nombres");
        const apellido = hijoCard.querySelector(".hijo-apellidos");
        const fecha = hijoCard.querySelector(".hijo-fechaNacimiento");
        const genero = hijoCard.querySelector(".hijo-genero");

        if (!nombre?.value.trim()) {
            nombre?.classList.add("field-error");
            setMsg("Cada hijo debe tener nombres registrados.", "error");
            nombre?.focus();
            return false;
        }

        if (!apellido?.value.trim()) {
            apellido?.classList.add("field-error");
            setMsg("Cada hijo debe tener apellidos registrados.", "error");
            apellido?.focus();
            return false;
        }

        if (!fecha?.value) {
            fecha?.classList.add("field-error");
            setMsg("Cada hijo debe tener fecha de nacimiento.", "error");
            fecha?.focus();
            return false;
        }

        if (!genero?.value) {
            genero?.classList.add("field-error");
            setMsg("Cada hijo debe tener género seleccionado.", "error");
            genero?.focus();
            return false;
        }
        }
    }

    if (sectionState.alergias === "si") {
        const alergias = getSimpleTextValues(alergiasList);
        if (!alergias.length) {
        setMsg("Debes registrar al menos una alergia si marcaste 'Sí tiene'.", "error");
        return false;
        }
    }

    if (sectionState.enfermedades === "si") {
        const enfermedades = getSimpleTextValues(enfermedadesList);
        if (!enfermedades.length) {
        setMsg("Debes registrar al menos una enfermedad o antecedente si marcaste 'Sí tiene'.", "error");
        return false;
        }
    }

    // Ambas declaraciones obligatorias (mapean a 1 solo campo en Firebase)
    const chkDeclaracion1 = $("#chkDeclaracion1");
    const chkDeclaracion2 = $("#chkDeclaracion2");
    const declaracionHint = $("#declaracionHint");
    if (!chkDeclaracion1?.checked || !chkDeclaracion2?.checked) {
        if (declaracionHint) declaracionHint.style.display = "block";
        (chkDeclaracion1?.checked ? chkDeclaracion2 : chkDeclaracion1)
            ?.closest(".declaracion-wrap")
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        setMsg("Debes aceptar ambas declaraciones de tratamiento de datos personales para guardar.", "error");
        return false;
    }
    if (declaracionHint) declaracionHint.style.display = "none";

    return true;
    }

    async function guardarFicha() {
    if (!fichaId) {
        showToast("No se encontró el identificador de la ficha.", "error");
        return;
    }

    if (!fichaActual) {
        showToast("La ficha aún no está lista. Recarga la página.", "error");
        return;
    }

    if (!validarFormulario()) {
        showToast("Revisa los campos marcados en rojo.", "error");
        return;
    }

    try {
        btnGuardar.disabled = true;
        btnGuardar.innerHTML = `<i class="bi bi-hourglass-split" style="margin-right:6px;"></i>Guardando...`;
        setMsg("Guardando cambios...");

        const payload = obtenerPayloadDesdeFormulario();
        const ref = doc(db, "fichas", fichaId);

        await setDoc(ref, payload, { merge: true });

        await loadFicha();
        showToast("✓ Ficha guardada correctamente");
    } catch (error) {
        console.error("Error al guardar ficha:", error);
        const errMsg = error.code === "permission-denied"
            ? "Sin permiso para guardar. Vuelve a iniciar sesión."
            : `No se pudo guardar. ${error.code || error.message || ""}`;
        showToast(errMsg, "error");
        setMsg(errMsg, "error");
    } finally {
        btnGuardar.disabled = false;
        btnGuardar.innerHTML = `<i class="bi bi-floppy" style="margin-right:6px;"></i>Guardar cambios`;
    }
    }

    function bindChoiceButtons() {
    document.querySelectorAll(".choice-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
        const target = btn.dataset.target;
        const value = btn.dataset.value;
        setChoiceState(target, value, { autoCreate: value === "si" });
        });
    });
    }

    function bindEvents() {
    btnAgregarConyuge?.addEventListener("click", () => {
        setChoiceState("conyuge", "si");
        agregarConyuge();
    });

    btnAgregarHijo?.addEventListener("click", () => {
        setChoiceState("hijos", "si");
        agregarHijo();
    });

    btnAgregarAlergia?.addEventListener("click", () => {
        setChoiceState("alergias", "si");
        addSimpleTextItem(alergiasList, "Alergia", "");
        renumerarSimpleList(alergiasList);
    });

    btnAgregarEnfermedad?.addEventListener("click", () => {
        setChoiceState("enfermedades", "si");
        addSimpleTextItem(enfermedadesList, "Enfermedad", "");
        renumerarSimpleList(enfermedadesList);
    });

    selNacionalidad?.addEventListener("change", toggleNacionalidadOtra);

    selDep?.addEventListener("change", () => {
        actualizarProvincias(selDep.value);
    });

    selProv?.addEventListener("change", () => {
        actualizarDistritos(selDep?.value || "", selProv.value);
    });

    form?.addEventListener("submit", async (e) => {
        e.preventDefault();
        await guardarFicha();
    });

    bindChoiceButtons();
    }

    async function init() {
    bindEvents();
    await cargarJsons();
    await loadFicha();
    }

    init();