import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsAgentRoutingContent from '../content/docs/settings-agent-routing.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-agent-routing')({
  component: () => (
    <DocsPage id="settings-agent-routing">
      <SettingsAgentRoutingContent />
    </DocsPage>
  )
})
