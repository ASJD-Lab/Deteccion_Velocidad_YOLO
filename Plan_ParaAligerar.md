Aquí tienes un prompt/plan estructurado y directo listo para copiar y pegar en **OpenCode** dentro de la raíz de tu repositorio, para que inspeccione los archivos y aplique todas las optimizaciones:

---

```markdown
# Plan de Optimización para Ejecución en Móviles y Despliegue en Netlify

Actúa como ingeniero senior de frontend y WebAssembly/ONNX Runtime. El objetivo es optimizar este proyecto (`Deteccion_Velocidad_YOLO`) para que cargue rápido y ejecute la inferencia de manera fluida en navegadores móviles (Android/iOS) desplegados en Netlify (`https://deteccion-velocidad-yolo.netlify.app/app/`).

Realiza las siguientes tareas en orden, inspeccionando primero los archivos involucrados antes de editar:

## 1. Limpieza de modelos duplicados y rutas unificadas
- Actualmente existen modelos duplicados en `modelos/`, `app/modelos/` y `app/models/`, además de un modelo residual (`modelos/best.onnx`) y un video `.mkv` incompatible con navegadores móviles (`videos/Licence Plate Camera Illustration Video.mkv`).
- Revisa en `app/js/onnx.js`, `app/js/onnx_worker.js`, `app/js/vehiculos.js`, `app/js/detector.js`, `app/js/ocr.js` y `app/js/app.js` qué rutas exactas se utilizan para cargar `vehiculos.onnx`, `best_deteccion.onnx` y `cct_s_v2_global.onnx`.
- Unifica todas las rutas de modelos para apuntar exclusivamente a `../modelos/` (relativo a `app/`).
- Elimina las carpetas duplicadas `app/modelos/` y `app/models/`, elimina `modelos/best.onnx` si no se referencia en el código, y elimina `videos/Licence Plate Camera Illustration Video.mkv` (actualizando `app/index.html` o `app/js/app.js` si estaba listado como video de prueba, dejando solo el `.webm` o videos compatibles).

## 2. Configuración de Netlify para WASM Multihilo (`netlify.toml`)
- Revisa `netlify.toml` y asegúrate de que `publish = "."` esté configurado correctamente para servir tanto `app/` como `modelos/` y `videos/`.
- Agrega/verifica las cabeceras globales para habilitar `SharedArrayBuffer` y permitir ejecución multihilo de ONNX Runtime Web (WASM) en celulares sin WebGPU:
  ```toml
  [[headers]]
    for = "/*"
    [headers.values]
      Cross-Origin-Opener-Policy = "same-origin"
      Cross-Origin-Embedder-Policy = "credentialless"

```

## 3. Inferencia en cascada bajo demanda (Evitar triple inferencia por frame)

* Inspecciona el ciclo principal de detección en `app/js/app.js`, `app/js/vehiculos.js`, `app/js/detector.js`, `app/js/ocr.js` y `app/js/onnx_worker.js`.
* Modifica el flujo para que **en cada frame** solo se ejecute el modelo de detección de vehículos (`vehiculos.onnx`).
* Haz que el detector de placas (`best_deteccion.onnx`) y el OCR (`cct_s_v2_global.onnx`) **NO se ejecuten en todos los frames**, sino únicamente bajo demanda: solo cuando un vehículo tracked en `app/js/seguimiento.js` / `app/js/velocidad.js` supere el límite de velocidad configurado (y solo una vez por ID de vehículo, recortando únicamente el ROI/bounding box del vehículo infractor).

## 4. Control de concurrencia (Frame Skipping) y Modo Móvil en el Worker

* En `app/js/app.js` y `app/js/onnx_worker.js`, asegura que exista un bloqueo (`isProcessing` / bandera de ocupado) para que nunca se encolen frames nuevos hacia el Web Worker mientras el frame anterior sigue procesándose.
* En `app/js/onnx.js` / `app/js/onnx_worker.js`, configura explícitamente `ort.env.wasm.numThreads` (usando `Math.min(navigator.hardwareConcurrency || 4, 4)` cuando `crossOriginIsolated === true`) y asegúrate de que el fallback de `webgpu` a `wasm` capture errores limpiamente y reporte el backend activo a la UI.
* Si el dispositivo es móvil o corre sobre `wasm`, reduce dinámicamente la frecuencia de muestreo (por ejemplo, procesar 1 de cada 2 o 3 frames del video) para mantener la interfaz fluida y evitar saturación de RAM.

## 5. Indicador de progreso de carga de modelos en la UI

* En `app/index.html`, `app/styles.css` y `app/js/app.js`, agrega un indicador de estado visible (overlay o barra de estado en el panel) que informe al usuario mientras los archivos `.onnx` (~28 MB en total) se descargan e inicializan en el Worker (ej. *"Cargando modelos de IA (1/3)..."*), deshabilitando el botón de inicio hasta que los modelos estén listos.
* Agrega manejo de errores visible en pantalla si falla la descarga de algún `.onnx` o la inicialización de ONNX Runtime.

## Verificación final

* Verifica que no queden rutas rotas hacia `models/` o `app/modelos/`.
* Comprueba que la sintaxis JS/HTML/TOML sea válida y resume los cambios realizados archivo por archivo.

```

---

**Tip adicional antes de correrlo:** Si tienes los pesos `.pt` originales con los que entrenaste `vehiculos.onnx` y `best_deteccion.onnx`, también puedes pedirle a OpenCode que genere un script rápido en Python para re-exportarlos con `imgsz=416` y `half=True` (FP16), lo que reducirá cada modelo de ~12 MB a ~4 MB y acelerará aún más la carga inicial en datos móviles.

```
