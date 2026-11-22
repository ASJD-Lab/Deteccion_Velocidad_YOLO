// ==========================================
// MÓDULO DE GENERACIÓN DE INFRACCIONES
// ==========================================

// Determina si un vehículo supera el límite permitido.

function verificarInfraccion(velocidad, limite) {

    if (velocidad > limite) {

        return {
            infraccion: true,
            exceso: Number((velocidad - limite).toFixed(2))
        };

    }

    return {
        infraccion: false,
        exceso: 0
    };

}