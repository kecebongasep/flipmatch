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

let audioCtx = null
function ensureAudio() {
	try {
		audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
		if (audioCtx.state === 'suspended') audioCtx.resume()
	} catch (e) {}
}
function playCorrectSound() {
	if (!audioCtx) return
	const now = audioCtx.currentTime
	const gain = audioCtx.createGain()
	gain.connect(audioCtx.destination)
	gain.gain.setValueAtTime(0.0001, now)
	gain.gain.exponentialRampToValueAtTime(0.13, now + 0.025)
	gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5)
	;[523.25, 659.25, 783.99].forEach((freq, i) => {
		const osc = audioCtx.createOscillator()
		osc.type = 'sine'
		osc.frequency.value = freq
		osc.connect(gain)
		osc.start(now + i * 0.07)
		osc.stop(now + 0.5)
	})
}

let room = null
let unsub = null
let playerId = null
let roomCode = null
let timerInt = null
let lastHandledMismatchAt = null
let lastHandledMatchAt = null

const urlCode = new URLSearchParams(location.search).get('code')
if (urlCode) $('#codeInput').value = urlCode.toUpperCase()

function fitGrid(n) {
	const w = innerWidth
	let cols
	if (w <= 560) cols = n <= 12 ? 3 : n <= 20 ? 4 : 5
	else if (w <= 850) cols = n <= 12 ? 4 : n <= 24 ? 5 : 6
	else cols = n <= 12 ? 4 : n <= 20 ? 5 : n <= 30 ? 6 : 8
	$('#cardGrid').style.setProperty('--grid-cols', cols)
}

function getMyEntity() {
	if (!room || !playerId) return null
	if (room.mode === 'group') {
		const me = room.players[playerId]
		if (!me || !me.groupId) return null
		return room.groups[me.groupId]
	}
	return room.boards[playerId]
}

$('#joinForm').addEventListener('submit', async (e) => {
	e.preventDefault()
	const code = $('#codeInput').value.trim().toUpperCase()
	const name = $('#nameInput').value.trim()
	$('#joinError').hidden = true
	if (!code || !name) {
		$('#joinError').hidden = false
		$('#joinError').textContent = 'Isi kode room dan nama kamu.'
		return
	}
	const existing = await Store.getRoom(code)
	if (!existing) {
		$('#joinError').hidden = false
		$('#joinError').textContent = window.FLIPMATCH_IS_LOCAL
			? 'Room tidak ditemukan. Pastikan admin membuat room di TAB lain pada komputer ini (mode lokal).'
			: 'Room tidak ditemukan. Cek kode lagi ke admin.'
		return
	}
	if (existing.status !== 'lobby') {
		$('#joinError').hidden = false
		$('#joinError').textContent = 'Permainan sudah dimulai/selesai. Minta admin membuat room baru.'
		return
	}
	let myId = null
	const updated = await Store.updateRoom(code, (rm) => {
		if (rm.status !== 'lobby') return rm
		const player = GameLogic.addPlayer(rm, name)
		myId = player.id
		return rm
	})
	if (!updated || !myId) {
		$('#joinError').hidden = false
		$('#joinError').textContent = 'Gagal bergabung, coba lagi.'
		return
	}
	if (updated.status !== 'lobby') {
		$('#joinError').hidden = false
		$('#joinError').textContent = 'Permainan sudah dimulai duluan. Minta admin membuat room baru.'
		return
	}
	roomCode = code
	playerId = myId
	room = updated
	subscribeToRoom(code)
	renderFromRoom()
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
	$('#joinPanel').hidden = true
	if (room.status === 'lobby') {
		$('#waitPanel').hidden = false
		$('#playPanel').hidden = true
		$('#resultPanel').hidden = true
		renderWaitPanel()
		return
	}
	const entity = getMyEntity()
	if (!entity) return
	if (entity.finishedAt) {
		$('#waitPanel').hidden = true
		$('#playPanel').hidden = true
		$('#resultPanel').hidden = false
		clearInterval(timerInt)
		renderResult()
	} else {
		$('#waitPanel').hidden = true
		$('#resultPanel').hidden = true
		$('#playPanel').hidden = false
		$('#playTitle').textContent = room.title
		renderPlay(entity)
		if (!timerInt) timerInt = setInterval(tick, 1000)
	}
}

function renderWaitPanel() {
	const me = room.players[playerId]
	$('#waitName').textContent = me?.name || ''
	if (room.mode === 'group' && me?.groupId) {
		const g = room.groups[me.groupId]
		$('#waitGroupInfo').hidden = false
		$('#waitGroupInfo').innerHTML = `Grup kamu: <strong>${esc(g.name)}</strong><br>Anggota: ${g.memberIds.map((id) => esc(room.players[id]?.name || '?')).join(', ')}`
	} else {
		$('#waitGroupInfo').hidden = true
	}
}

function isRecentlyRevealed(entity, i) {
	return entity.lastEvent && entity.lastEvent.type === 'mismatch' && entity.lastEvent.cards.includes(i) && Date.now() - entity.lastEvent.at < 850
}

function renderPlay(entity) {
	fitGrid(entity.deck.length)
	$('#matchTarget').textContent = entity.deck.length / 2
	$('#cardGrid').innerHTML = entity.deck
		.map((c, i) => {
			const flipped = c.matched || (entity.pendingOpen || []).includes(i) || isRecentlyRevealed(entity, i)
			return `<button class="memory-card${flipped ? ' flipped' : ''}${c.matched ? ' matched' : ''}" data-card="${i}" type="button" ${c.matched ? 'disabled' : ''}><span class="card-inner"><span class="card-face card-back"></span><span class="card-face card-front">${esc(c.text)}</span></span></button>`
		})
		.join('')
	$$('[data-card]').forEach((b) => b.addEventListener('click', onCardClick))
	renderStats(entity)

	if (entity.lastEvent && entity.lastEvent.type === 'mismatch' && entity.lastEvent.at !== lastHandledMismatchAt) {
		lastHandledMismatchAt = entity.lastEvent.at
		setTimeout(() => {
			const latest = getMyEntity()
			if (latest && latest.id === entity.id) renderPlay(latest)
		}, 850)
	}
	if (entity.lastEvent && entity.lastEvent.type === 'match' && entity.lastEvent.at !== lastHandledMatchAt) {
		lastHandledMatchAt = entity.lastEvent.at
		playCorrectSound()
	}
}

function renderStats(entity) {
	$('#moves').textContent = entity.moves || 0
	$('#matched').textContent = (entity.matchedIds || []).length / 2
	$('#progressBar').style.width = `${((entity.matchedIds || []).length / entity.deck.length) * 100}%`
	if (room.mode === 'group') {
		$('#turnIndicator').hidden = false
		const turnId = entity.memberIds[entity.turnIndex % entity.memberIds.length]
		$('#turnName').textContent = turnId === playerId ? `${room.players[turnId]?.name || '?'} (kamu)` : room.players[turnId]?.name || '?'
	} else {
		$('#turnIndicator').hidden = true
	}
	const remaining = room.startedAt ? Math.max(0, room.duration - Math.floor((Date.now() - room.startedAt) / 1000)) : room.duration
	$('#timer').textContent = fmt(remaining)
}

async function onCardClick(e) {
	const idx = +e.currentTarget.dataset.card
	const entity = getMyEntity()
	if (!entity || entity.finishedAt) return
	if (room.mode === 'group') {
		const turnId = entity.memberIds[entity.turnIndex % entity.memberIds.length]
		if (turnId !== playerId) {
			toast('Bukan giliranmu.')
			return
		}
	}
	ensureAudio()
	const updated = await Store.updateRoom(roomCode, (rm) => {
		GameLogic.applyFlip(rm, entity.id, idx, playerId)
		return rm
	})
	if (updated) {
		room = updated
		renderFromRoom()
	}
}

async function tick() {
	if (!room || !room.startedAt) return
	const entity = getMyEntity()
	if (!entity) return
	const remaining = Math.max(0, room.duration - Math.floor((Date.now() - room.startedAt) / 1000))
	if ($('#timer')) $('#timer').textContent = fmt(remaining)
	if (remaining <= 0 && !entity.finishedAt) {
		const updated = await Store.updateRoom(roomCode, (rm) => {
			GameLogic.forceFinishIfExpired(rm, entity.id)
			return rm
		})
		if (updated) {
			room = updated
			renderFromRoom()
		}
	}
}

function renderResult() {
	const entity = getMyEntity()
	const total = entity.deck.length / 2
	const matched = (entity.matchedIds || []).length / 2
	const all = matched === total
	$('#resultIcon').textContent = all ? '\u2713' : '!'
	$('#resultIcon').style.background = all ? '#e8f2ec' : '#fce9e7'
	$('#resultIcon').style.color = all ? 'var(--green)' : 'var(--red)'
	$('#resultTitle').textContent = all ? 'Selesai, semua cocok!' : 'Waktu habis'
	$('#resultText').textContent = `Kamu menemukan ${matched} dari ${total} pasangan dalam ${entity.moves || 0} langkah.`
	const board = GameLogic.leaderboard(room)
	$('#resultScores').innerHTML = board
		.map(
			(row, i) =>
				`<div class="score-row${i === 0 ? ' winner' : ''}"><span>${esc(row.name)}${row.members ? ` <span class="muted">(${row.members.map(esc).join(', ')})</span>` : ''}</span><strong>${row.matchedCount}/${row.total} pasangan</strong></div>`
		)
		.join('')
}

$('#playAgainBtn').addEventListener('click', () => {
	clearInterval(timerInt)
	timerInt = null
	if (unsub) unsub()
	room = null
	playerId = null
	roomCode = null
	$('#resultPanel').hidden = true
	$('#waitPanel').hidden = true
	$('#playPanel').hidden = true
	$('#joinPanel').hidden = false
	$('#nameInput').value = ''
})

window.addEventListener('resize', () => {
	const entity = getMyEntity()
	if (entity && !$('#playPanel').hidden) fitGrid(entity.deck.length)
})
