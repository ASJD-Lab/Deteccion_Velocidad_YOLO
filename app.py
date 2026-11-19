import gradio as gr
import cv2
import numpy as np
from ultralytics import solutions

# Inicializar el estimador de velocidad oficial de YOLO
speed_estimator = solutions.SpeedEstimator(
    model="yolov8n.pt",
    fps=30.0,
    meter_per_pixel=0.05,
    show=False
)

def procesar_frame(frame):
    if frame is None:
        return None
    
    # Gradio captura en RGB, OpenCV trabaja con BGR
    img = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
    
    # Ejecutar el análisis de velocidad de YOLO
    results = speed_estimator(img)
    
    # Devolver la imagen procesada (con cajas y velocidades) a formato RGB para Gradio
    img_result_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    return img_result_rgb

# Construir la interfaz web interactiva optimizada para móvil
demo = gr.Interface(
    fn=procesar_frame,
    inputs=gr.Image(sources=["webcam"], streaming=True, type="numpy"),
    outputs=gr.Image(type="numpy"),
    title="🚗 Detección de Exceso de Velocidad en Tiempo Real",
    description="Apunta con la cámara trasera de tu celular hacia la calle para el monitoreo en vivo con YOLO.",
    live=True,
    concurrency_limit=1
)

if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860)