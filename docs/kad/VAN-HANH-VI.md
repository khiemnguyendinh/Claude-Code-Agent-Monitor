# Quy trình Vận hành Kstudy AI Department (Dành cho Trưởng phòng)

## 1. Tổng quan
KAD (Kstudy AI Department) vận hành theo cơ chế **turn-based** (theo lượt) và **guardrails** chặt chẽ để đảm bảo chi phí và hiệu quả. Các Agent AI hoạt động như nhân sự thật, có mô tả công việc (JD), quyền hạn và tiêu chuẩn đầu ra rõ ràng.

## 2. Quy trình Giao việc
- **Bước 1 (Intake):** Trưởng phòng tạo yêu cầu tại `/cong-viec/moi`.
- **Bước 2 (Brief):** Cung cấp tài liệu (Syllabus, quy định...). Agent có thể phản hồi đòi thêm thông tin nếu brief thiếu (theo cơ chế chống mockup).
- **Bước 3 (Thực thi):** Agent tiến hành làm việc. Hệ thống kiểm soát ngân sách (Budget) và Max Turns. Nếu vượt ngưỡng, tiến trình sẽ tạm ngưng và chuyển sang trạng thái `waiting_human`.
- **Bước 4 (Duyệt - Report):** Trưởng phòng xem xét Artifact (kết quả). Có thể yêu cầu làm lại (Needs Changes) hoặc Approve.

## 3. Quản lý Đội ngũ
- Theo dõi trạng thái của các Agent tại `/doi-ngu`.
- Các chính sách phòng ban (Department Policies) và prompt mặc định có thể được cập nhật qua thư mục `prompts/`.
- Nếu một Agent liên tục bị lỗi hoặc chi tiêu quá mức, trưởng phòng cần kiểm tra lại file cấu hình và giới hạn budget của Agent đó.

## 4. Troubleshooting nhanh
- **Agent không phản hồi:** Kiểm tra Job Queue. Có thể tiến trình đang chờ được resume.
- **Lỗi ngân sách:** Kiểm tra cảnh báo (budget_warning) và xác nhận phê duyệt thủ công nếu cần.
