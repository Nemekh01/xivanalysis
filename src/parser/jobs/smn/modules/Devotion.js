import {t} from '@lingui/macro'
import {Trans} from '@lingui/react'
import Module from 'parser/core/Module'
import DISPLAY_ORDER from './DISPLAY_ORDER'
import ACTIONS from 'data/ACTIONS'
import STATUSES from 'data/STATUSES'
import {RotationTable} from 'components/ui/RotationTable'
import React from 'react'

const PLAYERS_HIT_TARGET = 8
const MAX_DEVOTION_DURATION = 30000

export default class Devotion extends Module {
	static displayOrder = DISPLAY_ORDER.DEVOTION
	static handle = 'devotion'
	static title = t('smn.devotion.title')`Devotion Actions`
	static dependencies = [
		'combatants',
		'timeline',
		'data',
	]

	_devotionWindows = []

	// {
	//	start: Number
	//	end: Number
	//	playersHit: [Number]
	//	events: [Event]
	// }
	_currentWindow = null

	constructor(...args) {
		super(...args)
		this.addEventHook('cast', {by: 'player'}, this._onCast)
		this.addEventHook('cast', {by: 'pet', abilityId: ACTIONS.DEVOTION.id}, this._onPetDevotionCast)
		this.addEventHook('complete', this._onComplete)
		this.addEventHook('normalisedapplybuff', {by: 'pet', abilityId: STATUSES.DEVOTION.id}, this._countDevotionTargets)
		this.parser.fightFriendlies.forEach(id => {
			this.addEventHook('removebuff', {to: id, abilityId: STATUSES.DEVOTION.id}, this._onDevotionRemoved)
		})
	}

	_onComplete() {
		this._closeWindow(this.parser.fight.end_time - this.parser.fight.start_time)
	}

	_onDevotionRemoved(event) {
		this._closeWindow(event.timestamp)
	}

	_onPetDevotionCast(event) {
		this._openWindow(event.timestamp)
	}

	_countDevotionTargets(event) {
		if (this._currentWindow) {
			const playersHit = event.confirmedEvents
				.map(hit => hit.targetID)
				.filter(id => this.parser.fightFriendlies.findIndex(f => f.id === id) >= 0)
			playersHit.forEach(id => {
				if (!this._currentWindow.playersHit.includes(id)) {
					this._currentWindow.playersHit.push(id)
				}
			})
		}
	}

	_onCast(event) {
		const action = this.data.getAction(event.ability.guid)
		// Disregard auto attacks
		if (!action || action.autoAttack) {
			return
		}
		if (this._currentWindow && this.combatants.selected.hasStatus(STATUSES.DEVOTION.id)) {
			this._pushToWindow(event)
		}
	}

	_pushToWindow(event) {
		if (this._currentWindow) {
			this._currentWindow.events.push(event)
		}
	}

	_openWindow(timestamp) {
		if (this._currentWindow) {
			// Make sure we keep the window open if this is a duplicate application
			if (this._currentWindow.start + MAX_DEVOTION_DURATION < timestamp) {
				this._closeWindow(this._currentWindow.start + MAX_DEVOTION_DURATION)
			} else {
				return
			}
		}

		const lastWindow = this._devotionWindows[this._devotionWindows.length - 1]
		if (lastWindow && lastWindow.end === timestamp) {
			this._currentWindow = this._devotionWindows.pop()
			this._currentWindow.end = undefined
		} else {
			this._currentWindow = {
				start: timestamp,
				events: [],
				playersHit: [],
			}
		}
		return
	}

	_closeWindow(timestamp) {
		if (this._currentWindow) {
			this._currentWindow.end = timestamp
			this._devotionWindows.push(this._currentWindow)
			this._currentWindow = null
		}
	}

	output() {
		const rotationData = this._devotionWindows.map(devotionWindow => {
			if (!devotionWindow) {
				return null
			}
			const targetsData = {}
			targetsData.players = {
				actual: devotionWindow.playersHit.length,
				expected: PLAYERS_HIT_TARGET,
			}
			const windowStart = devotionWindow.start - this.parser.fight.start_time
			const windowEnd = devotionWindow.end - this.parser.fight.start_time
			return {
				start: windowStart,
				end: windowEnd,
				rotation: devotionWindow.events,
				targetsData,
			}
		}).filter(window => window !== null)
		const rotationTargets = [{
			header: <Trans id="smn.devotion.players-count">Players Buffed</Trans>,
			accessor: 'players',
		}]
		return <RotationTable
			targets={rotationTargets}
			data={rotationData}
			onGoto={this.timeline.show}
			headerTitle={<Trans id="smn.devotion.table-header">Devotion Actions</Trans>}
		/>
	}
}