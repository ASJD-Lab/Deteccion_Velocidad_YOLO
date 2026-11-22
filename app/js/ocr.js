// ======================================================
// MÓDULO OCR
// RECONOCIMIENTO DE CARACTERES DE MATRÍCULAS
// Tesseract.js
// ======================================================

let trabajadorOCR = null;

let inicializandoOCR = false;


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

            tessedit_pageseg_mode:
                Tesseract.PSM.SINGLE_LINE

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
// 2. PREPARAR IMAGEN DE MATRÍCULA
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

    // Ampliar la imagen para facilitar la lectura.
    const escala = Math.max(
        2,
        Math.min(4, 500 / anchoOriginal)
    );

    const ancho = Math.round(anchoOriginal * escala);
    const alto = Math.round(altoOriginal * escala);

    const canvas = document.createElement("canvas");

    canvas.width = ancho;
    canvas.height = alto;

    const ctx = canvas.getContext("2d", {
        willReadFrequently: true
    });

    // Fondo blanco.
    ctx.fillStyle = "#ffffff";

    ctx.fillRect(
        0,
        0,
        ancho,
        alto
    );

    // Dibujar imagen ampliada.
    ctx.drawImage(
        imagen,
        0,
        0,
        ancho,
        alto
    );

    const datos = ctx.getImageData(
        0,
        0,
        ancho,
        alto
    );

    // Convertir a escala de grises y aumentar contraste.
    for (let i = 0; i < datos.data.length; i += 4) {

        const gris =
            0.299 * datos.data[i] +
            0.587 * datos.data[i + 1] +
            0.114 * datos.data[i + 2];

        const contraste = gris > 135 ? 255 : 0;

        datos.data[i] = contraste;
        datos.data[i + 1] = contraste;
        datos.data[i + 2] = contraste;

    }

    ctx.putImageData(
        datos,
        0,
        0
    );

    return canvas;

}


// ======================================================
// 3. LIMPIAR TEXTO RECONOCIDO
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


// ======================================================
// 4. LEER MATRÍCULA
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

        // Evitar aceptar lecturas demasiado cortas o dudosas.
        // No se impone un formato estatal específico.
        const identificada =
            texto.length >= 5 &&
            texto.length <= 8 &&
            confianza >= 35;

        console.log("Resultado OCR:", {
            texto,
            confianza,
            identificada
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