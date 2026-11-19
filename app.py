import cv2
import numpy as np
from ultralytics import solutions
import streamlit as st
from PIL import Image

def ejecutar_sistema_yolo():
    st.title("🚗 Sistema de Detección de Exceso de Velocidad - YOLO")
    st.write("Aplicación móvil basada en las herramientas de tu libreta de Redes Neuronales.")

    # Parámetros configurables desde la interfaz de la app
    limite_velocidad = st.slider("Límite de velocidad (km/h)", 30, 120, 60)
    
    # Inicializar el estimador de velocidad oficial de YOLO
    # (Utiliza yolov8n.pt como base estándar de detección y tracking)
    @st.cache_resource
    def cargar_modelo():
        return solutions.SpeedEstimator(
            model="yolov8n.pt",
            fps=30.0,
            meter_per_pixel=0.05,
            show=False
        )

    speed_estimator = cargar_modelo()

    # Opción para usar la cámara del celular o subir un video de prueba
    modo = st.radio("Selecciona la fuente de entrada:", ["Cámara en vivo (Celular)", "Subir video de tráfico"])

    if modo == "Subir video de tráfico":
        video_file = st.file_uploader("Sube un archivo de video (.mp4)", type=["mp4", "avi"])
        if video_file is not None:
            with open("temp_video.mp4", "wb") as f:
                f.write(video_file.read())
            cap = cv2.VideoCapture("temp_video.mp4")
        else:
            cap = None
    else:
        # Usando la API de captura de video web para dispositivos móviles
        cap = cv2.VideoCapture(0) # 0 o índice de la cámara trasera en dispositivos móviles

    if cap and cap.isOpened():
        st.warning("Procesando flujo de video... Revisa las alertas de multas abajo.")
        st_frame = st.empty()
        ticket_container = st.container()

        vehiculos_multados = set()

        while cap.isOpened():
            success, im0 = cap.read()
            if not success:
                break

            # Procesar el fotograma con el estimador de velocidad de YOLO
            results = speed_estimator(im0)

            # Verificar velocidades detectadas por ID de objeto rastreado
            if hasattr(speed_estimator, 'spd') and speed_estimator.spd:
                boxes = getattr(speed_estimator, 'boxes', [])
                track_ids = getattr(speed_estimator, 'track_ids', [])

                for box, tid in zip(boxes, track_ids):
                    velocidad_actual = speed_estimator.spd.get(tid, 0.0)

                    # Evaluar si el auto va a exceso de velocidad
                    if velocidad_actual > limite_velocidad:
                        x1, y1, x2, y2 = map(int, box)
                        h_img, w_img, _ = im0.shape
                        x1, y1 = max(0, x1), max(0, y1)
                        x2, y2 = min(w_img, x2), min(h_img, y2)

                        if x2 > x1 and y2 > y1:
                            recorte_placa = im0[y1:y2, x1:x2]

                            # Generar ticket único por vehículo en infracción
                            if tid not in vehiculos_multados:
                                vehiculos_multados.add(tid)
                                
                                with ticket_container:
                                    st.error("🚨 ¡TICKET GENERADO POR EXCESO DE VELOCIDAD! 🚨")
                                    col1, col2 = st.columns(2)
                                    with col1:
                                        st.write(f"**ID del Vehículo:** {tid}")
                                        st.write(f"**Velocidad Registrada:** {velocidad_actual:.2f} km/h")
                                        st.write(f"**Límite Permitido:** {limite_velocidad} km/h")
                                    with col2:
                                        # Mostrar la evidencia visual de la placa recortada
                                        img_rgb = cv2.cvtColor(recorte_placa, cv2.COLOR_BGR2RGB)
                                        st.image(img_rgb, caption=f"Placa / Vehículo ID {tid}", width=200)

            # Mostrar el video analizado en la interfaz de Streamlit
            im0_rgb = cv2.cvtColor(im0, cv2.COLOR_BGR2RGB)
            st_frame.image(im0_rgb, channels="RGB", use_column_width=True)

        cap.release()

if __name__ == "__main__":
    ejecutar_sistema_yolo()