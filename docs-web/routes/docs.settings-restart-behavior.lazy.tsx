import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsRestartBehaviorContent from '../content/docs/settings-restart-behavior.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-restart-behavior')({
  component: () => (
    <DocsPage id="settings-restart-behavior">
      <SettingsRestartBehaviorContent />
    </DocsPage>
  )
})
