// ==========================================
// MÓDULO DE CÁLCULO DE VELOCIDAD
// ==========================================

// Calcula la velocidad a partir de una distancia
// conocida y el tiempo transcurrido.

function calcularVelocidad(distancia, tiempo) {

    if (distancia <= 0 || tiempo <= 0) {
        return 0;
    }

    const velocidad = (distancia / tiempo) * 3.6;

    return Number(velocidad.toFixed(2));

}