import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsProviderIntegrationContent from '../content/docs/settings-provider-integration.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-provider-integration')({
  component: () => (
    <DocsPage id="settings-provider-integration">
      <SettingsProviderIntegrationContent />
    </DocsPage>
  )
})
