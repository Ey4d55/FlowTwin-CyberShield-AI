"""Create and independently decode-check QR artwork for the verified Pages URL."""
from pathlib import Path
import sys, json, io
from PIL import Image, ImageDraw, ImageFont
try:
    import qrcode, qrcode.image.svg, zxingcpp
except ImportError:
    sys.path.append(str(Path(__file__).resolve().parents[2] / 'tmp' / 'qr-libs'))
    import qrcode, qrcode.image.svg, zxingcpp
ROOT = Path(__file__).resolve().parents[1]
URL = 'https://ey4d55.github.io/FlowTwin-CyberShield-AI/'
OUT = ROOT / 'branding'
OUT.mkdir(exist_ok=True)
qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, box_size=20, border=6)
qr.add_data(URL); qr.make(fit=True)
image = qr.make_image(fill_color='#102c39', back_color='white').convert('RGB')
image.save(OUT / 'cybershield-qr.png', dpi=(300,300))
qr.make_image(image_factory=qrcode.image.svg.SvgPathImage).save(OUT / 'cybershield-qr.svg')
card = Image.new('RGB', (1500,1900), '#0b1421'); d = ImageDraw.Draw(card)
regular = ROOT / 'docs' / 'fonts' / 'space.ttf'
font = lambda size: ImageFont.truetype(str(regular),size)
d.rounded_rectangle((90,90,1410,1810),radius=36,fill='#111f2e',outline='#2a4052',width=3)
d.text((750,170),'FLOWTWIN',font=font(38),anchor='mt',fill='#adc4d5')
d.text((750,245),'CYBERSHIELD AI',font=font(64),anchor='mt',fill='#65e6cd')
d.text((750,348),'Secure traffic intelligence',font=font(30),anchor='mt',fill='#a1b4c9')
symbol=image.resize((1030,1030),Image.Resampling.NEAREST)
card.paste(symbol,(235,480))
d.text((750,1560),'SCAN TO EXPLORE THE LIVE DEMO',font=font(27),anchor='mt',fill='#65e6cd')
d.text((750,1630),'ey4d55.github.io/FlowTwin-CyberShield-AI/',font=font(24),anchor='mt',fill='#bccbd9')
d.text((750,1720),'IS CYBERNEXT 2026  /  WORKING PROOF OF CONCEPT',font=font(20),anchor='mt',fill='#8197ac')
card.save(OUT / 'cybershield-qr-card.png',dpi=(300,300))
checks=[]
def check(name,variant):
    result=zxingcpp.read_barcode(variant)
    assert result is not None and result.text==URL, name
    checks.append({'variant':name,'decodedUrl':result.text})
check('original PNG',image)
check('300 pixel print preview',image.resize((300,300),Image.Resampling.LANCZOS))
check('branded card',card)
check('rotated 90 degrees',image.rotate(90,expand=True))
stream=io.BytesIO();image.save(stream,format='JPEG',quality=65);stream.seek(0);check('JPEG compression',Image.open(stream))
(OUT / 'qr-validation.json').write_text(json.dumps({'url':URL,'checks':checks},indent=2),encoding='utf-8')
print(json.dumps({'url':URL,'checks':len(checks),'outputs':[str(p) for p in OUT.glob('*.png')]}))
