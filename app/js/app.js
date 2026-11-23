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

    const procesadorONNX = document.getElementById("procesadorONNX");

    const fpsDeteccion = document.getElementById("fpsDeteccion");

    const metodoVelocidadInput = document.getElementById("metodoVelocidad");
    const factorEscalaInput    = document.getElementById("factorEscala");


    // ==================================================
    // 2. VARIABLES DE CONTROL
    // ==================================================

    let flujoCamara = null;
    let fuenteVideo = null;

    let procesando = false;
    let deteccionEnCurso = false;

    let ultimaDeteccion = 0;
    let bucleRAF = null;

    // Con la inferencia en worker el límite real lo pone el
    // modelo. Esta compuerta evita encolar más de una
    // detección a la vez y deja respirar al navegador.
    const INTERVALO_DETECCION = 70;

    // Medición de rendimiento (se actualiza una vez por segundo).
    let fpsContador = 0;
    let fpsInicio = performance.now();
    let msInferenciaAcumulado = 0;
    let msInferenciaMuestras = 0;

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

    const INTERVALO_OCR = 500;
    const CONFIANZA_PLACA = 0.10;
    const MAX_INTENTOS_OCR = 10;

    // Identifica cada reproducción.
    let sesionVideo = 0;

    // Canvas auxiliar para recortar vehículos.
    const canvasRecorte = document.createElement("canvas");

    const contextoRecorte = canvasRecorte.getContext("2d", {
        willReadFrequently: true
    });

    // Canvas reutilizable para recortar matrículas.
    // Evita crear un nuevo elemento DOM en cada intento OCR.
    const canvasPlacaOCR = document.createElement("canvas");

    const ctxPlacaOCR = canvasPlacaOCR.getContext("2d", {
        willReadFrequently: true
    });

    // Tiempo del último frame procesado para detectar
    // cuando el video hace loop y resetear el tracker.
    let tiempoFrameAnterior = 0;


    // ==================================================
    // 3. CONFIGURACIÓN DE LÍNEAS
    // ==================================================

    function obtenerConfiguracionLineas() {

        return {
            lineaA: Number(lineaAInput.value) / 100,
            lineaB: Number(lineaBInput.value) / 100,
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
    // 6b. MEDIR RENDIMIENTO (FPS Y TIEMPO DE INFERENCIA)
    // ==================================================

    function actualizarRendimiento() {

        fpsContador++;

        const ahora = performance.now();

        const transcurrido = ahora - fpsInicio;

        if (transcurrido < 1000) return;

        const fps = fpsContador * 1000 / transcurrido;

        const ms = msInferenciaMuestras > 0
            ? msInferenciaAcumulado / msInferenciaMuestras
            : 0;

        if (fpsDeteccion) {

            fpsDeteccion.textContent =
                `${fps.toFixed(1)} FPS · ${ms.toFixed(0)} ms`;

        }

        fpsContador = 0;
        fpsInicio = ahora;
        msInferenciaAcumulado = 0;
        msInferenciaMuestras = 0;

    }


    // ==================================================
    // 6c. MOSTRAR EL PROCESADOR DE LOS MODELOS
    // ==================================================

    function actualizarProcesador() {

        if (!procesadorONNX) return;

        const epVehiculos = modeloVehiculos?.ep;
        const epMatriculas = modeloDetector?.ep;

        const usaGPU =
            epVehiculos === "webgpu" ||
            epMatriculas === "webgpu";

        const usaCPU =
            epVehiculos === "wasm" ||
            epMatriculas === "wasm";

        procesadorONNX.textContent =
            usaGPU && usaCPU
                ? "GPU + CPU"
                : usaGPU
                    ? "GPU (WebGPU)"
                    : "CPU (WASM)";

        if (!usaGPU) {

            console.warn(
                "WebGPU no está disponible. Los modelos usarán " +
                "WASM y el rendimiento será menor. Prueba con " +
                "Chrome o Edge actualizados."
            );

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

    // ==================================================
    // MEJORAR RECORTE DEL VEHÍCULO (PREPROCESAMIENTO)
    // Ecualización de histograma + escalado para reducir
    // reflejos y mejorar la detección de placas.
    // ==================================================
    function mejorarRecorteVehiculo(imagen) {

        const anchoOrig = imagen.width || imagen.videoWidth || imagen.naturalWidth;
        const altoOrig = imagen.height || imagen.videoHeight || imagen.naturalHeight;
        if (!anchoOrig || !altoOrig) return imagen;

        // Escalar ×2 para mejorar la detección.
        const escala = 2;
        const ancho = anchoOrig * escala;
        const alto = altoOrig * escala;

        const canvas = document.createElement("canvas");
        canvas.width = ancho;
        canvas.height = alto;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(imagen, 0, 0, ancho, alto);

        const datos = ctx.getImageData(0, 0, ancho, alto);

        // Convertir a YUV y ecualizar el canal Y.
        const hist = new Array(256).fill(0);
        for (let i = 0; i < datos.data.length; i += 4) {
            const y = Math.round(0.299 * datos.data[i] + 0.587 * datos.data[i + 1] + 0.114 * datos.data[i + 2]);
            hist[y]++;
        }

        // CDF
        const cdf = new Array(256).fill(0);
        cdf[0] = hist[0];
        for (let i = 1; i < 256; i++) {
            cdf[i] = cdf[i - 1] + hist[i];
        }

        const total = ancho * alto;
        const cdfMin = cdf.find(v => v > 0) || 0;
        const escalaHist = 255 / (total - cdfMin);

        for (let i = 0; i < datos.data.length; i += 4) {
            const r = datos.data[i];
            const g = datos.data[i + 1];
            const b = datos.data[i + 2];
            const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
            const yEq = Math.round((cdf[y] - cdfMin) * escalaHist);
            const factor = y > 0 ? yEq / y : 1;
            datos.data[i]     = Math.min(255, Math.round(r * factor));
            datos.data[i + 1] = Math.min(255, Math.round(g * factor));
            datos.data[i + 2] = Math.min(255, Math.round(b * factor));
        }

        ctx.putImageData(datos, 0, 0);
        return canvas;

    }

    async function reconocerMatriculaVehiculo(
        vehiculo,
        sesionActual
    ) {

        if (!modeloDetector || !trabajadorOCR) return;

        if (vehiculo.matricula) return;

        const recorte = recortarVehiculo(vehiculo);

        if (!recorte) return;

        // Preprocesar el recorte para reducir reflejos y
        // mejorar la detección de placas (CLAHE simplificado
        // por ecualización de histograma + escalado).
        const recorteMejorado = mejorarRecorteVehiculo(recorte.imagen);

        // Detectar matrículas dentro del vehículo.
        const placas = await detectarMatriculas(
            recorteMejorado,
            CONFIANZA_PLACA
        );

        // Comprobar que sigue siendo la misma sesión.
        if (sesionActual !== sesionVideo) return;

        if (!procesando) return;

        console.log(
            `[DIAG] Vehículo ${vehiculo.id}: ${placas ? placas.length : 0} placas detectadas. ` +
            `Recorte: ${recorte.ancho}×${recorte.alto}px.`
        );

        if (placas && placas.length > 0) {
            placas.forEach((p, i) => {
                console.log(
                    `  placa ${i + 1}: confianza ${(p.confianza * 100).toFixed(1)}%, ` +
                    `tamaño ${(p.x2 - p.x1)}×${(p.y2 - p.y1)}px`
                );
            });
        }

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

        // Añadir padding para que Tesseract no pierda
        // caracteres cortados en los bordes de la caja.
        const padH = Math.round(placaAncho * 0.15);
        const padV = Math.round(placaAlto * 0.20);

        const srcX = Math.max(0, placa.x1 - padH);
        const srcY = Math.max(0, placa.y1 - padV);
        const srcX2 = Math.min(recorteMejorado.width, placa.x2 + padH);
        const srcY2 = Math.min(recorteMejorado.height, placa.y2 + padV);
        const srcAncho = srcX2 - srcX;
        const srcAlto  = srcY2 - srcY;

        // Reutilizar canvas preallocado para evitar
        // crear un nuevo elemento DOM en cada intento OCR.
        canvasPlacaOCR.width  = Math.max(1, Math.ceil(srcAncho));
        canvasPlacaOCR.height = Math.max(1, Math.ceil(srcAlto));

        // Recortar desde la captura mejorada del vehículo (con padding).
        // Las coordenadas ya están en el espacio del recorte mejorado.
        ctxPlacaOCR.drawImage(
            recorteMejorado,
            srcX,
            srcY,
            srcAncho,
            srcAlto,
            0,
            0,
            canvasPlacaOCR.width,
            canvasPlacaOCR.height
        );

        console.log(
            `[OCR] Vehículo ${vehiculo.id}: ` +
            `caja placa ${Math.round(placaAncho)}×${Math.round(placaAlto)}px ` +
            `(confianza modelo: ${(placa.confianza * 100).toFixed(1)}%)`
        );

        // Recorte crudo (antes del preprocesamiento OCR).
        // Copia el link y pégalo en una pestaña para ver qué detectó el modelo.
        console.log("[OCR recorte crudo] →", canvasPlacaOCR.toDataURL());

        // Aplicar reconocimiento OCR.
        const resultadoOCR = await leerMatriculaONNX(canvasPlacaOCR);

        if (sesionActual !== sesionVideo) return;

        if (!procesando) return;

        vehiculo.deteccionMatricula = {

            x1: placaX,
            y1: placaY,
            x2: placaX + placaAncho,
            y2: placaY + placaAlto,

            confianza: placa.confianza

        };

        // Capturar imagen de la placa para incluirla en la multa.
        capturarImagenPlaca(vehiculo);

        vehiculo.ultimoResultadoOCR = resultadoOCR;

        if (!vehiculo.lecturasOCR) {
            vehiculo.lecturasOCR = [];
        }

        if (resultadoOCR && resultadoOCR.texto) {
            const textoNorm = (typeof normalizarVariantes === "function")
                ? normalizarVariantes(resultadoOCR.texto)
                : resultadoOCR.texto;
            vehiculo.lecturasOCR.push(textoNorm);
        }

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
                vehiculo.hits >= 1 &&
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

        // Procesar un vehículo por ciclo (throttle reducido).
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

                // Votación: elegir la lectura más frecuente
                // entre los intentos acumulados.
                if (vehiculo.lecturasOCR && vehiculo.lecturasOCR.length > 0) {

                    const conteo = {};
                    vehiculo.lecturasOCR.forEach(t => {
                        conteo[t] = (conteo[t] || 0) + 1;
                    });

                    const masFrecuente = Object.keys(conteo).reduce(
                        (a, b) => (conteo[a] >= conteo[b] ? a : b)
                    );

                    if (masFrecuente) {
                        vehiculo.matricula = masFrecuente;
                        vehiculo.confianzaOCR = 20;
                        vehiculo.ocrFinalizado = true;

                        console.log(
                            `MATRÍCULA (votación): Vehículo ${vehiculo.id} -> ${vehiculo.matricula}`
                        );

                        actualizarTablaVehiculos(
                            vehiculo,
                            vehiculo.velocidades?.velocidad ?? null
                        );

                        actualizarMatriculaMulta(vehiculo);
                        return;
                    }

                }

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

        dibujarLineas(
            ctx,
            ancho,
            alto,
            lineaA,
            lineaB,
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

        // Actualizar imagen de placa si ya fue capturada.
        actualizarImagenPlacaMulta(vehiculo);

        console.log(
            `Ticket actualizado con matrícula ${vehiculo.matricula}.`
        );

    }


    // ==================================================
    // 15. CREAR FILA DE MULTA EN LA TABLA
    // ==================================================

    function crearFilaMulta(vehiculo, velocidad) {

        const limite   = Number(limiteVelocidad.value);
        const resultado = verificarInfraccion(velocidad, limite);

        if (!resultado.infraccion) return;
        if (multasRegistradas.has(vehiculo.id)) return;

        multasRegistradas.add(vehiculo.id);
        infraccionesRegistradas++;
        totalInfracciones.textContent = infraccionesRegistradas;

        if (!tablaMultas) return;

        const mensaje = tablaMultas.querySelector(".empty-message");
        if (mensaje) tablaMultas.innerHTML = "";

        const fila = document.createElement("tr");
        fila.dataset.vehiculoId = vehiculo.id;

        // --- Celda imagen de placa ---
        const celdaImagen = document.createElement("td");
        celdaImagen.className = "imagen-placa-multa";

        if (vehiculo.imagenPlaca) {

            const img = document.createElement("img");
            img.src    = vehiculo.imagenPlaca;
            img.alt    = "Placa";
            img.style.cssText =
                "max-width:120px; max-height:50px; " +
                "border:2px solid #38bdf8; border-radius:4px; " +
                "image-rendering:pixelated;";
            celdaImagen.appendChild(img);

        } else {
            celdaImagen.textContent = "—";
            celdaImagen.style.color = "#64748b";
        }

        // --- Celda matrícula ---
        const celdaMatricula = document.createElement("td");
        celdaMatricula.className = "matricula-multa";
        celdaMatricula.textContent = vehiculo.matricula || "No identificada";

        // --- Resto de celdas ---
        const celdaVelocidad = document.createElement("td");
        celdaVelocidad.textContent = `${velocidad.toFixed(2)} km/h`;

        const celdaLimite = document.createElement("td");
        celdaLimite.textContent = `${limite} km/h`;

        const celdaExceso = document.createElement("td");
        celdaExceso.textContent = `${resultado.exceso.toFixed(2)} km/h`;
        celdaExceso.style.color = "#ef4444";
        celdaExceso.style.fontWeight = "bold";

        const celdaFecha = document.createElement("td");
        celdaFecha.textContent = obtenerFechaHora();

        fila.append(
            celdaImagen,
            celdaMatricula,
            celdaVelocidad,
            celdaLimite,
            celdaExceso,
            celdaFecha
        );

        tablaMultas.prepend(fila);
        filasMultas.set(vehiculo.id, fila);

        console.warn("INFRACCIÓN REGISTRADA:", {
            vehiculo: vehiculo.id,
            matricula: vehiculo.matricula || "No identificada",
            velocidad,
            limite,
            exceso: resultado.exceso,
            fecha: obtenerFechaHora()
        });

    }


    // ==================================================
    // 15b. REGISTRAR INFRACCIONES (MÉTODO TRES LÍNEAS)
    // ==================================================

    function registrarInfraccion(vehiculo, velocidad) {
        crearFilaMulta(vehiculo, velocidad);
    }


    // ==================================================
    // 15c. REGISTRAR INFRACCIONES (MÉTODO PERSPECTIVA)
    // Guarda la velocidad máxima observada y registra la
    // multa solo cuando el vehículo sale del encuadre o
    // cuando la velocidad supera claramente el límite,
    // para evitar registros duplicados por fluctuaciones.
    // ==================================================

    function registrarInfraccionPerspectiva(vehiculo, velocidad) {

        // Si ya fue multado, solo actualizar la imagen de placa
        // si aún no la tenemos.
        if (multasRegistradas.has(vehiculo.id)) {
            actualizarImagenPlacaMulta(vehiculo);
            return;
        }

        const limite = Number(limiteVelocidad.value);

        if (velocidad <= limite) return;

        // Acumular la velocidad máxima vista para este vehículo.
        if (
            !vehiculo.velocidadMaximaObservada ||
            velocidad > vehiculo.velocidadMaximaObservada
        ) {
            vehiculo.velocidadMaximaObservada = velocidad;

            // Capturar imagen de placa en el momento de mayor
            // velocidad para incluirla en la multa.
            if (vehiculo.deteccionMatricula) {
                capturarImagenPlaca(vehiculo);
            }

        }

        // Registrar la multa cuando la velocidad supera el
        // límite en más de un 5 % (margen para evitar ruido).
        if (velocidad > limite * 1.05) {
            crearFilaMulta(vehiculo, velocidad);
        }

    }


    // ==================================================
    // 15d. CAPTURAR IMAGEN DE LA PLACA
    // ==================================================

    function capturarImagenPlaca(vehiculo) {

        const placa = vehiculo.deteccionMatricula;
        if (!placa) return;

        const pad = 6;
        const x = Math.max(0, Math.floor(placa.x1 - pad));
        const y = Math.max(0, Math.floor(placa.y1 - pad));
        const w = Math.min(video.videoWidth,  Math.ceil(placa.x2 + pad)) - x;
        const h = Math.min(video.videoHeight, Math.ceil(placa.y2 + pad)) - y;

        if (w < 5 || h < 5) return;

        canvasRecorte.width  = w;
        canvasRecorte.height = h;

        contextoRecorte.drawImage(video, x, y, w, h, 0, 0, w, h);

        vehiculo.imagenPlaca = canvasRecorte.toDataURL("image/png");

    }


    // ==================================================
    // 15e. ACTUALIZAR IMAGEN DE PLACA EN MULTA EXISTENTE
    // ==================================================

    function actualizarImagenPlacaMulta(vehiculo) {

        if (!vehiculo.imagenPlaca) return;

        const fila = filasMultas.get(vehiculo.id);
        if (!fila) return;

        const celda = fila.querySelector(".imagen-placa-multa");
        if (!celda || celda.querySelector("img")) return;

        const img = document.createElement("img");
        img.src = vehiculo.imagenPlaca;
        img.alt = "Placa";
        img.style.cssText =
            "max-width:120px; max-height:50px; " +
            "border:2px solid #38bdf8; border-radius:4px; " +
            "image-rendering:pixelated;";

        celda.textContent = "";
        celda.appendChild(img);

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
                    <td colspan="6">No hay infracciones registradas.</td>
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
        tiempoFrameAnterior = 0;

        fpsContador = 0;
        fpsInicio = performance.now();
        msInferenciaAcumulado = 0;
        msInferenciaMuestras = 0;

        if (fpsDeteccion) {
            fpsDeteccion.textContent = "—";
        }

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
                // 1. CAPTURAR TIEMPO DEL FRAME ACTUAL
                // Se debe leer ANTES de la inferencia ONNX
                // porque ésta puede tardar decenas o cientos
                // de ms, tiempo durante el cual el video sigue
                // avanzando. Usar currentTime post-inferencia
                // produce tiempos de cruce incorrectos y
                // velocidades sistemáticamente subestimadas.
                // --------------------------------------

                const tiempoFrame = video.currentTime;

                // Detectar loop del video: si el tiempo actual
                // es menor que el del frame anterior significa
                // que el video reinició. Se resetea el tracker
                // para evitar tiempos de cruce mezclados entre
                // ciclos distintos (lo que produce velocidades
                // absurdas o cruces no detectados).
                // Desactivado para permitir pruebas con videos cortos
                // (dataset VS13). Para reactivar la detección de loop,
                // cambiar la condición a: tiempoFrame < tiempoFrameAnterior - 0.5
                if (false) {

                    console.log(
                        "Loop de video detectado. " +
                        "Reiniciando seguimiento."
                    );

                    reiniciarSeguimiento();
                    limpiarRegistros();

                }

                tiempoFrameAnterior = tiempoFrame;

                // --------------------------------------
                // 2. DETECTAR VEHÍCULOS
                // --------------------------------------

                const inicioInferencia = performance.now();

                const detecciones = await detectarVehiculos(
                    video,
                    confianza
                );

                msInferenciaAcumulado +=
                    performance.now() - inicioInferencia;

                msInferenciaMuestras++;

                if (!procesando) return;

                // --------------------------------------
                // 3. PREPARAR CANVAS
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
                // 4. DIBUJAR VEHÍCULOS
                // --------------------------------------

                dibujarVehiculos(
                    canvas,
                    video,
                    detecciones
                );

                // --------------------------------------
                // 5. ACTUALIZAR SEGUIMIENTO
                // --------------------------------------

                const vehiculos = actualizarSeguimiento(
                    detecciones
                );

                // --------------------------------------
                // 6. CALCULAR POSICIÓN DE LAS LÍNEAS
                // --------------------------------------

                const configuracion = obtenerConfiguracionLineas();

                const lineaA = configuracion.orientacion === "horizontal"
                    ? canvas.height * configuracion.lineaA
                    : canvas.width * configuracion.lineaA;

                const lineaB = configuracion.orientacion === "horizontal"
                    ? canvas.height * configuracion.lineaB
                    : canvas.width * configuracion.lineaB;

                // --------------------------------------
                // 7. REGISTRAR CRUCES (ZONA RADAR 2 LÍNEAS)
                // --------------------------------------

                registrarCruces(
                    vehiculos,
                    lineaA,
                    lineaB,
                    tiempoFrame,
                    configuracion.orientacion
                );

                // --------------------------------------
                // 7b. REGISTRAR HISTORIAL BBOX Y CALCULAR
                //     VELOCIDAD POR PERSPECTIVA
                // Se ejecuta en cada frame para mantener
                // una estimación continua de velocidad
                // independiente del cruce de líneas.
                // --------------------------------------

                const metodo      = metodoVelocidadInput.value;
                const factorEscala = Number(factorEscalaInput.value);

                vehiculos.forEach(vehiculo => {

                    if (
                        vehiculo.fotogramasPerdidos !== 0 ||
                        vehiculo.hits < 2
                    ) return;

                    // Actualizar historial de tamaño del bbox.
                    registrarMuestraBbox(
                        vehiculo,
                        vehiculo.deteccion,
                        tiempoFrame
                    );

                    // Calcular velocidad por perspectiva si
                    // el método seleccionado lo incluye.
                    // Radar (2 líneas) siempre que existan ambos cruces.
                    const resultadoRadar = actualizarVelocidadVehiculo(
                        vehiculo,
                        Number(distanciaABInput?.value) || 12.0
                    );

                    // Estimación continua por regresión/perspectiva.
                    if (
                        metodo === "continuo" ||
                        metodo === "ambos" ||
                        metodo === "radar" ||
                        metodo === "perspectiva"
                    ) {

                        const resultadoContinuo =
                            calcularVelocidadContinua(
                                vehiculo,
                                factorEscala
                            );

                        if (resultadoContinuo) {
                            actualizarTablaVehiculos(
                                vehiculo,
                                resultadoContinuo.velocidad
                            );

                            if (
                                resultadoContinuo.velocidad >
                                maximoRegistrado
                            ) {
                                maximoRegistrado =
                                    resultadoContinuo.velocidad;

                                velocidadMaxima.innerHTML =
                                    `${maximoRegistrado.toFixed(2)} ` +
                                    `<small>km/h</small>`;
                            }
                        }

                        // El radar prevalece sobre la continua.
                        if (resultadoRadar) {
                            actualizarTablaVehiculos(
                                vehiculo,
                                resultadoRadar.velocidad
                            );

                            if (
                                resultadoRadar.velocidad >
                                maximoRegistrado
                            ) {
                                maximoRegistrado =
                                    resultadoRadar.velocidad;

                                velocidadMaxima.innerHTML =
                                    `${maximoRegistrado.toFixed(2)} ` +
                                    `<small>km/h</small>`;
                            }
                        }

                    }

                });

                // --------------------------------------
                // 8. VELOCIDADES YA CALCULADAS ARRIBA
                // (radar 2 líneas + estimación continua)
                // --------------------------------------

                // --------------------------------------
                // 9. DETECTAR Y LEER MATRÍCULAS
                // --------------------------------------

                // Se aplica a TODOS los vehículos seguidos.
                // No depende de que exista una infracción.
                procesarOCR(vehiculos);

                // --------------------------------------
                // 10. DIBUJAR SEGUIMIENTO Y MATRÍCULAS
                // --------------------------------------

                dibujarSeguimiento(vehiculos);

                // --------------------------------------
                // 11. ACTUALIZAR CONTADOR
                // --------------------------------------

                const cantidad = vehiculos.filter(
                    vehiculo =>
                        vehiculo.fotogramasPerdidos === 0 &&
                        vehiculo.hits >= 2
                ).length;

                totalVehiculos.textContent = cantidad;

                // --------------------------------------
                // 12. MEDIR RENDIMIENTO
                // --------------------------------------

                actualizarRendimiento();

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
            tiempoFrameAnterior = 0;

            fpsContador = 0;
            fpsInicio = performance.now();
            msInferenciaAcumulado = 0;
            msInferenciaMuestras = 0;

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

                inicializarOCR(),

                cargarModeloOCR()

            ]);

            const matriculasCargadas = resultados[0];
            const vehiculosCargados = resultados[1];
            const ocrCargado = resultados[2];

            actualizarProcesador();

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