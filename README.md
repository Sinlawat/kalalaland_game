# Kalalaland

เกมจำลองชีวิตบนเว็บ ในโลกสมมติ Kalalaland — เล่นคนเดียว ใช้ชีวิตตัวละครหนึ่งคนตั้งแต่เกิดจนตาย

## สถานะ

Increment 1: แกนของเกม — game loop รายเดือน, character model 5 ชั้น (เฉพาะ MVP), การตาย, สรุปรายปีพร้อมที่มา, autosave
ยังไม่มี: การเงิน, อาชีพ, เหตุการณ์, ความฝัน, NPC/ranking

## เริ่มใช้งาน

```bash
npm install
npm run dev        # เปิดเกมที่ http://localhost:5173
npm test           # unit + data + balance (Monte Carlo) tests
npm run build      # typecheck + build ไปที่ dist/
```

## โครงสร้าง

```
src/
  engine/    game loop, stat calculation, mortality, RNG — pure logic ห้ามแตะ DOM/localStorage
  finance/   เงิน (จำนวนเต็มหน่วยสตางค์) — ระบบการเงินเต็มรูปแบบใน increment ถัดไป
  actions/   player actions (ตอนนี้: เปลี่ยน habits)
  save/      save/load, saveVersion, migration
  data/      ค่า balance และข้อมูลเกม (ชื่อ ฯลฯ)
  i18n/      ข้อความ (th.json) — โค้ดและข้อมูลเก็บแค่ key
  ui/        React components — แสดงผลและรับ input เท่านั้น ไม่มีกฎของเกม
```

## Deploy

push ไปที่ `main` แล้ว GitHub Actions จะรัน test, build และ deploy ไป GitHub Pages
ครั้งแรกต้องตั้งค่า repo: Settings → Pages → Source = **GitHub Actions**

## ความปลอดภัย

repo นี้เป็น public — ห้าม commit secret / API key / ไฟล์ `.env`
