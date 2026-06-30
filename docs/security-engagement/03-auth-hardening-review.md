# Auth Hardening Review Checklist

Checklist untuk me-review alur login / OTP / MFA milik sendiri (atau target in-scope) terhadap kelemahan umum. Ini **review pertahanan** — bukan menebak kredensial. Petakan ke OWASP ASVS v4 (Chapter 2: Authentication).

---

## 1. Rate Limiting & Lockout
- [ ] Ada rate-limit **per IP** pada endpoint login & OTP (ASVS 2.2.1)
- [ ] Ada lockout / throttling **per akun** (mencegah brute force satu akun)
- [ ] Ada throttling **per-credential-pair** atau deteksi volume (mencegah spraying lintas akun yang melewati lockout per-akun)
- [ ] Exponential backoff, bukan sekadar counter reset cepat
- [ ] Rate-limit tidak mudah di-bypass dengan ganti header (`X-Forwarded-For`, casing path, trailing slash)
- [ ] CAPTCHA / step-up muncul setelah N kegagalan

## 2. OTP Design
- [ ] Panjang & entropi memadai (≥6 digit; pertimbangkan alfanumerik untuk aksi sensitif)
- [ ] **Maksimum percobaan** per kode (3–5), lalu kode hangus (ASVS 2.5.x)
- [ ] **Masa berlaku pendek** (mis. 2–5 menit)
- [ ] OTP **single-use** — invalid setelah dipakai
- [ ] OTP lama **di-invalidate** saat OTP baru diminta
- [ ] Rate-limit pada **request pengiriman OTP** (cegah SMS bombing / cost abuse)
- [ ] OTP tidak dikembalikan/terbocor di response body, header, atau log

## 3. Username / Account Enumeration
- [ ] Pesan error login **seragam** ("kredensial salah"), tidak membedakan "user tidak ada" vs "password salah" (ASVS 2.2.x)
- [ ] Endpoint register / reset-password / OTP tidak membocorkan keberadaan akun
- [ ] **Timing** respons seragam (tidak ada selisih waktu yang membocorkan user valid)
- [ ] Kode status & redirect tidak berbeda antara user ada/tidak ada

## 4. MFA Enforcement
- [ ] MFA benar-benar **dipaksakan** di sisi server, bukan hanya disembunyikan di UI
- [ ] Tidak bisa skip langkah MFA dengan langsung memanggil endpoint pasca-login
- [ ] "Remember device" punya masa berlaku & bisa dicabut
- [ ] Recovery/backup code aman & sekali pakai

## 5. Session & Token
- [ ] Session di-rotate setelah login & setelah step-up MFA
- [ ] Token punya expiry wajar; refresh token bisa dicabut
- [ ] Logout benar-benar invalidate sesi di server
- [ ] Cookie: `HttpOnly`, `Secure`, `SameSite` sesuai

## 6. Credential Hygiene
- [ ] Password hashing kuat (bcrypt/scrypt/argon2), bukan MD5/SHA tanpa salt
- [ ] Cek password terhadap daftar bocoran (k-anonymity / HIBP range API)
- [ ] Tidak ada kredensial/secret hardcoded (cek juga `config/tests.json` di repo ini)

---

## Cara memakai di engagement
1. Isi checklist sambil membaca kode & mengobservasi response (lihat dokumen 04 untuk verifikasi rate-limit secara empiris).
2. Setiap item gagal → jadikan **temuan** dengan severity (CVSS) + rekomendasi.
3. Lampirkan ke laporan final.
