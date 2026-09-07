# FlipMatch Online — Multiplayer Lintas Perangkat

Versi FlipMatch yang bisa dimainkan banyak orang dari laptop masing-masing (misalnya lewat GitHub Pages). Ada 2 halaman terpisah:

- `admin.html` — admin membuat soal & jawaban, mengatur mode permainan, membuat room, memantau pergerakan tiap pemain/grup secara langsung, dan melihat klasemen.
- `player.html` — pemain memasukkan nama + kode room, menunggu di lobby sampai admin menekan **Mulai Permainan**, lalu bermain.

## Cara kerja singkat

1. Admin buka `admin.html`, isi soal/jawaban, pilih mode **Mandiri** (tiap orang main sendiri-sendiri, papan sendiri-sendiri) atau **Grup** (beberapa orang gabung 1 grup, main bergiliran di satu papan yang sama — atur jumlah orang per grup).
2. Admin klik **Buat Room** → muncul kode room + link untuk dibagikan ke pemain.
3. Setiap pemain buka `player.html`, masukkan kode room + nama, lalu menunggu di lobby. Kalau mode Grup, sistem otomatis membagi pemain ke dalam grup-grup sesuai jumlah orang yang diatur admin (grup penuh → otomatis buat grup baru).
4. Admin klik **Mulai Permainan**. Semua pemain otomatis pindah ke papan kartu masing-masing/grupnya.
5. Admin melihat panel **Permainan berlangsung**: untuk tiap pemain/grup ada jumlah pasangan cocok, langkah, giliran siapa, dan kartu yang sedang dibuka — plus tabel klasemen yang otomatis terurut.
6. Saat waktu habis atau semua pasangan ditemukan, papan itu otomatis "Selesai" dan pemain melihat hasil akhir + klasemen.

Logika pencocokan kartu sama seperti versi offline: kartu jawaban boleh dipasangkan dengan soal manapun yang punya jawaban sama persis (misal "4 + 4" dan "16 ÷ 2" yang jawabannya sama-sama "8").

## PENTING: perlu backend realtime

GitHub Pages hanya menyajikan file statis — tidak ada server. Supaya admin & pemain di laptop yang berbeda-beda bisa saling melihat data yang sama secara langsung, game ini butuh database realtime gratis. Semua pengaturan ada di **`firebase-config.js`**:

```js
window.FLIPMATCH_BACKEND = 'local' // ganti jadi 'firebase' untuk main lintas laptop
window.FIREBASE_CONFIG = { ...isi sendiri... }
```

- **`'local'`** (bawaan): hanya untuk uji coba di beberapa **tab pada satu komputer yang sama** (pakai localStorage). Tidak bisa dipakai lintas laptop/HP. Cocok untuk mencoba alur admin+pemain sebelum deploy.
- **`'firebase'`**: bisa dipakai lintas laptop/HP di internet, termasuk saat dihost di GitHub Pages. Wajib diisi dulu dengan project Firebase milik Anda sendiri (gratis).

## Setup Firebase (gratis, ±5 menit)

1. Buka https://console.firebase.google.com → **Add project** → beri nama (misal `flipmatch-online`) → lanjutkan (Google Analytics boleh dimatikan) → **Create project**.
2. Di sidebar kiri, buka **Build → Realtime Database** → **Create Database** → pilih lokasi server (misal Singapore) → pilih **Start in test mode** (bisa diperketat nanti, lihat bagian Rules di bawah) → **Enable**.
3. Di sidebar kiri, buka **Build → Authentication** → **Get started** → tab **Sign-in method** → aktifkan provider **Anonymous** → **Save**.
4. Di sidebar kiri klik ikon gerigi → **Project settings** → scroll ke **Your apps** → klik ikon **Web (`</>`)** → beri nama app → **Register app**. Salin object `firebaseConfig` yang muncul.
5. Tempel nilai-nilainya ke `firebase-config.js` di `window.FIREBASE_CONFIG`, lalu ubah `window.FLIPMATCH_BACKEND = 'firebase'`.
6. Di **Realtime Database → Rules**, gunakan aturan berikut (hanya pengguna yang sudah login anonim yang boleh baca/tulis) lalu **Publish**:

```json
{
  "rules": {
    "rooms": {
      "$code": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  }
}
```

> Catatan keamanan: game ini didesain untuk kelas/acara kasual (bukan kompetisi berhadiah). Logika permainan berjalan di sisi pemain (client-side), jadi pemain yang sangat teknis bisa saja membuka konsol browser untuk melihat jawaban. Untuk kuis santai/kelas, ini biasanya bukan masalah.

## Deploy ke GitHub Pages

1. Buat repository baru di GitHub, upload semua file di folder ini (`admin.html`, `player.html`, `firebase-config.js`, folder `shared/`, dst) ke root repo (atau ke folder `/docs`).
2. Isi `firebase-config.js` seperti langkah di atas (backend `'firebase'`) **sebelum** upload, supaya semua orang otomatis pakai konfigurasi yang sama.
3. Buka **Settings → Pages** di repo tersebut → pilih branch (misal `main`) dan folder (`/ (root)` atau `/docs`) → **Save**.
4. Tunggu beberapa menit, lalu buka link yang muncul, contoh:
   - Admin: `https://namamu.github.io/repo-ini/admin.html`
   - Pemain: `https://namamu.github.io/repo-ini/player.html`
5. Bagikan link **admin.html** ke diri sendiri, dan link **player.html** (atau link dengan `?code=KODEROOM` yang otomatis muncul di panel admin setelah room dibuat) ke semua pemain.

## Uji coba lokal dulu (tanpa Firebase)

Biarkan `FLIPMATCH_BACKEND = 'local'`, lalu jalankan server lokal sederhana (supaya localStorage konsisten antar tab):

```bash
cd flip-memory-online
python3 -m http.server 8080
```

Buka `http://localhost:8080/admin.html` di satu tab dan `http://localhost:8080/player.html` di tab lain (browser & komputer yang sama) untuk mencoba seluruh alur sebelum deploy sungguhan.

## Struktur folder

- `admin.html`, `admin.js` — halaman & logika admin.
- `player.html`, `player.js` — halaman & logika pemain.
- `firebase-config.js` — pilihan backend + kunci konfigurasi Firebase (isi sendiri).
- `shared/game-logic.js` — logika inti permainan (acak kartu, cek jawaban sama, giliran grup, klasemen) — dipakai admin & pemain supaya hasilnya selalu konsisten.
- `shared/store-local.js`, `shared/store-firebase.js`, `shared/store.js` — lapisan penyimpanan/sinkronisasi data (bisa tukar backend tanpa mengubah logika permainan).
- `shared/styles.css` — tampilan visual, termasuk animasi flip & efek suara saat kartu cocok.

## Fitur

- 2 halaman terpisah: Admin dan Pemain, siap dipisah linknya.
- Pemain memasukkan nama sendiri dan menunggu admin memulai game (lobby real-time).
- Mode **Mandiri**: tiap pemain punya papan kartu sendiri, main serentak.
- Mode **Grup**: admin mengatur jumlah orang per grup; sistem otomatis mengelompokkan pemain yang bergabung; anggota grup main bergiliran di satu papan yang sama (persis seperti mode multiplayer lokal sebelumnya).
- Dashboard admin real-time: jumlah pasangan cocok, langkah, giliran siapa, dan **kartu yang sedang dibuka** untuk setiap pemain/grup.
- Klasemen otomatis terurut berdasarkan jumlah pasangan cocok, lalu langkah, lalu waktu.
- Import soal dari Excel `.xlsx`/`.csv` (sama seperti versi offline).
- Animasi flip kartu & efek suara saat pasangan ditemukan.
- Aturan pencocokan jawaban sama tetap berlaku: soal berbeda dengan jawaban identik bisa saling dipasangkan.
