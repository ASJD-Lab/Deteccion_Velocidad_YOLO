// ======================================================
// DETECTOR DE VEHÍCULOS
// Modelo: YOLOv8n COCO en formato ONNX
// Clases: automóvil, motocicleta, autobús y camión
// ======================================================

let modeloVehiculos = null;

const TAMANO_MODELO_VEHICULOS = 640;

const CLASES_VEHICULOS = {
    2: "Automóvil",
    3: "Motocicleta",
    5: "Autobús",
    7: "Camión"
};


// Canvas y memoria reutilizables
let canvasTemporalVehiculos = null;
let contextoTemporalVehiculos = null;
let tensorDatosVehiculos = null;


// ======================================================
// 1. CARGAR MODELO
// ======================================================

async function cargarModeloVehiculos() {

    if (modeloVehiculos !== null) {
        return modeloVehiculos;
    }

    try {

        console.log("Cargando modelo YOLOv8n de vehículos...");

        // Asegurar que ONNX Runtime encuentre los archivos WASM
        // tanto en desarrollo local como en Netlify.
        ort.env.wasm.wasmPaths =
            "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";

        modeloVehiculos = await ort.InferenceSession.create(
            "../modelos/vehiculos.onnx",
            {
                executionProviders: ["wasm"],
                graphOptimizationLevel: "all"
            }
        );

        console.log("Modelo de vehículos cargado correctamente.");

        return modeloVehiculos;

    } catch (error) {

        console.error(
            "Error al cargar el modelo de vehículos:",
            error
        );

        modeloVehiculos = null;

        throw error;

    }

}


// ======================================================
// 2. PREPARAR CANVAS REUTILIZABLE
// ======================================================

function obtenerCanvasTemporal() {

    if (!canvasTemporalVehiculos) {

        canvasTemporalVehiculos = document.createElement("canvas");

        canvasTemporalVehiculos.width = TAMANO_MODELO_VEHICULOS;
        canvasTemporalVehiculos.height = TAMANO_MODELO_VEHICULOS;

        contextoTemporalVehiculos =
            canvasTemporalVehiculos.getContext(
                "2d",
                { willReadFrequently: true }
            );

    }

    return contextoTemporalVehiculos;

}


// ======================================================
// 3. PREPROCESAMIENTO
// ======================================================

function preprocesarVehiculo(video) {

    const anchoOriginal = video.videoWidth;
    const altoOriginal = video.videoHeight;

    if (!anchoOriginal || !altoOriginal) {

        throw new Error(
            "El video todavía no tiene dimensiones disponibles."
        );

    }


    const contexto = obtenerCanvasTemporal();

    const tamano = TAMANO_MODELO_VEHICULOS;

    contexto.fillStyle = "rgb(114, 114, 114)";

    contexto.fillRect(0, 0, tamano, tamano);


    const escala = Math.min(
        tamano / anchoOriginal,
        tamano / altoOriginal
    );


    const anchoNuevo = Math.round(anchoOriginal * escala);
    const altoNuevo = Math.round(altoOriginal * escala);

    const paddingX = (tamano - anchoNuevo) / 2;
    const paddingY = (tamano - altoNuevo) / 2;


    contexto.drawImage(
        video,
        paddingX,
        paddingY,
        anchoNuevo,
        altoNuevo
    );


    const imagen = contexto.getImageData(
        0,
        0,
        tamano,
        tamano
    );


    const datos = imagen.data;

    const tamanoCanal = tamano * tamano;

    const longitudTensor = 3 * tamanoCanal;


    // Reutilizar memoria siempre que sea posible
    if (
        !tensorDatosVehiculos ||
        tensorDatosVehiculos.length !== longitudTensor
    ) {

        tensorDatosVehiculos = new Float32Array(
            longitudTensor
        );

    }


    for (let i = 0; i < tamanoCanal; i++) {

        const posicion = i * 4;

        tensorDatosVehiculos[i] =
            datos[posicion] / 255;

        tensorDatosVehiculos[i + tamanoCanal] =
            datos[posicion + 1] / 255;

        tensorDatosVehiculos[i + tamanoCanal * 2] =
            datos[posicion + 2] / 255;

    }


    return {

        tensor: tensorDatosVehiculos,

        escala,

        paddingX,

        paddingY,

        anchoOriginal,

        altoOriginal

    };

}


// ======================================================
// 4. CALCULAR IoU
// ======================================================

function calcularIoUVehiculos(a, b) {

    const izquierda = Math.max(a.x1, b.x1);
    const arriba = Math.max(a.y1, b.y1);

    const derecha = Math.min(a.x2, b.x2);
    const abajo = Math.min(a.y2, b.y2);


    const ancho = Math.max(0, derecha - izquierda);
    const alto = Math.max(0, abajo - arriba);

    const interseccion = ancho * alto;


    const areaA =
        (a.x2 - a.x1) * (a.y2 - a.y1);

    const areaB =
        (b.x2 - b.x1) * (b.y2 - b.y1);


    const union = areaA + areaB - interseccion;

    if (union <= 0) {
        return 0;
    }

    return interseccion / union;

}


// ======================================================
// 5. SUPRESIÓN DE DETECCIONES DUPLICADAS
// ======================================================

function aplicarNMSVehiculos(
    detecciones,
    umbralIoU = 0.45
) {

    const ordenadas = [...detecciones].sort(
        (a, b) => b.confianza - a.confianza
    );

    const seleccionadas = [];


    while (ordenadas.length > 0) {

        const mejor = ordenadas.shift();

        seleccionadas.push(mejor);


        for (let i = ordenadas.length - 1; i >= 0; i--) {

            if (
                ordenadas[i].claseId !== mejor.claseId
            ) {
                continue;
            }


            const iou = calcularIoUVehiculos(
                mejor,
                ordenadas[i]
            );


            if (iou > umbralIoU) {
                ordenadas.splice(i, 1);
            }

        }

    }


    return seleccionadas;

}


// ======================================================
// 6. PROCESAR SALIDA YOLOv8
// ======================================================

function procesarSalidaVehiculos(
    salida,
    parametros,
    confianzaMinima = 0.50
) {

    const dimensiones = salida.dims;
    const datos = salida.data;


    let numeroCaracteristicas;
    let numeroPredicciones;
    let formatoTranspuesto;


    if (dimensiones[1] < dimensiones[2]) {

        numeroCaracteristicas = dimensiones[1];
        numeroPredicciones = dimensiones[2];

        formatoTranspuesto = false;

    } else {

        numeroCaracteristicas = dimensiones[2];
        numeroPredicciones = dimensiones[1];

        formatoTranspuesto = true;

    }


    if (numeroCaracteristicas < 5) {

        throw new Error(
            "La salida del modelo no tiene el formato YOLOv8 esperado."
        );

    }


    function obtenerValor(prediccion, caracteristica) {

        if (formatoTranspuesto) {

            return datos[
                prediccion * numeroCaracteristicas + caracteristica
            ];

        }

        return datos[
            caracteristica * numeroPredicciones + prediccion
        ];

    }


    const detecciones = [];


    for (let i = 0; i < numeroPredicciones; i++) {

        const centroX = obtenerValor(i, 0);
        const centroY = obtenerValor(i, 1);

        const ancho = obtenerValor(i, 2);
        const alto = obtenerValor(i, 3);


        let mejorConfianza = 0;
        let mejorClase = -1;


        for (
            let clase = 0;
            clase < numeroCaracteristicas - 4;
            clase++
        ) {

            const puntuacion = obtenerValor(i, clase + 4);

            if (puntuacion > mejorConfianza) {

                mejorConfianza = puntuacion;
                mejorClase = clase;

            }

        }


        if (!(mejorClase in CLASES_VEHICULOS)) {
            continue;
        }

        if (mejorConfianza < confianzaMinima) {
            continue;
        }


        let x1 = centroX - ancho / 2;
        let y1 = centroY - alto / 2;

        let x2 = centroX + ancho / 2;
        let y2 = centroY + alto / 2;


        // Deshacer letterbox
        x1 = (x1 - parametros.paddingX) / parametros.escala;
        y1 = (y1 - parametros.paddingY) / parametros.escala;

        x2 = (x2 - parametros.paddingX) / parametros.escala;
        y2 = (y2 - parametros.paddingY) / parametros.escala;


        // Limitar coordenadas
        x1 = Math.max(
            0,
            Math.min(x1, parametros.anchoOriginal)
        );

        y1 = Math.max(
            0,
            Math.min(y1, parametros.altoOriginal)
        );

        x2 = Math.max(
            0,
            Math.min(x2, parametros.anchoOriginal)
        );

        y2 = Math.max(
            0,
            Math.min(y2, parametros.altoOriginal)
        );


        if (x2 <= x1 || y2 <= y1) {
            continue;
        }


        detecciones.push({

            x1,
            y1,
            x2,
            y2,

            confianza: mejorConfianza,

            claseId: mejorClase,

            etiqueta: CLASES_VEHICULOS[mejorClase],

            centroX: (x1 + x2) / 2,

            centroY: (y1 + y2) / 2

        });

    }


    return aplicarNMSVehiculos(detecciones);

}


// ======================================================
// 7. DETECTAR VEHÍCULOS
// ======================================================

async function detectarVehiculos(
    video,
    confianzaMinima = 0.50
) {

    if (!modeloVehiculos) {
        await cargarModeloVehiculos();
    }


    const parametros = preprocesarVehiculo(video);


    const tensorEntrada = new ort.Tensor(
        "float32",
        parametros.tensor,
        [
            1,
            3,
            TAMANO_MODELO_VEHICULOS,
            TAMANO_MODELO_VEHICULOS
        ]
    );


    const nombreEntrada = modeloVehiculos.inputNames[0];

    const entradas = {};

    entradas[nombreEntrada] = tensorEntrada;


    const resultados = await modeloVehiculos.run(entradas);


    const nombreSalida = modeloVehiculos.outputNames[0];

    const salida = resultados[nombreSalida];


    return procesarSalidaVehiculos(
        salida,
        parametros,
        confianzaMinima
    );

}


// ======================================================
// 8. DIBUJAR VEHÍCULOS
// ======================================================

function dibujarVehiculos(
    canvas,
    video,
    detecciones
) {

    const contexto = canvas.getContext("2d");


    if (
        canvas.width !== video.videoWidth ||
        canvas.height !== video.videoHeight
    ) {

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

    }


    detecciones.forEach(vehiculo => {

        const ancho = vehiculo.x2 - vehiculo.x1;
        const alto = vehiculo.y2 - vehiculo.y1;


        contexto.strokeStyle = "#38bdf8";
        contexto.lineWidth = 3;


        contexto.strokeRect(
            vehiculo.x1,
            vehiculo.y1,
            ancho,
            alto
        );


        const texto =
            `${vehiculo.etiqueta} ` +
            `${(vehiculo.confianza * 100).toFixed(1)}%`;


        contexto.font = "bold 16px Arial";

        const anchoTexto =
            contexto.measureText(texto).width;


        contexto.fillStyle = "#0284c7";

        contexto.fillRect(
            vehiculo.x1,
            Math.max(0, vehiculo.y1 - 25),
            anchoTexto + 10,
            25
        );


        contexto.fillStyle = "#ffffff";

        contexto.fillText(
            texto,
            vehiculo.x1 + 5,
            Math.max(17, vehiculo.y1 - 7)
        );

    });

}


// ======================================================
// FIN DEL MÓDULO
// ======================================================