# Hướng dẫn Sao lưu và Khôi phục KAD (Backup & Restore)

Tài liệu này mô tả quy trình an toàn để sao lưu và khôi phục dữ liệu của Kstudy Curriculum R&D, kết hợp cùng các script do **Track B** cung cấp.

## 1. Cơ chế Lưu trữ
KAD sử dụng `better-sqlite3` với chế độ WAL (Write-Ahead Logging). Do đó, khi sao lưu, hệ thống cần được thao tác đúng cách để không làm hỏng dữ liệu đang ghi dở.

## 2. Sao lưu (Backup)
Sử dụng script backup của Track B (ví dụ: `scripts/kad-backup.mjs`). Lệnh này sẽ an toàn copy file database chính (`database.sqlite`) và các file WAL liên quan.

```bash
node scripts/kad-backup.mjs --out ./backups/
```
*(Lưu ý: Tên file chính xác có thể thay đổi tùy theo kết quả gộp code của Track B, vui lòng kiểm tra thư mục scripts).*

## 3. Khôi phục (Restore)
Sử dụng script restore của Track B (ví dụ: `scripts/kad-restore.mjs`) để khôi phục từ bản sao lưu.

```bash
# Dừng ứng dụng trước khi khôi phục
node scripts/kad-restore.mjs --file ./backups/backup-YYYYMMDD.sqlite
```

## 4. Xử lý sau khi Khôi phục
Sau khi khôi phục thành công, khởi động lại hệ thống (`npm start`). Hệ thống `reconcile_runs` sẽ tự động dọn dẹp các tiến trình mồ côi (nếu có) và đưa các công việc dở dang vào hàng đợi (Job Queue) để tiếp tục.
