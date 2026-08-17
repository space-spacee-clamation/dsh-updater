/**
 * @dsh-ext/dsh-updater — browser half. Contributes the "Harness 更新" tab to
 * the Plugins settings section. All host data flows through the /dsh-updater
 * JSON route; this half has no other business state.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings shell's SlotMap declaration for 'settings.plugins.tab'.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { en, zh, type LocaleKey } from './locales.ts'
import { UpdaterTab } from './UpdaterTab.tsx'

export const name = 'dsh-updater'

export const inject = ['slots', 'locale']

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.dshUpdater'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Harness updater settings tab copy. */
    'settings.dshUpdater': LocaleKey
  }
}

/**
 * Register the updater tab. Waiting on the slot declaration mirrors the
 * official registrants: a direct register racing the declaration fails.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-updater: copy dictionaries')

  const t = ctx.locale.bind(NS)
  const injectT = (): { t: (key: LocaleKey) => string } => ({ t: ctx.locale.bind(NS) })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'dsh-updater',
    order: 20,
    label: () => t('tab'),
    locale: NS,
    inject: injectT,
  }, UpdaterTab))
}
