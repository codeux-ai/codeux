import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsProviderCredentialsContent from '../content/docs/settings-provider-credentials.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-provider-credentials')({
  component: () => (
    <DocsPage id="settings-provider-credentials">
      <SettingsProviderCredentialsContent />
    </DocsPage>
  )
})
