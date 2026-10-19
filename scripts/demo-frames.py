"""Generate original schematic animatic frames; no reference or production assets."""
from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageFont
root=Path(sys.argv[1]).resolve()
root.mkdir(parents=True,exist_ok=True)
def font(size):
    for candidate in [r"C:\Windows\Fonts\segoeui.ttf",r"C:\Windows\Fonts\arial.ttf"]:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate,size)
    return ImageFont.load_default()
for index,label in enumerate(["THE WAITING ROOM","AMENEWA / DOORWAY","THE EMPTY HALL","BEFORE SUNRISE","A MOMENT LONGER"]):
    image=Image.new("RGB",(960,540),"#19252e")
    d=ImageDraw.Draw(image)
    d.rectangle((45,50,915,450),fill="#d5d0c2")
    d.polygon([(45,380),(915,355),(915,450),(45,450)],fill="#9b9c92")
    d.line([(45,380),(500,280),(915,355)],fill="#777f7b",width=3)
    d.rectangle((670,110,800,355),fill="#535e60",outline="#283f45",width=4)
    d.rectangle((120,120,340,275),fill="#b7c7c7",outline="#64767a",width=4)
    d.line((230,120,230,275),fill="#64767a",width=3)
    d.line((120,197,340,197),fill="#64767a",width=3)
    if index in (0,1,4):
        x=450 if index!=1 else 600
        d.ellipse((x-24,181,x+24,229),fill="#3d5057")
        d.polygon([(x-18,229),(x+18,229),(x+30,325),(x-28,325)],fill="#536c70")
        d.line((x-12,325,x-23,389),fill="#3d5057",width=10)
        d.line((x+12,325,x+24,385),fill="#3d5057",width=10)
        d.line((x-16,245,x-62,294),fill="#3d5057",width=7)
    d.line((62,67,96,67),fill="#5e777e",width=2)
    d.line((62,67,62,101),fill="#5e777e",width=2)
    d.text((45,478),label,font=font(23),fill="#e5e8e2")
    d.text((45,512),"GENERATED TEST ANIMATIC  /  ORAMA SOUNDR",font=font(12),fill="#a3b0b7")
    d.text((790,482),f"FRAME {index+1:02d}",font=font(16),fill="#d7b77c")
    image.save(root/f"frame-{index+1}.png")

