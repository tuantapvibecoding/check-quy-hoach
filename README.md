# Check Quy Hoạch · Gia Lai

Bản demo app kiểm tra quy hoạch và thửa đất trên nền ảnh vệ tinh, dùng hệ tọa độ **VN-2000, kinh tuyến trục 108°30′, múi 3°** (tỉnh Gia Lai cũ).

**Mở app:** https://tuantapvibecoding.github.io/check-quy-hoach/

## Cài lên iPhone

1. Mở link trên bằng **Safari**.
2. Bấm nút **Chia sẻ** (ô vuông có mũi tên lên) → **Thêm vào MH chính**.
3. Mở app từ biểu tượng **Quy Hoạch** trên màn hình chính.

Mỗi lần có bản cập nhật, app tự tải bản mới; đóng hẳn rồi mở lại là dùng được.

## Phiên bản

Số phiên bản đang dùng hiện ở góc trên bên trái bảng điều khiển trong app. Mục **Phiên bản** (cuối bảng) có lịch sử cập nhật và nút **Kiểm tra cập nhật**; khi có bản mới, app hiện thanh **Cập nhật** ở đầu màn hình.

## Bật bản đồ Google

App dùng **Map Tiles API** của Google với key của riêng bạn (miễn phí 100 000 ô ảnh mỗi tháng). Key nhập trong app, mục **Bản đồ Google**, chỉ lưu trên máy, không có trong repo.

1. Vào https://console.cloud.google.com → tạo project → gắn tài khoản thanh toán (Billing).
2. **APIs & Services → Library** → bật **Map Tiles API**.
3. **APIs & Services → Credentials → Create credentials → API key**.
4. Sửa key: *Application restrictions* = **Websites**, thêm `https://tuantapvibecoding.github.io/*`; *API restrictions* = **Map Tiles API**.
5. Dán key vào app → **Lưu**.

Ảnh của Google không được lưu để dùng offline (điều khoản Google); khi mất mạng app dùng bản đồ offline riêng.

## Tính năng hiện có

- Nhiều lớp dữ liệu, bật/tắt từng lớp, nền vệ tinh hoặc bản đồ đường.
- Thửa đất từ file DGN tự đặt đúng vị trí theo VN-2000; bảng tọa độ đỉnh, cạnh, diện tích.
- Tìm theo số thửa hoặc tên (gõ không dấu cũng được).
- Chạm bất kỳ điểm nào để xem tọa độ WGS84 và VN-2000.
- Định vị GPS của điện thoại trên bản đồ.
- Bản vẽ chưa có tọa độ gốc (DXF thiết kế): kéo, xoay để căn chỉnh tay, hoặc nhập tọa độ tâm.

## Cấu trúc

```
index.html, css/, js/app.js     giao diện + bản đồ (không dùng thư viện ngoài)
js/vn2000.js                    chuyển WGS84 ⇄ VN-2000 (Helmert 7 tham số + Transverse Mercator)
data/catalog.json               danh sách lớp dữ liệu
data/*.json                     dữ liệu đã chuyển từ DGN / DXF
sw.js, manifest.webmanifest     chạy như app, dùng được khi mất mạng
tools/                          script Python chuyển DGN V8 / DXF → JSON
```

## Thêm dữ liệu

```
python3 tools/build_parcel.py  thua.dgn   data/<ten>.json    # trích lục / bản đồ địa chính DGN (VN-2000)
python3 tools/build_overlay.py ban-ve.dxf data/<ten>.json    # bản vẽ DXF tọa độ cục bộ
```

Sau đó thêm một dòng vào `data/catalog.json`. File DGN/DXF gốc không đưa lên repo (xem `.gitignore`).
