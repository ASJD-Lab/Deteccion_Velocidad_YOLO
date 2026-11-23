// ======================================================
// MÓDULO OCR
// RECONOCIMIENTO DE CARACTERES DE MATRÍCULAS
// Tesseract.js + ONNX (cct_s_v2_global)
// ======================================================

// Modelo ONNX de OCR de placas (entrada [1,64,128,3]).
let modeloOCR = null;

// Alfabeto del modelo cct_s: 0-9, A-Z + blank (índice 36).
const ALFABETO_OCR = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const BLANK_IDX = 36;

// Los volcados de imagen en consola (toDataURL) son útiles
// para depurar, pero cuestan tiempo y memoria en cada intento.
// Actívalos solo si necesitas inspeccionar los recortes.
const DEPURAR_OCR = true;

let trabajadorOCR = null;

let inicializandoOCR = false;

// Canvas reutilizable para el preprocesamiento de matrículas.
// Se redimensiona según necesidad, evitando crear uno nuevo
// en cada intento OCR.
let _canvasOCR = null;
let _ctxOCR = null;

function _obtenerCanvasOCR(ancho, alto) {

    if (!_canvasOCR) {
        _canvasOCR = document.createElement("canvas");
        _ctxOCR = _canvasOCR.getContext("2d", {
            willReadFrequently: true
        });
    }

    _canvasOCR.width = ancho;
    _canvasOCR.height = alto;

    return { canvas: _canvasOCR, ctx: _ctxOCR };

}


// ======================================================
// 1. INICIALIZAR MOTOR OCR
// ======================================================

async function inicializarOCR() {

    if (trabajadorOCR) {
        return true;
    }

    if (inicializandoOCR) {

        while (inicializandoOCR) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        return trabajadorOCR !== null;

    }

    inicializandoOCR = true;

    try {

        if (typeof Tesseract === "undefined") {

            throw new Error(
                "La biblioteca Tesseract.js no está disponible."
            );

        }

        console.log("Inicializando reconocimiento OCR...");

        trabajadorOCR = await Tesseract.createWorker("eng");

        await trabajadorOCR.setParameters({

            tessedit_char_whitelist:
                "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",

            // SINGLE_BLOCK es más tolerante con ruido.
            tessedit_pageseg_mode:
                Tesseract.PSM.SINGLE_BLOCK

        });

        console.log("Motor OCR inicializado correctamente.");

        return true;

    } catch (error) {

        console.error(
            "No se pudo inicializar el motor OCR:",
            error
        );

        trabajadorOCR = null;

        return false;

    } finally {

        inicializandoOCR = false;

    }

}


// ======================================================
// 2. CALCULAR UMBRAL DE BINARIZACIÓN (MÉTODO DE OTSU)
// Ajusta el umbral automáticamente según el histograma
// de la imagen, lo que mejora la lectura con iluminación
// variable (sombras, reflejos, noche).
// ======================================================

function calcularUmbralOtsu(datos, longitud) {

    // Construir histograma de intensidades (256 niveles).
    const histograma = new Int32Array(256);

    for (let i = 0; i < longitud; i += 4) {

        const gris = Math.round(
            0.299 * datos[i] +
            0.587 * datos[i + 1] +
            0.114 * datos[i + 2]
        );

        histograma[gris]++;

    }

    const totalPixeles = longitud / 4;

    let suma = 0;

    for (let t = 0; t < 256; t++) {
        suma += t * histograma[t];
    }

    let sumaPeso = 0;
    let pesoPorDebajo = 0;
    let varianzaMaxima = 0;
    let umbral = 128;

    for (let t = 0; t < 256; t++) {

        pesoPorDebajo += histograma[t];

        if (pesoPorDebajo === 0) continue;

        const pesoPorArriba = totalPixeles - pesoPorDebajo;

        if (pesoPorArriba === 0) break;

        sumaPeso += t * histograma[t];

        const mediaPorDebajo = sumaPeso / pesoPorDebajo;
        const mediaPorArriba =
            (suma - sumaPeso) / pesoPorArriba;

        const varianza =
            pesoPorDebajo *
            pesoPorArriba *
            (mediaPorDebajo - mediaPorArriba) ** 2;

        if (varianza > varianzaMaxima) {
            varianzaMaxima = varianza;
            umbral = t;
        }

    }

    return umbral;

}


// ======================================================
// 3. PREPARAR IMAGEN DE MATRÍCULA
// ======================================================

function prepararImagenOCR(imagen) {

    const anchoOriginal =
        imagen.width ||
        imagen.videoWidth ||
        imagen.naturalWidth;

    const altoOriginal =
        imagen.height ||
        imagen.videoHeight ||
        imagen.naturalHeight;

    if (!anchoOriginal || !altoOriginal) {
        return null;
    }

    // Escalar para facilitar la lectura. Máximo 2×
    // para evitar distorsión de la altura.
    const escala = Math.max(
        1,
        Math.min(2, 200 / anchoOriginal)
    );

    const ancho = Math.round(anchoOriginal * escala);
    const alto = Math.round(altoOriginal * escala);

    const { canvas, ctx } = _obtenerCanvasOCR(ancho, alto);

    // Fondo blanco.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, ancho, alto);

    // Desactivar suavizado para preservar bordes de caracteres.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(imagen, 0, 0, ancho, alto);

    const datos = ctx.getImageData(0, 0, ancho, alto);

    // Pasar primero a escala de grises.
    for (let i = 0; i < datos.data.length; i += 4) {
        const gris = Math.round(
            0.299 * datos.data[i] +
            0.587 * datos.data[i + 1] +
            0.114 * datos.data[i + 2]
        );
        datos.data[i]     = gris;
        datos.data[i + 1] = gris;
        datos.data[i + 2] = gris;
    }

    // Solo escala de grises (sin binarización) para baseline.
    // La binarización adaptativa destruía la imagen.
    for (let i = 0; i < datos.data.length; i += 4) {
        const gris = Math.round(
            0.299 * datos.data[i] +
            0.587 * datos.data[i + 1] +
            0.114 * datos.data[i + 2]
        );
        datos.data[i]     = gris;
        datos.data[i + 1] = gris;
        datos.data[i + 2] = gris;
    }

    ctx.putImageData(datos, 0, 0);

    if (DEPURAR_OCR) {

        // Log visual de la imagen procesada que recibe Tesseract.
        console.log(
            `%c   `,
            `font-size:1px; ` +
            `padding: ${Math.round(alto / 2)}px ${Math.round(ancho / 2)}px; ` +
            `background: url(${canvas.toDataURL()}) no-repeat center/contain; ` +
            `border: 2px solid #facc15; image-rendering: pixelated;`
        );

        // Enlace directo para inspección: clic derecho → Abrir en nueva pestaña
        console.log("[OCR imagen procesada] →", canvas.toDataURL());

    }

    return canvas;

}


// ======================================================
// 4. LIMPIAR TEXTO RECONOCIDO
// ======================================================

function normalizarMatricula(texto) {

    if (!texto) {
        return "";
    }

    return texto
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .trim();

}

// Normalizar variantes OCR comunes antes de votar.
function normalizarVariantes(texto) {

    if (!texto) return texto;

    return texto
        .replace(/O/g, "0")
        .replace(/I/g, "1")
        .replace(/B/g, "8")
        .replace(/S/g, "5")
        .replace(/Z/g, "2");

}


// ======================================================
// 4b. VALIDAR FORMATO DE PLACA MEXICANA
// Formatos comunes: 3 letras + 3/4 dígitos, o 2-3 letras
// + 3-4 dígitos + letra, etc. Se exige al menos una letra
// y un dígito, y longitud entre 5 y 8 caracteres.
// ======================================================

function esPlacaValida(texto) {

    if (!texto || texto.length < 4 || texto.length > 10) {
        return false;
    }

    // Aceptar cualquier texto alfanumérico (placas de cualquier país).
    if (!/^[A-Z0-9]+$/.test(texto)) {
        return false;
    }

    return true;

}


// ======================================================
// 5. LEER MATRÍCULA
// ======================================================

async function leerMatricula(imagen) {

    if (!trabajadorOCR) {

        const inicializado = await inicializarOCR();

        if (!inicializado) {
            return {
                texto: "",
                confianza: 0,
                identificada: false
            };
        }

    }

    try {

        const imagenPreparada = prepararImagenOCR(imagen);

        if (!imagenPreparada) {

            return {
                texto: "",
                confianza: 0,
                identificada: false
            };

        }

        const resultado = await trabajadorOCR.recognize(
            imagenPreparada
        );

        const textoOriginal = resultado.data.text || "";

        const texto = normalizarMatricula(textoOriginal);

        const confianza = Number(
            resultado.data.confidence || 0
        );

        // Criterio de aceptación:
        // - Mínimo 3 caracteres (cubre placas parcialmente legibles)
        // - Máximo 10 caracteres
        // - Confianza >= 20 (Tesseract devuelve valores bajos en
        //   imágenes de video; exigir 35 descarta lecturas válidas)
        const identificada =
            esPlacaValida(texto) &&
            confianza >= 3;

        console.log("Resultado OCR:", {
            texto,
            confianza,
            identificada,
            tamanoImagen: `${imagenPreparada.width}×${imagenPreparada.height}px`,
            textoRaw: textoOriginal.trim()
        });

        return {

            texto: identificada ? texto : "",

            textoOriginal,

            confianza,

            identificada

        };

    } catch (error) {

        console.error(
            "Error al reconocer matrícula:",
            error
        );

        return {

            texto: "",

            textoOriginal: "",

            confianza: 0,

            identificada: false

        };

    }

}

// ======================================================
// 6. CARGAR MODELO ONNX DE OCR (cct_s_v2_global)
// ======================================================

async function cargarModeloOCR() {

    if (modeloOCR) return true;

    try {

        console.log("Cargando modelo OCR ONNX...");

        console.log("[OCR ONNX] fetch ../modelos/cct_s_v2_global.onnx");
        const respuesta = await fetch("../modelos/cct_s_v2_global.onnx");
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);

        const buffer = await respuesta.arrayBuffer();

        const opciones = {
            executionProviders: ["webgpu", "wasm"]
        };

        modeloOCR = await ort.InferenceSession.create(buffer, opciones);

        modeloOCR.inputNames = modeloOCR.inputNames || [modeloOCR.inputNames?.[0]];
        modeloOCR.outputNames = modeloOCR.outputNames || [modeloOCR.outputNames?.[0]];

        // Warmup con uint8.
        const warmup = new ort.Tensor("uint8", new Uint8Array(1 * 64 * 128 * 3), [1, 64, 128, 3]);
        await modeloOCR.run({ [modeloOCR.inputNames[0]]: warmup });

        console.log("Modelo OCR ONNX cargado.", modeloOCR.inputNames, modeloOCR.outputNames);

        return true;

    } catch (error) {

        console.error("No se pudo cargar el modelo OCR ONNX:", error);
        modeloOCR = null;
        return false;

    }

}


// ======================================================
// 7. LEER MATRÍCULA CON ONNX
// ======================================================

async function leerMatriculaONNX(imagen) {

    console.log("[OCR ONNX] leerMatriculaONNX llamada");

    if (!modeloOCR) {
        const ok = await cargarModeloOCR();
        if (!ok) {
            return { texto: "", confianza: 0, identificada: false };
        }
    }

    try {

        const anchoObj = 128;
        const altoObj = 64;

        const canvas = document.createElement("canvas");
        canvas.width = anchoObj;
        canvas.height = altoObj;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(imagen, 0, 0, anchoObj, altoObj);

        const datos = ctx.getImageData(0, 0, anchoObj, altoObj).data;
        const tensor = new Uint8Array(1 * altoObj * anchoObj * 3);

        for (let i = 0; i < altoObj * anchoObj; i++) {
            const p = i * 4;
            tensor[i * 3]     = datos[p];
            tensor[i * 3 + 1] = datos[p + 1];
            tensor[i * 3 + 2] = datos[p + 2];
        }

        const tensorObj = new ort.Tensor("uint8", tensor, [1, altoObj, anchoObj, 3]);

        const salida = await modeloOCR.run({ [modeloOCR.inputNames[0]]: tensorObj });

        const logits = salida[modeloOCR.outputNames[0]].data;
        const numT = 10;
        const numC = 37;
        let texto = "";
        let confianzaTotal = 0;
        let prevIdx = -1;

        for (let t = 0; t < numT; t++) {
            // Softmax para obtener probabilidades.
            let maxVal = -Infinity;
            for (let c = 0; c < numC; c++) {
                const val = logits[t * numC + c];
                if (val > maxVal) maxVal = val;
            }
            let sumExp = 0;
            const probs = new Array(numC);
            for (let c = 0; c < numC; c++) {
                probs[c] = Math.exp(logits[t * numC + c] - maxVal);
                sumExp += probs[c];
            }
            let maxIdx = 0;
            let maxProb = 0;
            for (let c = 0; c < numC; c++) {
                probs[c] /= sumExp;
                if (probs[c] > maxProb) {
                    maxProb = probs[c];
                    maxIdx = c;
                }
            }
            if (maxIdx !== BLANK_IDX && maxIdx !== prevIdx) {
                texto += ALFABETO_OCR[maxIdx];
                confianzaTotal += maxProb;
            }
            prevIdx = maxIdx;
        }

        const confianza = numT > 0 ? (confianzaTotal / numT) * 100 : 0;
        const textoNorm = normalizarMatricula(texto);
        const identificada = esPlacaValida(textoNorm) && confianza >= 3;

        console.log("Resultado OCR ONNX:", { texto: textoNorm, confianza, identificada });

        return {
            texto: identificada ? textoNorm : "",
            textoOriginal: texto,
            confianza,
            identificada
        };

    } catch (error) {

        console.error("Error OCR ONNX:", error);
        return { texto: "", confianza: 0, identificada: false };

    }

}
