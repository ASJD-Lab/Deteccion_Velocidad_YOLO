// ======================================================
// MÓDULO DE DETECCIÓN DE MATRÍCULAS
// YOLOv8 + ONNX Runtime Web
// ======================================================

let modeloDetector = null;

const TAMANO_ENTRADA = 640;

// Canvas reutilizable para evitar crearlo en cada inferencia.
const canvasDetector = document.createElement("canvas");

canvasDetector.width = TAMANO_ENTRADA;
canvasDetector.height = TAMANO_ENTRADA;

const contextoDetector = canvasDetector.getContext("2d", {
    willReadFrequently: true
});


// ======================================================
// 1. CARGAR MODELO ONNX
// ======================================================

async function cargarModelo() {

    try {

        console.log("Cargando modelo YOLO de matrículas...");

        const respuesta = await fetch(
            "../modelos/best_deteccion_opt.onnx"
        );

        if (!respuesta.ok) {

            throw new Error(
                "No se pudo descargar best_deteccion.onnx " +
                `(HTTP ${respuesta.status}).`
            );

        }

        const tipoContenido =
            respuesta.headers.get("content-type") || "";

        if (tipoContenido.includes("text/html")) {

            throw new Error(
                "best_deteccion.onnx no se encontró en modelos/."
            );

        }

        const buffer = await respuesta.arrayBuffer();

        // Igual que el detector de vehículos: worker con
        // WebGPU y respaldo a WASM para no bloquear la UI.
        modeloDetector = await SesionONNX.crear(buffer, {
            tamanoEntrada: TAMANO_ENTRADA,
            etiqueta: "Modelo de matrículas"
        });

        console.log("Modelo de matrículas cargado correctamente.");

        console.log("Entrada:", modeloDetector.inputNames);
        console.log("Salida:", modeloDetector.outputNames);

        console.log(
            `Procesador de matrículas: ${modeloDetector.ep}.`
        );

        const estado = document.getElementById("estadoModelo");

        if (estado) {
            estado.textContent = "Modelos cargados";
        }

        return true;

    } catch (error) {

        console.error(
            "Error al cargar modelo de matrículas:",
            error
        );

        const estado = document.getElementById("estadoModelo");

        if (estado) {
            estado.textContent = "Error al cargar modelos";
        }

        return false;

    }

}


// ======================================================
// 2. OBTENER DIMENSIONES DE LA IMAGEN
// ======================================================

function obtenerDimensionesImagen(imagen) {

    if (!imagen) {
        return null;
    }

    const ancho =
        imagen.videoWidth ||
        imagen.naturalWidth ||
        imagen.width;

    const alto =
        imagen.videoHeight ||
        imagen.naturalHeight ||
        imagen.height;

    if (!ancho || !alto) {
        return null;
    }

    return {
        ancho,
        alto
    };

}


// ======================================================
// 3. PREPROCESAMIENTO DE IMÁGENES
// ======================================================

function preprocesarImagen(imagen) {

    const dimensiones = obtenerDimensionesImagen(imagen);

    if (!dimensiones) {
        throw new Error("La imagen no tiene dimensiones válidas.");
    }

    const ancho = dimensiones.ancho;
    const alto = dimensiones.alto;

    // Mantener la proporción de la imagen.
    const escala = Math.min(
        TAMANO_ENTRADA / ancho,
        TAMANO_ENTRADA / alto
    );

    const nuevoAncho = Math.round(ancho * escala);
    const nuevoAlto = Math.round(alto * escala);

    const padX = (TAMANO_ENTRADA - nuevoAncho) / 2;
    const padY = (TAMANO_ENTRADA - nuevoAlto) / 2;

    // Fondo gris para completar el formato cuadrado.
    contextoDetector.fillStyle = "rgb(114,114,114)";

    contextoDetector.fillRect(
        0,
        0,
        TAMANO_ENTRADA,
        TAMANO_ENTRADA
    );

    // Dibujar imagen o recorte.
    contextoDetector.drawImage(
        imagen,
        padX,
        padY,
        nuevoAncho,
        nuevoAlto
    );

    const imagenProcesada = contextoDetector.getImageData(
        0,
        0,
        TAMANO_ENTRADA,
        TAMANO_ENTRADA
    );

    const datos = imagenProcesada.data;

    const area = TAMANO_ENTRADA * TAMANO_ENTRADA;

    // Buffer nuevo por inferencia: se transfiere al worker
    // y deja de pertenecer al hilo principal.
    const tensor = new Float32Array(3 * area);

    // Convertir RGBA a RGB normalizado y formato CHW.
    for (let i = 0; i < area; i++) {

        const posicion = i * 4;

        tensor[i] = datos[posicion] / 255;

        tensor[area + i] = datos[posicion + 1] / 255;

        tensor[2 * area + i] = datos[posicion + 2] / 255;

    }

    return {

        tensor,

        escala,

        padX,

        padY,

        ancho,

        alto

    };

}


// ======================================================
// 4. CALCULAR INTERSECCIÓN SOBRE UNIÓN (IoU)
// ======================================================

function calcularIoU(a, b) {

    const x1 = Math.max(a.x1, b.x1);
    const y1 = Math.max(a.y1, b.y1);

    const x2 = Math.min(a.x2, b.x2);
    const y2 = Math.min(a.y2, b.y2);

    const interseccion =
        Math.max(0, x2 - x1) *
        Math.max(0, y2 - y1);

    const areaA =
        Math.max(0, a.x2 - a.x1) *
        Math.max(0, a.y2 - a.y1);

    const areaB =
        Math.max(0, b.x2 - b.x1) *
        Math.max(0, b.y2 - b.y1);

    return interseccion /
        (areaA + areaB - interseccion + 1e-7);

}


// ======================================================
// 5. SUPRESIÓN DE DETECCIONES DUPLICADAS (NMS)
// ======================================================

function aplicarNMS(detecciones, umbral = 0.45) {

    // Trabajar sobre una copia para no mutar el array de entrada.
    let candidatos = [...detecciones].sort(
        (a, b) => b.confianza - a.confianza
    );

    const seleccionadas = [];

    while (candidatos.length > 0) {

        const mejor = candidatos.shift();

        seleccionadas.push(mejor);

        candidatos = candidatos.filter(
            deteccion =>
                calcularIoU(mejor, deteccion) < umbral
        );

    }

    return seleccionadas;

}


// ======================================================
// 6. INTERPRETAR SALIDA DE YOLOv8
// ======================================================

function procesarSalida(salida, parametros, confianzaMinima) {

    const datos = salida.data;
    const dimensiones = salida.dims;

    if (!datos || !dimensiones || dimensiones.length !== 3) {

        console.error(
            "Formato de salida ONNX no reconocido:",
            dimensiones
        );

        return [];

    }

    // El modelo puede devolver:
    // [1, 5, N] o [1, N, 5].
    // En ambos casos se esperan 4 coordenadas y 1 confianza.

    let cantidadPredicciones;
    let caracteristicasPrimero;

    if (dimensiones[1] === 5) {

        cantidadPredicciones = dimensiones[2];
        caracteristicasPrimero = true;

    } else if (dimensiones[2] === 5) {

        cantidadPredicciones = dimensiones[1];
        caracteristicasPrimero = false;

    } else {

        console.error(
            "El modelo no devuelve 5 características por predicción:",
            dimensiones
        );

        return [];

    }

    const detecciones = [];

    const escala = parametros.escala;

    for (let i = 0; i < cantidadPredicciones; i++) {

        let centroX;
        let centroY;
        let ancho;
        let alto;
        let confianza;

        if (caracteristicasPrimero) {

            centroX = datos[i];

            centroY = datos[cantidadPredicciones + i];

            ancho = datos[2 * cantidadPredicciones + i];

            alto = datos[3 * cantidadPredicciones + i];

            confianza = datos[4 * cantidadPredicciones + i];

        } else {

            const inicio = i * 5;

            centroX = datos[inicio];

            centroY = datos[inicio + 1];

            ancho = datos[inicio + 2];

            alto = datos[inicio + 3];

            confianza = datos[inicio + 4];

        }

        if (
            !Number.isFinite(confianza) ||
            confianza < confianzaMinima
        ) {
            continue;
        }

        // Convertir coordenadas del modelo
        // a coordenadas de la imagen original.

        const x1 =
            (centroX - ancho / 2 - parametros.padX) / escala;

        const y1 =
            (centroY - alto / 2 - parametros.padY) / escala;

        const x2 =
            (centroX + ancho / 2 - parametros.padX) / escala;

        const y2 =
            (centroY + alto / 2 - parametros.padY) / escala;

        const caja = {

            x1: Math.max(
                0,
                Math.min(parametros.ancho, x1)
            ),

            y1: Math.max(
                0,
                Math.min(parametros.alto, y1)
            ),

            x2: Math.max(
                0,
                Math.min(parametros.ancho, x2)
            ),

            y2: Math.max(
                0,
                Math.min(parametros.alto, y2)
            ),

            confianza

        };

        if (
            caja.x2 > caja.x1 &&
            caja.y2 > caja.y1
        ) {
            detecciones.push(caja);
        }

    }

    return aplicarNMS(detecciones);

}


// ======================================================
// 7. EJECUTAR DETECCIÓN DE MATRÍCULAS
// ======================================================

// Recibe un video, canvas o imagen.
// Esto permite analizar también el recorte de un vehículo.

async function detectarMatriculas(imagen, confianza = 0.15) {

    if (!modeloDetector) {
        return [];
    }

    if (!obtenerDimensionesImagen(imagen)) {
        return [];
    }

    try {

        const parametros = preprocesarImagen(imagen);

        const salida = await modeloDetector.run(
            parametros.tensor,
            [1, 3, TAMANO_ENTRADA, TAMANO_ENTRADA]
        );

        return procesarSalida(
            salida,
            parametros,
            confianza
        );

    } catch (error) {

        console.error(
            "Error durante la detección de matrículas:",
            error
        );

        return [];

    }

}


// ======================================================
// 8. DIBUJAR DETECCIONES DE MATRÍCULAS
// ======================================================

function dibujarDetecciones(canvas, video, detecciones) {

    const ctx = canvas.getContext("2d");

    const dimensiones = obtenerDimensionesImagen(video);

    if (!dimensiones) {
        return;
    }

    canvas.width = dimensiones.ancho;
    canvas.height = dimensiones.alto;

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    detecciones.forEach((deteccion, indice) => {

        const ancho = deteccion.x2 - deteccion.x1;
        const alto = deteccion.y2 - deteccion.y1;

        ctx.strokeStyle = "#22c55e";
        ctx.lineWidth = 3;

        ctx.strokeRect(
            deteccion.x1,
            deteccion.y1,
            ancho,
            alto
        );

        const etiqueta =
            `PLACA ${indice + 1} | ${(deteccion.confianza * 100).toFixed(1)}%`;

        ctx.font = "bold 15px Arial";

        const anchoTexto = ctx.measureText(etiqueta).width;

        const posicionTexto = Math.max(
            0,
            deteccion.y1 - 25
        );

        ctx.fillStyle = "#16a34a";

        ctx.fillRect(
            deteccion.x1,
            posicionTexto,
            anchoTexto + 10,
            25
        );

        ctx.fillStyle = "#ffffff";

        ctx.fillText(
            etiqueta,
            deteccion.x1 + 5,
            Math.max(17, deteccion.y1 - 7)
        );

    });

}