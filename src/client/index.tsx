/**
 * @dsh-ext/dsh-updater — browser half. Contributes the "Harness 更新" row to
 * the General settings section (settings.general.item). All host data flows
 * through the /dsh-updater JSON route; this half has no other business state.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings domain's SlotMap declaration for
// 'settings.general.item' (declared by the General settings section).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { en, zh, type LocaleKey } from './locales.ts'
import { UpdaterGeneralItem } from './UpdaterGeneralItem.tsx'

export const name = 'dsh-updater'

export const inject = ['slots', 'locale']

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.dshUpdater'

/** General-section row order: after language (0), appearance (10), and composer-enter (20). */
const GENERAL_ITEM_ORDER = 30

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Harness updater General-settings row copy. */
    'settings.dshUpdater': LocaleKey
  }
}

/**
 * Register the updater row into the General settings section. Waiting on the
 * slot declaration mirrors the official registrants: a direct register racing
 * the declaration fails. The owner passes no props; the row draws its own
 * label, status, and actions from the inject face.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-updater: copy dictionaries')

  const t = ctx.locale.bind(NS)
  const injectT = (): { t: (key: LocaleKey) => string } => ({ t: ctx.locale.bind(NS) })

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'dsh-updater',
    order: GENERAL_ITEM_ORDER,
    locale: NS,
    inject: injectT,
  }, UpdaterGeneralItem))
}
