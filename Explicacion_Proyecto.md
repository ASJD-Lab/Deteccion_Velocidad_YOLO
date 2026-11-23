# Explicación completa del proyecto: Detección de Velocidad con YOLO + ONNX

## 1. ¿Qué es el sistema?

Aplicación web (HTML/JS) que procesa video de tráfico y hace cuatro cosas:

1. **Detectar vehículos** (auto, moto, bus, camión) con un modelo YOLOv8 en ONNX.
2. **Seguirlos** entre fotogramas (tracking por IoU + distancia + predicción de movimiento).
3. **Calcular su velocidad** con dos métodos: radar de 2 líneas (exacto) y estimación continua (aproximada).
4. **Leer la placa** (OCR) y registrar multas si supera el límite.

Todo corre en el navegador, sin backend: los modelos ONNX se ejecutan con ONNX Runtime Web (WebGPU si hay GPU, si no WASM).

---

## 2. Modelos ONNX utilizados

| Archivo | Tarea | Entrada | Salida | Uso |
|---|---|---|---|---|
| `vehiculos.onnx` | Detección YOLOv8n (clases COCO 2,3,5,7) | `[1,3,640,640]` float32 | `[1, 84, 8400]` (4 coords + 80 clases) | Detectar vehículos |
| `best_deteccion.onnx` | Detección de placas (YOLOv8 de 1 clase) | `[1,3,640,640]` float32 | `[1,5,N]` o `[1,N,5]` | Localizar la placa dentro del recorte del vehículo |
| `cct_s_v2_global.onnx` | OCR de placas (CNN + CTC) | `[1,64,128,3]` | `[1,10,37]` (10 caracteres, 37 símbolos) | Reconocer texto de la placa (opcional, fallback Tesseract) |

### Decodificación de YOLO (vehículos)
- Salida `[1, 84, 8400]`: 8400 anchors, 84 features (4 bbox + 80 clases).
- Para cada anchor se toma la clase con mayor score; si no es una de {2,3,5,7} se descarta.
- Se aplica **NMS (Non-Maximum Suppression)** con IoU 0.45 para eliminar duplicados.
- Las coordenadas se deshacen del letterbox: `x = (x_model - padX) / escala`.

### Preprocesamiento (letterbox)
- Se redimensiona la imagen manteniendo aspect ratio dentro de 640×640.
- Se rellena con gris 114 (estándar YOLO).
- Se normaliza dividiendo por 255 y se reordena a formato CHW (canal, alto, ancho).

---

## 3. Arquitectura de ejecución (rendimiento)

- **Web Workers**: cada modelo corre en su propio worker (`onnx_worker.js`), así la inferencia no bloquea el video ni la UI.
- **WebGPU primero**: el worker intenta crear la sesión con `executionProviders: ["webgpu"]`; si falla, cae a WASM.
- **Warmup**: al cargar el modelo se ejecuta una inferencia con tensor de ceros para pagar la compilación de kernels antes del primer frame real.
- **Transferencia de buffers**: el `Float32Array` se envía con `postMessage(..., [buffer])` (transferible, sin copia).
- **Serialización**: cada `SesionONNX` tiene una cola (`cola`) para que un mismo worker no ejecute dos `run()` simultáneos.
- **Respuesta**: el worker devuelve `data` + `dims` como `ArrayBuffer` transferido.

---

## 4. Seguimiento (tracking)

Archivo `seguimiento.js`. Objetivo: asociar detecciones del frame actual con vehículos ya conocidos.

- **Punto de anclaje**: centro inferior de la caja `(cx, y2)` (contacto con el suelo).
- **Asociación**: para cada detección se busca el vehículo no asociado que minimice `distancia - 200·IoU`, con umbral dinámico `max(120, max(ancho,alto)*1.5)` px o IoU ≥ 0.10.
- **Predicción de movimiento**: si el vehículo tiene `vx, vy` estimados, se proyecta su posición esperada `puntoActual + v·dt` (dt < 0.5 s) antes de calcular la distancia.
- **Suavizado EMA** de la caja: 30% anterior + 70% nueva detección (reduce jitter del bbox).
- **Velocidad en píxeles/s**: `vx = (x_actual - x_anterior)/dt`, suavizada con EMA (30/70).
- **TTL**: un vehículo se descarta si lleva más de 1200 ms sin ser visto (tiempo real, no frames).
- **MIN_HITS = 2**: se necesitan al menos 2 detecciones antes de mostrar/medir.

---

## 5. Cálculo de la velocidad (lo más importante)

### 5.1 Método radar (2 líneas) — el más preciso

Dos líneas horizontales en la imagen (por defecto 56% y 80% de la altura). Distancia real configurable (default 12 m).

Para cada vehículo se registran los instantes en que su punto inferior cruza cada línea (`tiemposCruce.A`, `.B`). El cruce se detecta por cambio de signo entre frames y el tiempo exacto se interpola linealmente:

```
t_cruce = t_anterior + (t_actual - t_anterior) * (linea - pos_anterior)/(pos_actual - pos_anterior)
```

Velocidad:

```
v = (distancia_metros / |t_B - t_A|) * 3.6   [km/h]
```

Validaciones:
- dt entre 0.08 s y 15 s (descarta ruido).
- v entre 1 y 220 km/h (clamp).
- Solo se mide si el vehículo tiene ≥ MIN_HITS y no está perdido.

### 5.2 Estimación continua (perspectiva)

Mientras el vehículo no haya cruzado ambas líneas, se muestra una velocidad aproximada usando el crecimiento del bbox (perspectiva de cámara):

```
Δdistancia = K * (1/h1 - 1/h2)     // K = constante calibrada (default 800)
v = (Δdistancia / Δt) * 3.6
```

donde `h1, h2` son las alturas del bbox en el primer y último frame del historial (mínimo 5 muestras, máximo 15). Requiere que el vehículo se acerque (h2 > h1).

**Prioridad**: si existe velocidad por radar, prevalece sobre la continua.

### 5.3 Reglas anti-error (multas)

- Tolerancia de +5 km/h sobre el límite.
- Mínimo 5 detecciones para multar.
- Solo se multa si la placa fue leída (OCR exitoso).
- Clamp máximo 220 km/h.

---

## 6. OCR y multas

- `best_deteccion.onnx` localiza la placa dentro del recorte del vehículo (confianza ≥ 0.15).
- El texto se reconoce con `cct_s_v2_global.onnx` (OCR ONNX) o Tesseract.js como fallback.
- Se guardan los recortes más nítidos (varianza del Laplaciano) y se vota entre frames.
- Se valida el formato de placa mexicana.
- Al detectar infracción se registra: imagen de placa, matrícula, velocidad, límite, exceso, fecha/hora.

---

## 7. Parámetros configurables (UI)

- Límite de velocidad (km/h).
- Distancia real entre líneas A-B (metros).
- Confianza del detector.
- Posición de líneas A y B (porcentaje de altura).
- Orientación (horizontal/vertical).
- Método de velocidad (radar, líneas, ambos, perspectiva).
- Constante K (perspectiva).

---

## 8. Preguntas típicas del profesor (y respuestas)

**¿Por qué ONNX y no PyTorch?**
ONNX es un formato interoperable; ONNX Runtime Web permite ejecutar el modelo en el navegador con WebGPU/WASM sin servidor. Reduce latencia y privacidad (video no sale del cliente).

**¿Qué es el letterbox y por qué 640?**
YOLO espera entrada cuadrada 640×640. El letterbox redimensiona manteniendo proporción y rellena con gris 114 para no deformar los objetos. 640 es el tamaño estándar de YOLOv8n (trade-off velocidad/precisión).

**¿Cómo se convierte salida YOLO a cajas?**
Cada anchor predice (cx,cy,w,h) + scores de clase. Se filtra por clase válida y confianza, se convierte a (x1,y1,x2,y2) deshaciendo el padding/escala, y se aplica NMS por IoU para quitar duplicados.

**¿Cómo se calcula la velocidad?**
Medición de tiempo entre dos puntos de distancia conocida: `v = d/Δt`. El tiempo de cruce se interpola linealmente entre frames para mayor precisión. Se valida el rango de Δt y se aplica clamp.

**¿Por qué EMA y predicción en el tracking?**
El detector es ruidoso (bbox jitter) y la inferencia no corre cada frame. La EMA suaviza; la predicción con `v·dt` permite asociar aunque el objeto se haya movido. El TTL en ms (no en frames) hace el sistema independiente del FPS.

**¿Qué es WebGPU vs WASM?**
WebGPU usa la GPU del navegador para inferencia (mucho más rápido). WASM es fallback en CPU. El worker intenta WebGPU primero y cae a WASM si no está disponible o falla.

**¿Cómo se evita bloquear la UI?**
Inferencia en Web Worker + transferencia de buffers + serialización por sesión. El hilo principal solo dibuja y decide.

---

## 9. Flujo de ejemplo completo (paso a paso)

Escenario: video de una carretera con límite 60 km/h, dos vehículos.

### Frame 0 (t = 0.000 s)
1. El navegador captura el frame del `<video>` (ej. 1920×1080).
2. Se llama a `detectarVehiculos(video, 0.50)`.
3. Preprocesamiento: letterbox a 640×640, gris 114, normalización /255, CHW.
4. Se envía el `Float32Array` al worker (transferido, sin copia).
5. El worker ejecuta `vehiculos.onnx` (WebGPU si está disponible).
6. Salida `[1,84,8400]`: se decodifican anchors, se filtra por clase {2,3,5,7} y confianza ≥ 0.50.
7. NMS (IoU 0.45) elimina duplicados.
8. Coordenadas se deshacen del letterbox → cajas en píxeles originales.
9. El worker devuelve `{data, dims}` al hilo principal.

### Frame 1 (t = 0.033 s) — primer vehículo detectado
10. `actualizarSeguimiento(detecciones, t)` crea un nuevo vehículo `#1` con `hits = 1`, `tiemposCruce = {A:null, B:null}`, `vx = 0`.
11. Como `hits < MIN_HITS (2)`, no se registra cruce ni se muestra ID.
12. Se dibuja la caja del vehículo en el canvas (azul).

### Frame 2 (t = 0.066 s) — segundo hit
13. El mismo vehículo se asocia por distancia/IoU; `hits` pasa a 2.
14. Se calcula `vx, vy` en px/s (aún 0 porque no hay desplazamiento previo significativo).
15. La caja se suaviza con EMA (30% anterior + 70% nueva).
16. `registrarMuestrasBbox` añade `{area, alto, tiempo}` al historial (máx. 15).
17. `registrarCruces` comprueba si el punto inferior `(cx, y2)` cruzó la línea A (56%) o B (80%). Si no, nada.

### Frame ~15 (t ≈ 0.5 s) — cruce de línea A
18. El punto inferior pasa de estar por encima a por debajo de la línea A.
19. `calcularCruceLinea` detecta el cambio de signo.
20. `obtenerTiempoCruce` interpola: `t_A = t_anterior + (t_actual - t_anterior) * (lineaA - y_anterior)/(y_actual - y_anterior)`.
21. Se guarda `vehiculo.tiemposCruce.A = t_A`.
22. En la consola: `Vehículo 1: cruce de línea A, Tiempo: 0.487 s`.

### Frame ~25 (t ≈ 0.83 s) — cruce de línea B
23. Mismo proceso para la línea B → `tiemposCruce.B = t_B`.
24. `actualizarVelocidadVehiculo` calcula:
    - `dt = |t_B - t_A|` (ej. 0.343 s).
    - Validación: 0.08 ≤ dt ≤ 15 ✓.
    - `v = (12 m / 0.343 s) * 3.6 = 126.5 km/h`.
    - Clamp: 1 ≤ 126.5 ≤ 220 ✓.
25. Se guarda `vehiculo.velocidades = {velocidad: 126.5, metodo: "radar"}`.
26. La tabla de vehículos muestra `#1 · 126.5 km/h`.

### Durante el trayecto (antes de cruzar B) — velocidad continua
27. Mientras `tiemposCruce.B === null`, `calcularVelocidadContinua` usa el historial de bbox (≥5 muestras):
    - `h1 = altura primer frame`, `h2 = altura último frame`.
    - Requiere `h2 > h1` (vehículo acercándose).
    - `Δdist = 800 * (1/h1 - 1/h2)`.
    - `v = (Δdist / Δt) * 3.6`.
28. Se muestra con `metodo: "continuo"` hasta que el radar prevalece.

### Detección de placa (zona cercana)
29. Cuando el vehículo está en zona cercana (línea B superada) y tiene velocidad, se recorta su bbox.
30. `detectarMatriculas(recorte, 0.15)` ejecuta `best_deteccion.onnx`.
31. Si hay placa, se recorta y se pasa a OCR (`cct_s_v2_global.onnx` o Tesseract).
32. Se valida formato de placa mexicana; se vota entre varios frames por nitidez (varianza Laplaciano).

### Verificación de infracción
33. `verificarInfraccion(126.5, 60)`:
    - `limiteConTolerancia = 65`.
    - `126.5 > 65` → infracción.
    - `exceso = 126.5 - 60 = 66.5 km/h`.
34. Si el vehículo tiene ≥ 5 hits y placa leída, se registra en `tablaMultas` con imagen, matrícula, velocidad, límite, exceso y fecha/hora.

### Pérdida del vehículo
35. Si el vehículo sale del cuadro y no se detecta en 1200 ms, `actualizarSeguimiento` lo elimina de `vehiculosActivos` (TTL).
36. Sus datos ya registrados (velocidad, multa) permanecen en las tablas.

### Reinicio del video
37. Al reiniciar, `reiniciarSeguimiento()` limpia `vehiculosActivos` y `siguienteID = 1`, pero **no** borra las tablas de infracciones (historial conservado).
