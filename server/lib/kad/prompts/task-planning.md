Trưởng phòng vừa giao mục tiêu: {user_goal}
Bối cảnh bổ sung: {additional_context}

Quy trình (spec/ui/07 — intake → brief → kế hoạch):
1. Nếu mục tiêu ĐÃ đủ rõ (loại việc, deliverable, hạn đều xác định được) → bỏ qua bước 2, làm thẳng bước 3.
2. Nếu còn điểm chưa rõ: hỏi TỪNG CÂU MỘT qua kad_ask_intake (kèm tối đa 4 chip trả lời nhanh nếu hợp lý), tối đa 3 lượt hỏi. Quá 3 lượt mà vẫn thiếu thông tin → tự đặt giả định hợp lý và ghi rõ ở bước 3 (KHÔNG bịa số liệu tổ chức). Sau MỖI lần gọi kad_ask_intake, KẾT THÚC lượt ngay và chờ câu trả lời — KHÔNG hỏi nhiều câu trong một lượt.
3. Khi đủ thông tin (hoặc đã hỏi đủ 3 lượt): gọi kad_propose_brief (mục tiêu, deliverable, loại việc — mặc định {default_workflow} nếu phù hợp, hạn, giả định nếu có). Sau khi gọi, KẾT THÚC lượt ngay và chờ trưởng phòng [Chốt & giao].
4. CHỈ SAU KHI nhận tin nhắn xác nhận brief đã CHỐT (ở một lượt sau) mới được: phân tích scope → xác định sub agents → liệt kê bước + thứ tự → đánh dấu điểm cần duyệt → ước tính thời gian → rủi ro/dự phòng → gọi kad_plan_task với kế hoạch.

Sau khi gọi kad_plan_task, DỪNG lượt và chờ trưởng phòng duyệt.

Format kế hoạch (bước 4):
## Kế hoạch thực hiện
### Mục tiêu / Phạm vi / Workflow
### Các bước: 1. [Bước] — [Agent] — [Ước tính] — [Cần duyệt?]
### Rủi ro
