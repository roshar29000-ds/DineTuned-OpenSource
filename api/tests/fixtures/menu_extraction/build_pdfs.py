"""Reproducible fictional PDF fixtures. No downloaded or copyrighted restaurant menus."""
from pathlib import Path
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

ROOT = Path(__file__).parent


def add_page(writer, lines):
    page = writer.add_blank_page(width=612, height=792)
    fonts = DictionaryObject()
    for key, family in [('F1', 'Helvetica'), ('F2', 'Helvetica-Bold')]:
        fonts[NameObject('/' + key)] = writer._add_object(DictionaryObject({NameObject('/Type'): NameObject('/Font'),
            NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/' + family)}))
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): fonts})
    commands = []
    for text, size, bold, x, y in lines:
        escaped = text.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
        commands.append(f'BT /F{2 if bold else 1} {size} Tf 1 0 0 1 {x} {y} Tm ({escaped}) Tj ET')
    stream = DecodedStreamObject(); stream.set_data('\n'.join(commands).encode('latin-1'))
    page[NameObject('/Contents')] = writer._add_object(stream)


def build():
    writer = PdfWriter()
    for page_no, category in enumerate(['STARTERS', 'MAIN PLATES', 'DESSERTS'], 1):
        lines = [('Cedar & Salt', 18, True, 40, 750), ('123 North River Street, Chicago, IL 60607', 9, False, 40, 730),
                 ('All prices in USD', 10, False, 40, 712), (category, 14, True, 40, 680)]
        names = [['Tomato soup', 'Crispy eggplant', 'Garden salad', 'Grilled corn', 'Potato croquettes', 'Roasted carrots'],
                 ['Herb chicken', 'Mushroom rice', 'Grilled trout', 'Tomato pasta', 'Lentil bowl', 'Roast squash'],
                 ['Lemon tart', 'Chocolate mousse', 'Vanilla ice cream', 'Poached pear', 'Rice pudding', 'Fruit plate']][page_no-1]
        for i, name in enumerate(names):
            lines += [(f'{name} .... USD {10 + page_no + i}.50', 11, True, 40, 650-i*65),
                      (f'{name}, prepared with the seasonal accompaniments listed by the kitchen.', 10, False, 40, 633-i*65)]
        lines.append((f'Page {page_no} of 3', 9, False, 40, 50))
        add_page(writer, lines)
    writer.write(ROOT/'cedar-three-pages.pdf')
    writer = PdfWriter()
    lines = [('Cedar & Salt',18,True,40,750), ('All prices in USD',10,False,40,725)]
    for x, category, names in [(40,'SMALL PLATES',['Tomato soup','Green salad','Roasted corn']), (320,'SWEETS',['Lemon tart','Ice cream','Poached pear'])]:
        lines.append((category,14,True,x,680))
        for i, name in enumerate(names):
            lines.extend([(f'{name} USD {8+i}',11,True,x,650-i*70), ('Seasonal preparation.',10,False,x,634-i*70)])
    add_page(writer, lines); writer.write(ROOT/'cedar-two-columns.pdf')
    writer = PdfWriter(); writer.add_blank_page(width=612,height=792); writer.write(ROOT/'blank-image-page.pdf')
    writer = PdfWriter(); add_page(writer,[('Protected menu',14,True,40,700)])
    writer.encrypt('offline-fixture'); writer.write(ROOT/'encrypted-menu.pdf')


if __name__ == '__main__': build()
