// ======================================================
// SISTEMA DE SEGUIMIENTO DE VEHÍCULOS
// Adaptación del seguimiento de la libreta
// Referencia: centro inferior de la caja
// ======================================================

let vehiculosActivos = [];
let siguienteID = 1;

const MAX_FOTOGRAMAS_PERDIDOS = 5;
const DISTANCIA_MAXIMA = 120;
const MIN_HITS = 2;


// ======================================================
// 1. OBTENER EL PUNTO INFERIOR CENTRAL
// ======================================================

function obtenerCentroInferior(deteccion) {

    return {
        x: (deteccion.x1 + deteccion.x2) / 2,
        y: deteccion.y2
    };

}


// ======================================================
// 2. CALCULAR DISTANCIA ENTRE PUNTOS
// ======================================================

function calcularDistancia(a, b) {

    const dx = a.x - b.x;
    const dy = a.y - b.y;

    return Math.sqrt(dx * dx + dy * dy);

}


// ======================================================
// 3. CALCULAR IoU
// ======================================================

function obtenerIoU(a, b) {

    if (
        !a ||
        !b ||
        typeof calcularIoUVehiculos !== "function"
    ) {
        return 0;
    }

    return calcularIoUVehiculos(a, b);

}


// ======================================================
// 4. ACTUALIZAR SEGUIMIENTO
// ======================================================

function actualizarSeguimiento(detecciones) {

    // Reiniciar asociación de los vehículos existentes.
    vehiculosActivos.forEach(vehiculo => {
        vehiculo.asociado = false;
    });


    // Asociar las nuevas detecciones con los vehículos activos.
    detecciones.forEach(deteccion => {

        const punto = obtenerCentroInferior(deteccion);

        let mejorVehiculo = null;
        let mejorPuntuacion = -Infinity;


        vehiculosActivos.forEach(vehiculo => {

            // Evitar asociar dos detecciones al mismo vehículo.
            if (vehiculo.asociado) return;

            const distancia = calcularDistancia(
                punto,
                vehiculo.puntoActual
            );

            const iou = obtenerIoU(
                deteccion,
                vehiculo.deteccion
            );


            // Comprobar si la detección puede pertenecer
            // al seguimiento existente.
            if (
                distancia <= DISTANCIA_MAXIMA ||
                iou >= 0.10
            ) {

                // Combinar cercanía e IoU para elegir
                // la asociación más conveniente.
                const puntuacion =
                    (iou * 120) - distancia;

                if (puntuacion > mejorPuntuacion) {

                    mejorPuntuacion = puntuacion;
                    mejorVehiculo = vehiculo;

                }

            }

        });


        // --------------------------------------------------
        // ACTUALIZAR VEHÍCULO EXISTENTE
        // --------------------------------------------------

        if (mejorVehiculo) {

            mejorVehiculo.puntoAnterior = {
                ...mejorVehiculo.puntoActual
            };

            mejorVehiculo.puntoActual = punto;

            // Guardar la detección más reciente.
            // Se utiliza también para recortar el vehículo
            // y buscar su matrícula mediante OCR.
            mejorVehiculo.deteccion = deteccion;

            mejorVehiculo.fotogramasPerdidos = 0;

            mejorVehiculo.asociado = true;

            mejorVehiculo.hits++;


        } else {

            // --------------------------------------------------
            // CREAR NUEVO SEGUIMIENTO
            // --------------------------------------------------

            vehiculosActivos.push({

                id: siguienteID++,

                deteccion,

                puntoAnterior: { ...punto },

                puntoActual: { ...punto },

                fotogramasPerdidos: 0,

                asociado: true,

                hits: 1,

                tiemposCruce: {
                    A: null,
                    B: null,
                    C: null
                },

                // Se completará cuando se calcule
                // el primer resultado de velocidad.
                velocidades: null,

                infraccionRegistrada: false,

                // Información de reconocimiento de matrícula.
                matricula: null,

                confianzaOCR: null,

                intentosOCR: 0,

                deteccionMatricula: null,

                // Tiempo de la última posición válida.
                tiempoAnterior: null

            });

        }

    });


    // --------------------------------------------------
    // ACTUALIZAR VEHÍCULOS NO DETECTADOS
    // --------------------------------------------------

    vehiculosActivos.forEach(vehiculo => {

        if (!vehiculo.asociado) {

            vehiculo.fotogramasPerdidos++;

            // Importante:
            // No modificamos puntoAnterior ni puntoActual.
            // Así conservamos la última posición válida
            // mientras el vehículo vuelve a detectarse.

        }

    });


    // --------------------------------------------------
    // ELIMINAR SEGUIMIENTOS PERDIDOS
    // --------------------------------------------------

    vehiculosActivos = vehiculosActivos.filter(
        vehiculo =>
            vehiculo.fotogramasPerdidos <= MAX_FOTOGRAMAS_PERDIDOS
    );


    return vehiculosActivos;

}


// ======================================================
// 5. DETECTAR CRUCE DE UNA LÍNEA
// ======================================================

function calcularCruceLinea(anterior, actual, linea) {

    const cruceAscendente =
        anterior < linea && actual >= linea;

    const cruceDescendente =
        anterior > linea && actual <= linea;

    return cruceAscendente || cruceDescendente;

}


// ======================================================
// 6. CALCULAR EL TIEMPO EXACTO DEL CRUCE
// Interpolación entre dos posiciones consecutivas.
// ======================================================

function obtenerTiempoCruce(
    posicionAnterior,
    posicionActual,
    posicionLinea,
    tiempoAnterior,
    tiempoActual
) {

    const diferenciaPosicion =
        posicionActual - posicionAnterior;

    if (diferenciaPosicion === 0) {
        return tiempoActual;
    }

    const proporcion =
        (posicionLinea - posicionAnterior) /
        diferenciaPosicion;

    // Limitar la proporción al intervalo entre
    // la posición anterior y la posición actual.
    const proporcionLimitada = Math.max(
        0,
        Math.min(1, proporcion)
    );

    // Interpolar el instante en el que el vehículo
    // atravesó la línea.
    return tiempoAnterior +
        (tiempoActual - tiempoAnterior) *
        proporcionLimitada;

}


// ======================================================
// 7. REGISTRAR CRUCES A, B Y C
// ======================================================

function registrarCruces(
    vehiculos,
    lineaA,
    lineaB,
    lineaC,
    tiempoVideo,
    orientacion = "horizontal"
) {

    vehiculos.forEach(vehiculo => {

        // No utilizar vehículos que no tengan
        // suficientes detecciones.
        if (vehiculo.hits < MIN_HITS) {

            // Guardar el primer instante observado.
            // Servirá como referencia para interpolar
            // el primer cruce.
            if (vehiculo.fotogramasPerdidos === 0) {
                vehiculo.tiempoAnterior = tiempoVideo;
            }

            return;

        }


        // No calcular cruces utilizando posiciones
        // de vehículos que actualmente no se detectan.
        if (vehiculo.fotogramasPerdidos !== 0) {
            return;
        }


        const anterior = orientacion === "horizontal"
            ? vehiculo.puntoAnterior.y
            : vehiculo.puntoAnterior.x;

        const actual = orientacion === "horizontal"
            ? vehiculo.puntoActual.y
            : vehiculo.puntoActual.x;


        const lineas = {
            A: lineaA,
            B: lineaB,
            C: lineaC
        };


        // Si todavía no existe un tiempo anterior,
        // utilizar el tiempo actual como referencia.
        if (!Number.isFinite(vehiculo.tiempoAnterior)) {

            vehiculo.tiempoAnterior = tiempoVideo;

            return;

        }


        // --------------------------------------------------
        // COMPROBAR CADA LÍNEA
        // --------------------------------------------------

        Object.entries(lineas).forEach(([nombre, posicion]) => {

            // No registrar dos veces el mismo cruce.
            if (vehiculo.tiemposCruce[nombre] !== null) {
                return;
            }


            if (
                calcularCruceLinea(
                    anterior,
                    actual,
                    posicion
                )
            ) {

                const tiempoCruce = obtenerTiempoCruce(
                    anterior,
                    actual,
                    posicion,
                    vehiculo.tiempoAnterior,
                    tiempoVideo
                );


                vehiculo.tiemposCruce[nombre] = tiempoCruce;


                console.log(
                    `Vehículo ${vehiculo.id}: cruce de línea ${nombre}`,
                    `Tiempo: ${tiempoCruce.toFixed(3)} s`
                );

            }

        });


        // Actualizar el tiempo de referencia para
        // la siguiente detección válida.
        vehiculo.tiempoAnterior = tiempoVideo;

    });

}


// ======================================================
// 8. DIBUJAR LAS TRES LÍNEAS
// ======================================================

function dibujarLineas(
    ctx,
    ancho,
    alto,
    lineaA,
    lineaB,
    lineaC,
    orientacion = "horizontal"
) {

    const lineas = [
        { posicion: lineaA, color: "#3b82f6", nombre: "A" },
        { posicion: lineaB, color: "#22c55e", nombre: "B" },
        { posicion: lineaC, color: "#facc15", nombre: "C" }
    ];

    ctx.save();

    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);


    lineas.forEach(linea => {

        ctx.strokeStyle = linea.color;

        ctx.beginPath();

        if (orientacion === "horizontal") {

            ctx.moveTo(0, linea.posicion);
            ctx.lineTo(ancho, linea.posicion);

        } else {

            ctx.moveTo(linea.posicion, 0);
            ctx.lineTo(linea.posicion, alto);

        }

        ctx.stroke();

        ctx.setLineDash([]);

        ctx.font = "bold 18px Arial";
        ctx.fillStyle = linea.color;

        if (orientacion === "horizontal") {

            ctx.fillText(
                `LÍNEA ${linea.nombre}`,
                10,
                linea.posicion - 8
            );

        } else {

            ctx.fillText(
                `LÍNEA ${linea.nombre}`,
                linea.posicion + 8,
                25
            );

        }

        ctx.setLineDash([10, 8]);

    });

    ctx.restore();

}


// ======================================================
// 9. DIBUJAR IDENTIFICADORES
// ======================================================

function dibujarIdentificadores(ctx, vehiculos) {

    vehiculos.forEach(vehiculo => {

        if (vehiculo.hits < MIN_HITS) return;

        if (vehiculo.fotogramasPerdidos !== 0) return;

        const punto = vehiculo.puntoActual;

        ctx.save();

        ctx.fillStyle = "#38bdf8";
        ctx.font = "bold 17px Arial";

        ctx.fillText(
            `VEHÍCULO #${vehiculo.id}`,
            punto.x + 8,
            punto.y - 8
        );


        // Punto inferior central de referencia.
        ctx.beginPath();

        ctx.arc(
            punto.x,
            punto.y,
            5,
            0,
            Math.PI * 2
        );

        ctx.fillStyle = "#ffffff";

        ctx.fill();

        ctx.restore();

    });

}


// ======================================================
// 10. REINICIAR SEGUIMIENTO
// ======================================================

function reiniciarSeguimiento() {

    vehiculosActivos = [];

    siguienteID = 1;

}