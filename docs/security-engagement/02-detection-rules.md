# Detection Rules — Password Spraying / Credential Stuffing / OTP Brute Force

Rules ini bersifat **defensif**: untuk mendeteksi pola serangan pada log autentikasi. Format Sigma (portable ke Splunk, Elastic, Sentinel via sigmac/converter). Sesuaikan `logsource` & nama field dengan skema log kamu.

---

## 1. Password Spraying — banyak USER, sedikit password, dari 1 sumber

> Karakteristik: satu IP / satu sesi mencoba 1–2 password ke BANYAK username berbeda dalam jendela waktu pendek. Lolos dari lockout per-akun.

```yaml
title: Password Spraying - Many Distinct Users From Single Source
id: 1a7e0c2a-1111-4a01-9b01-spray0001
status: experimental
logsource:
  category: authentication
  product: webapp
detection:
  selection:
    event_action: login_failed
  timeframe: 10m
  condition: selection | count(distinct username) by src_ip > 15
fields:
  - src_ip
  - username
  - user_agent
level: high
falsepositives:
  - Shared NAT/proxy egress (corporate gateway)
  - SSO/health-check bots
```

## 2. Credential Stuffing — banyak USER, password unik per user, sukses sporadis

> Karakteristik: volume login tinggi, banyak kombinasi user+password unik (dari breach list), rasio sukses rendah tapi ada beberapa yang lolos.

```yaml
title: Credential Stuffing - High Volume Unique Credential Pairs
id: 1a7e0c2a-2222-4a01-9b01-stuff0001
status: experimental
logsource:
  category: authentication
  product: webapp
detection:
  high_volume:
    event_action:
      - login_failed
      - login_success
  timeframe: 5m
  condition: high_volume | count() by src_ip > 100
fields:
  - src_ip
  - username
  - user_agent
  - result
level: high
falsepositives:
  - Load testing from known IP (whitelist)
```

**Sinyal pendukung (korelasi, naikkan severity bila bertemu):**
- User-Agent statis/headless (mis. `python-requests`, `curl`, UA kosong)
- Sukses login dari IP yang sebelumnya gagal puluhan kali
- Login sukses diikuti login dari geolokasi/ASN berbeda dalam menit yang sama (impossible travel)

## 3. OTP Brute Force — percobaan kode berulang pada 1 akun/sesi

> Karakteristik: banyak submit OTP gagal untuk akun/sesi yang sama; OTP 4–6 digit sangat rawan bila tidak ada limit.

```yaml
title: OTP Brute Force - Repeated OTP Failures Per Account
id: 1a7e0c2a-3333-4a01-9b01-otp00001
status: experimental
logsource:
  category: authentication
  product: webapp
detection:
  selection:
    event_action: otp_verify_failed
  timeframe: 5m
  condition: selection | count() by account_id > 5
fields:
  - account_id
  - src_ip
  - session_id
level: critical
falsepositives:
  - User salah ketik berulang (jarang > 5)
```

---

## 4. Splunk SPL (siap pakai)

**Spraying:**
```spl
index=auth action=login_failed earliest=-10m
| stats dc(username) AS distinct_users count AS attempts by src_ip
| where distinct_users > 15
| sort - distinct_users
```

**OTP brute force:**
```spl
index=auth action=otp_verify_failed earliest=-5m
| stats count AS otp_fails by account_id, src_ip
| where otp_fails > 5
```

---

## 5. Rekomendasi Respons Otomatis
- Trigger **step-up/CAPTCHA** setelah N gagal per IP/akun.
- **Lockout sementara** + exponential backoff per akun, dan **rate-limit per IP/ASN**.
- Untuk OTP: maksimum 3–5 percobaan per kode, **kode hangus** setelah gagal, dan OTP baru wajib invalidate yang lama.
- Alert ke SOC bila rule level `high`/`critical` menyala; auto-block sementara untuk `critical`.
