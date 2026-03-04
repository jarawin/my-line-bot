# Fly.io Deploy & Management Cheatsheet

App: `my-line-bot-demo` | Region: `nrt` (Tokyo)

---

## First-time Setup (ทำครั้งเดียว)

```bash
# 1. Login
fly auth login

# 2. สร้าง persistent volume สำหรับ SQLite + exports + backups
fly volumes create bot_data --region nrt --size 1 --count 1

# 3. ตั้ง secrets (tokens ไม่ควรอยู่ใน fly.toml)
fly secrets set LINE_CHANNEL_ACCESS_TOKEN=<your-token>
fly secrets set TELEGRAM_BOT_TOKEN=<your-token>
fly secrets set SERVER_URL=https://my-line-bot-demo.fly.dev

# 4. Deploy ครั้งแรก
fly deploy --ha=false
```

---

## Deploy (ทุกครั้งที่อัปเดตโค้ด)

```bash
# วิธีที่ 1: ผ่าน GitHub Actions (แนะนำ)
git add .
git commit -m "your message"
git push                    # → Actions รัน fly deploy อัตโนมัติ

# วิธีที่ 2: ผ่าน CLI โดยตรง (ไม่ต้อง push git)
fly deploy
```

> ไม่ต้อง destroy machine ก่อน — `strategy = 'immediate'` ใน fly.toml จัดการให้อัตโนมัติ
> (destroy เฉพาะกรณี machine ค้างจาก deploy ที่ fail ผิดปกติเท่านั้น)

---

## Logs

```bash
# ดู log แบบ real-time — fly logs tails อยู่แล้วโดย default
fly logs

# ดู log ของ machine ใด machine หนึ่ง
fly logs --machine <MACHINE_ID>

# ดูครั้งเดียวไม่ต่อเนื่อง (no-tail)
fly logs -n
```

---

## รอดู Log จนกว่า Deploy จะ Go Live

```bash
# ถ้า deploy ผ่าน CLI — progress แสดงในหน้าเดิมจนเสร็จ แล้วดู log ต่อ
fly deploy && fly logs

# ถ้า deploy ผ่าน GitHub Actions — เปิด 2 terminal
# terminal 1: ดู Actions progress
gh run watch

# terminal 2: ดู server log พร้อมกัน
fly logs
```

---

## Machine Management

```bash
# ดูสถานะ app + machines
fly status

# รายการ machines
fly machines list

# Restart server (เช่น หลัง reset ข้อมูล)
fly machine restart

# Destroy machine ที่ค้าง (กรณีฉุกเฉิน)
fly machines destroy <MACHINE_ID> --force
```

---

## Reset ข้อมูล (ล้าง DB + exports + backups)

```bash
# 1. รัน reset script บน server
fly ssh console -C "bun run reset"

# 2. Restart server เพื่อ initialize DB ใหม่
fly machine restart
```

---

## SSH เข้า Server

```bash
# เข้า interactive shell
fly ssh console

# รันคำสั่งเดียวแล้วออก
fly ssh console -C "<command>"
```

---

## Secrets (Environment Variables)

```bash
# ดู secrets ที่ตั้งไว้ (แสดงแค่ชื่อ ไม่แสดงค่า)
fly secrets list

# ตั้ง / อัปเดต secret
fly secrets set KEY=value

# ลบ secret
fly secrets unset KEY
```

---

## Volume

```bash
# ดูรายการ volumes
fly volumes list

# ขยาย volume (GB)
fly volumes extend <VOLUME_ID> --size 2
```

---

## ตรวจสอบก่อน deploy

```bash
fly auth whoami    # เช็คว่า login ถูก account
fly status         # เช็ค app + machines ปัจจุบัน
fly volumes list   # เช็ค volume bot_data มีอยู่
```
