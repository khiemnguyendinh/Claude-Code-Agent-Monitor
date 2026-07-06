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

## 5. Gotcha: đường dẫn thư mục có khoảng trắng (space)

Nếu đường dẫn tuyệt đối của repo chứa khoảng trắng (ví dụ `.../AI Agent Workspace/...`), `npm rebuild better-sqlite3` (dùng generator `make` mặc định của node-gyp) sẽ vỡ build với lỗi kiểu:

```
/bin/sh: Agent/AI: No such file or directory
```
hoặc (trên node-gyp/make bản khác):
```
missing separator. Stop.
```

Đây là bug của node-gyp/GNU Make khi xử lý path có space, không liên quan tới lỗi ABI mismatch giữa các bản Node cài song song (xem gotcha #3 ở trên). Cách khắc phục — build bằng generator Xcode thay vì make:

```bash
GYP_GENERATORS=xcode npm rebuild better-sqlite3
```

Nếu máy không có Xcode command line tools, cách thay thế là dùng `ninja`:
```bash
brew install ninja
cd node_modules/better-sqlite3 && node-gyp configure --release -- -f ninja
ninja -C build/Release
```
