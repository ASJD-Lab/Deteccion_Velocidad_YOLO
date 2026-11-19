import streamlit as st
import cv2
import numpy as np
from ultralytics import solutions
from PIL import Image
import tempfile

# 1. Configuración de pantalla ancha y tema oscuro profesional
st.set_page_config(
    page_title="Radar Vial - Detección de Placas y Velocidad",
    page_icon="📡",
    layout="wide"
)

# Estilos CSS personalizados para lograr la estética de tarjetas y bordes sutiles
st.markdown("""
    <style>
    .stApp {
        background-color: #0b0e14;
        color: #e2e8f0;
    }
    .status-badge {
        background-color: #0f291e;
        color: #34d399;
        border: 1px solid #059669;
        padding: 6px 14px;
        border-radius: 20px;
        font-size: 0.85rem;
        font-weight: 600;
        text-align: center;
        display: inline-block;
        float: right;
    }
    .metric-card {
        background-color: #131722;
        border: 1px solid #232a3b;
        border-radius: 10px;
        padding: 15px;
        text-align: left;
    }
    .metric-label {
        color: #94a3b8;
        font-size: 0.75rem;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
    }
    .metric-value {
        color: #f8fafc;
        font-size: 1.8rem;
        font-weight: 700;
        margin-top: 4px;
    }
    </style>
""", unsafe_allow_html=True)

# 2. Encabezado superior (Título a la izquierda, Badge de estado a la derecha)
col_header_izq, col_header_der = st.columns([4, 1])
with col_header_izq:
    st.markdown("### 📡 Radar Vial")
    st.caption("Detección de placas y exceso de velocidad con YOLOv8")
with col_header_der:
    st.markdown('<div class="status-badge">● YOLOv8 listo</div>', unsafe_allow_html=True)

st.divider()

# Cargar el modelo YOLO con caché
@st.cache_resource
def cargar_modelo():
    return solutions.SpeedEstimator(
        model="yolov8n.pt",
        fps=30.0,
        meter_per_pixel=0.05,
        show=False
    )

speed_estimator = cargar_modelo()

# 3. Estructura principal de dos columnas (Área de trabajo a la izquierda, Panel de datos a la derecha)
col_principal, col_panel = st.columns([2.2, 1], gap="large")

with col_principal:
    # Barra de controles de flujo (simulando los 3 pasos de la interfaz de referencia)
    st.markdown("#### Detecta placas en el tráfico")
    st.caption("1. Elige la fuente • 2. Activa la detección • 3. Configura el modo infracciones")
    
    ctrl1, ctrl2, ctrl3 = st.columns(3)
    with ctrl1:
        fuente = st.selectbox("Fuente de entrada", ["Subir video", "Cámara (Captura)"], label_visibility="collapsed")
    with ctrl2:
        activar_deteccion = st.toggle("Activar detección", value=True)
    with ctrl3:
        modo_infracciones = st.toggle("Modo infracciones", value=True)

    # Ajustes del radar desplegables (igual que "Ajustes del radar" en la esquina inferior)
    with st.expander("⚙️ Ajustes del radar (Límite de velocidad y calibración)"):
        limite_velocidad = st.slider("Límite de velocidad permitido (km/h)", 20, 140, 60)

    # Contenedor donde se mostrará el video/imagen o la zona de carga
    visor_principal = st.container(border=True)

with col_panel:
    # Tarjetas superiores de métricas en vivo
    m1, m2, m3 = st.columns(3)
    slot_vehiculos = m1.empty()
    slot_placas = m2.empty()
    slot_multas = m3.empty()

    def actualizar_tarjetas(v, p, m):
        slot_vehiculos.markdown(f'<div class="metric-card"><div class="metric-label">VEHÍCULOS</div><div class="metric-value">{v}</div></div>', unsafe_allow_html=True)
        slot_placas.markdown(f'<div class="metric-card"><div class="metric-label">PLACAS LEÍDAS</div><div class="metric-value">{p}</div></div>', unsafe_allow_html=True)
        slot_multas.markdown(f'<div class="metric-card"><div class="metric-label">MULTAS</div><div class="metric-value" style="color:#f87171;">{m}</div></div>', unsafe_allow_html=True)

    # Inicializar tarjetas en 0
    actualizar_tarjetas(0, 0, 0)
    st.write("")

    # Pestañas inferiores para historial en vivo
    tab_vehiculos, tab_leidas, tab_multas = st.tabs(["Vehículos", "Leídas", "Multas"])
    with tab_vehiculos:
        lista_vehiculos = st.container(height=380)
        lista_vehiculos.caption("Los vehículos detectados en el tráfico se irán mostrando aquí.")
    with tab_leidas:
        lista_leidas = st.container(height=380)
        lista_leidas.caption("Recortes de placas/vehículos capturados.")
    with tab_multas:
        lista_multas = st.container(height=380)
        lista_multas.caption("Registro de infracciones por exceso de velocidad.")

# 4. Lógica de procesamiento según la fuente elegida
with visor_principal:
    if fuente == "Subir video":
        video_file = st.file_uploader("Sube un video de tráfico (.mp4, .avi, .mov)", type=["mp4", "avi", "mov"])
        
        if video_file is not None:
            tfile = tempfile.NamedTemporaryFile(delete=False)
            tfile.write(video_file.read())
            cap = cv2.VideoCapture(tfile.name)
            
            st_frame = st.empty()
            ids_vistos = set()
            ids_multados = set()
            total_placas = 0

            while cap.isOpened():
                success, im0 = cap.read()
                if not success:
                    break

                if activar_deteccion:
                    results = speed_estimator(im0)

                    if hasattr(speed_estimator, 'spd') and speed_estimator.spd:
                        boxes = getattr(speed_estimator, 'boxes', [])
                        track_ids = getattr(speed_estimator, 'track_ids', [])

                        for box, tid in zip(boxes, track_ids):
                            velocidad = speed_estimator.spd.get(tid, 0.0)
                            
                            # Registrar vehículo único
                            if tid not in ids_vistos:
                                ids_vistos.add(tid)
                                with lista_vehiculos:
                                    st.info(f"🚘 Vehículo ID #{tid} detectado • {velocidad:.1f} km/h")

                            # Recortar evidencia
                            x1, y1, x2, y2 = map(int, box)
                            h_img, w_img, _ = im0.shape
                            x1, y1 = max(0, x1), max(0, y1)
                            x2, y2 = min(w_img, x2), min(h_img, y2)

                            if x2 > x1 and y2 > y1:
                                recorte_rgb = cv2.cvtColor(im0[y1:y2, x1:x2], cv2.COLOR_BGR2RGB)
                                
                                # Si el modo infracciones está activo y supera el límite
                                if modo_infracciones and velocidad > limite_velocidad and tid not in ids_multados:
                                    ids_multados.add(tid)
                                    total_placas += 1
                                    
                                    with lista_leidas:
                                        st.image(recorte_rgb, caption=f"ID #{tid}", width=140)
                                    with lista_multas:
                                        st.error(f"🚨 Multa ID #{tid}: {velocidad:.1f} km/h (Límite: {limite_velocidad})")
                                        st.image(recorte_rgb, width=160)

                            actualizar_tarjetas(len(ids_vistos), total_placas, len(ids_multados))

                im0_rgb = cv2.cvtColor(im0, cv2.COLOR_BGR2RGB)
                st_frame.image(im0_rgb, channels="RGB", use_container_width=True)

            cap.release()
            st.success("✅ Procesamiento finalizado.")

    else:
        foto = st.camera_input("Apunta la cámara hacia la vialidad y captura un fotograma")
        if foto is not None:
            image_pil = Image.open(foto)
            im0 = cv2.cvtColor(np.array(image_pil), cv2.COLOR_RGB2BGR)
            
            if activar_deteccion:
                results = speed_estimator(im0)
                if hasattr(speed_estimator, 'spd') and speed_estimator.spd:
                    boxes = getattr(speed_estimator, 'boxes', [])
                    track_ids = getattr(speed_estimator, 'track_ids', [])
                    for box, tid in zip(boxes, track_ids):
                        velocidad = speed_estimator.spd.get(tid, 0.0)
                        actualizar_tarjetas(len(track_ids), 1, 1 if velocidad > limite_velocidad else 0)
                        with lista_vehiculos:
                            st.info(f"🚘 Vehículo ID #{tid} • {velocidad:.1f} km/h")

            st.image(cv2.cvtColor(im0, cv2.COLOR_BGR2RGB), use_container_width=True)