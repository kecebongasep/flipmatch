// Logika inti permainan (tanpa DOM), dipakai bersama oleh admin.js dan player.js.
// File ini juga bisa di-require dari Node.js untuk pengujian otomatis.
(function (root) {
	const MAX_GROUP_SIZE = 8
	const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

	function normalizeAnswer(v) {
		return String(v).trim().toLowerCase().replace(/\s+/g, ' ')
	}

	function genRoomCode(len = 5) {
		let s = ''
		for (let i = 0; i < len; i++) s += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]
		return s
	}

	function genId(prefix) {
		return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
	}

	function shuffled(arr) {
		const a = [...arr]
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1))
			;[a[i], a[j]] = [a[j], a[i]]
		}
		return a
	}

	function buildDeck(pairs) {
		return shuffled(
			pairs.flatMap((p, i) => [
				{ id: `${i}-q`, type: 'q', pair: i, value: normalizeAnswer(p[1]), text: p[0], matched: false },
				{ id: `${i}-a`, type: 'a', pair: i, value: normalizeAnswer(p[1]), text: p[1], matched: false },
			])
		)
	}

	function checkMatch(cardA, cardB) {
		return !!cardA && !!cardB && cardA.type !== cardB.type && cardA.value === cardB.value
	}

	// Firebase Realtime Database menghapus object/array kosong ({}/[]) saat disimpan.
	// Room yang baru dibuat punya players/groups/boards berupa {} kosong, sehingga
	// setelah tersimpan & terbaca ulang dari Firebase, properti ini bisa hilang (undefined).
	// Fungsi ini memastikan ketiganya selalu berupa object sebelum dipakai.
	function normalizeRoom(room) {
		if (!room) return room
		if (!room.players) room.players = {}
		if (!room.groups) room.groups = {}
		if (!room.boards) room.boards = {}
		if (room.mode === 'tournament') {
			if (!room.bracket) room.bracket = { round: 1, matches: {}, eliminated: {}, championId: null, history: [] }
			if (!room.bracket.matches) room.bracket.matches = {}
			if (!room.bracket.eliminated) room.bracket.eliminated = {}
			if (!room.bracket.history) room.bracket.history = []
			Object.values(room.bracket.matches).forEach((m) => {
				if (!m.scores) m.scores = {}
				if (!m.pendingOpen) m.pendingOpen = []
				if (!m.matchedIds) m.matchedIds = []
				if (!m.memberIds) m.memberIds = []
			})
		}
		return room
	}

	function createRoom({ title, pairs, duration, mode, groupSize }) {
		return {
			code: genRoomCode(),
			title: (title || '').trim() || 'Permainan Tanpa Judul',
			pairs,
			duration: Math.min(3600, Math.max(15, Number(duration) || 120)),
			mode: mode === 'group' ? 'group' : mode === 'tournament' ? 'tournament' : 'individual',
			groupSize: mode === 'group' ? Math.min(MAX_GROUP_SIZE, Math.max(2, Number(groupSize) || 2)) : null,
			status: 'lobby',
			createdAt: Date.now(),
			startedAt: null,
			players: {},
			groups: {},
			boards: {},
			bracket: null,
		}
	}

	function addPlayer(room, name) {
		normalizeRoom(room)
		const id = genId('p')
		const player = {
			id,
			name: (name || '').trim().slice(0, 24) || `Pemain ${Object.keys(room.players).length + 1}`,
			joinedAt: Date.now(),
			groupId: null,
		}
		if (room.mode === 'group') {
			let target = Object.values(room.groups).find((g) => g.memberIds.length < room.groupSize && !g.finishedAt)
			if (!target) {
				const gid = genId('g')
				target = {
					id: gid,
					name: `Grup ${Object.keys(room.groups).length + 1}`,
					memberIds: [],
					turnIndex: 0,
					deck: [],
					pendingOpen: [],
					matchedIds: [],
					moves: 0,
					scores: {},
					startedAt: null,
					finishedAt: null,
					lastEvent: null,
				}
				room.groups[gid] = target
			}
			target.memberIds.push(id)
			target.scores[id] = 0
			player.groupId = target.id
		}
		room.players[id] = player
		return player
	}

	function startRoom(room) {
		normalizeRoom(room)
		room.status = 'playing'
		room.startedAt = Date.now()
		if (room.mode === 'group') {
			Object.values(room.groups).forEach((g) => {
				g.deck = buildDeck(room.pairs)
				g.startedAt = Date.now()
			})
		} else {
			Object.values(room.players).forEach((p) => {
				room.boards[p.id] = {
					id: p.id,
					deck: buildDeck(room.pairs),
					pendingOpen: [],
					matchedIds: [],
					moves: 0,
					score: 0,
					startedAt: Date.now(),
					finishedAt: null,
					lastEvent: null,
				}
			})
		}
		return room
	}

	function getEntity(room, entityId) {
		normalizeRoom(room)
		if (room.mode === 'tournament') return (room.bracket && room.bracket.matches[entityId]) || null
		return room.mode === 'group' ? room.groups[entityId] : room.boards[entityId]
	}

	function applyFlip(room, entityId, cardIndex, actingPlayerId, now = Date.now()) {
		const entity = getEntity(room, entityId)
		if (!entity || entity.finishedAt) return false
		if (room.mode === 'group' || room.mode === 'tournament') {
			if (!entity.memberIds || !entity.memberIds.length) return false
			const currentTurnPlayer = entity.memberIds[entity.turnIndex % entity.memberIds.length]
			if (currentTurnPlayer !== actingPlayerId) return false
		}
		const card = entity.deck[cardIndex]
		if (!card || card.matched) return false
		const pending = entity.pendingOpen || []
		if (pending.includes(cardIndex)) return false
		if (pending.length === 0) {
			entity.pendingOpen = [cardIndex]
			entity.lastEvent = { type: 'flip1', cards: [cardIndex], by: actingPlayerId, at: now }
			return true
		}
		const a = pending[0]
		const b = cardIndex
		entity.moves = (entity.moves || 0) + 1
		const isMatch = checkMatch(entity.deck[a], entity.deck[b])
		entity.pendingOpen = []
		if (isMatch) {
			entity.deck[a].matched = true
			entity.deck[b].matched = true
			entity.matchedIds = [...(entity.matchedIds || []), a, b]
			if (room.mode === 'group' || room.mode === 'tournament') entity.scores[actingPlayerId] = (entity.scores[actingPlayerId] || 0) + 1
			else entity.score = (entity.score || 0) + 1
			entity.lastEvent = { type: 'match', cards: [a, b], by: actingPlayerId, at: now }
			if (entity.matchedIds.length === entity.deck.length) entity.finishedAt = now
		} else {
			entity.lastEvent = { type: 'mismatch', cards: [a, b], by: actingPlayerId, at: now }
			if (room.mode === 'group' || room.mode === 'tournament') entity.turnIndex = (entity.turnIndex + 1) % entity.memberIds.length
		}
		return true
	}

	function forceFinishIfExpired(room, entityId, now = Date.now()) {
		const entity = getEntity(room, entityId)
		if (!entity || entity.finishedAt) return false
		if (room.mode === 'tournament') {
			if (!entity.startedAt) return false
			if (now - entity.startedAt >= room.duration * 1000) {
				entity.finishedAt = now
				return true
			}
			return false
		}
		if (!room.startedAt) return false
		if (now - room.startedAt >= room.duration * 1000) {
			entity.finishedAt = now
			return true
		}
		return false
	}

	// ---- Mode Turnamen (gugur, 2 orang per babak) ----

	function pairUpIds(ids) {
		const pairs = []
		for (let i = 0; i < ids.length; i += 2) {
			if (i + 1 < ids.length) pairs.push([ids[i], ids[i + 1]])
			else pairs.push([ids[i]])
		}
		return pairs
	}

	function buildMatch(round, memberIds, pairsData) {
		const isBye = memberIds.length < 2
		const scores = {}
		memberIds.forEach((id) => {
			scores[id] = 0
		})
		return {
			id: genId('m'),
			round,
			memberIds,
			isBye,
			turnIndex: 0,
			deck: isBye ? [] : buildDeck(pairsData),
			pendingOpen: [],
			matchedIds: [],
			moves: 0,
			scores,
			startedAt: isBye ? null : Date.now(),
			finishedAt: isBye ? Date.now() : null,
			winnerId: isBye ? memberIds[0] : null,
			lastEvent: null,
		}
	}

	function decideMatchWinner(m) {
		if (m.isBye) return m.memberIds[0]
		const [a, b] = m.memberIds
		const sa = m.scores[a] || 0
		const sb = m.scores[b] || 0
		if (sa !== sb) return sa > sb ? a : b
		// Seri saat waktu habis: menang ditentukan acak supaya adil (tidak selalu memihak satu posisi).
		return Math.random() < 0.5 ? a : b
	}

	// pairAssignments: array pasangan playerId, misal [[id1,id2],[id3,id4],[id5]] (array 1 anggota = bye/menang otomatis).
	function startTournament(room, pairAssignments) {
		normalizeRoom(room)
		room.status = 'playing'
		room.startedAt = Date.now()
		room.bracket = { round: 1, matches: {}, eliminated: {}, championId: null, history: [] }
		pairAssignments.forEach((pair) => {
			const match = buildMatch(1, pair, room.pairs)
			room.bracket.matches[match.id] = match
		})
		maybeAdvanceTournamentRound(room)
		return room
	}

	// Mengecek apakah semua pertandingan di babak berjalan sudah selesai; kalau ya, buat babak
	// selanjutnya dari para pemenang, atau tetapkan juara kalau cuma tersisa 1 pemenang.
	function maybeAdvanceTournamentRound(room) {
		normalizeRoom(room)
		if (room.mode !== 'tournament' || !room.bracket || room.bracket.championId) return false
		const matches = Object.values(room.bracket.matches)
		if (!matches.length) return false
		matches.forEach((m) => {
			if (m.finishedAt && m.winnerId == null) m.winnerId = decideMatchWinner(m)
		})
		const allDone = matches.every((m) => m.winnerId != null)
		if (!allDone) return false
		const winners = matches.map((m) => m.winnerId)
		const losers = matches.flatMap((m) => m.memberIds.filter((id) => id !== m.winnerId))
		losers.forEach((id) => {
			room.bracket.eliminated[id] = { round: room.bracket.round }
		})
		room.bracket.history.push({
			round: room.bracket.round,
			matches: matches.map((m) => ({ memberIds: m.memberIds, scores: m.scores, winnerId: m.winnerId, isBye: !!m.isBye })),
		})
		if (winners.length <= 1) {
			room.bracket.championId = winners[0] || null
			room.status = 'finished'
			return true
		}
		room.bracket.round += 1
		room.bracket.matches = {}
		pairUpIds(winners).forEach((pair) => {
			const match = buildMatch(room.bracket.round, pair, room.pairs)
			room.bracket.matches[match.id] = match
		})
		return true
	}

	// Ringkasan peringkat akhir turnamen (dipanggil setelah championId sudah terisi).
	function tournamentStandings(room) {
		normalizeRoom(room)
		const elim = (room.bracket && room.bracket.eliminated) || {}
		const championId = room.bracket ? room.bracket.championId : null
		return Object.keys(room.players)
			.map((id) => ({
				id,
				name: room.players[id]?.name || '?',
				isChampion: championId === id,
				eliminatedRound: elim[id] ? elim[id].round : null,
			}))
			.sort((a, b) => {
				if (a.isChampion) return -1
				if (b.isChampion) return 1
				const ra = a.eliminatedRound == null ? Infinity : a.eliminatedRound
				const rb = b.eliminatedRound == null ? Infinity : b.eliminatedRound
				return rb - ra
			})
	}

	function leaderboard(room) {
		normalizeRoom(room)
		const entities = room.mode === 'group' ? Object.values(room.groups) : Object.values(room.boards)
		return entities
			.map((e) => {
				const matchedCount = (e.matchedIds || []).length / 2
				const total = e.deck ? e.deck.length / 2 : 0
				const elapsed = e.startedAt ? ((e.finishedAt || Date.now()) - e.startedAt) / 1000 : 0
				const base = { id: e.id, matchedCount, total, moves: e.moves || 0, elapsed, finished: !!e.finishedAt }
				if (room.mode === 'group') {
					const memberScores = e.memberIds.map((id) => ({ id, name: room.players[id]?.name || '?', score: (e.scores && e.scores[id]) || 0 }))
					const maxScore = memberScores.reduce((m, s) => Math.max(m, s.score), 0)
					const topScorers = maxScore > 0 ? memberScores.filter((s) => s.score === maxScore) : []
					return {
						...base,
						name: e.name,
						members: e.memberIds.map((id) => room.players[id]?.name || '?'),
						scores: e.scores,
						memberScores,
						topScorers,
					}
				}
				return { ...base, name: room.players[e.id]?.name || '?', members: null }
			})
			.sort((x, y) => y.matchedCount - x.matchedCount || x.moves - y.moves || x.elapsed - y.elapsed)
	}

	const GameLogic = {
		MAX_GROUP_SIZE,
		normalizeAnswer,
		genRoomCode,
		genId,
		shuffled,
		buildDeck,
		checkMatch,
		createRoom,
		normalizeRoom,
		addPlayer,
		startRoom,
		getEntity,
		applyFlip,
		forceFinishIfExpired,
		leaderboard,
		pairUpIds,
		buildMatch,
		startTournament,
		maybeAdvanceTournamentRound,
		tournamentStandings,
	}

	if (typeof module !== 'undefined' && module.exports) module.exports = GameLogic
	else root.GameLogic = GameLogic
})(typeof window !== 'undefined' ? window : globalThis)
