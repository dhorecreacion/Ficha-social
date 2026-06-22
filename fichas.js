    import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
    import {
    collection,
    doc,
    addDoc,
    getDocs,
    deleteDoc,
    query,
    orderBy,
    limit,
    serverTimestamp,
    where
    } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

    import { auth, db, ADMIN_UIDS } from "./firebase-config.js";

    const $ = (s) => document.querySelector(s);

    const tbody = $("#tbody");
    const btnNew = $("#btnNew");
    const btnExport = $("#btnExport");
    const btnFiltrar = $("#btnFiltrar");
    const search = $("#search");
    const filtroEstado = $("#fltEstado");
    const filtroRevision = $("#fltRevision");
    const filtroDeclaracion = $("#fltDeclaracion");
    const filtroHerederos   = $("#fltHerederos");
    const msg = $("#msg");

    const kpiTotal = $("#kpiTotal");
    const kpiActivas = $("#kpiActivas");
    const kpiInactivas = $("#kpiInactivas");
    const kpiDeclaracion = $("#kpiDeclaracion");

    const modalNuevaFichaEl = $("#modalNuevaFicha");
    const inputNuevoNombreCompleto = $("#nuevoNombreCompleto");
    const inputNuevoDni = $("#nuevoDni");
    const inputNuevoCorreo = $("#nuevoCorreo");
    const btnCrearDesdeModal = $("#btnCrearDesdeModal");
    const msgNuevaFicha = $("#msgNuevaFicha");

    let modalNuevaFicha = null;
    let session = { user: null, isAdmin: false };
    let rows = [];

    onAuthStateChanged(auth, async (user) => {
    if (!user) {
        location.href = "index.html";
        return;
    }

    session.user = user;
    session.isAdmin = ADMIN_UIDS.has(user.uid);

    if (!session.isAdmin) {
        btnNew?.classList.add("hidden");
    }

    if (modalNuevaFichaEl && window.bootstrap) {
        modalNuevaFicha = new window.bootstrap.Modal(modalNuevaFichaEl, {
        backdrop: true,
        keyboard: true,
        focus: true
        });
    }

    bindEvents();
    await loadFichas();
    });

    function bindEvents() {
    search?.addEventListener("input", render);
    filtroEstado?.addEventListener("change", render);
    filtroRevision?.addEventListener("change", render);
    btnFiltrar?.addEventListener("click", render);

    btnNew?.addEventListener("click", openNuevaFichaModal);
    btnCrearDesdeModal?.addEventListener("click", createAndGo);

    btnExport?.addEventListener("click", exportXLSX);
    filtroDeclaracion?.addEventListener("change", render);
    filtroHerederos?.addEventListener("change", render);

    inputNuevoDni?.addEventListener("input", () => {
        inputNuevoDni.value = inputNuevoDni.value.replace(/\D/g, "").slice(0, 8);
    });

    inputNuevoCorreo?.addEventListener("keydown", handleEnterCreate);
    inputNuevoNombreCompleto?.addEventListener("keydown", handleEnterCreate);
    inputNuevoDni?.addEventListener("keydown", handleEnterCreate);

    modalNuevaFichaEl?.addEventListener("hidden.bs.modal", () => {
        clearNuevaFichaForm();
    });
    }

    function handleEnterCreate(e) {
    if (e.key === "Enter") {
        e.preventDefault();
        createAndGo();
    }
    }

    const hasActivoFlag = (r) =>
    r?.meta && Object.prototype.hasOwnProperty.call(r.meta, "activo");

    const isActive = (r) =>
    hasActivoFlag(r) ? r.meta.activo === true : true;

    function readEstadoFilter() {
    let v = (filtroEstado?.value ?? "").toString().trim().toLowerCase();

    if (v === "" || v === "activas" || v === "activa" || v === "1" || v === "true") v = "act";
    if (v === "inactivas" || v === "inactiva" || v === "0" || v === "false") v = "inact";
    if (v === "todas" || v === "todo" || v === "any" || v === "*") v = "all";

    if (!["act", "inact", "all"].includes(v)) v = "act";
    return v;
    }

    function readRevisionFilter() {
    const v = (filtroRevision?.value ?? "all").toString().trim().toLowerCase();
    return v || "all";
    }

    async function loadFichas() {
    try {
        tbody.innerHTML = "<tr><td colspan='8'>Cargando…</td></tr>";

        const qy = query(
        collection(db, "fichas"),
        orderBy("createdAt", "desc"),
        limit(10000)
        );

        const snap = await getDocs(qy);
        rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        updateKpis();
        render();
        setMsg("");
    } catch (e) {
        console.error("Error cargando fichas:", e);

        if (e?.code === "permission-denied") {
        setMsg("No tienes permisos para ver el listado de fichas.");
        tbody.innerHTML = "<tr><td colspan='8'>Sin permisos</td></tr>";
        return;
        }

        if (e?.code === "failed-precondition") {
        setMsg("Firestore pide crear un índice para esta consulta.");
        tbody.innerHTML = "<tr><td colspan='8'>Falta índice en Firestore</td></tr>";
        return;
        }

        setMsg(human(e));
        tbody.innerHTML = "<tr><td colspan='9'>No se pudieron cargar las fichas.</td></tr>";
    }
    }

    function hasDeclaracion(r) {
    return r?.meta?.declaracionDatos === true;
    }

    function hasDeclaracionHerederos(r) {
    return r?.meta?.declaracionHerederos === true;
    }

    function updateKpis() {
    const total = rows.length;
    const activas = rows.filter(isActive).length;
    const inactivas = total - activas;
    const conDeclaracion = rows.filter(r => isActive(r) && hasDeclaracion(r)).length;

    if (kpiTotal) kpiTotal.textContent = total;
    if (kpiActivas) kpiActivas.textContent = activas;
    if (kpiInactivas) kpiInactivas.textContent = inactivas;
    if (kpiDeclaracion) kpiDeclaracion.textContent = conDeclaracion;
    }

    function openNuevaFichaModal() {
    if (!session.isAdmin) {
        alert("Solo un administrador puede crear fichas.");
        return;
    }

    clearNuevaFichaForm();
    modalNuevaFicha?.show();
    }

    function getFiltered() {
    const term = (search?.value || "").trim().toLowerCase();
    const est = readEstadoFilter();
    const rev = readRevisionFilter();
    const decl      = (filtroDeclaracion?.value || "all").trim().toLowerCase();
    const herederos = (filtroHerederos?.value   || "all").trim().toLowerCase();

    return rows.filter((r) => {
        if (est === "act" && !isActive(r)) return false;
        if (est === "inact" && isActive(r)) return false;

        const estadoFicha = normalizeEstado(r.estado || "borrador");
        if (rev !== "all" && estadoFicha !== rev) return false;

        if (decl === "si" && !hasDeclaracion(r)) return false;
        if (decl === "no" && hasDeclaracion(r)) return false;

        if (herederos === "si" && !hasDeclaracionHerederos(r)) return false;
        if (herederos === "no" && hasDeclaracionHerederos(r)) return false;

        if (term) {
        const dni = (r.personal?.doc || r.doc || "").toString().toLowerCase();
        const nombres = (r.personal?.nombres || r.nombres || "").toString().toLowerCase();
        const apellidos = (r.personal?.apellidos || r.apellidos || "").toString().toLowerCase();
        const fullName = `${apellidos} ${nombres}`.trim().toLowerCase();
        const correo = (r.contacto?.correo || r.correo || "").toString().toLowerCase();
        const telefono = (r.contacto?.telefono || r.telefono || "").toString().toLowerCase();

        const match =
            dni.includes(term) ||
            fullName.includes(term) ||
            nombres.includes(term) ||
            apellidos.includes(term) ||
            correo.includes(term) ||
            telefono.includes(term);

        if (!match) return false;
        }

        return true;
    });
    }

    function normalizeEstado(value) {
    return (value || "borrador").toString().trim().toLowerCase();
    }

    function renderEstadoBadge(estado) {
    const v = normalizeEstado(estado);

    if (v === "en revisión" || v === "en revision") {
        return `<span class="badge badge-revision">En revisión</span>`;
    }

    if (v === "observado") {
        return `<span class="badge badge-observado">Observado</span>`;
    }

    if (v === "subsanado") {
        return `<span class="badge badge-subsanado">Subsanado</span>`;
    }

    if (v === "aprobado") {
        return `<span class="badge badge-aprobado">Aprobado</span>`;
    }

    if (v === "enviado") {
        return `<span class="badge badge-enviado">Enviado</span>`;
    }

    return `<span class="badge badge-borrador">Borrador</span>`;
    }

    function render() {
    const data = getFiltered();

    if (!data.length) {
        tbody.innerHTML = "<tr><td colspan='9'>Sin resultados</td></tr>";
        return;
    }

    tbody.innerHTML = data.map((r) => {
        const dni = r.personal?.doc || r.doc || "-";
        const nombres = r.personal?.nombres || r.nombres || "";
        const apellidos = r.personal?.apellidos || r.apellidos || "";
        const fullName = `${apellidos} ${nombres}`.trim() || "-";

        const correo = r.contacto?.correo || r.correo || "-";
        const telefono = r.contacto?.telefono || r.telefono || "-";

        const fecha = formatFecha(r.updatedAt || r.createdAt);
        const estado = r.estado || "borrador";

        const situacion = isActive(r)
        ? `<span class="badge ok">Activa</span>`
        : `<span class="badge warn">Inactiva</span>`;

        const declaracionBadge = hasDeclaracion(r)
        ? `<span class="badge" style="background:#dcfce7;color:#15803d;border:1px solid #bbf7d0;">&#10003; Aceptada</span>`
        : `<span class="badge" style="background:#fef9c3;color:#92400e;border:1px solid #fde68a;">Pendiente</span>`;

        const herederosBadge = hasDeclaracionHerederos(r)
        ? `<span class="badge" style="background:#dcfce7;color:#15803d;border:1px solid #bbf7d0;">&#10003; Entregó</span>`
        : `<span class="badge" style="background:#fee2e2;color:#b91c1c;border:1px solid #fecaca;">No entregó</span>`;

        return `
        <tr>
            <td>${esc(dni)}</td>

            <td>
            <div class="table-user">
                <div class="table-user-name">${esc(fullName)}</div>
            </div>
            </td>

            <td>
            <div class="contact-stack">
                <div class="contact-line"><span>Correo:</span>${esc(correo)}</div>
                <div class="contact-line"><span>Tel.:</span>${esc(telefono)}</div>
            </div>
            </td>

            <td>${esc(fecha)}</td>
            <td>${renderEstadoBadge(estado)}</td>
            <td>${situacion}</td>
            <td>${declaracionBadge}</td>
            <td>${herederosBadge}</td>

            <td class="text-end" style="white-space:nowrap">
            <div class="action-row">
                <a class="btn-outline" href="detalles.html?id=${encodeURIComponent(r.id)}">Ver</a>
                ${session.isAdmin ? `<button class="btn-outline" type="button" data-del="${r.id}">Eliminar</button>` : ""}
            </div>
            </td>
        </tr>
        `;
    }).join("");

    if (session.isAdmin) {
        tbody.querySelectorAll("[data-del]").forEach((btn) => {
        btn.addEventListener("click", () => del(btn.dataset.del));
        });
    }
    }

    function formatFecha(value) {
    if (!value) return "-";

    try {
        if (typeof value.toDate === "function") {
        return value.toDate().toLocaleDateString("es-PE");
        }

        const d = new Date(value);
        if (isNaN(d.getTime())) return "-";

        return d.toLocaleDateString("es-PE");
    } catch {
        return "-";
    }
    }

    async function createAndGo() {
    const defaultBtnHtml = `<i class="bi bi-plus-circle" style="margin-right: 8px;"></i>Crear ficha`;

    try {
        if (!session.isAdmin) {
        alert("Solo un administrador puede crear fichas.");
        return;
        }

        const nombreCompleto = (inputNuevoNombreCompleto?.value || "").trim().replace(/\s+/g, " ");
        const dni = (inputNuevoDni?.value || "").trim();
        const correo = (inputNuevoCorreo?.value || "").trim().toLowerCase();

        setNuevaFichaMsg("");

        if (!nombreCompleto || !dni || !correo) {
        setNuevaFichaMsg("Debes completar nombre completo, DNI y correo.");
        return;
        }

        if (!/^\d{8}$/.test(dni)) {
        setNuevaFichaMsg("El DNI debe tener exactamente 8 dígitos.");
        return;
        }

        if (!isValidEmail(correo)) {
        setNuevaFichaMsg("Ingresa un correo válido.");
        return;
        }

        btnCrearDesdeModal.disabled = true;
        btnCrearDesdeModal.innerHTML = "Creando...";

        const duplicadoLocal = rows.some((r) => (r.personal?.doc || r.doc || "") === dni);
        if (duplicadoLocal) {
        setNuevaFichaMsg("Ya existe una ficha registrada con ese DNI.");
        btnCrearDesdeModal.disabled = false;
        btnCrearDesdeModal.innerHTML = defaultBtnHtml;
        return;
        }

        const qDup = query(
        collection(db, "fichas"),
        where("personal.doc", "==", dni),
        limit(1)
        );

        const dupSnap = await getDocs(qDup);
        if (!dupSnap.empty) {
        setNuevaFichaMsg("Ya existe una ficha registrada con ese DNI.");
        btnCrearDesdeModal.disabled = false;
        btnCrearDesdeModal.innerHTML = defaultBtnHtml;
        return;
        }

        const { nombres, apellidos } = splitFullName(nombreCompleto);

        const ref = await addDoc(collection(db, "fichas"), {
        grants: {},
        estado: "borrador",
        hijos: [],
        salud: {
            alergias: [],
            enfermedadesCronicas: []
        },
        meta: {
            activo: true
        },
        personal: {
            doc: dni,
            nombres,
            apellidos
        },
        contacto: {
            correo,
            telefono: ""
        },
        ubicacion: {},
        laboral: {},
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
        });

        modalNuevaFicha?.hide();
        location.href = `detalles.html?id=${ref.id}`;
    } catch (e) {
        console.error("Error creando ficha:", e);
        setNuevaFichaMsg(human(e));
    } finally {
        btnCrearDesdeModal.disabled = false;
        btnCrearDesdeModal.innerHTML = defaultBtnHtml;
    }
    }

    function exportXLSX() {
    if (typeof XLSX === "undefined") {
        alert("La librería de Excel no está disponible. Recarga la página.");
        return;
    }

    const data = getFiltered();
    if (!data.length) {
        alert("No hay datos para exportar.");
        return;
    }

    // Calcula la edad en años a partir de "YYYY-MM-DD"
    function calcEdad(nacStr) {
        if (!nacStr) return "";
        const nac = new Date(nacStr);
        if (isNaN(nac)) return "";
        const hoy = new Date();
        let age = hoy.getFullYear() - nac.getFullYear();
        const m = hoy.getMonth() - nac.getMonth();
        if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) age--;
        return age;
    }

    // Determina cuántos hijos tiene el colaborador con más hijos
    const maxHijos = data.reduce((mx, r) => {
        const h = Array.isArray(r.hijos) ? r.hijos : Array.isArray(r.familia?.hijos) ? r.familia.hijos : [];
        return Math.max(mx, h.length);
    }, 0);

    // Cabecera fija
    const FIXED_HEADERS = [
        // Identificación
        "DNI", "Apellidos", "Nombres", "Nombre completo",
        // Personal
        "Género", "Fecha nacimiento", "Edad", "Estado civil", "Nacionalidad",
        "Talla casaca", "Talla pantalón",
        // Contacto
        "Correo", "Teléfono",
        // Ubicación
        "Dirección", "Referencia", "Departamento", "Provincia", "Distrito",
        // Laboral
        "Sede", "Cargo", "Categoría", "Dirección corporativa", "Área", "Sección",
        "Fecha ingreso",
        // Académico
        "Nivel académico", "Profesión",
        // Emergencia
        "Contacto emergencia", "Teléfono emergencia", "Parentesco emergencia",
        // Salud
        "Tipo de sangre", "Alergias", "Enfermedades crónicas", "Seguros",
        // Hijos resumen
        "Tiene hijos", "Nro. hijos",
        // Estado
        "Estado ficha", "Situación", "Actualizado"
    ];

    // Columnas dinámicas de hijos
    const hijoHeaders = [];
    for (let i = 1; i <= maxHijos; i++) {
        hijoHeaders.push(
        `Hijo${i} Nombres`,
        `Hijo${i} Apellidos`,
        `Hijo${i} Nacimiento`,
        `Hijo${i} Edad`,
        `Hijo${i} Género`,
        `Hijo${i} Tipo`
        );
    }

    const headers = [...FIXED_HEADERS, ...hijoHeaders];

    // Filas de datos
    const rows_xlsx = data.map((r) => {
        const nombres   = r.personal?.nombres   || "";
        const apellidos = r.personal?.apellidos || "";
        const nacStr    = r.personal?.nacimiento || "";
        const hijos     = Array.isArray(r.hijos) ? r.hijos : Array.isArray(r.familia?.hijos) ? r.familia.hijos : [];
        const seguros   = Array.isArray(r.salud?.seguros) ? r.salud.seguros.join(", ") : "";
        const alergias  = Array.isArray(r.salud?.alergias) ? r.salud.alergias.join(", ") : "";
        const enfArr    = r.salud?.enfermedades || r.salud?.enfermedadesCronicas || [];
        const enf       = Array.isArray(enfArr) ? enfArr.join(", ") : "";

        const fixed = [
        // Identificación
        r.personal?.doc        || "",
        apellidos,
        nombres,
        `${apellidos} ${nombres}`.trim(),
        // Personal
        r.personal?.genero     || "",
        nacStr,
        calcEdad(nacStr),
        r.personal?.estadoCivil || "",
        r.personal?.nacionalidad || "",
        r.personal?.tallaCasaca   || "",
        r.personal?.tallaPantalon || "",
        // Contacto
        r.contacto?.correo    || "",
        r.contacto?.telefono  || "",
        // Ubicación
        r.ubicacion?.direccion   || "",
        r.ubicacion?.referencia  || "",
        r.ubicacion?.departamento || "",
        r.ubicacion?.provincia   || "",
        r.ubicacion?.distrito    || "",
        // Laboral
        r.laboral?.sede                  || "",
        r.laboral?.cargo                 || "",
        r.laboral?.categoria             || "",
        r.laboral?.direccionCorporativa  || "",
        r.laboral?.area                  || "",
        r.laboral?.seccion               || "",
        r.laboral?.fechaIngreso          || "",
        // Académico
        r.academica?.nivel     || "",
        r.academica?.profesion || "",
        // Emergencia
        (r.familia?.emergencia?.nombre     || r.emergencia?.nombre     || ""),
        (r.familia?.emergencia?.telefono   || r.emergencia?.telefono   || ""),
        (r.familia?.emergencia?.parentesco || r.emergencia?.parentesco || ""),
        // Salud
        r.salud?.tipoSangre || "",
        alergias,
        enf,
        seguros,
        // Hijos resumen
        hijos.length > 0 ? "Sí" : "No",
        hijos.length,
        // Estado
        r.estado || "borrador",
        isActive(r) ? "Activa" : "Inactiva",
        formatFecha(r.updatedAt || r.createdAt)
        ];

        // Columnas dinámicas de hijos
        const hijoCols = [];
        for (let i = 0; i < maxHijos; i++) {
        const h = hijos[i] || {};
        const hNac = h.fechaNacimiento || h.nacimiento || "";
        hijoCols.push(
            h.nombres   || "",
            h.apellidos || "",
            hNac,
            calcEdad(hNac),
            h.genero    || "",
            h.tipoHijo  || ""
        );
        }

        return [...fixed, ...hijoCols];
    });

    const aoa = [headers, ...rows_xlsx];
    const ws  = XLSX.utils.aoa_to_sheet(aoa);

    // Anchos de columna orientativos
    const colWidths = headers.map((h) => {
        if (h === "Nombre completo") return { wch: 30 };
        if (h.startsWith("Hijo"))   return { wch: 18 };
        if (h === "Dirección" || h === "Dirección corporativa") return { wch: 32 };
        if (h === "Alergias" || h === "Enfermedades crónicas" || h === "Seguros") return { wch: 28 };
        return { wch: 18 };
    });
    ws["!cols"] = colWidths;

    // AutoFiltro en toda la cabecera
    ws["!autofilter"] = { ref: ws["!ref"] };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fichas");

    const filename = `fichas-${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, filename);
    }

    async function del(id) {
    if (!session.isAdmin) {
        alert("Solo un administrador puede eliminar.");
        return;
    }

    if (!confirm("¿Eliminar esta ficha? Esta acción no se puede deshacer.")) return;

    try {
        await deleteDoc(doc(db, "fichas", id));
        rows = rows.filter((r) => r.id !== id);
        updateKpis();
        render();
        setMsg("Ficha eliminada correctamente.");
    } catch (e) {
        console.error("Error eliminando ficha:", e);
        alert(human(e));
    }
    }

    function clearNuevaFichaForm() {
    if (inputNuevoNombreCompleto) inputNuevoNombreCompleto.value = "";
    if (inputNuevoDni) inputNuevoDni.value = "";
    if (inputNuevoCorreo) inputNuevoCorreo.value = "";
    setNuevaFichaMsg("");
    }

    function setNuevaFichaMsg(text) {
    if (msgNuevaFicha) msgNuevaFicha.textContent = text || "";
    }

    function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function splitFullName(fullName) {
    const clean = fullName.replace(/\s+/g, " ").trim();
    const parts = clean.split(" ");

    if (parts.length === 1) {
        return {
        nombres: parts[0],
        apellidos: ""
        };
    }

    if (parts.length === 2) {
        return {
        nombres: parts[0],
        apellidos: parts[1]
        };
    }

    const apellidos = parts.slice(-2).join(" ");
    const nombres = parts.slice(0, -2).join(" ");

    return { nombres, apellidos };
    }

    function setMsg(text) {
    if (msg) msg.textContent = text || "";
    }

    function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (m) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[m]));
    }

    function human(err) {
    const map = {
        "permission-denied": "Permisos insuficientes.",
        "unauthenticated": "Inicia sesión e inténtalo nuevamente.",
        "failed-precondition": "Falta crear un índice en Firestore para esta consulta."
    };

    return map[err?.code] || err?.message || "Ocurrió un error.";
    }