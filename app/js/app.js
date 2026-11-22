// ==========================================
// SISTEMA DE VIGILANCIA VIAL
// Archivo principal de la aplicación
// ==========================================

document.addEventListener("DOMContentLoaded", () => {

    console.log("Sistema de Vigilancia Vial iniciado.");

    // Elementos principales
    const limiteVelocidad = document.getElementById("limiteVelocidad");
    const limiteActual = document.getElementById("limiteActual");

    // Actualizar el límite permitido
    limiteVelocidad.addEventListener("change", () => {

        const limite = Number(limiteVelocidad.value);

        if (limite > 0) {
            limiteActual.innerHTML = `${limite} <small>km/h</small>`;
        }

    });

});