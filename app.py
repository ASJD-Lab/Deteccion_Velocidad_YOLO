import streamlit as st
import cv2
import numpy as np
from ultralytics import solutions
from PIL import Image
import tempfile

st.set_page_config(page_title="Detección de Velocidad YOLO", page_icon="🚗", layout="centered")

st.title("🚗 Sistema de Detección de Exceso de Velocidad")
st.write("Sube un video grabado con la cámara de tu celular para analizar el tráfico y generar multas automáticas.")

# Control deslizante para el límite de velocidad
limite_velocidad = st.slider("Límite de velocidad permitido (km/h)", 30, 120, 60)

# Cargar el modelo YOLO con caché para optimizar la ejecución en la nube
@st.cache_resource
def cargar_modelo():
    return solutions.SpeedEstimator(
        model="yolov8n.pt",
        fps=30.0,
        meter_per_pixel=0.05,
        show=False
    )

speed_estimator = cargar_modelo()

# Componente para subir el video desde el celular
video_file = st.file_uploader("Sube tu archivo de video de tráfico (.mp4)", type=["mp4", "avi", "mov"])

if video_file is not None:
    # Guardar temporalmente el video subido para que OpenCV pueda leerlo
    tfile = tempfile.NamedTemporaryFile(delete=False)
    tfile.write(video_file.read())
    
    cap = cv2.VideoCapture(tfile.name)
    
    st.warning("🔄 Procesando video con YOLO... Por favor espera a que finalice el análisis.")
    
    st_frame = st.empty()
    ticket_container = st.container()
    vehiculos_multados = set()

    while cap.isOpened():
        success, im0 = cap.read()
        if not success:
            break

        # Ejecutar el estimador de velocidad sobre el fotograma actual
        results = speed_estimator(im0)

        # Verificar si se detectaron vehículos con exceso de velocidad
        if hasattr(speed_estimator, 'spd') and speed_estimator.spd:
            boxes = getattr(speed_estimator, 'boxes', [])
            track_ids = getattr(speed_estimator, 'track_ids', [])

            for box, tid in zip(boxes, track_ids):
                velocidad_actual = speed_estimator.spd.get(tid, 0.0)

                if velocidad_actual > limite_velocidad:
                    x1, y1, x2, y2 = map(int, box)
                    h_img, w_img, _ = im0.shape
                    x1, y1 = max(0, x1), max(0, y1)
                    x2, y2 = min(w_img, x2), min(h_img, y2)

                    if x2 > x1 and y2 > y1:
                        recorte_placa = im0[y1:y2, x1:x2]

                        # Evitar spam duplicando el ticket para el mismo vehículo
                        if tid not in vehiculos_multados:
                            vehiculos_multados.add(tid)
                            with ticket_container:
                                st.error(f"🚨 ¡TICKET GENERADO! Vehículo ID: {tid} | Velocidad: {velocidad_actual:.2f} km/h")
                                img_rgb = cv2.cvtColor(recorte_placa, cv2.COLOR_BGR2RGB)
                                st.image(img_rgb, caption=f"Evidencia de Placa - ID {tid}", width=200)

        # Mostrar el fotograma procesado con las cajas de YOLO en la app
        im0_rgb = cv2.cvtColor(im0, cv2.COLOR_BGR2RGB)
        st_frame.image(im0_rgb, channels="RGB", use_column_width=True)

    cap.release()
    st.success("✅ Análisis de video completado con éxito.")