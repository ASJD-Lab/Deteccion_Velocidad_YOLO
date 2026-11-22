// ======================================================
// MÓDULO DE GENERACIÓN DE INFRACCIONES
// ======================================================


// ======================================================
// 1. VERIFICAR SI EXISTE UNA INFRACCIÓN
// ======================================================

function verificarInfraccion(velocidad, limite) {

    if (
        !Number.isFinite(velocidad) ||
        !Number.isFinite(limite) ||
        velocidad <= 0 ||
        limite <= 0
    ) {

        return {
            infraccion: false,
            exceso: 0
        };

    }


    if (velocidad > limite) {

        return {

            infraccion: true,

            exceso: Number(
                (velocidad - limite).toFixed(2)
            )

        };

    }


    return {

        infraccion: false,

        exceso: 0

    };

}


// ======================================================
// 2. OBTENER FECHA Y HORA
// ======================================================

function obtenerFechaHora() {

    return new Date().toLocaleString("es-MX");

}

