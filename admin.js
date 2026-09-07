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
let tournamentPairs = []
let pairingSelected = null

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
		$('#tournamentHint').hidden = mode !== 'tournament'
	})
)

function shuffleArr(arr) {
	const a = [...arr]
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		;[a[i], a[j]] = [a[j], a[i]]
	}
	return a
}

function unpairedIds(r) {
	const pairedIds = new Set(tournamentPairs.flat())
	return Object.keys(r.players).filter((id) => !pairedIds.has(id))
}

function updateStartButtonState() {
	if (!room) return
	const totalPlayers = Object.keys(room.players).length
	if (room.mode === 'tournament') {
		$('#startRoomBtn').disabled = totalPlayers < 2 || unpairedIds(room).length > 0
	} else {
		$('#startRoomBtn').disabled = totalPlayers === 0
	}
}

function renderPairingUI(r) {
	$('#pairingPanel').hidden = r.mode !== 'tournament'
	if (r.mode !== 'tournament') return
	const pool = unpairedIds(r)
	$('#pairingPool').innerHTML = pool.length
		? pool
				.map(
					(id) =>
						`<button type="button" class="pairing-chip${pairingSelected === id ? ' selected' : ''}" data-pair-pick="${id}">${esc(r.players[id]?.name || '?')}</button>`
				)
				.join('')
		: '<p class="muted">Semua pemain sudah berpasangan.</p>'
	$('#pairingList').innerHTML = tournamentPairs.length
		? tournamentPairs
				.map(
					(pair, i) =>
						`<div class="pairing-row"><span>${pair.map((id) => esc(r.players[id]?.name || '?')).join(' vs ')}${pair.length === 1 ? ' <span class="muted">(bye, menang otomatis)</span>' : ''}</span><button type="button" class="remove-pair" data-unpair="${i}">&times;</button></div>`
				)
				.join('')
		: '<p class="muted">Belum ada pasangan.</p>'
	$$('[data-pair-pick]').forEach((btn) =>
		btn.addEventListener('click', () => {
			const id = btn.dataset.pairPick
			if (pairingSelected === null) pairingSelected = id
			else if (pairingSelected === id) pairingSelected = null
			else {
				tournamentPairs.push([pairingSelected, id])
				pairingSelected = null
			}
			renderPairingUI(room)
			updateStartButtonState()
		})
	)
	$$('[data-unpair]').forEach((btn) =>
		btn.addEventListener('click', () => {
			tournamentPairs.splice(+btn.dataset.unpair, 1)
			renderPairingUI(room)
			updateStartButtonState()
		})
	)
}

$('#autoPairBtn').addEventListener('click', () => {
	if (!room) return
	const pool = shuffleArr(unpairedIds(room))
	for (let i = 0; i < pool.length; i += 2) {
		if (i + 1 < pool.length) tournamentPairs.push([pool[i], pool[i + 1]])
		else tournamentPairs.push([pool[i]])
	}
	pairingSelected = null
	renderPairingUI(room)
	updateStartButtonState()
})
$('#clearPairsBtn').addEventListener('click', () => {
	tournamentPairs = []
	pairingSelected = null
	renderPairingUI(room)
	updateStartButtonState()
})

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
	renderPairingUI(r)
	updateStartButtonState()
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
	if (room.mode === 'tournament') {
		if (Object.keys(room.players).length < 2) return toast('Minimal 2 pemain untuk mode turnamen.')
		if (unpairedIds(room).length > 0) return toast('Pasangkan semua pemain dulu (atau pakai tombol Acak sisanya).')
		const pairsSnapshot = tournamentPairs.map((p) => [...p])
		const updated = await Store.updateRoom(room.code, (rm) => {
			if (rm.status !== 'lobby') return rm
			return GameLogic.startTournament(rm, pairsSnapshot)
		})
		if (updated) {
			room = updated
			showMonitor(room)
			startMonitorTimer()
		}
		return
	}
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
	tournamentPairs = []
	pairingSelected = null
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
	if (r.mode === 'tournament') {
		renderTournamentMonitor(r)
		return
	}
	$('#bracketRoundLabel').hidden = true
	$('#tournamentSummary').hidden = true
	$('#leaderboardSection').hidden = false
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

function renderTournamentMonitor(r) {
	const matches = Object.values(r.bracket?.matches || {})
	const championId = r.bracket?.championId
	$('#bracketRoundLabel').hidden = false
	$('#bracketRoundLabel').textContent = championId
		? `Turnamen selesai.`
		: `Babak ${r.bracket?.round || 1} sedang berlangsung (${matches.filter((m) => m.finishedAt).length}/${matches.length} pertandingan selesai).`
	$('#monitorGrid').innerHTML = matches
		.map((m) => {
			if (m.isBye) {
				return `<div class="monitor-card done"><h4>${esc(r.players[m.memberIds[0]]?.name || '?')}</h4><p><em>Bye, menang otomatis babak ini</em></p><span class="done-badge">Lanjut</span></div>`
			}
			const [a, b] = m.memberIds
			const total = m.deck.length / 2
			const matched = (m.matchedIds || []).length / 2
			const turnName = esc(r.players[m.memberIds[m.turnIndex % m.memberIds.length]]?.name || '?')
			const scoreLine = `${esc(r.players[a]?.name || '?')} <strong>${m.scores[a] || 0}</strong> &ndash; <strong>${m.scores[b] || 0}</strong> ${esc(r.players[b]?.name || '?')}`
			return `<div class="monitor-card ${m.finishedAt ? 'done' : ''}">
		<h4>${scoreLine}</h4>
		<p>Cocok: <strong>${matched}/${total}</strong> &middot; Langkah: <strong>${m.moves || 0}</strong></p>
		${!m.finishedAt ? `<p>Giliran: <strong>${turnName}</strong></p>` : ''}
		${m.finishedAt ? `<span class="done-badge">Menang: ${esc(r.players[m.winnerId]?.name || '?')}</span>` : ''}
		</div>`
		})
		.join('')
	if (championId) {
		$('#tournamentSummary').hidden = false
		$('#tournamentSummary').innerHTML = `<div class="champion-banner">\uD83C\uDFC6 Juara Turnamen: <strong>${esc(r.players[championId]?.name || '?')}</strong></div>`
	} else {
		$('#tournamentSummary').hidden = true
	}
	$('#leaderboardSection').hidden = false
	const standings = GameLogic.tournamentStandings(r)
	$('#leaderboardBody').innerHTML = standings
		.map(
			(row, i) =>
				`<tr><td>${i + 1}</td><td>${esc(row.name)}${row.isChampion ? ' \uD83C\uDFC6' : ''}</td><td colspan="2">${row.isChampion ? 'Juara' : row.eliminatedRound ? `Tersingkir babak ${row.eliminatedRound}` : 'Masih bermain'}</td><td>${row.isChampion || row.eliminatedRound ? 'Selesai' : 'Berjalan'}</td></tr>`
		)
		.join('')
	tournamentTick(r)
}

let tournamentTicking = false
async function tournamentTick(r) {
	if (tournamentTicking || r.bracket?.championId) return
	tournamentTicking = true
	try {
		const updated = await Store.updateRoom(r.code, (rm) => {
			if (rm.mode !== 'tournament' || !rm.bracket) return rm
			Object.keys(rm.bracket.matches).forEach((mid) => GameLogic.forceFinishIfExpired(rm, mid))
			GameLogic.maybeAdvanceTournamentRound(rm)
			return rm
		})
		if (updated) room = updated
	} finally {
		tournamentTicking = false
	}
}

function groupWinnerLabel(row) {
	if (!row.topScorers || !row.topScorers.length) return ''
	const names = row.topScorers.map((s) => esc(s.name)).join(' &amp; ')
	return `<br><span class="muted">\uD83C\uDFC6 Juara grup: <strong>${names}</strong> (${row.topScorers[0].score} poin)</span>`
}

function renderLeaderboard(r) {
	const board = GameLogic.leaderboard(r)
	$('#leaderboardBody').innerHTML = board
		.map(
			(row, i) =>
				`<tr><td>${i + 1}</td><td>${esc(row.name)}${row.members ? ` <span class="muted">(${row.members.map(esc).join(', ')})</span>` : ''}${groupWinnerLabel(row)}</td><td>${row.matchedCount}/${row.total}</td><td>${row.moves}</td><td>${row.finished ? 'Selesai' : 'Berjalan'}</td></tr>`
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
		if (rm.mode === 'tournament') {
			Object.values(rm.bracket?.matches || {}).forEach((m) => {
				if (!m.finishedAt) m.finishedAt = Date.now()
			})
			GameLogic.maybeAdvanceTournamentRound(rm)
			return rm
		}
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
