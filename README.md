# Deteccion_Velocidad_YOLO
Proyecto de la materia de Redes Neuronales 2026, donde implementamos un modelo de detección de exceso de velocidad en carros usando YOLO.

## Cómo ejecutar

Sirve la raíz del proyecto con un servidor HTTP (los modelos y los workers no funcionan abriendo el archivo con `file://`):

```bash
python3 -m http.server 8000
```

Abre `http://localhost:8000/app/`.

## Rendimiento

- Los modelos ONNX se ejecutan en **Web Workers** para no bloquear el video ni la interfaz.
- Se usa **WebGPU** cuando el navegador lo soporta y, si no, **WASM** como respaldo.
- El panel de configuración muestra el procesador activo y los **FPS de detección** en tiempo real.
- Para obtener el máximo rendimiento se recomienda **Chrome o Edge actualizados** con WebGPU habilitado. En navegadores sin WebGPU la detección seguirá funcionando, pero más lenta.
- El respaldo WASM usa un solo hilo. Para habilitar varios hilos hacen falta las cabeceras `Cross-Origin-Opener-Policy: same-origin` y `Cross-Origin-Embedder-Policy: require-corp` (o `credentialless`) en el servidor.

Los modelos deben estar en `modelos/`:

- `vehiculos.onnx`
- `best_deteccion.onnx`
