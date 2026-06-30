# Surat Otorisasi Pengujian (Authorization to Test) & Rules of Engagement (RoE)

> Dokumen ini WAJIB ditandatangani oleh pemilik/penanggung jawab sistem **sebelum** aktivitas pengujian apa pun dimulai. Tanpa tanda tangan pada bagian Persetujuan di bawah, tidak ada satu pun pengujian yang boleh dijalankan.

---

## 1. Para Pihak

| Peran | Detail |
|---|---|
| **Penyedia Pengujian (Tester)** | Yubiteck |
| Penanggung Jawab Teknis (Lead) | Nandang Eka Prasetya — Security Researcher |
| Kontak Tester | [email] · [telepon] |
| **Pemilik Sistem (Client)** | [Nama Perusahaan / Organisasi] |
| PIC Client (Authorizing Officer) | [Nama] — [Jabatan] |
| Kontak PIC | [email] · [telepon] |
| Kontak Darurat Client (24/7) | [Nama] — [telepon] |

PIC Client menyatakan dirinya **berwenang secara sah** untuk memberikan izin pengujian atas seluruh aset yang tercantum dalam Bagian 3.

---

## 2. Tujuan & Dasar

Pengujian bertujuan mengidentifikasi celah keamanan, menilai tingkat risiko, dan memberikan rekomendasi perbaikan. Pengujian dilakukan atas dasar permintaan dan otorisasi tertulis Client, sesuai prinsip *authorized testing*.

---

## 3. Ruang Lingkup (Scope)

### 3.1 Aset Dalam Lingkup (In-Scope)
| # | Aset / Target | Tipe | Lingkungan | Catatan |
|---|---|---|---|---|
| 1 | [domain / IP / URL] | Web / API / Host | Prod / Staging | |
| 2 | | | | |

### 3.2 Aset Luar Lingkup (Out-of-Scope) — DILARANG diuji
- Seluruh aset yang tidak tercantum di 3.1
- Infrastruktur pihak ketiga (CDN, payment gateway, SSO provider, dsb.) kecuali ada izin tertulis terpisah dari pemiliknya
- [tambahkan: subdomain, sistem produksi kritikal, dsb.]

---

## 4. Jenis & Metode Pengujian yang Diizinkan

Tandai (✔) yang disetujui Client:

- [ ] Reconnaissance pasif & enumerasi
- [ ] Pengujian kerentanan aplikasi web (OWASP Top 10 / ASVS)
- [ ] Pengujian autentikasi & otorisasi (lihat batasan Bagian 6)
- [ ] **Pengujian ketahanan kontrol** (rate-limit / lockout / MFA enforcement) — *menguji bahwa pertahanan bekerja, bukan menembus akun*
- [ ] Pengujian API
- [ ] [lainnya]

---

## 5. Jendela Waktu (Testing Window)

| Item | Detail |
|---|---|
| Tanggal mulai | [tgl] |
| Tanggal selesai | [tgl] |
| Jam yang diizinkan | [mis. 22:00–04:00 WIB / kapan saja] |
| Zona waktu | WIB (UTC+7) |
| Pemberitahuan sebelum mulai | [mis. H-1 ke PIC] |

Pengujian **di luar jendela waktu ini dilarang** tanpa persetujuan tertulis tambahan.

---

## 6. Batasan Teknis (Constraints)

- **Tidak ada serangan Denial of Service / stress yang merusak ketersediaan.** Pengujian beban hanya untuk memverifikasi rate-limit/lockout dengan volume yang disepakati di Bagian 7.
- **Tidak ada eksfiltrasi data nyata.** Jika ditemukan akses ke data sensitif, hentikan, dokumentasikan buktinya secukupnya (screenshot/metadata), jangan unduh isi.
- **Akun uji:** gunakan kredensial uji yang disediakan Client jika tersedia. Pengujian autentikasi tidak boleh menargetkan akun pengguna riil tanpa persetujuan eksplisit.
- Tidak melakukan modifikasi/penghapusan data produksi.
- Tidak memasang backdoor/persistence; seluruh artefak uji wajib dibersihkan setelah engagement.

---

## 7. Parameter Pengujian Ketahanan Kontrol (Rate-limit / Lockout)

Agar pengujian rate-limit tidak menjadi DoS, batas berikut disepakati:

| Parameter | Nilai disepakati |
|---|---|
| Maksimum request/detik per target | [mis. 20 rps] |
| Maksimum koneksi konkuren | [mis. 5] |
| Endpoint yang diuji | [mis. POST /auth/login, POST /auth/otp] |
| Kredensial yang dipakai | Akun uji khusus / dummy (BUKAN akun riil) |
| Kriteria keberhasilan kontrol | Lockout/429 muncul setelah N percobaan |

---

## 8. Kondisi Penghentian (Stop Conditions)

Pengujian **dihentikan segera** dan PIC dihubungi bila:
- Terindikasi gangguan ketersediaan layanan (degradasi/timeout meluas)
- Ditemukan data pihak ketiga / data pribadi dalam jumlah besar
- Ditemukan kerentanan kritikal yang berisiko aktif dieksploitasi pihak lain
- Client meminta penghentian (alasan apa pun)

---

## 9. Kerahasiaan & Penanganan Data

- Seluruh temuan, kredensial, dan data yang ditemui bersifat **rahasia**.
- Bukti disimpan terenkripsi, hanya untuk keperluan laporan, dan dihapus [mis. 30 hari] setelah laporan final diterima.
- Laporan hanya diserahkan kepada PIC yang berwenang.

---

## 10. Penyerahan Hasil (Deliverables)

- Laporan temuan + tingkat risiko (CVSS) + rekomendasi remediasi
- Bukti teknis (PoC) seperlunya
- Sesi pemaparan (opsional)

---

## 11. Persetujuan (Wajib Tanda Tangan)

Dengan menandatangani di bawah ini, **Pemilik Sistem memberikan izin** kepada Tester untuk melaksanakan pengujian sesuai ruang lingkup dan batasan dokumen ini.

| | Pemilik Sistem (Client) | Penyedia Pengujian (Yubiteck) |
|---|---|---|
| Nama | | Nandang Eka Prasetya |
| Jabatan | | Security Researcher |
| Tanda tangan | __________________ | __________________ |
| Tanggal | | |

> **Catatan:** Engagement tidak dimulai sampai kedua tanda tangan lengkap dan salinan dokumen ini dipegang kedua pihak.
