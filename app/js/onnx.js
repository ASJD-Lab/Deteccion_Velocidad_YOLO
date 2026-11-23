// ======================================================
// CLIENTE DE SESIONES ONNX
// Crea los modelos en un Web Worker (WebGPU con respaldo
// a WASM) y ofrece la misma interfaz run(datos, dims)
// cuando se usa el respaldo en el hilo principal.
// ======================================================

const ORT_CDN_ONNX =
    "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";

const RUTA_WORKER_ONNX = "js/onnx_worker.js";

const TIEMPO_MAXIMO_INIT_ONNX = 30000;


// Asegurar que el respaldo en el hilo principal use
// exactamente los mismos binarios WASM que el worker.
if (typeof ort !== "undefined") {

    ort.env.wasm.wasmPaths = ORT_CDN_ONNX;

}


class SesionONNX {

    constructor() {

        this.worker = null;
        this.pending = new Map();
        this.seq = 0;

        this.inputNames = [];
        this.outputNames = [];

        // "webgpu" o "wasm".
        this.ep = "wasm";

        // Serializa las inferencias: un mismo worker no debe
        // ejecutar dos run() a la vez (por ejemplo, si el OCR
        // sigue trabajando al reiniciar el video).
        this.cola = Promise.resolve();

    }


    // ==================================================
    // 1. CREAR SESIÓN
    // ==================================================

    static async crear(buffer, opciones = {}) {

        const tamanoEntrada = opciones.tamanoEntrada || 640;

        const etiqueta = opciones.etiqueta || "ONNX";

        try {

            return await SesionONNX._crearEnWorker(
                buffer,
                tamanoEntrada,
                etiqueta
            );

        } catch (error) {

            console.warn(
                `${etiqueta}: no se pudo usar el worker ` +
                `(${error.message || error}). ` +
                "Se usará el hilo principal con WASM."
            );

            return await SesionONNX._crearEnHiloPrincipal(
                buffer,
                tamanoEntrada,
                etiqueta
            );

        }

    }


    // ==================================================
    // 2. SESIÓN EN WORKER (GPU / CPU)
    // ==================================================

    static _crearEnWorker(buffer, tamanoEntrada, etiqueta) {

        return new Promise((resolve, reject) => {

            let worker;

            try {

                worker = new Worker(RUTA_WORKER_ONNX);

            } catch (error) {

                reject(error);

                return;

            }

            const sesion = new SesionONNX();

            sesion.worker = worker;

            let terminado = false;

            const fallar = (error) => {

                if (terminado) {

                    // Si el worker ya estaba listo, rechazar las
                    // inferencias pendientes para no dejarlas colgadas.
                    for (const pendiente of sesion.pending.values()) {
                        pendiente.reject(error);
                    }

                    sesion.pending.clear();

                    sesion.worker = null;

                    worker.terminate();

                    return;

                }

                terminado = true;

                clearTimeout(temporizador);

                worker.terminate();

                reject(error);

            };

            const temporizador = setTimeout(() => {

                fallar(
                    new Error(
                        "Tiempo de espera agotado al iniciar ONNX."
                    )
                );

            }, TIEMPO_MAXIMO_INIT_ONNX);


            worker.onmessage = (evento) => {

                const mensaje = evento.data;

                if (mensaje.type === "ready") {

                    if (terminado) return;

                    terminado = true;

                    clearTimeout(temporizador);

                    sesion.inputNames = mensaje.inputNames || [];
                    sesion.outputNames = mensaje.outputNames || [];
                    sesion.ep = mensaje.ep || "wasm";

                    console.info(
                        `${etiqueta}: ` +
                        (sesion.ep === "webgpu"
                            ? "GPU (WebGPU)"
                            : "CPU (WASM)")
                    );

                    resolve(sesion);

                    return;

                }


                if (mensaje.type === "result") {

                    const pendiente = sesion.pending.get(mensaje.id);

                    if (!pendiente) return;

                    sesion.pending.delete(mensaje.id);

                    pendiente.resolve({
                        data: mensaje.data,
                        dims: mensaje.dims
                    });

                    return;

                }


                if (mensaje.type === "error") {

                    const pendiente = sesion.pending.get(mensaje.id);

                    if (pendiente) {

                        sesion.pending.delete(mensaje.id);

                        pendiente.reject(new Error(mensaje.message));

                    } else {

                        fallar(new Error(mensaje.message));

                    }

                }

            };


            worker.onerror = (evento) => {

                fallar(
                    new Error(
                        evento.message || "Error en el worker ONNX."
                    )
                );

            };


            const copia = buffer.slice(0);

            const warmup = [
                1,
                3,
                tamanoEntrada,
                tamanoEntrada
            ];

            worker.postMessage(
                {
                    type: "init",
                    buffer: copia,
                    warmup,
                    gpu: true
                },
                [copia]
            );

        });

    }


    // ==================================================
    // 3. RESPALDO EN EL HILO PRINCIPAL
    // ==================================================

    static async _crearEnHiloPrincipal(
        buffer,
        tamanoEntrada,
        etiqueta
    ) {

        if (typeof ort === "undefined") {

            throw new Error(
                "ONNX Runtime no está disponible."
            );

        }

        ort.env.wasm.wasmPaths = ORT_CDN_ONNX;

        ort.env.wasm.numThreads = self.crossOriginIsolated
            ? Math.min(4, navigator.hardwareConcurrency || 1)
            : 1;


        const nativo = await ort.InferenceSession.create(
            buffer.slice(0),
            {
                executionProviders: ["wasm"],
                graphOptimizationLevel: "all"
            }
        );


        // Warmup: paga la compilación de kernels antes
        // del primer fotograma real.
        const total = 3 * tamanoEntrada * tamanoEntrada;

        await nativo.run({
            [nativo.inputNames[0]]: new ort.Tensor(
                "float32",
                new Float32Array(total),
                [1, 3, tamanoEntrada, tamanoEntrada]
            )
        });


        const sesion = new SesionONNX();

        sesion.ep = "wasm";
        sesion.inputNames = nativo.inputNames;
        sesion.outputNames = nativo.outputNames;


        sesion.run = async (datos, dims) => {

            const tensor = new ort.Tensor("float32", datos, dims);

            const salidas = await nativo.run({
                [nativo.inputNames[0]]: tensor
            });

            const salida = salidas[nativo.outputNames[0]];

            return {
                data: salida.data,
                dims: salida.dims
            };

        };


        console.info(`${etiqueta}: CPU (WASM, hilo principal)`);

        return sesion;

    }


    // ==================================================
    // 4. EJECUTAR INFERENCIA
    // El Float32Array se transfiere al worker, por eso
    // debe ser un buffer nuevo en cada fotograma.
    // ==================================================

    run(datos, dims) {

        const ejecutar = () => this._ejecutarEnWorker(datos, dims);

        const resultado = this.cola.then(ejecutar, ejecutar);

        // Un fallo no debe bloquear las inferencias siguientes.
        this.cola = resultado.catch(() => {});

        return resultado;

    }


    _ejecutarEnWorker(datos, dims) {

        if (!this.worker) {

            return Promise.reject(
                new Error(
                    "La sesión ONNX no tiene worker ni respaldo."
                )
            );

        }

        const id = ++this.seq;

        return new Promise((resolve, reject) => {

            this.pending.set(id, { resolve, reject });

            this.worker.postMessage(
                {
                    type: "run",
                    id,
                    datos,
                    dims
                },
                [datos.buffer]
            );

        });

    }

}
