import streamlit as st
from streamlit_webrtc import webrtc_streamer, RTCConfiguration
import av
import cv2
from ultralytics import solutions
import numpy as np

st.set_page_config(page_title="YOLO Speed Detector", page_icon="🚗")

st.title("🚗 Detección de Exceso de Velocidad en Tiempo Real")
st.write("Apunta con la cámara trasera de tu celular hacia la calle para el monitoreo en vivo.")

# Parámetro de velocidad ajustable
limite_velocidad = st.slider("Límite de velocidad (km/h)", 30, 120, 60)

# Cargar el modelo YOLO con caché para optimizar recursos en la nube
@st.cache_resource
def cargar_modelo():
    return solutions.SpeedEstimator(
        model="yolov8n.pt",
        fps=30.0,
        meter_per_pixel=0.05,
        show=False
    )

speed_estimator = cargar_modelo()

# Clase procesadora de video fotograma a fotograma en tiempo real
class YOLOVideoProcessor:
    def recv(self, frame: av.VideoFrame) -> av.VideoFrame:
        # Convertir el frame de WebRTC a formato OpenCV (Array de NumPy)
        img = frame.to_ndarray(format="bgr24")
        
        # Ejecutar el estimador de velocidad de YOLO sobre el fotograma actual
        results = speed_estimator(img)
        
        # Opcional: Si deseas verificar en consola o aplicar lógica adicional de multas
        if hasattr(speed_estimator, 'spd') and speed_estimator.spd:
            for tid, speed in speed_estimator.spd.items():
                if speed > limite_velocidad:
                    # Aquí puedes manejar la lógica visual en el video si excede el límite
                    pass

        # Retornar el frame procesado (con las cajas y velocidades dibujadas por YOLO) al navegador
        return av.VideoFrame.from_ndarray(img, format="bgr24")

# Configuración de WebRTC para forzar el uso de la cámara trasera del celular (environment)
RTC_CONFIGURATION = RTCConfiguration(
    {"iceServers": [{"urls": ["stun:stun.l.google.com:19302"]}]}
)

# Inicializar el componente de transmisión de video en vivo
webrtc_streamer(
    key="detaccion-velocidad",
    video_processor_factory=YOLOVideoProcessor,
    rtc_configuration=RTC_CONFIGURATION,
    media_stream_constraints={"video": {"facingMode": "environment"}, "audio": False},
    async_processing=True,
)