const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => [...document.querySelectorAll(s)]

function esc(v) {
	return String(v).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]))
}
function fmt(sec) {
	sec = Math.max(0, Math.round(sec))
	return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
}
function toast(msg) {
	const el = $('#toast')
	el.textContent = msg
	el.classList.add('show')
	clearTimeout(toast.id)
	toast.id = setTimeout(() => el.classList.remove('show'), 2200)
}

// ---- Excel/CSV import (sama seperti versi offline) ----
function parseCsv(text) {
	const rows = []
	let row = [], cell = '', quoted = false
	for (let i = 0; i < text.length; i++) {
		const c = text[i], n = text[i + 1]
		if (c === '"') {
			if (quoted && n === '"') { cell += '"'; i++ } else quoted = !quoted
		} else if (c === ',' && !quoted) { row.push(cell); cell = '' }
		else if ((c === '\n' || c === '\r') && !quoted) {
			if (c === '\r' && n === '\n') i++
			row.push(cell)
			if (row.some((v) => String(v).trim())) rows.push(row)
			row = []; cell = ''
		} else cell += c
	}
	row.push(cell)
	if (row.some((v) => String(v).trim())) rows.push(row)
	return rows
}
async function unzipEntries(buffer) {
	const view = new DataView(buffer), bytes = new Uint8Array(buffer), dec = new TextDecoder()
	let eocd = -1
	for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
		if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break }
	}
	if (eocd < 0) throw new Error('File XLSX tidak valid.')
	const count = view.getUint16(eocd + 10, true), offset = view.getUint32(eocd + 16, true)
	let pos = offset
	const out = {}
	for (let k = 0; k < count; k++) {
		if (view.getUint32(pos, true) !== 0x02014b50) break
		const method = view.getUint16(pos + 10, true), size = view.getUint32(pos + 20, true), nameLen = view.getUint16(pos + 28, true), extraLen = view.getUint16(pos + 30, true), commentLen = view.getUint16(pos + 32, true), local = view.getUint32(pos + 42, true)
		const name = dec.decode(bytes.slice(pos + 46, pos + 46 + nameLen))
		if (!name.endsWith('/')) {
			const localName = view.getUint16(local + 26, true), localExtra = view.getUint16(local + 28, true)
			const start = local + 30 + localName + localExtra
			const raw = bytes.slice(start, start + size)
			let data
			if (method === 0) data = raw
			else if (method === 8) {
				if (!('DecompressionStream' in window)) throw new Error('Browser belum mendukung import XLSX. Gunakan Chrome/Edge terbaru atau CSV.')
				const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
				data = new Uint8Array(await new Response(stream).arrayBuffer())
			} else throw new Error('Kompresi XLSX tidak didukung.')
			out[name] = data
		}
		pos += 46 + nameLen + extraLen + commentLen
	}
	return out
}
function xmlDoc(bytes) {
	return new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml')
}
function columnIndex(ref) {
	const letters = (ref.match(/[A-Z]+/i) || ['A'])[0].toUpperCase()
	let n = 0
	for (const c of letters) n = n * 26 + c.charCodeAt(0) - 64
	return n - 1
}
async function parseXlsx(buffer) {
	const files = await unzipEntries(buffer)
	const shared = []
	if (files['xl/sharedStrings.xml']) {
		const doc = xmlDoc(files['xl/sharedStrings.xml'])
		for (const si of doc.getElementsByTagName('si')) shared.push([...si.getElementsByTagName('t')].map((t) => t.textContent || '').join(''))
	}
	const sheetName = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0]
	if (!sheetName) throw new Error('Sheet Excel tidak ditemukan.')
	const doc = xmlDoc(files[sheetName])
	const rows = []
	for (const rowEl of doc.getElementsByTagName('row')) {
		const row = []
		for (const c of rowEl.getElementsByTagName('c')) {
			const idx = columnIndex(c.getAttribute('r') || 'A1'), type = c.getAttribute('t')
			const v = c.getElementsByTagName('v')[0]?.textContent || ''
			row[idx] = type === 's' ? (shared[Number(v)] ?? '') : type === 'inlineStr' ? [...c.getElementsByTagName('t')].map((t) => t.textContent || '').join('') : v
		}
		if (row.some((v) => String(v ?? '').trim())) rows.push(row)
	}
	return rows
}
function rowsToPairs(rows) {
	if (!rows.length) throw new Error('File tidak memiliki data.')
	let start = 0, q = 0, a = 1
	const headers = rows[0].map((v) => String(v ?? '').trim().toLowerCase())
	const qi = headers.findIndex((v) => ['soal', 'pertanyaan', 'question'].includes(v))
	const ai = headers.findIndex((v) => ['jawaban', 'answer', 'pasangan'].includes(v))
	if (qi >= 0 && ai >= 0) { q = qi; a = ai; start = 1 }
	const pairs = rows.slice(start).map((r) => [String(r[q] ?? '').trim(), String(r[a] ?? '').trim()]).filter((p) => p[0] || p[1])
	if (pairs.length < 2) throw new Error('Minimal harus ada 2 pasangan soal dan jawaban.')
	if (pairs.some((p) => !p[0] || !p[1])) throw new Error('Ada baris dengan soal atau jawaban kosong.')
	return pairs.slice(0, 20)
}
async function importFile(file) {
	try {
		const rows = file.name.toLowerCase().endsWith('.csv') ? parseCsv(await file.text()) : await parseXlsx(await file.arrayBuffer())
		pairs = rowsToPairs(rows)
		renderPairs()
		$('#setupError').hidden = true
		toast(`${pairs.length} pasangan berhasil diimport.`)
	} catch (err) {
		$('#setupError').hidden = false
		$('#setupError').textContent = err.message || 'File gagal diimport.'
	} finally {
		$('#excelFile').value = ''
	}
}

// ---- State ----
let pairs = [
	['7 \u00d7 8', '56'],
	['12 + 9', '21'],
	['15 \u2212 6', '9'],
	['100 \u00f7 4', '25'],
]
let mode = 'individual'
let room = null
let unsub = null
let timerInt = null

function renderPairs() {
	$('#pairList').innerHTML = pairs
		.map(
			(p, i) =>
				`<div class="pair-row" data-index="${i + 1}"><input aria-label="Soal ${i + 1}" data-i="${i}" data-side="0" value="${esc(p[0])}" placeholder="Contoh: 7 \u00d7 8"><input aria-label="Jawaban ${i + 1}" data-i="${i}" data-side="1" value="${esc(p[1])}" placeholder="Contoh: 56"><button class="remove-pair" data-remove="${i}" type="button">\u00d7</button></div>`
		)
		.join('')
	$$('[data-i]').forEach((inp) => inp.addEventListener('input', (e) => { pairs[+e.target.dataset.i][+e.target.dataset.side] = e.target.value }))
	$$('[data-remove]').forEach((btn) =>
		btn.addEventListener('click', () => {
			if (pairs.length <= 2) return toast('Minimal 2 pasangan.')
			pairs.splice(+btn.dataset.remove, 1)
			renderPairs()
		})
	)
}

$('#addPair').addEventListener('click', () => {
	if (pairs.length >= 20) return toast('Maksimal 20 pasangan.')
	pairs.push(['', ''])
	renderPairs()
	$('#pairList').lastElementChild?.querySelector('input')?.focus()
})
$('#importExcel').addEventListener('click', () => $('#excelFile').click())
$('#excelFile').addEventListener('change', (e) => {
	const file = e.target.files?.[0]
	if (file) importFile(file)
})
$$('input[name="mode"]').forEach((r) =>
	r.addEventListener('change', (e) => {
		mode = e.target.value
		$$('.radio-chip').forEach((chip) => chip.classList.toggle('checked', chip.querySelector('input').checked))
		$('#groupSizeWrap').hidden = mode !== 'group'
	})
)

function playerLinkFor(code) {
	return new URL(`player.html?code=${code}`, location.href).toString()
}

$('#createRoomBtn').addEventListener('click', async () => {
	const title = $('#gameTitle').value.trim()
	const duration = Number($('#duration').value)
	const groupSize = Number($('#groupSize').value)
	const activePairs = pairs.filter((p) => p[0].trim() && p[1].trim())
	if (activePairs.length < 2) {
		$('#setupError').hidden = false
		$('#setupError').textContent = 'Minimal 2 pasangan soal & jawaban yang lengkap.'
		return
	}
	$('#setupError').hidden = true
	room = GameLogic.createRoom({ title, pairs: activePairs, duration, mode, groupSize })
	await Store.createRoom(room)
	subscribeToRoom(room.code)
	showLobby(room)
})

function subscribeToRoom(code) {
	if (unsub) unsub()
	unsub = Store.subscribeRoom(code, (r) => {
		if (!r) return
		room = r
		renderFromRoom()
	})
}

function renderFromRoom() {
	if (!room) return
	if (room.status === 'lobby') showLobby(room)
	else showMonitor(room)
}

function showLobby(r) {
	$('#setupPanel').hidden = true
	$('#lobbyPanel').hidden = false
	$('#monitorPanel').hidden = true
	$('#roomCodeDisplay').textContent = r.code
	$('#playerLink').value = playerLinkFor(r.code)
	if (window.FLIPMATCH_IS_LOCAL) {
		$('#backendNote').hidden = false
		$('#backendNote').textContent = 'Mode lokal aktif: link ini hanya bisa dibuka di TAB lain pada komputer ini. Untuk dimainkan lintas laptop (misalnya lewat GitHub Pages), atur backend ke "firebase" di firebase-config.js.'
	} else {
		$('#backendNote').hidden = true
	}
	renderLobbyPlayerList(r)
	$('#startRoomBtn').disabled = Object.keys(r.players).length === 0
}

function renderLobbyPlayerList(r) {
	if (r.mode === 'group') {
		const html = Object.values(r.groups)
			.map(
				(g) =>
					`<div class="lobby-group"><strong>${esc(g.name)}</strong> (${g.memberIds.length}/${r.groupSize})<ul>${g.memberIds.map((id) => `<li>${esc(r.players[id]?.name || '?')}</li>`).join('')}</ul></div>`
			)
			.join('')
		$('#lobbyPlayers').innerHTML = html || '<p class="muted">Belum ada pemain.</p>'
	} else {
		const html = Object.values(r.players)
			.map((p) => `<div class="lobby-player">${esc(p.name)}</div>`)
			.join('')
		$('#lobbyPlayers').innerHTML = html || '<p class="muted">Belum ada pemain.</p>'
	}
}

$('#startRoomBtn').addEventListener('click', async () => {
	const updated = await Store.updateRoom(room.code, (rm) => {
		if (Object.keys(rm.players).length === 0 || rm.status !== 'lobby') return rm
		return GameLogic.startRoom(rm)
	})
	if (updated) {
		room = updated
		showMonitor(room)
		startMonitorTimer()
	}
})

$('#cancelRoomBtn').addEventListener('click', resetToSetup)
$('#newRoomBtn').addEventListener('click', resetToSetup)

function resetToSetup() {
	clearInterval(timerInt)
	if (unsub) unsub()
	room = null
	$('#monitorPanel').hidden = true
	$('#lobbyPanel').hidden = true
	$('#setupPanel').hidden = false
}

$('#copyLinkBtn').addEventListener('click', () => {
	const input = $('#playerLink')
	input.select()
	navigator.clipboard?.writeText(input.value).then(() => toast('Link disalin.')).catch(() => toast('Gagal menyalin, salin manual dari kotak teks.'))
})

function showMonitor(r) {
	$('#setupPanel').hidden = true
	$('#lobbyPanel').hidden = true
	$('#monitorPanel').hidden = false
	renderMonitor(r)
}

function renderMonitor(r) {
	const remaining = r.startedAt ? Math.max(0, r.duration - Math.floor((Date.now() - r.startedAt) / 1000)) : r.duration
	$('#monitorTimer').textContent = fmt(remaining)
	const entities = r.mode === 'group' ? Object.values(r.groups) : Object.values(r.boards)
	$('#monitorGrid').innerHTML = entities
		.map((e) => {
			const total = e.deck.length / 2
			const matched = (e.matchedIds || []).length / 2
			const openCards = (e.pendingOpen || []).map((i) => e.deck[i]?.text).filter(Boolean)
			const turnName = r.mode === 'group' ? esc(r.players[e.memberIds[e.turnIndex % e.memberIds.length]]?.name || '?') : ''
			const label = r.mode === 'group' ? esc(e.name) : esc(r.players[e.id]?.name || '?')
			const members = r.mode === 'group' ? e.memberIds.map((id) => esc(r.players[id]?.name || '?')).join(', ') : ''
			return `<div class="monitor-card ${e.finishedAt ? 'done' : ''}">
		<h4>${label}</h4>
		${members ? `<p class="monitor-members">${members}</p>` : ''}
		<p>Cocok: <strong>${matched}/${total}</strong> &middot; Langkah: <strong>${e.moves || 0}</strong></p>
		${r.mode === 'group' ? `<p>Giliran: <strong>${turnName}</strong></p>` : ''}
		<p>Kartu terbuka: ${openCards.length ? openCards.map((t) => `<span class="chip">${esc(t)}</span>`).join(' ') : '<em>-</em>'}</p>
		${e.finishedAt ? '<span class="done-badge">Selesai</span>' : ''}
		</div>`
		})
		.join('')
	renderLeaderboard(r)
	maybeFinalize(r, entities, remaining)
}

function renderLeaderboard(r) {
	const board = GameLogic.leaderboard(r)
	$('#leaderboardBody').innerHTML = board
		.map(
			(row, i) =>
				`<tr><td>${i + 1}</td><td>${esc(row.name)}${row.members ? ` <span class="muted">(${row.members.map(esc).join(', ')})</span>` : ''}</td><td>${row.matchedCount}/${row.total}</td><td>${row.moves}</td><td>${row.finished ? 'Selesai' : 'Berjalan'}</td></tr>`
		)
		.join('')
}

function startMonitorTimer() {
	clearInterval(timerInt)
	timerInt = setInterval(() => {
		if (room) renderMonitor(room)
	}, 1000)
}

let finalizing = false
async function maybeFinalize(r, entities, remaining) {
	if (finalizing) return
	const expired = remaining <= 0
	const pendingEntities = entities.filter((e) => !e.finishedAt && (expired || false))
	if (!pendingEntities.length) return
	finalizing = true
	try {
		for (const e of pendingEntities) {
			const updated = await Store.updateRoom(r.code, (rm) => {
				GameLogic.forceFinishIfExpired(rm, e.id)
				return rm
			})
			if (updated) room = updated
		}
	} finally {
		finalizing = false
	}
}

$('#endNowBtn').addEventListener('click', async () => {
	const updated = await Store.updateRoom(room.code, (rm) => {
		const entities = rm.mode === 'group' ? Object.values(rm.groups) : Object.values(rm.boards)
		entities.forEach((e) => {
			if (!e.finishedAt) e.finishedAt = Date.now()
		})
		return rm
	})
	if (updated) {
		room = updated
		renderMonitor(room)
	}
})

renderPairs()
