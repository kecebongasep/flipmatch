// Backend 'local': sinkronisasi lewat localStorage + BroadcastChannel.
// Hanya bekerja untuk beberapa TAB di SATU komputer/browser yang sama (untuk uji coba).
// Tidak bisa dipakai untuk pemain di laptop yang berbeda-beda -- untuk itu gunakan backend 'firebase'.
;(function () {
	const PREFIX = 'flipmatch-room-'
	const channel = 'BroadcastChannel' in window ? new BroadcastChannel('flipmatch-rooms') : null

	function key(code) {
		return PREFIX + code
	}

	const LocalStore = {
		async createRoom(room) {
			localStorage.setItem(key(room.code), JSON.stringify(room))
			channel?.postMessage({ code: room.code })
			return room
		},
		async getRoom(code) {
			const raw = localStorage.getItem(key(code))
			return raw ? JSON.parse(raw) : null
		},
		subscribeRoom(code, cb) {
			let cancelled = false
			const read = () => {
				if (cancelled) return
				const raw = localStorage.getItem(key(code))
				cb(raw ? JSON.parse(raw) : null)
			}
			read()
			const onMsg = (e) => {
				if (e.data?.code === code) read()
			}
			channel?.addEventListener('message', onMsg)
			const onStorage = (e) => {
				if (e.key === key(code)) read()
			}
			window.addEventListener('storage', onStorage)
			const interval = setInterval(read, 1200)
			return () => {
				cancelled = true
				channel?.removeEventListener('message', onMsg)
				window.removeEventListener('storage', onStorage)
				clearInterval(interval)
			}
		},
		async updateRoom(code, mutator) {
			const raw = localStorage.getItem(key(code))
			const room = raw ? JSON.parse(raw) : null
			if (!room) return null
			const next = mutator(room) || room
			localStorage.setItem(key(code), JSON.stringify(next))
			channel?.postMessage({ code })
			return next
		},
	}
	window.LocalStore = LocalStore
})()
