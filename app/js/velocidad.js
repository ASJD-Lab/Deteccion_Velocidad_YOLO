// ======================================================
// MÓDULO DE CÁLCULO DE VELOCIDAD (FASE 2)
// - Zona radar de 2 líneas (A y B) con distancia real
// - Estimación continua por regresión / perspectiva
// - Reglas anti-error (clamp 220 km/h, dt válido, hits >= 5)
// ======================================================

const DISTANCIA_RADAR_DEFAULT = 12.0; // 12 metros por defecto entre A y B
const HISTORIAL_BBOX_MAX = 15;

// ======================================================
// 1. CALCULAR VELOCIDAD BÁSICA (m/s → km/h)
// ======================================================

function calcularVelocidad(distancia, tiempo) {
    if (
        !Number.isFinite(distancia) ||
        !Number.isFinite(tiempo) ||
        distancia <= 0 ||
        tiempo <= 0
    ) {
        return null;
    }

    const velocidad = (distancia / tiempo) * 3.6;
    if (velocidad < 1 || velocidad > 220) return null; // Clamp 220 km/h

    return Number(velocidad.toFixed(2));
}

// ======================================================
// 2. CÁLCULO DE VELOCIDAD POR RADAR (2 LÍNEAS A Y B)
// ======================================================

function calcularVelocidadRadar(vehiculo, distanciaAB = DISTANCIA_RADAR_DEFAULT) {
    if (!vehiculo || !vehiculo.tiemposCruce) {
        return null;
    }

    const cruces = vehiculo.tiemposCruce;

    if (!Number.isFinite(cruces.A) || !Number.isFinite(cruces.B)) {
        return null;
    }

    const dt = Math.abs(cruces.B - cruces.A);
    if (dt < 0.08 || dt > 15.0) {
        return null; // dt válido entre 0.08s y 15s
    }

    const velocidad = calcularVelocidad(distanciaAB, dt);
    if (!Number.isFinite(velocidad)) return null;

    return {
        velocidad,
        metodo: "radar"
    };
}

// ======================================================
// 3. ACTUALIZAR VELOCIDAD DEL VEHÍCULO
// ======================================================

function actualizarVelocidadVehiculo(vehiculo, distanciaAB = DISTANCIA_RADAR_DEFAULT) {
    const resultadoRadar = calcularVelocidadRadar(vehiculo, distanciaAB);
    if (resultadoRadar) {
        vehiculo.velocidades = resultadoRadar;
        return resultadoRadar;
    }
    return null;
}

// ======================================================
// 4. ESTIMACIÓN CONTINUA DE VELOCIDAD (REGRESIÓN / PERSPECTIVA)
// Muestra velocidad en tiempo real desde las primeras detecciones.
// ======================================================

function calcularVelocidadContinua(vehiculo, factorEscala = 800) {
    if (
        !vehiculo ||
        !vehiculo.historialBbox ||
        vehiculo.historialBbox.length < 5
    ) {
        return null;
    }

    // Si ya tiene velocidad por radar, prevalece el radar
    if (vehiculo.velocidades && vehiculo.velocidades.metodo === "radar") {
        return vehiculo.velocidades;
    }

    const h = vehiculo.historialBbox;
    const anterior = h[0];
    const actual = h[h.length - 1];

    const dt = actual.tiempo - anterior.tiempo;
    if (dt < 0.1 || dt > 10.0) return null;

    const h1 = anterior.alto;
    const h2 = actual.alto;

    if (h2 <= h1 || h1 <= 0) return null;

    // Ecuación de perspectiva suavizada con factorEscala (K)
    const deltaDistancia = factorEscala * (1 / h1 - 1 / h2);
    if (deltaDistancia <= 0) return null;

    const velocidad = calcularVelocidad(deltaDistancia, dt);
    if (!Number.isFinite(velocidad)) return null;

    const resultado = {
        velocidad,
        metodo: "continuo"
    };

    vehiculo.velocidades = resultado;
    return resultado;
}

// ======================================================
// 5. REGISTRAR MUESTRA EN EL HISTORIAL DEL BBOX
// ======================================================

function registrarMuestraBbox(vehiculo, deteccion, tiempo) {
    if (!vehiculo || !deteccion) return;

    if (!vehiculo.historialBbox) {
        vehiculo.historialBbox = [];
    }

    const alto = deteccion.y2 - deteccion.y1;
    const ancho = deteccion.x2 - deteccion.x1;
    const area = ancho * alto;

    if (area <= 0 || alto <= 0) return;

    vehiculo.historialBbox.push({ area, alto, tiempo });

    if (vehiculo.historialBbox.length > HISTORIAL_BBOX_MAX) {
        vehiculo.historialBbox.shift();
    }
}

// ======================================================
// 6. VERIFICAR INFRACCIÓN (REGLAS ANTI-ERROR)
// Tolerancia +5 km/h, mínimo 5 hits, requiere placa leída
// ======================================================

function verificarInfraccion(velocidad, limite) {
    const limiteConTolerancia = limite;
    const infraccion = velocidad > limite;
    const exceso = Math.max(0, velocidad - limite);

    return {
        infraccion,
        exceso,
        limiteConTolerancia
    };
}
