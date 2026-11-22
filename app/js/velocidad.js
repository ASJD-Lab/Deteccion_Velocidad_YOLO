// ======================================================
// MÓDULO DE CÁLCULO DE VELOCIDAD
// Método de tres líneas de la libreta
// ======================================================


// Distancias físicas entre líneas (metros).
// IMPORTANTE: sustituir por las distancias reales
// medidas en el escenario del video.

const DISTANCIA_AB = 5.0;
const DISTANCIA_BC = 5.0;


// ======================================================
// 1. CALCULAR VELOCIDAD
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

    // El vehículo puede recorrer las líneas
    // en cualquiera de los dos sentidos.
    const sentidoABC = A < B && B < C;
    const sentidoCBA = C < B && B < A;

    return sentidoABC || sentidoCBA;

}


// ======================================================
// 3. CALCULAR VELOCIDAD ENTRE A-B Y B-C
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


    // --------------------------------------------------
    // VALIDAR SECUENCIA DE LOS TRES CRUCES
    // --------------------------------------------------

    const tieneABC =
        Number.isFinite(cruces.A) &&
        Number.isFinite(cruces.B) &&
        Number.isFinite(cruces.C);

    if (tieneABC && !validarOrdenCruces(cruces)) {
        return null;
    }


    // --------------------------------------------------
    // TRAMO A-B
    // --------------------------------------------------

    if (
        Number.isFinite(cruces.A) &&
        Number.isFinite(cruces.B)
    ) {

        const tiempoAB = Math.abs(
            cruces.B - cruces.A
        );

        velocidadAB = calcularVelocidad(
            distanciaAB,
            tiempoAB
        );

    }


    // --------------------------------------------------
    // TRAMO B-C
    // --------------------------------------------------

    if (
        Number.isFinite(cruces.B) &&
        Number.isFinite(cruces.C)
    ) {

        const tiempoBC = Math.abs(
            cruces.C - cruces.B
        );

        velocidadBC = calcularVelocidad(
            distanciaBC,
            tiempoBC
        );

    }


    // --------------------------------------------------
    // CONSERVAR ÚNICAMENTE VELOCIDADES VÁLIDAS
    // --------------------------------------------------

    const velocidadesValidas = [
        velocidadAB,
        velocidadBC
    ].filter(
        velocidad =>
            Number.isFinite(velocidad) &&
            velocidad > 0
    );


    if (velocidadesValidas.length === 0) {
        return null;
    }


    // --------------------------------------------------
    // CALCULAR PROMEDIO
    // --------------------------------------------------

    const promedio =
        velocidadesValidas.reduce(
            (suma, velocidad) => suma + velocidad,
            0
        ) / velocidadesValidas.length;


    return {

        velocidadAB,

        velocidadBC,

        velocidad: Number(promedio.toFixed(2)),

        tramosCalculados: velocidadesValidas.length

    };

}


// ======================================================
// 4. ACTUALIZAR VELOCIDAD DEL VEHÍCULO
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

    if (!resultado) {
        return null;
    }

    vehiculo.velocidades = resultado;

    return resultado;

}