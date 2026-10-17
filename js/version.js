/* Single source of truth for the app version. Bump with: python3 tools/bump_version.py <x.y.z> "<ghi chú>" */
self.APP_VERSION = '0.2.0';
self.APP_BUILD_DATE = '2026-10-17';
self.CHANGELOG = [
  { v: '0.2.0', d: '2026-10-17', items: [
    'Hiện số phiên bản đang dùng ở góc bảng điều khiển',
    'Mục "Phiên bản" có lịch sử cập nhật và nút kiểm tra bản mới',
    'Tự báo khi có bản mới, chạm để cập nhật ngay',
    'Luôn tải mã mới nhất khi có mạng (tránh dùng bản cũ trong bộ nhớ đệm)',
  ] },
  { v: '0.1.0', d: '2026-10-17', items: [
    'Bản đầu tiên: bản đồ vệ tinh, lớp thửa đất DGN đúng vị trí VN-2000',
    'Lớp mặt bằng DXF căn chỉnh tay, tìm số thửa, định vị GPS',
    'Cài lên màn hình chính iPhone, dùng được khi mất mạng',
  ] },
];
