import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsIntegrationsContent from '../content/docs/settings-integrations.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-integrations')({
  component: () => (
    <DocsPage id="settings-integrations">
      <SettingsIntegrationsContent />
    </DocsPage>
  )
})
