# Check Quy Hoạch — ghi chú cho người/AI sửa repo

- App PWA tĩnh, chạy bằng GitHub Pages từ nhánh `main` (thư mục gốc). Không có bước build.
- Mỗi lần sửa và đẩy lên: tăng phiên bản bằng
  `python3 tools/bump_version.py <x.y.z> "ghi chú 1" "ghi chú 2"`
  (cập nhật `js/version.js` + tên cache trong `sw.js`). Ghi chú viết tiếng Việt, ngắn, theo góc nhìn người dùng.
- Sửa nhỏ / sửa lỗi: tăng số cuối (0.2.0 → 0.2.1). Tính năng mới: tăng số giữa (0.2.x → 0.3.0).
- Thêm file mới vào app thì thêm vào danh sách `SHELL` trong `sw.js`.
- Không commit file DGN/DXF gốc hay tên chủ hồ sơ; chỉ đưa JSON đã chuyển đổi.
- Hệ tọa độ: VN-2000, KT trục 108°30′, k0 = 0.9999 (Gia Lai cũ), xem `js/vn2000.js`.
