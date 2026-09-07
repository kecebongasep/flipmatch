// Backend 'firebase': sinkronisasi lewat Firebase Realtime Database.
// Bisa dipakai lintas perangkat/laptop (misalnya saat game dihost di GitHub Pages).
// Membutuhkan window.FIREBASE_CONFIG diisi di firebase-config.js.
;(function () {
	let appPromise = null

	async function getFirebase() {
		if (!appPromise) {
			appPromise = (async () => {
				const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js')
				const { getDatabase, ref, set, get, onValue, runTransaction } = await import(
					'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js'
				)
				const { getAuth, signInAnonymously } = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js')
				const app = initializeApp(window.FIREBASE_CONFIG)
				const db = getDatabase(app)
				const auth = getAuth(app)
				try {
					await signInAnonymously(auth)
				} catch (e) {
					console.warn('Anonymous sign-in gagal. Pastikan sudah diaktifkan di Firebase Console.', e)
				}
				return { ref, set, get, onValue, runTransaction, db }
			})()
		}
		return appPromise
	}

	const FirebaseStore = {
		async createRoom(room) {
			const { ref, set, db } = await getFirebase()
			await set(ref(db, `rooms/${room.code}`), room)
			return room
		},
		async getRoom(code) {
			const { ref, get, db } = await getFirebase()
			const snap = await get(ref(db, `rooms/${code}`))
			return snap.exists() ? snap.val() : null
		},
		subscribeRoom(code, cb) {
			let unsub = () => {}
			let cancelled = false
			getFirebase().then(({ ref, onValue, db }) => {
				if (cancelled) return
				const r = ref(db, `rooms/${code}`)
				unsub = onValue(r, (snap) => cb(snap.exists() ? snap.val() : null))
			})
			return () => {
				cancelled = true
				unsub()
			}
		},
		async updateRoom(code, mutator) {
			const { ref, runTransaction, db } = await getFirebase()
			const result = await runTransaction(ref(db, `rooms/${code}`), (room) => {
				if (room === null || room === undefined) return room
				return mutator(room) || room
			})
			return result.committed ? result.snapshot.val() : null
		},
	}
	window.FirebaseStore = FirebaseStore
})()
