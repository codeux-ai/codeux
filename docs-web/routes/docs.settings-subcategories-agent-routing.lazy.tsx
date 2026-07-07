import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesAgentRoutingContent from '../content/docs/settings-subcategories-agent-routing.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-agent-routing')({
  component: () => (
    <DocsPage id="settings-subcategories-agent-routing">
      <SettingsSubcategoriesAgentRoutingContent />
    </DocsPage>
  )
})
