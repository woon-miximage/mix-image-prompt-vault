# MIX-IMAGE Prompt Vault

Source project สำหรับเครื่องมือเก็บพรอมต์ส่วนตัวของ MIX-IMAGE Art & Audio

## สิ่งที่มีในเวอร์ชันนี้

- PIN gate `1449` สำหรับเข้าใช้งานใน browser session
- โครงสร้าง UI แบบ dark matte + glass panel
- Library, search, category filter, favorite
- เพิ่ม/แก้ไข/ลบพรอมต์
- คัดลอกพรอมต์
- ภาพตัวอย่างแบบ thumbnail ที่ใช้ `object-fit: contain` และรักษาสัดส่วน
- Local fallback ด้วย `localStorage`
- Firebase Firestore สำหรับข้อมูลพรอมต์
- Firebase Storage สำหรับไฟล์ภาพตัวอย่าง
- Firebase Analytics แบบ conditional

## เริ่มใช้งาน

```powershell
npm install
npm run dev
```

เปิด URL ที่ Vite แสดง แล้วกรอก PIN `1449`

## Firebase

การตั้งค่า browser config ถูกใส่ไว้ใน `src/lib/firebase.js` ตาม config ที่ผู้ใช้ส่งให้สำหรับ project `miximage-prompt-library`

แอปใช้ collection ชื่อ `prompts` เพื่อให้สอดคล้องกับแอปเดิม และใช้ path `prompt-images/*` ใน Cloud Storage

ก่อนใช้งานจริงควรตรวจสอบ Firestore Rules และ Storage Rules ให้ผูกกับ owner identity เพราะ PIN ที่อยู่ใน client เป็น convenience gate ไม่ใช่ security boundary

ถ้า Firebase Rules หรือ Storage ยังไม่พร้อม แอปจะ fallback ไปเก็บข้อมูลใน `localStorage` และแสดงสถานะ `ใช้ข้อมูลในเครื่อง`

## Production checklist

- ตรวจ Firestore read/write/delete จริง
- ตรวจ Storage upload และการลบไฟล์ที่ไม่ใช้แล้ว
- ตั้ง owner authentication หรือ pairing flow ก่อนเปิดเป็นข้อมูลส่วนตัวจริง
- ตรวจ responsive ที่ desktop และ mobile
- ตรวจ `npm run build` และ URL production หลัง deploy
