// ======================================================
// MÓDULO DE CÁLCULO DE VELOCIDAD
// Método 1: tres líneas de referencia
// Método 2: perspectiva (crecimiento del bounding box)
//           para video grabado por detrás del tráfico
// ======================================================


// Distancias físicas entre líneas (metros).
const DISTANCIA_AB = 5.0;
const DISTANCIA_BC = 5.0;

// Frames a conservar en el historial del bbox.
const HISTORIAL_BBOX_MAX = 8;


// ======================================================
// 1. CALCULAR VELOCIDAD (m/s → km/h)
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

    return Number(velocidad.toFixed(2));

}


// ======================================================
// 2. VALIDAR ORDEN DE LOS CRUCES
// ======================================================

function validarOrdenCruces(cruces) {

    const { A, B, C } = cruces;

    if (
        !Number.isFinite(A) ||
        !Number.isFinite(B) ||
        !Number.isFinite(C)
    ) {
        return false;
    }

    const sentidoABC = A < B && B < C;
    const sentidoCBA = C < B && B < A;

    return sentidoABC || sentidoCBA;

}


// ======================================================
// 3. CALCULAR VELOCIDAD ENTRE A-B Y B-C (TRES LÍNEAS)
// ======================================================

function calcularVelocidadVehiculo(
    vehiculo,
    distanciaAB = DISTANCIA_AB,
    distanciaBC = DISTANCIA_BC
) {

    if (!vehiculo || !vehiculo.tiemposCruce) {
        return null;
    }

    if (
        !Number.isFinite(distanciaAB) ||
        !Number.isFinite(distanciaBC) ||
        distanciaAB <= 0 ||
        distanciaBC <= 0
    ) {
        return null;
    }

    const cruces = vehiculo.tiemposCruce;

    let velocidadAB = null;
    let velocidadBC = null;

    const tieneABC =
        Number.isFinite(cruces.A) &&
        Number.isFinite(cruces.B) &&
        Number.isFinite(cruces.C);

    if (tieneABC && !validarOrdenCruces(cruces)) {
        return null;
    }

    if (Number.isFinite(cruces.A) && Number.isFinite(cruces.B)) {
        velocidadAB = calcularVelocidad(
            distanciaAB,
            Math.abs(cruces.B - cruces.A)
        );
    }

    if (Number.isFinite(cruces.B) && Number.isFinite(cruces.C)) {
        velocidadBC = calcularVelocidad(
            distanciaBC,
            Math.abs(cruces.C - cruces.B)
        );
    }

    const velocidadesValidas = [velocidadAB, velocidadBC].filter(
        v => Number.isFinite(v) && v > 0
    );

    if (velocidadesValidas.length === 0) return null;

    const promedio =
        velocidadesValidas.reduce((s, v) => s + v, 0) /
        velocidadesValidas.length;

    return {
        velocidadAB,
        velocidadBC,
        velocidad: Number(promedio.toFixed(2)),
        tramosCalculados: velocidadesValidas.length,
        metodo: "lineas"
    };

}


// ======================================================
// 4. ACTUALIZAR VELOCIDAD DEL VEHÍCULO (TRES LÍNEAS)
// ======================================================

function actualizarVelocidadVehiculo(
    vehiculo,
    distanciaAB = DISTANCIA_AB,
    distanciaBC = DISTANCIA_BC
) {

    const resultado = calcularVelocidadVehiculo(
        vehiculo,
        distanciaAB,
        distanciaBC
    );

    if (!resultado) return null;

    vehiculo.velocidades = resultado;

    return resultado;

}


// ======================================================
// 5. CALCULAR VELOCIDAD POR PERSPECTIVA
//
// En video grabado por detrás del tráfico los autos se
// acercan y su bounding box crece. La raíz cuadrada del
// área es inversamente proporcional a la distancia, por
// lo que la tasa de cambio de √área es proporcional a la
// velocidad de acercamiento.
//
//   v ≈ (√área_actual - √área_anterior) × factorEscala / Δt
//
// factorEscala convierte px^0.5 en metros. Se calibra en
// el panel de configuración; valor típico: 0.08 – 0.30.
// ======================================================

function calcularVelocidadPerspectiva(vehiculo, factorEscala) {

    if (
        !vehiculo ||
        !vehiculo.historialBbox ||
        vehiculo.historialBbox.length < 2
    ) {
        return null;
    }

    if (!Number.isFinite(factorEscala) || factorEscala <= 0) {
        return null;
    }

    const h = vehiculo.historialBbox;
    const anterior = h[0];
    const actual   = h[h.length - 1];

    const dt = actual.tiempo - anterior.tiempo;
    if (dt <= 0) return null;

    const ladoAnterior = Math.sqrt(anterior.area);
    const ladoActual   = Math.sqrt(actual.area);

    // Solo calculamos cuando el auto se acerca (bbox crece).
    if (ladoActual <= ladoAnterior) return null;

    const distanciaAprox = (ladoActual - ladoAnterior) * factorEscala;

    const velocidad = calcularVelocidad(distanciaAprox, dt);

    if (!Number.isFinite(velocidad)) return null;

    // Filtro de plausibilidad: 1 – 300 km/h.
    if (velocidad < 1 || velocidad > 300) return null;

    return {
        velocidad,
        metodo: "perspectiva"
    };

}


// ======================================================
// 6. REGISTRAR MUESTRA EN EL HISTORIAL DEL BBOX
// ======================================================

function registrarMuestraBbox(vehiculo, deteccion, tiempo) {

    if (!vehiculo || !deteccion) return;

    if (!vehiculo.historialBbox) {
        vehiculo.historialBbox = [];
    }

    const area =
        (deteccion.x2 - deteccion.x1) *
        (deteccion.y2 - deteccion.y1);

    if (area <= 0) return;

    vehiculo.historialBbox.push({ area, tiempo });

    if (vehiculo.historialBbox.length > HISTORIAL_BBOX_MAX) {
        vehiculo.historialBbox.shift();
    }

}
