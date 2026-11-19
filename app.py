import cv2
import numpy as np
from ultralytics import solutions
import streamlit as st
from PIL import Image

def ejecutar_sistema_yolo():
    st.title("🚗 Sistema de Detección de Exceso de Velocidad - YOLO")
    st.write("Aplicación móvil basada en las herramientas de tu libreta de Redes Neuronales.")

    # Parámetros configurables desde la interfaz
    limite_velocidad = st.slider("Límite de velocidad (km/h)", 30, 120, 60)
    
    # Inicializar el estimador de velocidad oficial de YOLO
    @st.cache_resource
    def cargar_modelo():
        return solutions.SpeedEstimator(
            model="yolov8n.pt",
            fps=30.0,
            meter_per_pixel=0.05,
            show=False
        )

    speed_estimator = cargar_modelo()

    modo = st.radio("Selecciona la fuente de entrada:", ["Cámara en vivo (Celular)", "Subir video de tráfico"])

    if modo == "Subir video de tráfico":
        video_file = st.file_uploader("Sube un archivo de video (.mp4)", type=["mp4", "avi"])
        if video_file is not None:
            with open("temp_video.mp4", "wb") as f:
                f.write(video_file.read())
            cap = cv2.VideoCapture("temp_video.mp4")
            
            st_frame = st.empty()
            ticket_container = st.container()
            vehiculos_multados = set()

            while cap.isOpened():
                success, im0 = cap.read()
                if not success:
                    break

                results = speed_estimator(im0)

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

                                if tid not in vehiculos_multados:
                                    vehiculos_multados.add(tid)
                                    with ticket_container:
                                        st.error(f"🚨 ¡MULTA GENERADA! ID: {tid} - Velocidad: {velocidad_actual:.2f} km/h")
                                        img_rgb = cv2.cvtColor(recorte_placa, cv2.COLOR_BGR2RGB)
                                        st.image(img_rgb, caption=f"Evidencia Placa ID {tid}", width=200)

                im0_rgb = cv2.cvtColor(im0, cv2.COLOR_BGR2RGB)
                st_frame.image(im0_rgb, channels="RGB", use_column_width=True)
            cap.release()

    else:
        st.info("📸 Usa la cámara de tu celular para capturar una foto o secuencia de prueba de la vialidad:")
        
        # Componente oficial de Streamlit para activar la cámara del teléfono (frontal o trasera)
        foto_capturada = st.camera_input("Tomar foto con la cámara del celular")

        if foto_capturada is not None:
            # Convertir la imagen capturada por el celular a formato OpenCV
            image_bytes = foto_capturada.getvalue()
            image_pil = Image.open(io.BytesIO(image_bytes)) if 'io' in globals() else Image.open(foto_capturada)
            im0 = cv2.cvtColor(np.array(image_pil), cv2.COLOR_RGB2BGR)

            st.write("Procesando imagen con YOLO...")
            results = speed_estimator(im0)

            # Mostrar la imagen analizada con las detecciones de YOLO
            im0_rgb = cv2.cvtColor(im0, cv2.COLOR_BGR2RGB)
            st.image(im0_rgb, caption="Imagen analizada por YOLO", use_column_width=True)

            # Verificar si se detectaron vehículos y velocidades en la captura
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
                            st.error(f"🚨 ¡EXCESO DE VELOCIDAD DETECTADO! Velocidad: {velocidad_actual:.2f} km/h")
                            img_rgb = cv2.cvtColor(recorte_placa, cv2.COLOR_BGR2RGB)
                            st.image(img_rgb, caption=f"Evidencia Placa ID {tid}", width=200)
            else:
                st.success("Fotografía analizada. No se detectaron vehículos superando el límite en este fotograma.")

if __name__ == "__main__":
    import io
    ejecutar_sistema_yolo()