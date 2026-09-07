// ======================================================================
// KONFIGURASI BACKEND FlipMatch Online
// ======================================================================
// 'local'    -> hanya untuk uji coba di beberapa TAB pada SATU komputer.
//               Tidak bisa dipakai lintas laptop/perangkat.
// 'firebase' -> bisa dipakai lintas laptop/perangkat (GitHub Pages, dll).
//               Isi FIREBASE_CONFIG di bawah dengan punya Anda sendiri,
//               lalu ubah baris di bawah menjadi 'firebase'.
// Lihat README.md bagian "Setup Firebase" untuk langkah lengkapnya.
// ======================================================================
window.FLIPMATCH_BACKEND = 'firebase'

window.FIREBASE_CONFIG = {
	apiKey: 'AIzaSyDyaJLUll4ywJ0V-jptctqSbTy1vi32fdU',
	authDomain: 'flipmatch-online.firebaseapp.com',
	databaseURL: 'https://flipmatch-online-default-rtdb.asia-southeast1.firebasedatabase.app',
	projectId: 'flipmatch-online',
	storageBucket: 'flipmatch-online.firebasestorage.app',
	messagingSenderId: '499814495245',
	appId: '1:499814495245:web:b969be35b9b4c128ae9144',
}
