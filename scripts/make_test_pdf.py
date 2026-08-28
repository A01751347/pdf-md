#!/usr/bin/env python3
"""Genera un PDF de prueba con títulos, listas, tablas, código, enlaces,
notas al pie y una página a dos columnas. Sin dependencias externas."""
import sys, zlib

W, H = 595.0, 842.0
FONTS = {
    "F1": "Helvetica", "F2": "Helvetica-Bold", "F3": "Helvetica-Oblique",
    "F4": "Courier", "F5": "Courier-Bold", "F6": "Times-Roman",
}
WIDTH_FACTOR = {"F1": 0.50, "F2": 0.54, "F3": 0.50, "F4": 0.60, "F5": 0.60, "F6": 0.47}


def esc(text):
    out = text.encode("cp1252", "replace")
    return out.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


class Page:
    def __init__(self):
        self.ops = []
        self.annots = []

    def text(self, x, y_top, s, font="F1", size=11):
        """y_top se mide desde el borde superior."""
        y = H - y_top
        self.ops.append(b"BT /%s %g Tf 1 0 0 1 %g %g Tm (%s) Tj ET" % (font.encode(), size, x, y, esc(s)))
        return x + len(s) * size * WIDTH_FACTOR[font]

    def runs(self, x, y_top, parts, size=11):
        for s, font in parts:
            x = self.text(x, y_top, s, font, size)
        return x

    def line(self, x1, y1_top, x2, y2_top, width=0.6):
        self.ops.append(b"%g w %g %g m %g %g l S" % (width, x1, H - y1_top, x2, H - y2_top))

    def rect(self, x, y_top, w, h):
        self.ops.append(b"%g %g %g %g re f" % (x, H - y_top - h, w, h))

    def link(self, x, y_top, w, h, url):
        self.annots.append((x, H - y_top - h, x + w, H - y_top, url))

    def stream(self):
        return b"\n".join(self.ops)


def paragraph(page, x, y, lines, size=11, leading=14, font="F1"):
    for i, ln in enumerate(lines):
        page.text(x, y + i * leading, ln, font, size)
    return y + len(lines) * leading


def build():
    pages = []

    # ---------------- Página 1 ----------------
    p = Page()
    p.text(60, 40, "Informe tecnico 2026", "F1", 8)
    p.text(60, 82, "Guía técnica de conversión", "F2", 24)
    p.text(60, 112, "Evaluación comparativa de motores de extracción", "F3", 11)

    p.text(60, 158, "1. Introducción", "F2", 15)
    paragraph(p, 60, 184, [
        "Este documento evalúa la fidelidad con la que distintos motores transfor-",
        "man documentos PDF en Markdown estructurado. El análisis cubre la deteccion",
        "de jerarquías, la reconstrucción de tablas sin bordes y el tratamiento de",
        "textos a varias columnas.",
    ])
    p.runs(60, 250, [("Los resultados muestran que la ", "F1"), ("precisión tipográfica", "F2"),
                     (" depende del ", "F1"), ("análisis geométrico", "F3"), (".", "F1")])

    p.text(60, 286, "1.1 Objetivos del estudio", "F2", 12.5)
    for i, item in enumerate([
        "Medir la exactitud en la deteccion de titulos.",
        "Comparar la reconstruccion de tablas con y sin bordes visibles, incluyendo",
        "Evaluar el coste computacional de cada motor.",
    ]):
        y = 312 + i * 17
        if i == 1:
            p.text(70, y, "•", "F1", 11)
            p.text(85, y, item, "F1", 11)
            p.text(85, y + 14, "las que dependen unicamente del blanco tipografico.", "F1", 11)
        else:
            p.text(70, y if i == 0 else y + 14, "•", "F1", 11)
            p.text(85, y if i == 0 else y + 14, item, "F1", 11)

    p.text(60, 400, "2. Resultados", "F2", 15)
    p.text(60, 426, "Modelo", "F2", 10)
    p.text(240, 426, "Precisión", "F2", 10)
    p.text(400, 426, "Tiempo (s)", "F2", 10)
    p.line(60, 432, 500, 432, 0.8)
    filas = [("Motor clásico", "72,4 %", "1,80"), ("Motor híbrido", "88,1 %", "2,35"), ("Este trabajo", "96,7 %", "1,42")]
    for i, (a, b, c) in enumerate(filas):
        y = 448 + i * 18
        p.text(60, y, a, "F1", 10)
        p.text(240, y, b, "F1", 10)
        p.text(400, y, c, "F1", 10)
    p.line(60, 508, 500, 508, 0.5)
    p.text(60, 526, "Tabla 1. Comparativa de precisión y tiempo por documento.", "F3", 9)

    p.text(60, 566, "3. Implementación", "F2", 15)
    code = [
        ("const doc = await cargarPdf(archivo)", 0),
        ("for (const pagina of doc.paginas) {", 0),
        ("const lineas = agrupar(pagina.spans)", 1),
        ("emitir(clasificar(lineas))", 1),
        ("}", 0),
    ]
    for i, (ln, indent) in enumerate(code):
        p.text(70 + indent * 4 * 9.5 * 0.6, 592 + i * 13, ln, "F4", 9.5)

    end = p.text(60, 690, "Documentación completa en ", "F1", 11)
    p.text(end, 690, "https://ejemplo.org/docs", "F1", 11)
    p.link(end, 690 - 9, 130, 13, "https://ejemplo.org/docs")

    p.text(280, 812, "1", "F1", 9)
    pages.append(p)

    # ---------------- Página 2: dos columnas ----------------
    p = Page()
    p.text(60, 40, "Informe tecnico 2026", "F1", 8)
    p.text(60, 82, "4. Análisis comparativo", "F2", 15)

    izq = [
        "El primer bloque de pruebas se centró en",
        "documentos académicos maquetados a dos",
        "columnas, donde el orden de lectura suele",
        "romperse al extraer el texto de forma inge-",
        "nua. Los motores que agrupan por línea base",
        "sin analizar las calles verticales mezclan el",
        "contenido de ambas columnas.",
    ]
    der = [
        "El segundo bloque abordó documentos con",
        "tablas sin bordes. En estos casos la única",
        "señal disponible es la separación horizontal",
        "constante entre celdas a lo largo de varias",
        "filas consecutivas, que puede detectarse con",
        "un perfil de ocupación por columnas.",
    ]
    paragraph(p, 60, 120, izq, 10, 13.5)
    paragraph(p, 315, 120, der, 10, 13.5)
    p.text(60, 232, "La proyección de tinta permite localizar", "F1", 10)
    p.text(60, 245.5, "la calle central sin conocer la plantilla.", "F1", 10)
    p.text(202, 226, "1", "F1", 6.5)

    p.text(315, 232, "Los resultados aparecen en la tabla 2 y", "F1", 10)
    p.text(315, 245.5, "confirman la hipótesis inicial del trabajo.", "F1", 10)

    p.text(60, 300, "4.1 Cita destacada", "F2", 12.5)
    paragraph(p, 110, 326, [
        "La estructura de un documento no está en sus bytes,",
        "sino en la distancia entre sus letras.",
    ], 10, 14, "F3")

    p.line(60, 760, 200, 760, 0.5)
    p.text(60, 776, "1 Véase el anexo metodológico para el detalle del procedimiento.", "F1", 8)
    p.text(280, 812, "2", "F1", 9)
    pages.append(p)

    # ---------------- Página 3: listas ----------------
    p = Page()
    p.text(60, 40, "Informe tecnico 2026", "F1", 8)
    p.text(60, 82, "5. Conclusiones", "F2", 15)
    pasos = [
        (60, "1.", "Extraer los fragmentos con su geometría y tipografía."),
        (60, "2.", "Reconstruir las líneas por proximidad de línea base."),
        (82, "a)", "Agrupar en columnas mediante el perfil de blancos."),
        (82, "b)", "Ordenar las bandas de lectura de arriba abajo."),
        (60, "3.", "Clasificar cada bloque y emitir el Markdown final."),
    ]
    for i, (x, marker, text) in enumerate(pasos):
        y = 116 + i * 19
        p.text(x, y, marker, "F1", 11)
        p.text(x + 18, y, text, "F1", 11)

    p.text(60, 240, "PALABRAS CLAVE", "F2", 10)
    p.text(60, 262, "PDF, Markdown, análisis de maquetación, OCR, tipografía.", "F1", 11)
    p.text(280, 812, "3", "F1", 9)
    pages.append(p)

    return pages


def serialize(pages, path):
    objects = {}
    font_ids = {}
    next_id = 3 + len(pages) * 2

    for key, name in FONTS.items():
        font_ids[key] = next_id
        objects[next_id] = (
            b"<< /Type /Font /Subtype /Type1 /BaseFont /%s /Encoding /WinAnsiEncoding >>" % name.encode()
        )
        next_id += 1

    font_res = b" ".join(b"/%s %d 0 R" % (k.encode(), v) for k, v in font_ids.items())

    kids = []
    for i, page in enumerate(pages):
        page_id = 3 + i * 2
        content_id = page_id + 1
        kids.append(page_id)
        data = zlib.compress(page.stream())
        objects[content_id] = b"<< /Length %d /Filter /FlateDecode >>\nstream\n%s\nendstream" % (len(data), data)

        annots = b""
        if page.annots:
            refs = []
            for (x0, y0, x1, y1, url) in page.annots:
                objects[next_id] = (
                    b"<< /Type /Annot /Subtype /Link /Border [0 0 0] /Rect [%g %g %g %g] "
                    b"/A << /Type /Action /S /URI /URI (%s) >> >>" % (x0, y0, x1, y1, esc(url))
                )
                refs.append(next_id)
                next_id += 1
            annots = b" /Annots [%s]" % b" ".join(b"%d 0 R" % r for r in refs)

        objects[page_id] = (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %g %g] /Resources << /Font << %s >> >> "
            b"/Contents %d 0 R%s >>" % (W, H, font_res, content_id, annots)
        )

    objects[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objects[2] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (
        b" ".join(b"%d 0 R" % k for k in kids), len(kids))

    info_id = next_id
    objects[info_id] = (
        b"<< /Title (Gu\\355a t\\351cnica de conversi\\363n) /Author (Equipo de Documentaci\\363n) "
        b"/Subject (Evaluaci\\363n de motores PDF a Markdown) /Creator (make_test_pdf.py) "
        b"/CreationDate (D:20260827120000+02'00') >>"
    )
    max_id = info_id

    out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for oid in range(1, max_id + 1):
        body = objects.get(oid)
        if body is None:
            continue
        offsets[oid] = len(out)
        out += b"%d 0 obj\n" % oid + body + b"\nendobj\n"

    xref_pos = len(out)
    out += b"xref\n0 %d\n" % (max_id + 1)
    out += b"0000000000 65535 f \n"
    for oid in range(1, max_id + 1):
        out += b"%010d 00000 n \n" % offsets.get(oid, 0)
    out += b"trailer\n<< /Size %d /Root 1 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        max_id + 1, info_id, xref_pos)

    with open(path, "wb") as fh:
        fh.write(out)
    return len(out)


if __name__ == "__main__":
    dest = sys.argv[1] if len(sys.argv) > 1 else "muestra.pdf"
    size = serialize(build(), dest)
    print(f"{dest}: {size} bytes")
