# Hướng dẫn Cài đặt Kstudy Curriculum R&D (KAD)

## 1. Yêu cầu hệ thống
- Node.js (v18+)
- SQLite (better-sqlite3)
- Claude CLI (đã login)

## 2. Cài đặt Server & Database
```bash
# Tại thư mục gốc
npm install
# Khởi tạo db (chạy migration KAD)
npm run migrate
```

## 3. Cài đặt Client (Gotcha Quan trọng)
⚠️ **CHÚ Ý QUAN TRỌNG:** Nếu máy tính của bạn (hoặc server) đang set biến môi trường `NODE_ENV=production` ở mức toàn cục, lệnh `npm install` mặc định sẽ BỎ QUA các gói trong `devDependencies`, dẫn tới việc build client bị lỗi (do thiếu Vite, TypeScript, v.v.).

Cách khắc phục (chạy ở thư mục `client/`):
```bash
cd client
NODE_ENV=development npm install --include=dev
npm run build
```

## 4. Chạy ứng dụng
```bash
npm start
```
Ứng dụng sẽ chạy tại `http://localhost:4820`
