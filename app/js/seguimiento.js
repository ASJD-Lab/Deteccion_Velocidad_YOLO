// ======================================================
// SISTEMA DE SEGUIMIENTO DE VEHÍCULOS (MEJORADO - FASE 2)
// Predicción de movimiento (vx, vy), EMA de cajas, TTL y Hits
// ======================================================

let vehiculosActivos = [];
let siguienteID = 1;

const TTL_MS = 1200; // 1200 ms de tiempo de vida sin detecciones
const MIN_HITS = 5;  // Mínimo de detecciones para considerar válido / multar

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
// 2. CALCULAR IoU
// ======================================================

function obtenerIoU(a, b) {
    if (!a || !b || typeof calcularIoUVehiculos !== "function") {
        return 0;
    }
    return calcularIoUVehiculos(a, b);
}

// ======================================================
// 3. ACTUALIZAR SEGUIMIENTO CON PREDICCIÓN Y EMA
// ======================================================

function actualizarSeguimiento(detecciones, tiempoVideo = performance.now()) {

    // Marcar todos como no asociados
    vehiculosActivos.forEach(vehiculo => {
        vehiculo.asociado = false;
    });

    detecciones.forEach(deteccion => {
        const punto = obtenerCentroInferior(deteccion);
        let mejorVehiculo = null;
        let mejorPuntuacion = -Infinity;

        vehiculosActivos.forEach(vehiculo => {
            if (vehiculo.asociado) return;

            // Posición predicha si hay velocidad estimada
            let posEsperada = vehiculo.puntoActual;
            if (vehiculo.vx !== undefined && vehiculo.vy !== undefined && vehiculo.ultimoTiempo) {
                const dtSec = (tiempoVideo - vehiculo.ultimoTiempo) / 1000;
                if (dtSec > 0 && dtSec < 0.5) {
                    posEsperada = {
                        x: vehiculo.puntoActual.x + vehiculo.vx * dtSec,
                        y: vehiculo.puntoActual.y + vehiculo.vy * dtSec
                    };
                }
            }

            const dx = punto.x - posEsperada.x;
            const dy = punto.y - posEsperada.y;
            const distancia = Math.sqrt(dx * dx + dy * dy);

            const iou = obtenerIoU(deteccion, vehiculo.deteccion);

            // Umbral de distancia dinámico basado en el tamaño de la caja
            const anchoCaja = vehiculo.deteccion.x2 - vehiculo.deteccion.x1;
            const altoCaja = vehiculo.deteccion.y2 - vehiculo.deteccion.y1;
            const umbralDistancia = Math.max(120, Math.max(anchoCaja, altoCaja) * 1.5);

            if (distancia <= umbralDistancia || iou >= 0.10) {
                const puntuacion = (iou * 200) - distancia;
                if (puntuacion > mejorPuntuacion) {
                    mejorPuntuacion = puntuacion;
                    mejorVehiculo = vehiculo;
                }
            }
        });

        if (mejorVehiculo) {
            const dtSec = vehiculo.ultimoTiempo ? (tiempoVideo - vehiculo.ultimoTiempo) / 1000 : 0.033;

            mejorVehiculo.puntoAnterior = { ...mejorVehiculo.puntoActual };
            mejorVehiculo.puntoActual = punto;

            // Calcular velocidad en píxeles por segundo (vx, vy)
            if (dtSec > 0 && dtSec < 1.0) {
                const vxInst = (punto.x - mejorVehiculo.puntoAnterior.x) / dtSec;
                const vyInst = (punto.y - mejorVehiculo.puntoAnterior.y) / dtSec;
                // Suavizado EMA para velocidad (30% anterior, 70% nueva)
                mejorVehiculo.vx = mejorVehiculo.vx !== undefined ? (0.3 * mejorVehiculo.vx + 0.7 * vxInst) : vxInst;
                mejorVehiculo.vy = mejorVehiculo.vy !== undefined ? (0.3 * mejorVehiculo.vy + 0.7 * vyInst) : vyInst;
            }

            // Suavizado EMA para la caja (30% anterior, 70% nueva detección)
            const dPrev = mejorVehiculo.deteccion;
            mejorVehiculo.deteccion = {
                x1: 0.3 * dPrev.x1 + 0.7 * deteccion.x1,
                y1: 0.3 * dPrev.y1 + 0.7 * deteccion.y1,
                x2: 0.3 * dPrev.x2 + 0.7 * deteccion.x2,
                y2: 0.3 * dPrev.y2 + 0.7 * deteccion.y2,
                confianza: deteccion.confianza
            };

            mejorVehiculo.fotogramasPerdidos = 0;
            mejorVehiculo.tiempoUltimoAvistamiento = tiempoVideo;
            mejorVehiculo.ultimoTiempo = tiempoVideo;
            mejorVehiculo.asociado = true;
            mejorVehiculo.hits++;

        } else {
            // Nuevo seguimiento
            vehiculosActivos.push({
                id: siguienteID++,
                deteccion,
                puntoAnterior: { ...punto },
                puntoActual: { ...punto },
                vx: 0,
                vy: 0,
                fotogramasPerdidos: 0,
                asociado: true,
                hits: 1,
                tiempoCreacion: tiempoVideo,
                tiempoUltimoAvistamiento: tiempoVideo,
                ultimoTiempo: tiempoVideo,
                tiemposCruce: {
                    A: null,
                    B: null
                },
                velocidades: null,
                infraccionRegistrada: false,
                matricula: null,
                confianzaOCR: null,
                intentosOCR: 0,
                deteccionMatricula: null,
                tiempoAnterior: null,
                historialBbox: []
            });
        }
    });

    // Actualizar vehículos no asociados (control por TTL de 1200 ms)
    vehiculosActivos.forEach(vehiculo => {
        if (!vehiculo.asociado) {
            vehiculo.fotogramasPerdidos++;
            // Predicción inercial si se pierde temporalmente
            if (vehiculo.vx && vehiculo.vy && vehiculo.ultimoTiempo) {
                const dtSec = 0.033;
                vehiculo.puntoActual = {
                    x: vehiculo.puntoActual.x + vehiculo.vx * dtSec,
                    y: vehiculo.puntoActual.y + vehiculo.vy * dtSec
                };
            }
        }
    });

    // Filtrar por TTL de 1200 ms (tiempo transcurrido desde el último avistamiento real)
    vehiculosActivos = vehiculosActivos.filter(vehiculo => {
        const tiempoInactivo = tiempoVideo - (vehiculo.tiempoUltimoAvistamiento || tiempoVideo);
        return tiempoInactivo <= TTL_MS;
    });

    return vehiculosActivos;
}

// ======================================================
// 4. DETECTAR CRUCE DE UNA LÍNEA
// ======================================================

function calcularCruceLinea(anterior, actual, linea) {
    const cruceAscendente = anterior < linea && actual >= linea;
    const cruceDescendente = anterior > linea && actual <= linea;
    return cruceAscendente || cruceDescendente;
}

// ======================================================
// 5. CALCULAR EL TIEMPO EXACTO DEL CRUCE
// ======================================================

function obtenerTiempoCruce(
    posicionAnterior,
    posicionActual,
    posicionLinea,
    tiempoAnterior,
    tiempoActual
) {
    const diferenciaPosicion = posicionActual - posicionAnterior;
    if (diferenciaPosicion === 0) {
        return tiempoActual;
    }
    const proporcion = (posicionLinea - posicionAnterior) / diferenciaPosicion;
    const proporcionLimitada = Math.max(0, Math.min(1, proporcion));
    return tiempoAnterior + (tiempoActual - tiempoAnterior) * proporcionLimitada;
}

// ======================================================
// 6. REGISTRAR CRUCES (ZONA RADAR DE 2 LÍNEAS A Y B)
// ======================================================

function registrarCruces(
    vehiculos,
    lineaA,
    lineaB,
    tiempoVideo,
    orientacion = "horizontal"
) {
    vehiculos.forEach(vehiculo => {
        if (vehiculo.hits < MIN_HITS) {
            if (vehiculo.fotogramasPerdidos === 0 && !vehiculo.tiempoAnterior) {
                vehiculo.tiempoAnterior = tiempoVideo;
            }
            return;
        }

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
            B: lineaB
        };

        if (!Number.isFinite(vehiculo.tiempoAnterior)) {
            vehiculo.tiempoAnterior = tiempoVideo;
            return;
        }

        Object.entries(lineas).forEach(([nombre, posicion]) => {
            if (vehiculo.tiemposCruce[nombre] !== null) {
                return;
            }

            if (calcularCruceLinea(anterior, actual, posicion)) {
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

        vehiculo.tiempoAnterior = tiempoVideo;
    });
}

// ======================================================
// 7. DIBUJAR LÍNEAS DE RADAR (A Y B)
// ======================================================

function dibujarLineas(
    ctx,
    ancho,
    alto,
    lineaA,
    lineaB,
    orientacion = "horizontal"
) {
    const lineas = [
        { posicion: lineaA, color: "#3b82f6", nombre: "A (Radar Inicio)" },
        { posicion: lineaB, color: "#22c55e", nombre: "B (Radar Fin)" }
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

        ctx.font = "bold 16px Arial";
        ctx.fillStyle = linea.color;

        if (orientacion === "horizontal") {
            ctx.fillText(`LÍNEA ${linea.nombre}`, 10, linea.posicion - 8);
        } else {
            ctx.fillText(`LÍNEA ${linea.nombre}`, linea.posicion + 8, 25);
        }

        ctx.setLineDash([10, 8]);
    });

    ctx.restore();
}

// ======================================================
// 8. DIBUJAR IDENTIFICADORES
// ======================================================

function dibujarIdentificadores(ctx, vehiculos) {
    vehiculos.forEach(vehiculo => {
        if (vehiculo.hits < MIN_HITS) return;
        if (vehiculo.fotogramasPerdidos !== 0) return;

        const punto = vehiculo.puntoActual;

        ctx.save();
        ctx.fillStyle = "#38bdf8";
        ctx.font = "bold 16px Arial";

        const velTexto = vehiculo.velocidades && Number.isFinite(vehiculo.velocidades.velocidad)
            ? ` · ${vehiculo.velocidades.velocidad.toFixed(1)} km/h`
            : "";

        ctx.fillText(
            `VEHÍCULO #${vehiculo.id}${velTexto}`,
            punto.x + 8,
            punto.y - 8
        );

        ctx.beginPath();
        ctx.arc(punto.x, punto.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.restore();
    });
}

// ======================================================
// 9. REINICIAR SEGUIMIENTO
// ======================================================

function reiniciarSeguimiento() {
    vehiculosActivos = [];
    siguienteID = 1;
}
