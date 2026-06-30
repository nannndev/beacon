# Defense-Validation Test Plan — Memverifikasi Rate-Limit & Lockout

Tujuan: **membuktikan bahwa kontrol pertahanan target bekerja** (rate-limit, lockout, OTP attempt cap). Ini BUKAN menebak kredensial — kita kirim kredensial **dummy yang sengaja salah** dan mengamati apakah pertahanan menyala. Hasilnya valid sebagai temuan, terlepas dari apakah login berhasil atau tidak.

> Prasyarat: dokumen **01-authorization-to-test-RoE.md** sudah ditandatangani, dan parameter di Bagian 7 dokumen tersebut disepakati (rps, konkuren, endpoint).

---

## Prinsip yang membedakan ini dari serangan

| Defense validation (ini) | Serangan auth (tidak dilakukan) |
|---|---|
| Kredensial **dummy konstan** yang salah | Wordlist / breach list / kombinasi nyata |
| Tujuan: lihat **kapan kontrol memblokir** | Tujuan: menemukan kredensial yang benar |
| Berhenti **begitu kontrol terbukti jalan** | Lanjut sampai dapat akses |
| Volume dibatasi RoE, anti-DoS | Volume maksimal |

---

## Skenario uji

### A. Rate-limit per IP pada login
1. Kirim request `POST /auth/login` dengan body `{username: "pentest-dummy", password: "wrong-constant"}` berulang.
2. Naikkan perlahan sampai mencapai batas rps yang disepakati.
3. **Ekspektasi:** setelah N request, respons berubah jadi `429 Too Many Requests` (atau header `Retry-After` muncul).
4. **Temuan jika gagal:** tidak ada `429` walau ratusan request → rate-limit absen/lemah.

### B. Lockout per akun
1. Pakai **satu** username uji yang disediakan Client, password salah konstan.
2. **Ekspektasi:** akun terkunci/throttled setelah N percobaan; reset butuh waktu/backoff.
3. **Temuan jika gagal:** percobaan tak terbatas tanpa lockout.

### C. OTP attempt cap
1. Minta OTP untuk akun uji, lalu submit kode salah konstan (mis. `000000`) berulang.
2. **Ekspektasi:** setelah 3–5 gagal, kode hangus & minta OTP baru.
3. **Temuan jika gagal:** OTP bisa di-retry tanpa batas → ruang tebak 6 digit jadi feasible.

### D. Bypass rate-limit (control robustness)
- Ulangi skenario A sambil variasikan header `X-Forwarded-For`, casing path (`/Auth/Login`), trailing slash.
- **Temuan jika gagal:** rate-limit bisa di-reset dengan trik header → tidak efektif.

---

## Menggunakan tool yang sudah ada di repo ini

Engine di [core/tester.py](../../core/tester.py) sudah bisa menembakkan request berulang/konkuren dengan stats live (`attempts`, `success`, `rate_limited`, `errors`) — itu **persis** yang dibutuhkan untuk skenario A/B.

Konfigurasi yang disarankan (defense-validation, bukan attack):

```json
{
  "base_url": "https://TARGET-IN-SCOPE",
  "variables": { "dummy_user": "pentest-dummy", "dummy_pass": "wrong-constant" },
  "endpoints": [
    {
      "name": "login-ratelimit-probe",
      "method": "POST",
      "url": "/auth/login",
      "payload_type": "json",
      "payload": { "username": "{{dummy_user}}", "password": "{{dummy_pass}}" }
    }
  ]
}
```

Jalankan dengan:
- `concurrency` & `delay` **sesuai batas RoE Bagian 7** (mis. konkuren 5, throttle agar ≤20 rps).
- Amati panel stats: begitu `rate_limited` mulai naik → kontrol terbukti jalan, **hentikan** (stop flag).
- Karena payload memakai satu kredensial dummy konstan (bukan generator/wordlist), ini menguji throttle, bukan menebak akun.

> Catatan engine: detektor "rate-limited" di repo ini = HTTP 429 **atau** teks respons mengandung "rate"/"too many". Verifikasi manual sekali bahwa target memakai 429 standar agar metrik akurat.

---

## Pelaporan
Untuk tiap skenario catat: endpoint, jumlah request sampai kontrol menyala (atau "tidak pernah"), kode/dasar respons, dan rekomendasi (lihat dokumen 03). Skenario yang **gagal memblokir** adalah temuan; petakan severity dengan CVSS.
