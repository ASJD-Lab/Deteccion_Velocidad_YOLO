// ==========================================
// MÓDULO DE DETECCIÓN
// YOLOv8 + ONNX Runtime Web
// ==========================================

// Aquí inicializaremos la sesión ONNX
// y realizaremos la detección de matrículas.

let modeloDetector = null;

async function cargarModelo() {

    try {

        const rutaModelo = "../modelos/best.onnx";

        modeloDetector = await ort.InferenceSession.create(
            rutaModelo
        );

        console.log("Modelo YOLOv8 ONNX cargado.");

        document.getElementById("estadoModelo").textContent =
            "Cargado";

    } catch (error) {

        console.error("Error al cargar el modelo:", error);

        document.getElementById("estadoModelo").textContent =
            "Error";

    }

}