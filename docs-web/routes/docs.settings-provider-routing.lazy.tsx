import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsProviderRoutingContent from '../content/docs/settings-provider-routing.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-provider-routing')({
  component: () => (
    <DocsPage id="settings-provider-routing">
      <SettingsProviderRoutingContent />
    </DocsPage>
  )
})
