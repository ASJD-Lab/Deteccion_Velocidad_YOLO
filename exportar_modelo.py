# Exporta el modelo de placas (best.pt) a ONNX optimizado para móvil.
# Requiere: pip install ultralytics
# Ejecutar: python exportar_modelo.py

from ultralytics import YOLO

modelo = YOLO("modelos/best.pt")

# Exportar con tamaño reducido y FP16 para carga rápida en móviles.
modelo.export(
    format="onnx",
    imgsz=416,
    half=True,
    simplify=True,
    opset=18,
)

print("Modelo exportado. Revisa modelos/best.onnx y renombra a best_deteccion.onnx si conviene.")
