// ======================================================
// WORKER DE ONNX RUNTIME
// Ejecuta los modelos fuera del hilo principal y usa
// WebGPU cuando está disponible, con respaldo a WASM.
// ======================================================

const ORT_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";

let sesion = null;

try {

    importScripts(ORT_CDN + "ort.webgpu.min.js");

    ort.env.wasm.wasmPaths = ORT_CDN;

    // Varios hilos solo si la página está aislada
    // (COOP/COEP). Si no, WASM usa un solo hilo.
    ort.env.wasm.numThreads = self.crossOriginIsolated
        ? Math.min(4, navigator.hardwareConcurrency || 1)
        : 1;

} catch (error) {

    self.postMessage({
        type: "error",
        id: 0,
        message: "No se pudo cargar ONNX Runtime: " + error
    });

}


// ======================================================
// 1. TENSOR DE CEROS PARA EL WARMUP
// ======================================================

function crearTensorCeros(dims) {

    const total = dims.reduce((a, b) => a * b, 1);

    return new ort.Tensor(
        "float32",
        new Float32Array(total),
        dims
    );

}


// ======================================================
// 2. CREAR SESIÓN CON UN PROVEEDOR DE EJECUCIÓN
// El warmup valida que el proveedor realmente funcione
// y paga la compilación de kernels antes del primer
// fotograma real.
// ======================================================

async function crearSesion(buffer, proveedor, dimsWarmup) {

    const sesionNueva = await ort.InferenceSession.create(
        buffer.slice(0),
        {
            executionProviders: [proveedor],
            graphOptimizationLevel: "all"
        }
    );

    if (dimsWarmup) {

        await sesionNueva.run({
            [sesionNueva.inputNames[0]]: crearTensorCeros(dimsWarmup)
        });

    }

    return sesionNueva;

}


// ======================================================
// 3. MENSAJES DEL HILO PRINCIPAL
// ======================================================

self.onmessage = async (evento) => {

    const mensaje = evento.data;

    try {

        if (mensaje.type === "init") {

            let proveedor = "wasm";

            // Intentar WebGPU primero.
            if (
                self.navigator &&
                navigator.gpu &&
                mensaje.gpu !== false
            ) {

                try {

                    sesion = await crearSesion(
                        mensaje.buffer,
                        "webgpu",
                        mensaje.warmup
                    );

                    proveedor = "webgpu";

                } catch (error) {

                    sesion = null;

                }

            }

            // Respaldo a CPU.
            if (!sesion) {

                sesion = await crearSesion(
                    mensaje.buffer,
                    "wasm",
                    mensaje.warmup
                );

            }

            self.postMessage({
                type: "ready",
                ep: proveedor,
                inputNames: sesion.inputNames,
                outputNames: sesion.outputNames
            });

            return;

        }


        if (mensaje.type === "run") {

            if (!sesion) {
                throw new Error(
                    "La sesión ONNX todavía no está lista."
                );
            }

            const tensor = new ort.Tensor(
                "float32",
                mensaje.datos,
                mensaje.dims
            );

            const salidas = await sesion.run({
                [sesion.inputNames[0]]: tensor
            });

            const nombreSalida = sesion.outputNames[0];
            const salida = salidas[nombreSalida];

            self.postMessage(
                {
                    type: "result",
                    id: mensaje.id,
                    data: salida.data,
                    dims: salida.dims
                },
                [salida.data.buffer]
            );

        }

    } catch (error) {

        self.postMessage({
            type: "error",
            id: mensaje && mensaje.id ? mensaje.id : 0,
            message: String((error && error.message) || error)
        });

    }

};
