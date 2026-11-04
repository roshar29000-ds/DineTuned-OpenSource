#!/usr/bin/env python3
"""Art for Muse's Culinary Orbit. The ivory plate, its fixed gloss and the small gold-rimmed plates are drawn here as SVG and rasterized with local Chrome.
The food comes from the app's own labelled illustrations in public/picks-preview. Nothing is taken from the reference mockups.
Run from web/: python3 scripts/make_culinary_orbit_art.py"""
import math, os, random, subprocess, tempfile
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

OUT = 'public/culinary-orbit'
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
FILTERS = '''
<filter id="v" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="2.4" result="b"/>
 <feSpecularLighting in="b" surfaceScale="4.5" specularConstant=".62" specularExponent="20" lighting-color="#fff4dc" result="s"><feDistantLight azimuth="235" elevation="52"/></feSpecularLighting>
 <feComposite in="s" in2="SourceAlpha" operator="in" result="s2"/><feDiffuseLighting in="b" surfaceScale="3.5" diffuseConstant="1.04" lighting-color="#fff" result="d"><feDistantLight azimuth="235" elevation="62"/></feDiffuseLighting>
 <feComposite in="d" in2="SourceGraphic" operator="arithmetic" k1="1" result="l"/><feComposite in="l" in2="SourceAlpha" operator="in" result="l2"/><feMerge><feMergeNode in="l2"/><feMergeNode in="s2"/></feMerge></filter>
<filter id="o" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="3" seed="4"/><feDisplacementMap in="SourceGraphic" scale="9" xChannelSelector="R" yChannelSelector="G"/></filter>
<filter id="crust" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".32" numOctaves="3" seed="7" result="n"/><feColorMatrix in="n" values="0 0 0 0 .2  0 0 0 0 .1  0 0 0 0 .03  0 0 0 1.5 -.62" result="c"/><feComposite in="c" in2="SourceAlpha" operator="in" result="c2"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="c2"/></feMerge></filter>
<filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>
<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1"/></filter>
<filter id="mott" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".014" numOctaves="4" seed="11"/><feColorMatrix values="0 0 0 0 .55  0 0 0 0 .42  0 0 0 0 .22  0 0 0 .55 -.17"/></filter>
<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4dc9c"/><stop offset=".3" stop-color="#b98a35"/><stop offset=".55" stop-color="#eccb79"/><stop offset=".8" stop-color="#9c7028"/><stop offset="1" stop-color="#e6c26e"/></linearGradient>'''

def svg(size, body, vb=400):
    return f'<!doctype html><html style="margin:0;background:transparent"><body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {vb} {vb}" style="display:block"><defs>{FILTERS}</defs>{body}</svg></body></html>'

def render(name, size, body, vb=400):
    with tempfile.TemporaryDirectory() as t:
        src, png = f'{t}/a.html', f'{t}/a.png'
        open(src, 'w').write(svg(size, body, vb))
        subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000', f'--window-size={size},{size}', f'--screenshot={png}', f'file://{src}'], check=True, capture_output=True)
        Image.open(png).convert('RGBA').save(f'{OUT}/{name}.webp', quality=90, method=6)

def specks(r, n, R=200, cx=200, cy=200, tones=('#8a6a3c', '#a58a5c', '#6e5430')):
    s = ''
    for _ in range(n):
        a, d = r.random() * math.tau, R * math.sqrt(r.random())
        s += f'<circle cx="{cx + math.cos(a) * d:.1f}" cy="{cy + math.sin(a) * d:.1f}" r="{r.uniform(.15, .55):.2f}" fill="{r.choice(tones)}" opacity="{r.uniform(.2, .6):.2f}"/>'
    return s

def plate_gradient(i, stops):
    return f'<radialGradient id="{i}" gradientUnits="userSpaceOnUse" cx="200" cy="200" r="200">' + ''.join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops) + '</radialGradient>'

# The large plate. All of its shading is radial, so it can turn under a fixed light.
PLATE_STOPS = [(0, '#f7efdd'), (.56, '#f5ecd9'), (.625, '#f1e8d5'), (.652, '#e3d7be'), (.672, '#ece2cd'), (.72, '#f5eddc'), (.92, '#f6efdf'), (.975, '#f1e8d4'), (1, '#dccca9')]
def big_plate():
    r = random.Random(3)
    return f'''<defs>{plate_gradient("p", PLATE_STOPS)}<clipPath id="c"><circle cx="200" cy="200" r="198"/></clipPath></defs>
    <circle cx="200" cy="200" r="198" fill="url(#p)"/><g clip-path="url(#c)"><rect width="400" height="400" filter="url(#mott)" opacity=".2"/></g>{specks(r, 170, 194)}
    <circle cx="200" cy="200" r="131" fill="none" stroke="url(#gold)" stroke-width=".55" opacity=".85"/>
    <circle cx="200" cy="200" r="197" fill="none" stroke="url(#gold)" stroke-width="2.3"/><circle cx="200" cy="200" r="194.6" fill="none" stroke="#fff8e6" stroke-width=".6" opacity=".7"/>'''

# Stays still over the turning plate, so the light never appears to move with the china.
def gloss():
    return '''<defs><radialGradient id="k" cx=".32" cy=".24" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset=".72" stop-color="#5b4318" stop-opacity="0"/><stop offset="1" stop-color="#5b4318" stop-opacity=".1"/></radialGradient><filter id="g"><feGaussianBlur stdDeviation="1.8"/></filter></defs>
    <circle cx="200" cy="200" r="197" fill="url(#k)"/>
    <g filter="url(#g)" fill="none" stroke="#fff" stroke-linecap="round"><path d="M38 150A170 170 0 0 1 112 53" stroke-width="4.5" opacity=".6"/><path d="M120 92A122 122 0 0 0 86 150" stroke-width="2.4" opacity=".5"/><path d="M352 276A170 170 0 0 1 300 340" stroke-width="3.2" opacity=".36"/><path d="M304 262A122 122 0 0 1 272 296" stroke-width="2" opacity=".38"/></g>'''

def small_plate(r):
    stops = [(0, '#fbf5e6'), (.58, '#f8f0df'), (.66, '#e4d8bf'), (.72, '#f6eedd'), (.95, '#f8f1e2'), (1, '#dccba6')]
    return f'''<defs>{plate_gradient("sp", stops)}</defs><circle cx="205" cy="208" r="189" fill="#061109" opacity=".32" filter="url(#sh)"/>
    <circle cx="200" cy="200" r="194" fill="url(#sp)"/>{specks(r, 70, 188)}<circle cx="200" cy="200" r="192.5" fill="none" stroke="url(#gold)" stroke-width="3.6"/>
    '''

# (file stem in public/picks-preview, centre x, centre y, radius x, radius y) as fractions of the image: the food and the plate surface around it.
STUDIES = {'chicken': ('charred-chicken', .495, .49, .455, .40), 'greens': ('garden-leaves', .50, .50, .45, .405), 'tart': ('lemon-tart', .50, .52, .475, .40),
           'rice': ('mushroom-rice', .50, .49, .40, .335), 'soup': ('roasted-tomato-soup', .375, .39, .315, .262)}

def plated(name, study):
    """Flatten the study's plate to a top-down circle, feather away everything around the food, grade it, and set it on the shared gold-rimmed plate."""
    stem, cx, cy, rx, ry = study
    src = Image.open(f'public/picks-preview/{stem}.jpg').convert('RGB')
    W, H = src.size
    box = (int((cx - rx) * W), int((cy - ry) * H), int((cx + rx) * W), int((cy + ry) * H))
    D = 336
    food = src.crop(box).resize((D, D), Image.LANCZOS)
    food = ImageEnhance.Color(food).enhance(1.12)
    food = ImageEnhance.Contrast(food).enhance(1.05)
    mask = Image.new('L', (D, D), 0)
    ImageDraw.Draw(mask).ellipse((10, 10, D - 10, D - 10), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(9))
    plate = Image.open(f'{OUT}/dish-base.webp').convert('RGBA')
    plate.paste(food, ((440 - D) // 2, (440 - D) // 2), mask)
    ring = Image.open(f'{OUT}/dish-ring.webp').convert('RGBA')
    plate.alpha_composite(ring)
    plate.save(f'{OUT}/dish-{name}.webp', quality=88, method=6)

render('plate', 1400, big_plate())
render('plate-gloss', 1000, gloss())
r = random.Random(9)
render('dish-base', 440, small_plate(r))
render('dish-ring', 440, '<circle cx="200" cy="200" r="154" fill="none" stroke="url(#gold)" stroke-width="1" opacity=".7"/>')
for name, study in STUDIES.items():
    plated(name, study)
os.remove(f'{OUT}/dish-base.webp')
os.remove(f'{OUT}/dish-ring.webp')
