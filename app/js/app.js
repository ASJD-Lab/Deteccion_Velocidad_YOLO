// ======================================================
// SISTEMA DE VIGILANCIA VIAL
// DETECCIÓN DE VEHÍCULOS, MATRÍCULAS, OCR Y VELOCIDAD
// ======================================================

document.addEventListener("DOMContentLoaded", () => {

    console.log("Sistema de Vigilancia Vial iniciado.");

    // ==================================================
    // 1. ELEMENTOS HTML
    // ==================================================

    const video = document.getElementById("video");
    const canvas = document.getElementById("canvas");
    const placeholder = document.getElementById("videoPlaceholder");

    const inputVideo = document.getElementById("inputVideo");

    const btnCamara = document.getElementById("btnCamara");
    const btnDetener = document.getElementById("btnDetener");

    const limiteVelocidad = document.getElementById("limiteVelocidad");
    const limiteActual = document.getElementById("limiteActual");

    const confianzaInput = document.getElementById("confianza");

    const totalVehiculos = document.getElementById("totalVehiculos");
    const totalInfracciones = document.getElementById("totalInfracciones");
    const velocidadMaxima = document.getElementById("velocidadMaxima");

    const tablaVehiculos = document.getElementById("tablaVehiculos");
    const tablaMultas = document.getElementById("tablaMultas");

    const lineaAInput = document.getElementById("lineaA");
    const lineaBInput = document.getElementById("lineaB");
    const lineaCInput = document.getElementById("lineaC");

    const valorLineaA = document.getElementById("valorLineaA");
    const valorLineaB = document.getElementById("valorLineaB");
    const valorLineaC = document.getElementById("valorLineaC");

    const distanciaABInput = document.getElementById("distanciaAB");
    const distanciaBCInput = document.getElementById("distanciaBC");

    const orientacionInput = document.getElementById("orientacionLineas");

    const estadoModelo = document.getElementById("estadoModelo");


    // ==================================================
    // 2. VARIABLES DE CONTROL
    // ==================================================

    let flujoCamara = null;
    let fuenteVideo = null;

    let procesando = false;
    let deteccionEnCurso = false;

    let ultimaDeteccion = 0;
    let bucleRAF = null;

    const INTERVALO_DETECCION = 250;

    let maximoRegistrado = 0;
    let infraccionesRegistradas = 0;

    // Evitar infracciones duplicadas.
    const multasRegistradas = new Set();

    // Referencias a las filas de las tablas.
    const filasVehiculos = new Map();
    const filasMultas = new Map();

    // Control del OCR.
    let ocrProcesando = false;
    let ultimoIntentoOCR = 0;

    const INTERVALO_OCR = 1500;
    const CONFIANZA_PLACA = 0.35;
    const MAX_INTENTOS_OCR = 6;

    // Identifica cada reproducción.
    let sesionVideo = 0;

    // Canvas auxiliar para recortar vehículos.
    const canvasRecorte = document.createElement("canvas");

    const contextoRecorte = canvasRecorte.getContext("2d", {
        willReadFrequently: true
    });


    // ==================================================
    // 3. CONFIGURACIÓN DE LÍNEAS
    // ==================================================

    function obtenerConfiguracionLineas() {

        return {
            lineaA: Number(lineaAInput.value) / 100,
            lineaB: Number(lineaBInput.value) / 100,
            lineaC: Number(lineaCInput.value) / 100,
            orientacion: orientacionInput.value
        };

    }


    function actualizarEtiquetasLineas() {

        valorLineaA.textContent = `${lineaAInput.value}%`;
        valorLineaB.textContent = `${lineaBInput.value}%`;
        valorLineaC.textContent = `${lineaCInput.value}%`;

    }


    lineaAInput.addEventListener("input", actualizarEtiquetasLineas);
    lineaBInput.addEventListener("input", actualizarEtiquetasLineas);
    lineaCInput.addEventListener("input", actualizarEtiquetasLineas);


    // ==================================================
    // 4. ACTUALIZAR LÍMITE DE VELOCIDAD
    // ==================================================

    limiteVelocidad.addEventListener("change", () => {

        const limite = Number(limiteVelocidad.value);

        if (Number.isFinite(limite) && limite > 0) {

            limiteActual.innerHTML =
                `${limite} <small>km/h</small>`;

        }

    });


    // ==================================================
    // 5. MOSTRAR VIDEO
    // ==================================================

    function mostrarVideo() {

        video.style.display = "block";
        placeholder.style.display = "none";

    }


    // ==================================================
    // 6. ACTUALIZAR ESTADO
    // ==================================================

    function actualizarEstado(mensaje, color) {

        const estado = document.querySelector(".system-status");

        if (!estado) return;

        estado.innerHTML = `
            <span class="status-indicator"
                style="background:${color}">
            </span>
            <span>${mensaje}</span>
        `;

        if (estadoModelo) {
            estadoModelo.textContent = mensaje;
        }

    }


    // ==================================================
    // 7. OBTENER DETECCIÓN DEL VEHÍCULO
    // ==================================================

    function obtenerCajaVehiculo(vehiculo) {

        if (!vehiculo) return null;

        const deteccion =
            vehiculo.deteccion ||
            vehiculo.deteccionActual ||
            vehiculo.box ||
            vehiculo;

        if (
            !Number.isFinite(deteccion.x1) ||
            !Number.isFinite(deteccion.y1) ||
            !Number.isFinite(deteccion.x2) ||
            !Number.isFinite(deteccion.y2)
        ) {
            return null;
        }

        return deteccion;

    }


    // ==================================================
    // 8. RECORTAR REGIÓN DEL VEHÍCULO
    // ==================================================

    function recortarVehiculo(vehiculo) {

        const caja = obtenerCajaVehiculo(vehiculo);

        if (!caja) return null;

        const anchoVideo = video.videoWidth;
        const altoVideo = video.videoHeight;

        if (!anchoVideo || !altoVideo) return null;

        const anchoCaja = caja.x2 - caja.x1;
        const altoCaja = caja.y2 - caja.y1;

        const margenX = anchoCaja * 0.05;
        const margenY = altoCaja * 0.05;

        const x = Math.max(
            0,
            Math.floor(caja.x1 - margenX)
        );

        const y = Math.max(
            0,
            Math.floor(caja.y1 - margenY)
        );

        const x2 = Math.min(
            anchoVideo,
            Math.ceil(caja.x2 + margenX)
        );

        const y2 = Math.min(
            altoVideo,
            Math.ceil(caja.y2 + margenY)
        );

        const ancho = x2 - x;
        const alto = y2 - y;

        if (ancho < 20 || alto < 20) return null;

        canvasRecorte.width = ancho;
        canvasRecorte.height = alto;

        // Capturar el vehículo en este instante.
        contextoRecorte.drawImage(
            video,
            x,
            y,
            ancho,
            alto,
            0,
            0,
            ancho,
            alto
        );

        return {
            imagen: canvasRecorte,
            x,
            y,
            ancho,
            alto
        };

    }


    // ==================================================
    // 9. BUSCAR Y LEER MATRÍCULA
    // ==================================================

    async function reconocerMatriculaVehiculo(
        vehiculo,
        sesionActual
    ) {

        if (!modeloDetector || !trabajadorOCR) return;

        if (vehiculo.matricula) return;

        const recorte = recortarVehiculo(vehiculo);

        if (!recorte) return;

        // Detectar matrículas dentro del vehículo.
        const placas = await detectarMatriculas(
            recorte.imagen,
            CONFIANZA_PLACA
        );

        // Comprobar que sigue siendo la misma sesión.
        if (sesionActual !== sesionVideo) return;

        if (!procesando) return;

        if (!placas || placas.length === 0) {

            console.log(
                `Vehículo ${vehiculo.id}: no se encontró matrícula.`
            );

            return;

        }

        // Seleccionar la placa con mayor confianza.
        placas.sort(
            (a, b) => b.confianza - a.confianza
        );

        const placa = placas[0];

        const placaAncho = placa.x2 - placa.x1;
        const placaAlto = placa.y2 - placa.y1;

        if (placaAncho < 5 || placaAlto < 5) return;

        // Coordenadas de la placa en el video.
        const placaX = recorte.x + placa.x1;
        const placaY = recorte.y + placa.y1;

        // Crear canvas exclusivo para la matrícula.
        const canvasPlaca = document.createElement("canvas");

        canvasPlaca.width = Math.max(
            1,
            Math.ceil(placaAncho)
        );

        canvasPlaca.height = Math.max(
            1,
            Math.ceil(placaAlto)
        );

        const ctxPlaca = canvasPlaca.getContext("2d", {
            willReadFrequently: true
        });

        // Recortar desde la captura del vehículo.
        ctxPlaca.drawImage(
            recorte.imagen,
            placa.x1,
            placa.y1,
            placaAncho,
            placaAlto,
            0,
            0,
            canvasPlaca.width,
            canvasPlaca.height
        );

        // Aplicar reconocimiento OCR.
        const resultadoOCR = await leerMatricula(canvasPlaca);

        if (sesionActual !== sesionVideo) return;

        if (!procesando) return;

        vehiculo.deteccionMatricula = {

            x1: placaX,
            y1: placaY,
            x2: placaX + placaAncho,
            y2: placaY + placaAlto,

            confianza: placa.confianza

        };

        vehiculo.ultimoResultadoOCR = resultadoOCR;

        if (resultadoOCR && resultadoOCR.identificada) {

            vehiculo.matricula = resultadoOCR.texto;

            vehiculo.confianzaOCR = resultadoOCR.confianza;

            vehiculo.ocrFinalizado = true;

            console.log(
                `MATRÍCULA RECONOCIDA: Vehículo ${vehiculo.id} -> ${vehiculo.matricula}`
            );

            actualizarTablaVehiculos(
                vehiculo,
                vehiculo.velocidades?.velocidad ?? null
            );

            // Actualizar el ticket si ya existe.
            actualizarMatriculaMulta(vehiculo);

        } else {

            console.log(
                `Vehículo ${vehiculo.id}: placa detectada, pero no pudo leerse.`
            );

        }

    }


    // ==================================================
    // 10. PROCESAR OCR PARA TODOS LOS VEHÍCULOS
    // ==================================================

    async function procesarOCR(vehiculos) {

        if (
            ocrProcesando ||
            !modeloDetector ||
            !trabajadorOCR
        ) {
            return;
        }

        const ahora = performance.now();

        if (ahora - ultimoIntentoOCR < INTERVALO_OCR) {
            return;
        }

        // Todos los vehículos seguidos pueden participar.
        const candidatos = vehiculos.filter(vehiculo => {

            return (
                vehiculo.fotogramasPerdidos === 0 &&
                vehiculo.hits >= 2 &&
                !vehiculo.matricula &&
                (vehiculo.ocrIntentos || 0) < MAX_INTENTOS_OCR &&
                !vehiculo.ocrFinalizado
            );

        });

        if (!candidatos.length) return;

        // Priorizar vehículos con mayor confianza.
        candidatos.sort((a, b) => {

            const cajaA = obtenerCajaVehiculo(a);
            const cajaB = obtenerCajaVehiculo(b);

            return (
                (cajaB?.confianza || 0) -
                (cajaA?.confianza || 0)
            );

        });

        // Procesar un vehículo por intento.
        const vehiculo = candidatos[0];

        const sesionActual = sesionVideo;

        ocrProcesando = true;
        ultimoIntentoOCR = ahora;

        vehiculo.ocrIntentos = (vehiculo.ocrIntentos || 0) + 1;

        console.log(
            `Buscando matrícula del vehículo ${vehiculo.id}. ` +
            `Intento ${vehiculo.ocrIntentos}/${MAX_INTENTOS_OCR}`
        );

        try {

            await reconocerMatriculaVehiculo(
                vehiculo,
                sesionActual
            );

            if (sesionActual !== sesionVideo) return;

            // Finalizar si se agotaron los intentos.
            if (
                !vehiculo.matricula &&
                vehiculo.ocrIntentos >= MAX_INTENTOS_OCR
            ) {

                vehiculo.ocrFinalizado = true;

                console.warn(
                    `Vehículo ${vehiculo.id}: matrícula no identificada después de ${MAX_INTENTOS_OCR} intentos.`
                );

                actualizarTablaVehiculos(
                    vehiculo,
                    vehiculo.velocidades?.velocidad ?? null
                );

            }

        } catch (error) {

            console.error(
                `Error OCR del vehículo ${vehiculo.id}:`,
                error
            );

        } finally {

            ocrProcesando = false;

        }

    }


    // ==================================================
    // 11. DIBUJAR MATRÍCULAS
    // ==================================================

    function dibujarMatriculas(vehiculos) {

        const ctx = canvas.getContext("2d");

        vehiculos.forEach(vehiculo => {

            const placa = vehiculo.deteccionMatricula;

            if (!placa) return;

            const ancho = placa.x2 - placa.x1;
            const alto = placa.y2 - placa.y1;

            ctx.strokeStyle = "#38bdf8";
            ctx.lineWidth = 3;

            ctx.strokeRect(
                placa.x1,
                placa.y1,
                ancho,
                alto
            );

            const etiqueta = vehiculo.matricula
                ? `PLACA: ${vehiculo.matricula}`
                : "PLACA DETECTADA";

            ctx.font = "bold 13px Arial";

            const anchoTexto = ctx.measureText(etiqueta).width;

            const posicionY = Math.max(
                0,
                placa.y1 - 23
            );

            ctx.fillStyle = "#0284c7";

            ctx.fillRect(
                placa.x1,
                posicionY,
                anchoTexto + 10,
                23
            );

            ctx.fillStyle = "#ffffff";

            ctx.fillText(
                etiqueta,
                placa.x1 + 5,
                Math.max(16, placa.y1 - 7)
            );

        });

    }


    // ==================================================
    // 12. DIBUJAR LÍNEAS E IDENTIFICADORES
    // ==================================================

    function dibujarSeguimiento(vehiculos) {

        const ctx = canvas.getContext("2d");

        const ancho = canvas.width;
        const alto = canvas.height;

        const configuracion = obtenerConfiguracionLineas();

        const lineaA = configuracion.orientacion === "horizontal"
            ? alto * configuracion.lineaA
            : ancho * configuracion.lineaA;

        const lineaB = configuracion.orientacion === "horizontal"
            ? alto * configuracion.lineaB
            : ancho * configuracion.lineaB;

        const lineaC = configuracion.orientacion === "horizontal"
            ? alto * configuracion.lineaC
            : ancho * configuracion.lineaC;

        dibujarLineas(
            ctx,
            ancho,
            alto,
            lineaA,
            lineaB,
            lineaC,
            configuracion.orientacion
        );

        dibujarIdentificadores(ctx, vehiculos);

        dibujarMatriculas(vehiculos);

    }


    // ==================================================
    // 13. ACTUALIZAR TABLA DE VEHÍCULOS
    // ==================================================

    function actualizarTablaVehiculos(vehiculo, velocidad) {

        if (!tablaVehiculos) return;

        const id = vehiculo.id;

        let fila = filasVehiculos.get(id);

        if (!fila) {

            const mensaje = tablaVehiculos.querySelector(".empty-message");

            if (mensaje) {
                tablaVehiculos.innerHTML = "";
            }

            fila = document.createElement("tr");

            fila.dataset.vehiculoId = id;

            const celdaMatricula = document.createElement("td");
            celdaMatricula.className = "matricula-vehiculo";

            const celdaVelocidad = document.createElement("td");
            celdaVelocidad.className = "velocidad-vehiculo";

            const celdaEstado = document.createElement("td");
            celdaEstado.className = "estado-vehiculo";

            const celdaHora = document.createElement("td");

            fila.append(
                celdaMatricula,
                celdaVelocidad,
                celdaEstado,
                celdaHora
            );

            tablaVehiculos.prepend(fila);

            filasVehiculos.set(id, fila);

            celdaHora.textContent =
                new Date().toLocaleTimeString("es-MX");

        }

        const celdaMatricula = fila.querySelector(".matricula-vehiculo");
        const celdaVelocidad = fila.querySelector(".velocidad-vehiculo");
        const celdaEstado = fila.querySelector(".estado-vehiculo");

        celdaMatricula.textContent =
            vehiculo.matricula || "No identificada";

        if (Number.isFinite(velocidad)) {

            celdaVelocidad.textContent =
                `${velocidad.toFixed(2)} km/h`;

            const limite = Number(limiteVelocidad.value);

            if (velocidad > limite) {

                celdaEstado.textContent = "EXCESO DE VELOCIDAD";
                celdaEstado.style.color = "#ef4444";

            } else {

                celdaEstado.textContent = "Dentro del límite";
                celdaEstado.style.color = "#22c55e";

            }

        } else {

            celdaVelocidad.textContent = "Pendiente";

            celdaEstado.textContent =
                vehiculo.ocrFinalizado
                    ? "Matrícula no identificada"
                    : "Midiendo";

        }

    }


    // ==================================================
    // 14. ACTUALIZAR MATRÍCULA EN TICKET EXISTENTE
    // ==================================================

    function actualizarMatriculaMulta(vehiculo) {

        const fila = filasMultas.get(vehiculo.id);

        if (!fila || !vehiculo.matricula) return;

        const celdaMatricula =
            fila.querySelector(".matricula-multa");

        if (celdaMatricula) {
            celdaMatricula.textContent = vehiculo.matricula;
        }

        console.log(
            `Ticket actualizado con matrícula ${vehiculo.matricula}.`
        );

    }


    // ==================================================
    // 15. REGISTRAR INFRACCIONES
    // ==================================================

    function registrarInfraccion(vehiculo, velocidad) {

        const limite = Number(limiteVelocidad.value);

        const resultado = verificarInfraccion(
            velocidad,
            limite
        );

        if (!resultado.infraccion) return;

        if (multasRegistradas.has(vehiculo.id)) return;

        multasRegistradas.add(vehiculo.id);

        infraccionesRegistradas++;

        totalInfracciones.textContent = infraccionesRegistradas;

        if (tablaMultas) {

            const mensaje = tablaMultas.querySelector(".empty-message");

            if (mensaje) {
                tablaMultas.innerHTML = "";
            }

            const fila = document.createElement("tr");

            fila.dataset.vehiculoId = vehiculo.id;

            const celdaMatricula = document.createElement("td");
            celdaMatricula.className = "matricula-multa";

            const celdaVelocidad = document.createElement("td");
            const celdaLimite = document.createElement("td");
            const celdaExceso = document.createElement("td");
            const celdaFecha = document.createElement("td");

            celdaMatricula.textContent =
                vehiculo.matricula || "No identificada";

            celdaVelocidad.textContent =
                `${velocidad.toFixed(2)} km/h`;

            celdaLimite.textContent =
                `${limite} km/h`;

            celdaExceso.textContent =
                `${resultado.exceso.toFixed(2)} km/h`;

            celdaFecha.textContent = obtenerFechaHora();

            fila.append(
                celdaMatricula,
                celdaVelocidad,
                celdaLimite,
                celdaExceso,
                celdaFecha
            );

            tablaMultas.prepend(fila);

            filasMultas.set(vehiculo.id, fila);

        }

        console.warn(
            "INFRACCIÓN REGISTRADA:",
            {
                vehiculo: vehiculo.id,
                matricula: vehiculo.matricula || "No identificada",
                velocidad,
                limite,
                exceso: resultado.exceso,
                fecha: obtenerFechaHora()
            }
        );

    }


    // ==================================================
    // 16. PROCESAR RESULTADO DE VELOCIDAD
    // ==================================================

    function procesarVelocidad(vehiculo) {

        const cruces = vehiculo.tiemposCruce;

        if (!cruces) return;

        // Esperar los tres cruces A, B y C.
        if (
            !Number.isFinite(cruces.A) ||
            !Number.isFinite(cruces.B) ||
            !Number.isFinite(cruces.C)
        ) {
            return;
        }

        if (vehiculo.velocidadesRegistradas) return;

        const distanciaAB = Number(distanciaABInput.value);
        const distanciaBC = Number(distanciaBCInput.value);

        const resultado = actualizarVelocidadVehiculo(
            vehiculo,
            distanciaAB,
            distanciaBC
        );

        if (
            !resultado ||
            !Number.isFinite(resultado.velocidad)
        ) {
            return;
        }

        vehiculo.velocidadesRegistradas = true;

        console.log(
            `VEHÍCULO ${vehiculo.id}`,
            resultado
        );

        actualizarTablaVehiculos(
            vehiculo,
            resultado.velocidad
        );

        // Actualizar velocidad máxima.
        if (resultado.velocidad > maximoRegistrado) {

            maximoRegistrado = resultado.velocidad;

            velocidadMaxima.innerHTML =
                `${maximoRegistrado.toFixed(2)} <small>km/h</small>`;

        }

        // Registrar infracción si supera el límite.
        registrarInfraccion(
            vehiculo,
            resultado.velocidad
        );

    }


    // ==================================================
    // 17. LIMPIAR REGISTROS Y ESTADÍSTICAS
    // ==================================================

    function limpiarRegistros() {

        multasRegistradas.clear();

        filasVehiculos.clear();
        filasMultas.clear();

        maximoRegistrado = 0;
        infraccionesRegistradas = 0;

        totalVehiculos.textContent = "0";
        totalInfracciones.textContent = "0";

        velocidadMaxima.innerHTML =
            `0 <small>km/h</small>`;

        if (tablaVehiculos) {
            tablaVehiculos.innerHTML = `
                <tr class="empty-message">
                    <td colspan="4">No hay vehículos detectados.</td>
                </tr>
            `;
        }

        if (tablaMultas) {
            tablaMultas.innerHTML = `
                <tr class="empty-message">
                    <td colspan="5">No hay infracciones registradas.</td>
                </tr>
            `;
        }

    }


    // ==================================================
    // 18. DETENER SISTEMA
    // ==================================================

    function detener() {

        // Invalidar operaciones OCR pendientes.
        sesionVideo++;

        procesando = false;

        if (bucleRAF !== null) {

            cancelAnimationFrame(bucleRAF);

            bucleRAF = null;

        }

        video.pause();

        video.onloadedmetadata = null;

        video.removeAttribute("src");
        video.srcObject = null;

        video.load();

        if (flujoCamara) {

            flujoCamara.getTracks().forEach(track => track.stop());

            flujoCamara = null;

        }

        if (fuenteVideo) {

            URL.revokeObjectURL(fuenteVideo);

            fuenteVideo = null;

        }

        video.loop = false;

        video.style.display = "none";
        placeholder.style.display = "block";

        const ctx = canvas.getContext("2d");

        ctx.clearRect(
            0,
            0,
            canvas.width,
            canvas.height
        );

        canvas.width = 0;
        canvas.height = 0;

        reiniciarSeguimiento();

        limpiarRegistros();

        ultimaDeteccion = 0;
        deteccionEnCurso = false;
        ultimoIntentoOCR = 0;

        actualizarEstado(
            "SISTEMA EN ESPERA",
            "#f59e0b"
        );

    }


    // ==================================================
    // 19. PROCESAR VIDEO
    // ==================================================

    async function procesarVideo(timestamp) {

        if (!procesando || video.paused || video.ended) {
            return;
        }

        if (
            timestamp - ultimaDeteccion >= INTERVALO_DETECCION &&
            !deteccionEnCurso
        ) {

            deteccionEnCurso = true;

            ultimaDeteccion = timestamp;

            try {

                const confianza = Number(confianzaInput.value);

                // --------------------------------------
                // 1. DETECTAR VEHÍCULOS
                // --------------------------------------

                const detecciones = await detectarVehiculos(
                    video,
                    confianza
                );

                if (!procesando) return;

                // --------------------------------------
                // 2. PREPARAR CANVAS
                // --------------------------------------

                if (
                    canvas.width !== video.videoWidth ||
                    canvas.height !== video.videoHeight
                ) {

                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;

                }

                const ctx = canvas.getContext("2d");

                ctx.clearRect(
                    0,
                    0,
                    canvas.width,
                    canvas.height
                );

                // --------------------------------------
                // 3. DIBUJAR VEHÍCULOS
                // --------------------------------------

                dibujarVehiculos(
                    canvas,
                    video,
                    detecciones
                );

                // --------------------------------------
                // 4. ACTUALIZAR SEGUIMIENTO
                // --------------------------------------

                const vehiculos = actualizarSeguimiento(
                    detecciones
                );

                // --------------------------------------
                // 5. CALCULAR POSICIÓN DE LAS LÍNEAS
                // --------------------------------------

                const configuracion = obtenerConfiguracionLineas();

                const lineaA = configuracion.orientacion === "horizontal"
                    ? canvas.height * configuracion.lineaA
                    : canvas.width * configuracion.lineaA;

                const lineaB = configuracion.orientacion === "horizontal"
                    ? canvas.height * configuracion.lineaB
                    : canvas.width * configuracion.lineaB;

                const lineaC = configuracion.orientacion === "horizontal"
                    ? canvas.height * configuracion.lineaC
                    : canvas.width * configuracion.lineaC;

                // --------------------------------------
                // 6. REGISTRAR CRUCES
                // --------------------------------------

                registrarCruces(
                    vehiculos,
                    lineaA,
                    lineaB,
                    lineaC,
                    video.currentTime,
                    configuracion.orientacion
                );

                // --------------------------------------
                // 7. CALCULAR VELOCIDADES
                // --------------------------------------

                vehiculos.forEach(vehiculo => {
                    procesarVelocidad(vehiculo);
                });

                // --------------------------------------
                // 8. DETECTAR Y LEER MATRÍCULAS
                // --------------------------------------

                // Se aplica a TODOS los vehículos seguidos.
                // No depende de que exista una infracción.
                procesarOCR(vehiculos);

                // --------------------------------------
                // 9. DIBUJAR SEGUIMIENTO Y MATRÍCULAS
                // --------------------------------------

                dibujarSeguimiento(vehiculos);

                // --------------------------------------
                // 10. ACTUALIZAR CONTADOR
                // --------------------------------------

                const cantidad = vehiculos.filter(
                    vehiculo =>
                        vehiculo.fotogramasPerdidos === 0 &&
                        vehiculo.hits >= 2
                ).length;

                totalVehiculos.textContent = cantidad;

            } catch (error) {

                console.error(
                    "Error durante el procesamiento del video:",
                    error
                );

            } finally {

                deteccionEnCurso = false;

            }

        }

        if (procesando) {
            bucleRAF = requestAnimationFrame(procesarVideo);
        }

    }


    // ==================================================
    // 20. INICIAR PROCESAMIENTO
    // ==================================================

    async function iniciarProcesamiento() {

        if (!modeloVehiculos) {

            alert(
                "El modelo de vehículos todavía no está cargado."
            );

            return;

        }

        if (!modeloDetector) {

            alert(
                "El modelo de matrículas todavía no está cargado."
            );

            return;

        }

        if (!trabajadorOCR) {

            alert(
                "El reconocimiento OCR todavía no está disponible."
            );

            return;

        }

        try {

            await video.play();

            procesando = true;

            ultimaDeteccion = 0;

            mostrarVideo();

            actualizarEstado(
                "SISTEMA ACTIVO",
                "#22c55e"
            );

            bucleRAF = requestAnimationFrame(procesarVideo);

        } catch (error) {

            console.error(error);

            alert(
                "No se pudo reproducir el video."
            );

        }

    }


    // ==================================================
    // 21. ACTIVAR CÁMARA
    // ==================================================

    btnCamara.addEventListener("click", async () => {

        try {

            detener();

            video.loop = false;

            flujoCamara = await navigator.mediaDevices.getUserMedia({

                video: {
                    facingMode: "environment"
                },

                audio: false

            });

            video.srcObject = flujoCamara;

            video.onloadedmetadata = async () => {
                await iniciarProcesamiento();
            };

        } catch (error) {

            console.error(error);

            alert(
                "No fue posible activar la cámara. Revisa los permisos."
            );

        }

    });


    // ==================================================
    // 22. CARGAR VIDEO
    // ==================================================

    inputVideo.addEventListener("change", () => {

        const archivo = inputVideo.files[0];

        if (!archivo) return;

        detener();

        fuenteVideo = URL.createObjectURL(archivo);

        video.loop = true;
        video.src = fuenteVideo;

        video.onloadedmetadata = async () => {
            await iniciarProcesamiento();
        };

    });


    // ==================================================
    // 23. BOTÓN DETENER
    // ==================================================

    btnDetener.addEventListener("click", detener);


    // ==================================================
    // 24. INICIALIZAR MODELOS Y OCR
    // ==================================================

    async function inicializar() {

        console.log(
            "Cargando modelos ONNX y motor OCR..."
        );

        actualizarEstado(
            "CARGANDO MODELOS",
            "#f59e0b"
        );

        try {

            const resultados = await Promise.all([

                cargarModelo(),

                cargarModeloVehiculos(),

                inicializarOCR()

            ]);

            const matriculasCargadas = resultados[0];
            const vehiculosCargados = resultados[1];
            const ocrCargado = resultados[2];

            if (
                matriculasCargadas &&
                vehiculosCargados &&
                ocrCargado
            ) {

                actualizarEstado(
                    "MODELOS Y OCR CARGADOS",
                    "#22c55e"
                );

                console.log(
                    "Sistema listo para detectar vehículos, " +
                    "reconocer matrículas y calcular velocidades."
                );

            } else {

                actualizarEstado(
                    "ERROR AL CARGAR COMPONENTES",
                    "#ef4444"
                );

                console.error(
                    "Resultado de inicialización:",
                    {
                        modeloMatriculas: matriculasCargadas,
                        modeloVehiculos: vehiculosCargados,
                        OCR: ocrCargado
                    }
                );

            }

        } catch (error) {

            console.error(
                "Error al inicializar el sistema:",
                error
            );

            actualizarEstado(
                "ERROR AL INICIALIZAR",
                "#ef4444"
            );

        }

    }


    // ==================================================
    // 25. INICIAR APLICACIÓN
    // ==================================================

    actualizarEtiquetasLineas();

    inicializar();

});