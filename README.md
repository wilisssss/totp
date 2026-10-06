# TOTP

Apt aplikasi desktop authenticator (2FA/TOTP) yang sederhana dan offline —
Rust + [Tauri v2](https://tauri.app) untuk backend, React + TypeScript +
Tailwind CSS untuk antarmuka.

<p align="center">
  <img src="src-tauri/icons/128x128.png" width="96" alt="TOTP icon" />
</p>

> Antarmuka memakai Bahasa Indonesia. Semua kode dihitung di perangkat, tanpa
> jaringan, tanpa akun, tanpa telemetry.

## Fitur

- **TOTP (RFC 6238)** dan **HOTP (RFC 4226)** — SHA1/SHA256/SHA512, 5–8 digit,
  periode & counter bisa diatur.
- **Vault terenkripsi** — Argon2id (19 MiB, t=2) + AES-256-GCM; master key
  diverifikasi lewat Argon2 verifier, file ditulis atomik dengan mode `0600`.
- **Kunci otomatis** setelah idle (default 5 menit), bisa dikunci manual.
- Tambah, ubah, hapus, pin, dan urutkan akun.
- **Impor** `otpauth://` via tempelan teks, file QR, *drag & drop*, atau
  `Ctrl+V` gambar QR (deteksi duplikat otomatis).
- **QR code** per akun untuk memindah ke perangkat lain.
- Salin kode dengan sekali klik, *countdown bar* sampai kode berganti.
- Tema terang/gelap/sistem, koreksi jam terhadap server waktu.
- Backup teks (`otpauth://` per baris) atau file.

## Keamanan

| Aspek    | Implementasi                                                       |
| -------- | ------------------------------------------------------------------ |
| KDF      | Argon2id — 19456 KiB, 2 iterasi, 1 lane, 32 byte                   |
| Enkripsi | AES-256-GCM (nonce 96 bit, acak per penyimpanan)                   |
| Verifier | Argon2 dari master key → mendeteksi passphrase salah vs file korup |
| Segresi  | Secret tidak pernah masuk snapshot; hanya `reveal_secret` terbuka  |
| Memori   | Master key & secret disimpan di `Zeroizing` (dibersihkan saat drop) |
| CSP      | `default-src 'self'` — tanpa jaringan dari dalam WebView           |

Konsekuensinya: **lupa passphrase = hilang akses**. Gunakan fitur backup.

## Bangun dari sumber

Prasyarat: Rust stable, Node.js ≥ 20, dan dependensi sistem Tauri
([lihat docs](https://tauri.app/start/prerequisites/)). Di Arch Linux:

```bash
sudo pacman -S --needed webkit2gtk-4.1 curl wget file base-devel npm
```

### Pengembangan

```bash
npm install          # dependensi frontend
npm run tauri dev    # hot-reload frontend + backend
```

### Build produksi

```bash
npm run tauri build            # frontend di-bundle, hasil di src-tauri/target/release/bundle/
./src-tauri/target/release/bundle/appimage/totp_*.AppImage
```

### Paket Arch Linux

Dari direktori `packaging/` (di CI otomatis saat tag dibuat):

```bash
cd packaging
makepkg -si          # build + install ke /usr/bin/totp
```

Atau pasang dari rilis GitHub: unduh `totp-*.pkg.tar.zst` lalu
`sudo pacman -U totp-*.pkg.tar.zst`.

## Perintah yang berguna

| Perintah              | Fungsi                                     |
| --------------------- | ------------------------------------------ |
| `npm run tauri dev`   | jalankan aplikasi dalam mode dev           |
| `npm run build`       | type-check + bundel frontend               |
| `npm run tauri build` | build aplikasi desktop (AppImage)          |
| `npm test`            | unit test frontend (Vitest)                |
| `npm run lint`        | ESLint                                     |
| `npm run format`      | Prettier                                   |
| `cargo test`          | unit test backend (RFC vectors, crypto, dsb) |

## Struktur proyek

```
src/                    # React + TypeScript
  api/                  #   binding command Tauri dan tipe DTO
  features/             #   layar: vault, entries, import, qr, settings
  components/ui/        #   modal, toast, ikon
  lib/                  #   helper murni (diuji Vitest)
src-tauri/src/          # Rust
  otp/                  #   domain OTP murni: base32, hotp, totp, uri, entry
  vault/                #   crypto (Argon2 + AES-GCM) dan penyimpanan file
  qr/                   #   decode (rqrr) dan encode (qrcode) QR
  commands/             #   permukaan IPC yang dipanggil frontend
  state.rs              #   kunci master + entri dalam memori (mutex)
packaging/              # PKGBUILD dan desktop entry
.github/workflows/      # ci.yml, release.yml
```

## Rilis

1. Perbarui `version` di `package.json` dan `src-tauri/tauri.conf.json`
   (dan `pkgver` di `packaging/PKGBUILD`).
2. Commit, lalu tag dan dorong:

```bash
git tag v0.1.0
git push origin main --tags
```

3. GitHub Actions membangun AppImage (Ubuntu) dan `totp-*.pkg.tar.zst`
   (container `archlinux:base-devel`) secara paralel, lalu menerbitkan
   **satu** rilis draft berisi kedua berkas beserta `SHA256SUMS`.
4. Pastikan kedua job hijau di tab Actions, lalu klik **Publish** pada rilis
   draft tersebut.

## Lisensi

MIT — lihat [LICENSE](LICENSE).
