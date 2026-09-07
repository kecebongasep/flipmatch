// Memilih backend penyimpanan aktif berdasarkan firebase-config.js
;(function () {
	const backend = window.FLIPMATCH_BACKEND === 'firebase' ? window.FirebaseStore : window.LocalStore
	window.Store = backend
	window.FLIPMATCH_IS_LOCAL = window.FLIPMATCH_BACKEND !== 'firebase'
})()
