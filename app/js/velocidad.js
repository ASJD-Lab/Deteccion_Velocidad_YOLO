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
// Para video grabado por detrás del tráfico (perspectiva
// central), la relación entre altura del bbox en píxeles
// y distancia real al vehículo es:
//
//   altura_px = K / distancia_m   →   distancia_m = K / altura_px
//
// donde K = focal_px × altura_real_m (constante de la cámara).
//
// La distancia recorrida entre dos frames es:
//
//   Δd = K × (1/h1 - 1/h2)   [metros]
//   v  = Δd / Δt              [m/s]  × 3.6 → km/h
//
// K se llama "constante perspectiva" y el usuario la
// calibra hasta que la velocidad mostrada coincida con
// la velocidad real. Valor de partida típico: 500–2000.
//
// Se usa la altura del bbox (y2-y1) en lugar del área
// porque la altura es más estable ante oclusiones
// parciales donde el ancho puede variar.
// ======================================================

function calcularVelocidadPerspectiva(vehiculo, constK) {

    if (
        !vehiculo ||
        !vehiculo.historialBbox ||
        vehiculo.historialBbox.length < 2
    ) {
        return null;
    }

    if (!Number.isFinite(constK) || constK <= 0) {
        return null;
    }

    const h = vehiculo.historialBbox;
    const anterior = h[0];
    const actual   = h[h.length - 1];

    const dt = actual.tiempo - anterior.tiempo;
    if (dt <= 0) return null;

    // Usar la altura del bbox, que es el parámetro
    // más directo en la ecuación de perspectiva.
    const h1 = anterior.alto;
    const h2 = actual.alto;

    // Si la altura no creció el auto no se está acercando.
    if (h2 <= h1 || h1 <= 0) return null;

    // Distancia recorrida según la ecuación perspectiva:
    //   Δd = K × (1/h1 - 1/h2)
    const deltaDistancia = constK * (1 / h1 - 1 / h2);

    if (deltaDistancia <= 0) return null;

    const velocidad = calcularVelocidad(deltaDistancia, dt);

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
// Se guarda tanto el área como el alto del bbox para
// que la fórmula de perspectiva tenga acceso al alto.
// ======================================================

function registrarMuestraBbox(vehiculo, deteccion, tiempo) {

    if (!vehiculo || !deteccion) return;

    if (!vehiculo.historialBbox) {
        vehiculo.historialBbox = [];
    }

    const alto = deteccion.y2 - deteccion.y1;
    const area = (deteccion.x2 - deteccion.x1) * alto;

    if (area <= 0 || alto <= 0) return;

    vehiculo.historialBbox.push({ area, alto, tiempo });

    if (vehiculo.historialBbox.length > HISTORIAL_BBOX_MAX) {
        vehiculo.historialBbox.shift();
    }

}
