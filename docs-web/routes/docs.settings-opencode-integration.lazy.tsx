import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsOpencodeIntegrationContent from '../content/docs/settings-opencode-integration.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-opencode-integration')({
  component: () => (
    <DocsPage id="settings-opencode-integration">
      <SettingsOpencodeIntegrationContent />
    </DocsPage>
  )
})
