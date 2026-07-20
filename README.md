# Wipter Orchestrator

Dashboard quản lý nhiều Wipter node theo proxy, có giao diện nhập account, import proxy, connect node, xem IP thoát ra và theo dõi health/log trong một màn hình.

![Wipter Orchestrator demo](docs/demo-dashboard.svg)

## Điểm Nổi Bật

- Nhập email/password Wipter trực tiếp trên dashboard.
- Import proxy hàng loạt, mỗi proxy tự tạo một node riêng.
- Kiểm tra proxy/IP thoát ra trước khi chạy.
- Tự reconnect node khi cần.
- Có log, trạng thái connected/waiting/error và cảnh báo leak.
- Có script cài đặt VPS một lệnh cho người mới.

Mục tiêu của repo này là cài thật đơn giản:

1. Mua VPS Ubuntu/Debian.
2. SSH vào VPS bằng `root`.
3. Chạy một lệnh install.
4. Mở dashboard, nhập account Wipter, nhập proxy, bấm chạy.

> Không commit file `.env`, proxy, email, password, hoặc `frontend/.htpasswd` lên GitHub.

## Cài Đặt Nhanh

### 1. Mua VPS

Khuyến nghị:

- Ubuntu 22.04/24.04 hoặc Debian 12
- Tối thiểu test: 2 vCPU, 4 GB RAM, 30 GB disk
- Chạy nhiều node: 4-8 vCPU, 8-16 GB RAM, 60 GB disk trở lên

### 2. Login Vào VPS

Trên máy bạn:

```bash
ssh root@IP_VPS_CUA_BAN
```

Ví dụ:

```bash
ssh root@1.2.3.4
```

### 3. Chạy Script Cài Đặt

```bash
curl -fsSL https://raw.githubusercontent.com/thanh743/wipter-orchestrator/main/scripts/install-vps.sh -o /tmp/install-wipter.sh
bash /tmp/install-wipter.sh
```

Script sẽ tự làm toàn bộ:

- Cài Docker
- Cài Docker Compose
- Clone source vào `/opt/wipter-orchestrator`
- Tạo `.env`
- Tự sinh mật khẩu database
- Tự sinh key mã hoá
- Tạo mật khẩu dashboard
- Build image sidecar
- Build image Wipter
- Chạy PostgreSQL, Redis, backend, frontend
- Mở firewall port dashboard
- In ra link đăng nhập cuối cùng

Sau khi chạy xong, bạn sẽ thấy dạng:

```text
Open:
  http://IP_VPS:5173

Dashboard login:
  User: admin
  Password: xxxxxxxxxx
```

Mở link đó trong trình duyệt.

## Cài Đặt Với Mật Khẩu Dashboard Tự Chọn

Nếu muốn đặt mật khẩu dashboard dễ nhớ:

```bash
curl -fsSL https://raw.githubusercontent.com/thanh743/wipter-orchestrator/main/scripts/install-vps.sh -o /tmp/install-wipter.sh
DASHBOARD_PASSWORD='mat-khau-cua-ban' bash /tmp/install-wipter.sh
```

## Cài Đặt Từ Fork Riêng

Nếu bạn fork repo về GitHub riêng, truyền `REPO_URL` như sau:

```bash
curl -fsSL https://raw.githubusercontent.com/thanh743/wipter-orchestrator/main/scripts/install-vps.sh -o /tmp/install-wipter.sh
REPO_URL='https://github.com/YOUR_USERNAME/wipter-orchestrator.git' bash /tmp/install-wipter.sh
```

## Cách Dùng Dashboard

### 1. Nhập Account Wipter

Trong dashboard, tìm khung **Wipter Account**:

1. Nhập email Wipter.
2. Nhập mật khẩu Wipter.
3. Bấm **Save**.

Mật khẩu được lưu trong database ở dạng mã hoá.

### 2. Nhập Proxy

Trong khung **Proxy Import**, mỗi dòng là một proxy:

```text
socks5://user:pass@host:port
http://user:pass@host:port
```

Ví dụ:

```text
socks5://user:pass@1.2.3.4:1080
http://user:pass@5.6.7.8:8080
```

Sau đó bấm **Provision All**.

Hệ thống sẽ tự:

- Test proxy
- Tạo sidecar container
- Tạo Wipter container
- Ép traffic đi qua proxy
- Kiểm tra IP thoát ra
- Cập nhật trạng thái trên dashboard

### 3. Connect Lại Toàn Bộ Node

Khi đã lưu account Wipter, bấm:

```text
Connect nodes
```

Hệ thống sẽ tự đưa các node vào hàng đợi reconnect.

### 4. Xoá Nhẹ Toàn Bộ Node

Muốn dọn VPS cho nhẹ:

```text
Clear nodes
```

Nút này xoá toàn bộ Wipter node/container hiện tại. Proxy đã nhập vẫn được giữ trong database.

## Ý Nghĩa Trạng Thái

- `running`: container đang chạy.
- `pending`: node đang chờ tạo hoặc chờ reconnect.
- `connected`: Wipter có dấu hiệu đã login/kết nối.
- `waiting`: Wipter đã mở nhưng chưa thấy tín hiệu connected.
- `error`: node lỗi, bấm Logs để xem nguyên nhân.

Lỗi thường gặp:

- `authentication failed`: sai email hoặc mật khẩu Wipter.
- `network issue`: app mở được nhưng chưa kết nối mạng ổn định.
- `Egress IP check failed`: proxy không hoạt động hoặc không lấy được IP thoát ra.
- `IPv6 leak detected`: sidecar không chặn được IPv6, node sẽ bị dừng để tránh leak.

## Lệnh Quản Lý Nhanh

Vào thư mục app:

```bash
cd /opt/wipter-orchestrator
```

Xem trạng thái:

```bash
docker compose ps
```

Xem log backend:

```bash
docker logs -f wipter-backend
```

Restart dashboard/backend:

```bash
docker compose restart backend frontend
```

Update code mới:

```bash
cd /opt/wipter-orchestrator
git pull
docker compose --profile build-sidecar --profile build-wipter build sidecar-builder wipter-builder
docker compose up -d --build backend frontend
```

Dừng toàn bộ:

```bash
docker compose down
```

## Backup Database

Backup thủ công:

```bash
APP_DIR=/opt/wipter-orchestrator /opt/wipter-orchestrator/scripts/backup-postgres.sh
```

Backup mỗi giờ bằng cron:

```cron
15 * * * * root APP_DIR=/opt/wipter-orchestrator /opt/wipter-orchestrator/scripts/backup-postgres.sh >/var/log/wipter-backup.log 2>&1
```

Backup nằm ở:

```text
/opt/wipter-orchestrator/backups/postgres
```

## Nếu Disk Đầy

Xem dung lượng Docker:

```bash
docker system df
```

Dọn cache Docker:

```bash
docker system prune -f
```

Không chạy `docker volume prune` nếu chưa backup database.

## File Quan Trọng

```text
scripts/install-vps.sh   Script cài đặt VPS từ A-Z
backend/                 API, Docker control, worker, monitor
frontend/                Dashboard
sidecar/                 Redsocks sidecar, firewall, DNS proxy
wipter/                  Image chạy Wipter GUI trong container
scripts/backup-postgres.sh
```

## Bảo Mật Trước Khi Public GitHub

Kiểm tra kỹ:

- Không có `.env`
- Không có `frontend/.htpasswd`
- Không có proxy thật
- Không có email/password thật
- Không có backup database

Sau khi test xong, nên đổi lại mật khẩu VPS và account đã dùng trong lúc thử nghiệm.
