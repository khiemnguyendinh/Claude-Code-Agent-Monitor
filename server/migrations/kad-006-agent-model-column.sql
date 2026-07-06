-- KAD backlog fix — "Cấu hình engine" trong JD & Kỹ năng hiển thị Model
-- nhưng agent_profiles chưa có cột model (client/api-client.ts đã kỳ vọng
-- AgentRow.model từ trước, chỉ thiếu cột thật). Additive, nullable.
ALTER TABLE agent_profiles ADD COLUMN model TEXT;
