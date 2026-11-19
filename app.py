import streamlit as st
import cv2
import numpy as np
from ultralytics import solutions
from PIL import Image
import tempfile

# Configuración de la página para que coincida con el estilo oscuro y moderno
st.set_page_config(
    page_title="Radar Vial - Detección de Placas",
    page_icon="🚗",
    layout="wide"
)

# Estilo visual personalizado para imitar la interfaz oscura de la captura
st.markdown("""
    <style>
    .main { background-color: #0e1117; color: white; }
    .stMetric { background-color: #1a1c24; padding: 15px; border-radius: 10px; border: 1px solid #30333d; }
    </style>
""", unsafe_allow_html=True)

# Encabezado principal
st.markdown("### 🛡️ Radar Vial")
st.caption("Detección de placas y exceso de velocidad con YOLO")

# Estado de la IA en la esquina superior (simulando el badge verde de la captura)
col_top1, col_top2 = st.columns([6, 1])
with col_top2:
    st.markdown("🟢 **YOLOv8 listo**")

# Layout principal en dos columnas (igual que la app de tus compañeros)
col_izq, col_der = st.columns([2, 1])

with col_izq:
    st.markdown("#### Detecta placas en el tráfico")
    st.write("Elige un video o usa la cámara. Después activa la detección y, si quieres, el modo infracciones.")
    
    # Selector de límite de velocidad
    limite_velocidad = st.slider("Límite de velocidad permitido (km/h)", 30, 120, 60)
    
    # Opciones de entrada
    fuente = st.radio("Selecciona el método de entrada:", ["Subir video de tráfico", "Tomar foto con la cámara del celular"], horizontal=True)

with col_der:
    st.markdown("#### Métricas en vivo")
    metric_vehiculos = st.empty()
    metric_placas = st.empty()
    metric_multas = st.empty()
    
    # Inicializar contadores en la barra lateral
    v_count, p_count, m_count = 0, 0, 0
    metric_vehiculos.metric("VEHÍCULOS", v_count)
    metric_placas.metric("PLACAS LEÍDAS", p_count)
    metric_multas.metric("MULTAS", m_count)

# Cargar modelo YOLO optimizado
@st.cache_resource
def cargar_modelo():
    return solutions.SpeedEstimator(
        model="yolov8n.pt",
        fps=30.0,
        meter_per_pixel=0.05,
        show=False
    )

speed_estimator = cargar_modelo()

# Contenedor central para mostrar resultados e imágenes
area_visualizacion = st.empty()
contenedor_tickets = st.container()

if fuente == "Subir video de tráfico":
    video_file = st.file_uploader("Sube tu archivo de video (.mp4)", type=["mp4", "avi", "mov"])
    
    if video_file is not None:
        tfile = tempfile.NamedTemporaryFile(delete=False)
        tfile.write(video_file.read())
        cap = cv2.VideoCapture(tfile.name)
        
        vehiculos_multados = set()
        
        while cap.isOpened():
            success, im0 = cap.read()
            if not success:
                break
            
            v_count += 1
            metric_vehiculos.metric("VEHÍCULOS", v_count)
            
            results = speed_estimator(im0)
            
            if hasattr(speed_estimator, 'spd') and speed_estimator.spd:
                boxes = getattr(speed_estimator, 'boxes', [])
                track_ids = getattr(speed_estimator, 'track_ids', [])
                
                for box, tid in zip(boxes, track_ids):
                    velocidad = speed_estimator.spd.get(tid, 0.0)
                    
                    if velocidad > limite_velocidad:
                        x1, y1, x2, y2 = map(int, box)
                        h_img, w_img, _ = im0.shape
                        x1, y1 = max(0, x1), max(0, y1)
                        x2, y2 = min(w_img, x2), min(h_img, y2)
                        
                        if x2 > x1 and y2 > y1:
                            recorte = im0[y1:y2, x1:x2]
                            if tid not in vehiculos_multados:
                                vehiculos_multados.add(tid)
                                p_count += 1
                                m_count += 1
                                metric_placas.metric("PLACAS LEÍDAS", p_count)
                                metric_multas.metric("MULTAS", m_count)
                                
                                with contenedor_tickets:
                                    st.error(f"🚨 Exceso detectado! ID: {tid} - {velocidad:.1f} km/h")
                                    st.image(cv2.cvtColor(recorte, cv2.COLOR_BGR2RGB), width=180, caption=f"Placa ID {tid}")

            im0_rgb = cv2.cvtColor(im0, cv2.COLOR_BGR2RGB)
            area_visualizacion.image(im0_rgb, channels="RGB", use_column_width=True)
        cap.release()

else:
    # Opción de cámara usando el componente nativo de foto móvil
    foto = st.camera_input("Capturar tráfico con la cámara del celular")
    
    if foto is not None:
        image_bytes = foto.getvalue()
        image_pil = Image.open(foto)
        im0 = cv2.cvtColor(np.array(image_pil), cv2.COLOR_RGB2BGR)
        
        results = speed_estimator(im0)
        area_visualizacion.image(cv2.cvtColor(im0, cv2.COLOR_BGR2RGB), caption="Fotograma analizado", use_column_width=True)
        
        if hasattr(speed_estimator, 'spd') and speed_estimator.spd:
            boxes = getattr(speed_estimator, 'boxes', [])
            track_ids = getattr(speed_estimator, 'track_ids', [])
            
            for box, tid in zip(boxes, track_ids):
                velocidad = speed_estimator.spd.get(tid, 0.0)
                if velocidad > limite_velocidad:
                    x1, y1, x2, y2 = map(int, box)
                    h_img, w_img, _ = im0.shape
                    x1, y1 = max(0, x1), max(0, y1)
                    x2, y2 = min(w_img, x2), min(h_img, y2)
                    if x2 > x1 and y2 > y1:
                        recorte = im0[y1:y2, x1:x2]
                        st.error(f"🚨 Infracción registrada: {velocidad:.1f} km/h")
                        st.image(cv2.cvtColor(recorte, cv2.COLOR_BGR2RGB), width=180, caption="Placa Evidencia")
        else:
            st.success("Fotograma procesado correctamente. Sin infracciones en esta toma.")